import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import argon2 from "argon2";
import { db, usersTable } from "@workspace/db";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  LogoutUserResponse,
  GetCurrentAuthUserResponse,
} from "@workspace/api-zod";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../middlewares/auth.js";

const router: IRouter = Router();

// Simple in-memory rate limit for login: 10 attempts/min/IP. Acceptable for a
// pilot-scale classroom deployment; revisit if this ever needs to survive
// process restarts or run across multiple instances.
const LOGIN_RATE_LIMIT = 10;
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

function setSessionCookie(res: Response, userId: string) {
  res.cookie(SESSION_COOKIE, userId, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

function toAuthUser(user: { id: string; email: string | null; role: string }) {
  return { id: user.id, email: user.email ?? "", role: user.role as "student" | "instructor" };
}

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email and password (min 8 chars) are required" });
    return;
  }
  const { email, password } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
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
  res.status(201).json(LoginUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginUserBody.safeParse(req.body);
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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  // Identical failure path whether the email doesn't exist or the password is
  // wrong — never let a caller distinguish the two (no user enumeration).
  const passwordHash = user?.passwordHash ?? null;
  const validPassword = passwordHash ? await argon2.verify(passwordHash, password) : false;
  if (!user || !validPassword) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  setSessionCookie(res, user.id);
  res.json(LoginUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
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

export default router;
