import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const COOKIE_SECRET = process.env.SESSION_SECRET || "arcadia-dev-secret";

const app: Express = express();

// This is a stateful JSON API (auth, live scenario/solve-job data), not
// cacheable content. Express's default weak ETags turn identical repeat GETs
// (e.g. solve-job polling) into 304 Not Modified — which customFetch treats
// as an error, not "reuse your cached data" — corrupting the poll loop.
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// In production the API and frontend are different Render services (
// different origins), so an explicit allowlist is required — reflecting
// every origin (today's behavior) would be an open credentialed CORS
// policy once the API has a real public hostname. Local dev keeps the
// permissive reflect-all behavior unchanged.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin: process.env.NODE_ENV === "production" ? allowedOrigins : true,
  }),
);
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Catch-all error-handling middleware. Express identifies this by its
// 4-argument signature (err, req, res, next) and only invokes it for errors
// that propagate out of a route handler (e.g. a thrown exception from an
// `await db...` call with no surrounding try/catch) — it never intercepts
// a normal request. Without it, Express 5's built-in `finalhandler` renders
// an HTML error page (with a full stack trace in development), which the API's
// own JSON convention ({error: "..."}) never produces — so any JSON client
// fails to parse the body instead of seeing a meaningful error.
//
// This must be the LAST middleware registered: anything mounted after it would
// run before the error is caught.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  logger.error({ err }, "Unhandled error in request");
  if (res.headersSent) {
    // Headers already went out (e.g. a streaming response or a route that
    // began writing then threw) — we can no longer send a JSON body, so
    // delegate to Express's default handler to tear the response down.
    next(err);
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});

export default app;
