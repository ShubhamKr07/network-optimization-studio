import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { findUserById } from "../lib/sessionUser.js";
import { logger } from "../lib/logger.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";

export const SESSION_COOKIE = "nos_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The one session-cookie clear: log-out, account deletion, and a deleted account's leftover cookie (WQF-B6). */
export function clearSessionCookie(res: Response): void {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, { path: "/", sameSite: crossOrigin ? "none" : "lax", secure: crossOrigin });
}
// The fallback is published in this repo, so a production process signing
// cookies with it would let anyone forge a session. Fail boot instead. Logged
// through pino first because Render drops stderr (see index.ts).
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  logger.fatal("[boot] SESSION_SECRET is unset in production; refusing to start");
  throw new Error("SESSION_SECRET is required in production");
}
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

/** The session's user; undefined when absent, expired or revoked; null when the cookie is validly signed but its user row no longer exists (a deleted account). Throws if the lookup fails. */
export async function sessionUser(req: Request) {
  const raw: unknown = req.signedCookies?.[SESSION_COOKIE];
  if (typeof raw !== "string") return undefined;
  const [userId, issuedAt, tag] = raw.split(".");
  if (!tag || !(Date.now() - Number(issuedAt) <= SESSION_TTL_MS)) return undefined;
  const user = await findUserById(userId);
  // WQF-B6 (D11) — a deleted account: null, not undefined, so the auth boundary
  // can clear the cookie as well as answer "signed out".
  if (!user) return null;
  // WQF-B4 — a user who has not accepted the CURRENT terms holds no session.
  // Sessions are stateless signed cookies, so this one comparison is the
  // whole one-time log-out (deploy) and every future re-acceptance (a
  // constant bump). It runs at the start of each request, so a request that
  // already passed it when the version changed completes normally.
  return passwordTag(user.passwordHash) === tag && user.termsVersion === CURRENT_TERMS_VERSION ? user : undefined;
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
    // WQF-B6 (D11) — a validly signed cookie whose account is gone is signed out
    // AND cleared, so the browser stops sending it (e.g. a second delete).
    if (user === null) clearSessionCookie(res);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.userId = user.id;
  next();
}

/**
 * ADM — admin gate. EVERY failure answers 404 `Not found` (signed out, stale
 * terms, deleted account, student, instructor, failed lookup) so the admin
 * surface is indistinguishable from a route that does not exist.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  let user: Awaited<ReturnType<typeof sessionUser>>;
  try { user = await sessionUser(req); } catch {
    // No error binding (api-server/CLAUDE.md: drizzle errors carry their params).
    logger.error({ step: "admin-session-lookup" }, "admin session lookup failed");
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Exact raw value, not parseRole: an unknown role must never pass this gate.
  if (!user || user.role !== "admin") { res.status(404).json({ error: "Not found" }); return; }
  req.userId = user.id;
  next();
}
