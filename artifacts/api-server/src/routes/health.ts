import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  // Probe DB reachability with a trivial query. A failure reports db:"down" but the endpoint still
  // returns 200 — the API process itself is up; this field is what the postgres_tls smoke check
  // asserts against.
  let db: "ok" | "down" = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "down";
  }
  const data = HealthCheckResponse.parse({ status: "ok", db });
  res.json(data);
});

export default router;
