import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, userProgressTable } from "@workspace/db";

const USER_COOKIE = "arcadia_uid";

const router = Router();

function toApiProgress(row: typeof userProgressTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    xp: row.xp,
    level: row.level,
    streakDays: row.streakDays,
    lastSolveDate: row.lastSolveDate ?? null,
    solvedScenarios: row.solvedScenarios as Record<string, unknown>,
    earnedBadges: row.earnedBadges as string[],
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/progress", async (req, res) => {
  const userId = req.signedCookies?.[USER_COOKIE] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const rows = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, userId));

  if (rows.length === 0) {
    const [row] = await db
      .insert(userProgressTable)
      .values({ userId, xp: 0, level: 1, streakDays: 0 })
      .returning();
    res.json(toApiProgress(row));
    return;
  }
  res.json(toApiProgress(rows[0]));
});

router.patch("/progress", async (req, res) => {
  const userId = req.signedCookies?.[USER_COOKIE] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const body = req.body as {
    xp?: number;
    level?: number;
    streakDays?: number;
    lastSolveDate?: string | null;
    solvedScenarios?: Record<string, unknown>;
    earnedBadges?: string[];
  };

  const existing = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, userId));

  if (existing.length === 0) {
    const [row] = await db
      .insert(userProgressTable)
      .values({
        userId,
        xp: body.xp ?? 0,
        level: body.level ?? 1,
        streakDays: body.streakDays ?? 0,
        lastSolveDate: body.lastSolveDate ?? null,
        solvedScenarios: body.solvedScenarios ?? {},
        earnedBadges: body.earnedBadges ?? [],
        updatedAt: new Date(),
      })
      .returning();
    res.json(toApiProgress(row));
    return;
  }

  const [row] = await db
    .update(userProgressTable)
    .set({
      ...(body.xp !== undefined && { xp: body.xp }),
      ...(body.level !== undefined && { level: body.level }),
      ...(body.streakDays !== undefined && { streakDays: body.streakDays }),
      ...(body.lastSolveDate !== undefined && { lastSolveDate: body.lastSolveDate }),
      ...(body.solvedScenarios !== undefined && { solvedScenarios: body.solvedScenarios }),
      ...(body.earnedBadges !== undefined && { earnedBadges: body.earnedBadges }),
      updatedAt: new Date(),
    })
    .where(eq(userProgressTable.userId, userId))
    .returning();

  res.json(toApiProgress(row));
});

export default router;
