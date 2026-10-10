import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import argon2 from "argon2";
import { db, usersTable } from "@workspace/db";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  LogoutUserResponse,
  GetCurrentAuthUserResponse,
  registerUserBodyPasswordMin,
  registerUserBodyPasswordMax,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  resetPasswordBodyPasswordMin,
  resetPasswordBodyPasswordMax,
} from "@workspace/api-zod";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../middlewares/auth.js";
import { posthog } from "../lib/posthog.js";
import { withNormalizedEmail } from "../lib/normalizeEmail.js";
import { sendEmail } from "../lib/email.js";
import { makeRateLimiter } from "../lib/rateLimit.js";
import {
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  resetEmailHtml,
  resetEmailSubject,
} from "../lib/resetTokens.js";
import * as Sentry from "@sentry/node";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Case-insensitive lookup by email.
 *
 * `withNormalizedEmail` guarantees the *incoming* address is already lowercase,
 * so `eq(usersTable.email, email)` would be enough for every row written after
 * this change. It is NOT enough for rows written before it: an account stored
 * as `Foo@x.com` would stop matching its own owner's login the moment we began
 * lowercasing the input — turning the bug this fixes into a permanent lockout
 * for exactly the users who already hit it. Comparing `lower(email)` covers
 * both eras with one query.
 *
 * The cost is that the plain `unique()` index on `email` can't serve this
 * predicate (Postgres would need a `lower(email)` expression index). At
 * classroom scale — tens of rows — a sequential scan is irrelevant; see the
 * changelog entry for the follow-up that makes the constraint itself
 * case-insensitive.
 */
async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`);
  return user;
}

// Simple in-memory rate limit for login: 20 attempts/min/IP. Raised from 10
// (2026-09-25) for the co-located pilot cohort — ~50 students behind one campus
// NAT IP can re-login (after the 7-day session expires / logout / new device)
// without the limiter hard-blocking; at 20/min a 50-student re-login wave clears
// over ~2-3 min via client retries. Still per-IP + in-memory (single-instance,
// no restart survival) — if a co-located cohort must ALL re-login within one
// minute, key this per-account instead of per-IP (distinct accounts, shared IP).
const LOGIN_RATE_LIMIT = 20;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_RATE_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_RATE_LIMIT;
}

// Test-only escape hatch: the counter above is module-level and otherwise
// persists for the lifetime of the process, which a test suite calling login
// dozens of times (from a single loopback IP) would trip. Not used by any
// production code path.
export function resetLoginRateLimiterForTests(): void {
  loginAttempts.clear();
}

function setSessionCookie(res: Response, userId: string) {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, userId, {
    httpOnly: true,
    signed: true,
    sameSite: crossOrigin ? "none" : "lax",
    secure: crossOrigin,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

function toAuthUser(user: { id: string; email: string | null; role: string }) {
  return { id: user.id, email: user.email ?? "", role: user.role as "student" | "instructor" };
}

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterUserBody.safeParse(withNormalizedEmail(req.body));
  if (!parsed.success) {
    res.status(400).json({
      error: `email and password (${registerUserBodyPasswordMin}-${registerUserBodyPasswordMax} chars) are required`,
    });
    return;
  }
  const { email, password } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await argon2.hash(password);
  const [user] = await db.insert(usersTable).values({
    email,
    passwordHash,
    role: "student",
  }).returning();

  setSessionCookie(res, user.id);

  posthog?.capture({
    distinctId: user.id,
    event: "user registered",
    properties: {
      role: user.role,
      $set: { email: user.email, role: user.role },
    },
  });

  res.status(201).json(LoginUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/login", async (req: Request, res: Response) => {
  // Parsing precedes both the rate-limit check and argon2 on purpose: an
  // over-length password is refused here, before any hashing work is spent on
  // it. The 401 is the same generic body every other failure returns, so a
  // caller still cannot tell an over-long password from a wrong one.
  const parsed = LoginUserBody.safeParse(withNormalizedEmail(req.body));
  if (!parsed.success) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const { email, password } = parsed.data;

  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many login attempts, try again shortly" });
    return;
  }

  const user = await findUserByEmail(email);
  // Identical failure path whether the email doesn't exist or the password is
  // wrong — never let a caller distinguish the two (no user enumeration).
  const passwordHash = user?.passwordHash ?? null;
  const validPassword = passwordHash ? await argon2.verify(passwordHash, password) : false;
  if (!user || !validPassword) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  setSessionCookie(res, user.id);

  posthog?.capture({
    distinctId: user.id,
    event: "user logged in",
    properties: {
      role: user.role,
      $set: { email: user.email, role: user.role },
    },
  });

  res.json(LoginUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const userId = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  const crossOrigin = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: crossOrigin ? "none" : "lax",
    secure: crossOrigin,
  });

  if (userId) {
    posthog?.capture({
      distinctId: userId,
      event: "user logged out",
    });
  }

  res.json(LogoutUserResponse.parse({ success: true }));
});

router.get("/auth/user", async (req: Request, res: Response) => {
  const userId = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (!userId) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json(GetCurrentAuthUserResponse.parse({ user: user ? toAuthUser(user) : null }));
});

// Reset-request limits. Per IP, lower than login's 20 because this endpoint
// sends mail; per address, which is what stops someone mailbombing a known
// student. Both answer 429 whether or not the account exists, so neither
// becomes an existence oracle.
const forgotIpLimiter = makeRateLimiter(10, 60 * 1000);
const forgotEmailLimiter = makeRateLimiter(3, 60 * 60 * 1000);

export function resetForgotPasswordLimitersForTests(): void {
  forgotIpLimiter.reset();
  forgotEmailLimiter.reset();
}

/**
 * Everything that happens AFTER the 200 has already gone out. Issues a token
 * only for a row that can actually log in: `password_hash` is nullable, login
 * rejects a null one, and provisioning a first password here would quietly
 * turn reset into an account-conversion path nothing asked for.
 *
 * Repeat requests are last-token-wins — the newest overwrites an unexpired
 * one, and the email copy says so. Refusing while a live token exists would
 * strand a user whose first email failed to send for the rest of the hour.
 */
async function issueResetToken(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) return;

  const token = generateResetToken();
  await db
    .update(usersTable)
    .set({
      resetTokenHash: hashResetToken(token),
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    })
    .where(eq(usersTable.id, user.id));

  await sendEmail(email, resetEmailSubject, resetEmailHtml(token));

  posthog?.capture({ distinctId: user.id, event: "password reset requested" });
}

router.post("/auth/forgot-password", (req: Request, res: Response) => {
  const parsed = ForgotPasswordBody.safeParse(withNormalizedEmail(req.body));
  const ip = req.ip ?? "unknown";

  // `||` short-circuits, so a request already refused on IP does not also
  // consume the address's hourly budget.
  if (forgotIpLimiter.check(ip) || (parsed.success && forgotEmailLimiter.check(parsed.data.email))) {
    res.status(429).json({ error: "Too many reset requests, try again shortly" });
    return;
  }

  // Answer BEFORE any lookup or send. A real lookup plus a ~200ms Resend call
  // is measurable against an instant miss, which leaks account existence even
  // though the body is identical either way. The cost is that a failed send is
  // invisible to the caller — it goes to Sentry instead.
  res.json(ForgotPasswordResponse.parse({ success: true }));

  if (!parsed.success) return;

  void issueResetToken(parsed.data.email).catch((err: unknown) => {
    logger.error({ err }, "password reset email failed");
    Sentry.captureException(err);
  });
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `password must be ${resetPasswordBodyPasswordMin}-${resetPasswordBodyPasswordMax} characters`,
    });
    return;
  }
  const { token, password } = parsed.data;

  const passwordHash = await argon2.hash(password);

  // ONE conditional statement, not SELECT-then-UPDATE. The pair does not
  // enforce single use: two concurrent confirms of the same token both pass
  // the read and both write, racing to set different passwords. Here Postgres
  // arbitrates, and nulling both columns in this same statement is what makes
  // the token single-use. Hashing first means a losing racer only spent CPU.
  const [user] = await db
    .update(usersTable)
    .set({ passwordHash, resetTokenHash: null, resetTokenExpiresAt: null })
    .where(
      and(
        eq(usersTable.resetTokenHash, hashResetToken(token)),
        gt(usersTable.resetTokenExpiresAt, new Date()),
      ),
    )
    .returning();

  if (!user) {
    // One message for unknown AND expired — distinct messages would tell a
    // caller holding a guessed token whether it ever existed.
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  setSessionCookie(res, user.id);

  posthog?.capture({
    distinctId: user.id,
    event: "password reset completed",
    properties: { role: user.role, $set: { email: user.email, role: user.role } },
  });

  res.json(ResetPasswordResponse.parse({ user: toAuthUser(user) }));
});

export default router;
