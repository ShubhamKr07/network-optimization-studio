import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE = "nos_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.userId = userId;
  next();
}
