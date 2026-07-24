import express, { type Express } from "express";
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

export default app;
