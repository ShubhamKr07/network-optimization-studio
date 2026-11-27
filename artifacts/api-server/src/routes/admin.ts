import { Router, type IRouter } from "express";
import { and, desc, gte, lt } from "drizzle-orm";
import { db, feedbackTable } from "@workspace/db";
import { GetAdminFeedbackResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middlewares/auth.js";
import { parseAdminRange, chicagoStart, chicagoEnd } from "../services/adminRange.js";

// Every admin endpoint lives on `admin`, and the ONLY way it is reachable is the
// gated mount below (plan review F4). Never register an admin route on `router`.
const router: IRouter = Router();
const admin: IRouter = Router();
// The trailing handler keeps unknown admin paths/methods on a JSON 404, not Express's HTML.
router.use("/admin", requireAdmin, admin, (_q, r) => { r.status(404).json({ error: "Not found" }); });
export const adminRoutesForTests = admin;

admin.get("/feedback", async (req, res) => {
  const p = parseAdminRange(req.query as Record<string, unknown>, undefined, { allowModel: false });
  if (!p.ok) { res.status(422).json({ error: p.error }); return; }
  try {
    const rows = await db.select({ id: feedbackTable.id, body: feedbackTable.body, createdAt: feedbackTable.createdAt }).from(feedbackTable)
      .where(and(gte(feedbackTable.createdAt, chicagoStart(p.range.from)), lt(feedbackTable.createdAt, chicagoEnd(p.range.to))))
      .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id)).limit(501);
    res.json(GetAdminFeedbackResponse.parse({ truncated: rows.length > 500, items: rows.slice(0, 500).map(r => ({ ...r, createdAt: r.createdAt.toISOString() })) }));
  } catch {
    logger.error({ step: "admin-feedback" }, "admin feedback query failed");
    res.status(500).json({ error: "Could not load site feedback." }); }
});

export default router;
