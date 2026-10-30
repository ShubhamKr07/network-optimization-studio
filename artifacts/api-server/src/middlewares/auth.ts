import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { findUserById } from "../lib/sessionUser.js";
import { logger } from "../lib/logger.js";

export const SESSION_COOKIE = "nos_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_SECRET = process.env.SESSION_SECRET || "arcadia-dev-secret";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// SEC-2 — the cookie (signed by cookie-parser) is `<userId>.<issuedAtMs>.<tag>`,
// where tag is derived from the user's CURRENT password hash. A password reset
// therefore invalidates every session issued before it, which is what kills a
// pre-registered squatter's session once the real mailbox owner resets.
// issuedAt enforces the 7-day TTL server-side rather than trusting maxAge.
function passwordTag(passwordHash: string | null): string {
  return createHmac("sha256", SESSION_SECRET).update(passwordHash ?? "").digest("base64url").slice(0, 22);
}

export function sessionCookieValue(user: { id: string; passwordHash: string | null }): string {
  return `${user.id}.${Date.now()}.${passwordTag(user.passwordHash)}`;
}

/** The session's user; undefined when absent, expired or revoked. Throws if the lookup fails. */
export async function sessionUser(req: Request) {
  const raw: unknown = req.signedCookies?.[SESSION_COOKIE];
  if (typeof raw !== "string") return undefined;
  const [userId, issuedAt, tag] = raw.split(".");
  if (!tag || !(Date.now() - Number(issuedAt) <= SESSION_TTL_MS)) return undefined;
  const user = await findUserById(userId);
  return user && passwordTag(user.passwordHash) === tag ? user : undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Six path-less sub-routers each `router.use(requireAuth)`, so one request
  // passes here several times; only this function sets req.userId.
  if (req.userId) return next();
  let user: Awaited<ReturnType<typeof sessionUser>>;
  try {
    user = await sessionUser(req);
  } catch {
    // No error binding: a failed drizzle query's message carries its params, i.e.
    // the user id. See api-server/CLAUDE.md on DrizzleQueryError.
    logger.error({ step: "session-lookup" }, "session lookup failed");
    res.status(500).json({ error: "Could not verify your session." });
    return;
  }
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.userId = user.id;
  next();
}
