import { Router, type IRouter, type Request, type Response } from "express";

const USER_COOKIE = "arcadia_uid";
const COOKIE_TTL = 7 * 24 * 60 * 60 * 1000;

const router: IRouter = Router();

router.get("/auth/user", (req: Request, res: Response) => {
  const userId = req.signedCookies?.[USER_COOKIE] as string | undefined;
  res.json({ user: userId ? { id: userId } : null });
});

router.post("/login", (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const uid = userId.trim().toLowerCase();
  res.cookie(USER_COOKIE, uid, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL,
  });
  res.json({ ok: true, userId: uid });
});

router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie(USER_COOKIE, { path: "/" });
  res.json({ ok: true });
});

export default router;
