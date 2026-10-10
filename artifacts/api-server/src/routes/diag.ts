// TEMPORARY DIAGNOSTIC (added 2026-10-10) -- DELETE THIS FILE once answered.
//
// Question it answers: behind Cloudflare + Render's load balancer, what does
// Express see as the client address? app.ts sets no `trust proxy`, so
// /auth/login's rate limiter (keyed on req.ip) may be one shared bucket for
// everyone. Probe this route once, read the log line in Render logs, decide
// the `trust proxy` hop count from the measurement, then remove this file and
// its `router.use(diagRouter)` line in routes/index.ts.
//
// Deliberately its own route (not logging inside /auth/login) so only a
// deliberate probe records an IP/XFF chain -- never every student's login.
// Responds 204 with no body: nothing is echoed to the caller.
//
// ponytail: throwaway diagnostic code; removal (delete file + one router.use) is the upgrade path.
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/_diag/client-ip", (req, res) => {
  const cf = req.headers["cf-connecting-ip"];
  logger.info(
    {
      diag: "client-ip",
      ip: req.ip,
      remoteAddress: req.socket.remoteAddress,
      xForwardedFor: req.headers["x-forwarded-for"],
      cfConnectingIpPresent: cf !== undefined,
      cfConnectingIp: cf,
      ips: req.ips,
      trustProxy: req.app.get("trust proxy"),
    },
    "diag client-ip",
  );
  res.status(204).end();
});

export default router;
