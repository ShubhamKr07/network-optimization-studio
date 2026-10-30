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
import { SESSION_COOKIE, SESSION_TTL_MS, sessionCookieValue, sessionUser } from "../middlewares/auth.js";
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
  // No error binding: a failed drizzle query's message carries its params, i.e.
  // the submitted email. Throws rather than returning undefined so an outage is
  // never mistaken for "no such account". See api-server/CLAUDE.md on
  // DrizzleQueryError.
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`);
    return user;
  } catch {
    logger.error({ step: "user-lookup-by-email" }, "user lookup failed");
    throw new Error("user lookup failed");
  }
}

// Login rate limit: 20 attempts/min per client IP (in-memory, single-instance,
// no restart survival). History of the number: raised from 10 to 20 on
// 2026-09-25 for the co-located pilot cohort (~50 students re-logging in after
// session expiry). That reasoning assumed `req.ip` was the client address; it
// was not, because the app set no `trust proxy` and every caller shared Render's
// load-balancer address, i.e. ONE bucket for the whole internet. app.ts now sets
// `trust proxy: 2` (measured 2026-10-10), so students on one campus NAT still
// share a key, but everyone else gets their own. 20 is kept so nothing changes
// for them. If a NAT'd cohort must all re-login within a minute, key per-account.
// Keys are now real client IPs (unbounded), hence makeRateLimiter's eviction.
const LOGIN_RATE_LIMIT = 20;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;
const loginLimiter = makeRateLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);

// Test-only escape hatch: the counter is module-level and otherwise persists for
// the process lifetime, which a suite calling login dozens of times (from one
// loopback IP) would trip. Not used by any production code path.
export function resetLoginRateLimiterForTests(): void {
  loginLimiter.reset();
}

/** Test-only: live key count, to prove eviction bounds memory. */
export function loginLimiterSizeForTests(): number {
  return loginLimiter.size();
}

function setSessionCookie(res: Response, user: { id: string; passwordHash: string | null }) {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, sessionCookieValue(user), {
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

  let existing: Awaited<ReturnType<typeof findUserByEmail>>;
  try {
    existing = await findUserByEmail(email);
  } catch {
    res.status(500).json({ error: "Could not create your account." });
    return;
  }
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await argon2.hash(password);
  // No error binding: a failed drizzle insert's message carries its params, i.e.
  // the email AND the argon2 hash. See api-server/CLAUDE.md on DrizzleQueryError.
  let user: typeof usersTable.$inferSelect;
  try {
    [user] = await db.insert(usersTable).values({
      email,
      passwordHash,
      role: "student",
    }).returning();
  } catch {
    logger.error({ step: "register-insert" }, "user insert failed");
    res.status(500).json({ error: "Could not create your account." });
    return;
  }

  setSessionCookie(res, user);

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
  if (loginLimiter.check(ip)) {
    res.status(429).json({ error: "Too many login attempts, try again shortly" });
    return;
  }

  let user: Awaited<ReturnType<typeof findUserByEmail>>;
  try {
    user = await findUserByEmail(email);
  } catch {
    // Not a 401: that would tell the caller "wrong credentials" for a DB fault.
    res.status(500).json({ error: "Could not sign in." });
    return;
  }
  // Identical failure path whether the email doesn't exist or the password is
  // wrong — never let a caller distinguish the two (no user enumeration).
  const passwordHash = user?.passwordHash ?? null;
  const validPassword = passwordHash ? await argon2.verify(passwordHash, password) : false;
  if (!user || !validPassword) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  setSessionCookie(res, user);

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
  // Analytics only, so the unverified id prefix of the signed cookie is enough.
  const userId = (req.signedCookies?.[SESSION_COOKIE] as string | undefined)?.split(".")[0];
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
  // Same check as requireAuth (SEC-2): an expired or reset-revoked cookie is
  // user: null here too. No error binding: a failed drizzle query's message
  // carries its params, i.e. the user id. See api-server/CLAUDE.md on DrizzleQueryError.
  let user: Awaited<ReturnType<typeof sessionUser>>;
  try {
    user = await sessionUser(req);
  } catch {
    logger.error({ step: "auth-user-lookup" }, "current user lookup failed");
    res.status(500).json({ error: "Could not load your account." });
    return;
  }
  res.json(GetCurrentAuthUserResponse.parse({ user: user ? toAuthUser(user) : null }));
});

// Reset-request limits. The per-ADDRESS limiter is the primary defence (what
// stops someone mailbombing a known student) and is the only per-caller one:
// this limiter predates `trust proxy: 2` (app.ts) and stays keyed by address;
// the global cap is deliberately global, a flood ceiling on mail
// sent, not a per-caller limit. Both answer 429 whether or not the account
// exists, so neither becomes an existence oracle.
const forgotGlobalLimiter = makeRateLimiter(120, 60 * 1000);
const FORGOT_GLOBAL_KEY = "global";
const forgotEmailLimiter = makeRateLimiter(3, 60 * 60 * 1000);
// reset-password is unauthenticated and runs argon2 before its conditional
// UPDATE (hashing after a SELECT would reintroduce the race), so a garbage
// token costs as much CPU as a real one. What matters is argon2 CPU, so bound
// concurrent hashes directly instead of a request rate (which would be a
// shared bucket behind the proxy, see above). Checked first so a 429 is free.
const RESET_MAX_IN_FLIGHT = 4;
let resetInFlight = 0;

export function resetForgotPasswordLimitersForTests(): void {
  forgotGlobalLimiter.reset();
  forgotEmailLimiter.reset();
  resetInFlight = 0;
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
  // No error binding: a failed drizzle query's message carries its params (the
  // token hash), and the caller logs and sends errors to Sentry. See
  // api-server/CLAUDE.md on DrizzleQueryError.
  try {
    await db
      .update(usersTable)
      .set({
        resetTokenHash: hashResetToken(token),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      })
      .where(eq(usersTable.id, user.id));
  } catch {
    logger.error({ step: "reset-token-write" }, "password reset token write failed");
    return;
  }

  await sendEmail(email, resetEmailSubject, resetEmailHtml(token));

  posthog?.capture({ distinctId: user.id, event: "password reset requested" });
}

router.post("/auth/forgot-password", (req: Request, res: Response) => {
  const parsed = ForgotPasswordBody.safeParse(withNormalizedEmail(req.body));

  // `||` short-circuits, so a request already refused by the global cap does
  // not also consume the address's hourly budget.
  if (forgotGlobalLimiter.check(FORGOT_GLOBAL_KEY) || (parsed.success && forgotEmailLimiter.check(parsed.data.email))) {
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
  if (resetInFlight >= RESET_MAX_IN_FLIGHT) {
    res.status(429).json({ error: "Too many reset attempts, try again shortly" });
    return;
  }
  resetInFlight++;
  try {
    await handleResetPassword(req, res);
  } finally {
    resetInFlight--;
  }
});

async function handleResetPassword(req: Request, res: Response): Promise<void> {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    // A bad token shape gets the SAME generic string as a wrong token, so a
    // malformed and a well-formed-but-unknown token stay indistinguishable.
    const passwordFailed = parsed.error.issues.some((i) => i.path[0] === "password");
    res.status(400).json({
      error: passwordFailed
        ? `password must be ${resetPasswordBodyPasswordMin}-${resetPasswordBodyPasswordMax} characters`
        : "This reset link is invalid or has expired.",
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
  // No error binding: a failed drizzle query's message carries its params,
  // i.e. the new argon2 hash. See api-server/CLAUDE.md on DrizzleQueryError.
  let user: typeof usersTable.$inferSelect | undefined;
  try {
    [user] = await db
      .update(usersTable)
      .set({ passwordHash, resetTokenHash: null, resetTokenExpiresAt: null })
      .where(
        and(
          eq(usersTable.resetTokenHash, hashResetToken(token)),
          gt(usersTable.resetTokenExpiresAt, new Date()),
        ),
      )
      .returning();
  } catch {
    res.status(500).json({ error: "Could not set your new password." });
    return;
  }

  if (!user) {
    // One message for unknown AND expired — distinct messages would tell a
    // caller holding a guessed token whether it ever existed.
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  setSessionCookie(res, user);

  posthog?.capture({
    distinctId: user.id,
    event: "password reset completed",
    properties: { role: user.role, $set: { email: user.email, role: user.role } },
  });

  res.json(ResetPasswordResponse.parse({ user: toAuthUser(user) }));
}

export default router;
