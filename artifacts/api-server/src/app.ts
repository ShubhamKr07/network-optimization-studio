import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { setupExpressRequestContext, setupExpressErrorHandler } from "posthog-node";
import * as Sentry from "@sentry/node";
import { and, eq } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { MAX_IMPORT_BYTES, SUPER_NETWORK_MAX_BYTES } from "@workspace/import-schema";
import router from "./routes";
import { requireAuth, SESSION_SECRET } from "./middlewares/auth";
import { logger } from "./lib/logger";
import { posthog } from "./lib/posthog";

const app: Express = express();

// This is a stateful JSON API (auth, live scenario/solve-job data), not
// cacheable content. Express's default weak ETags turn identical repeat GETs
// (e.g. solve-job polling) into 304 Not Modified — which customFetch treats
// as an error, not "reuse your cached data" — corrupting the poll loop.
app.set("etag", false);

// Measured in production 2026-10-10 (PWR-FU5a): chain nearest-to-farthest is
// socket (Render LB, private 10.x) -> Cloudflare edge -> client, i.e.
// X-Forwarded-For "<client>, <cloudflare>". Two trusted hops puts req.ip on the
// real client. Not `true`: that trusts the whole chain and makes
// X-Forwarded-For fully attacker-controlled. With 2, a spoofed leading entry
// lands in the untrusted part, because Cloudflare appends the sender's real
// address to the right of whatever they sent. This is the value for
// Cloudflare-in-front-of-Render; re-measure if the infrastructure changes.
app.set("trust proxy", 2);

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
app.use(cookieParser(SESSION_SECRET));
// SEC-1 — CSRF. The production session cookie is SameSite=None (Studio and API
// are different sites), so a browser attaches it to a cross-site form POST, and
// CORS only withholds the response, it never blocks the request. A browser
// always sends Origin on a cross-site POST/PATCH/DELETE; reject any that is not
// allowlisted. No Origin + Sec-Fetch-Site: cross-site is also rejected; header-less
// non-browser clients (curl, e2e_journey.py) carry no ambient cookie and pass.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production" || SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  const crossSite = origin ? !allowedOrigins.includes(origin) : req.get("sec-fetch-site") === "cross-site";
  if (crossSite) {
    res.status(403).json({ error: "cross_site_request_rejected" });
    return;
  }
  next();
});
// SCU-2.P2.2 (B2.6; review #1) — the two import routes parse their own body
// (route-scoped 2 MiB parser in routes/scenarios.ts, mounted after auth and
// ownership). Every other route keeps this unchanged global parser.
const IMPORT_BODY_PATH = /^\/api\/scenarios\/[^/]+\/(?:import(?:\/apply)?|network\/import)\/?$/i;
// SM-12 — scenario writes carry `inputs` (a super-model network is ~185 KB, over
// the 100 KiB default), so POST /scenarios and PATCH /scenarios/:id get the same
// 2 MiB cap as imports. Exact paths only; every other route stays at the default.
const SCENARIO_WRITE = (m: string, path: string) =>
  (m === "POST" && /^\/api\/scenarios\/?$/i.test(path)) || (m === "PATCH" && /^\/api\/scenarios\/[^/]+\/?$/i.test(path));
const defaultJsonBody = express.json();
const scenarioWriteJsonBody = express.json({ limit: MAX_IMPORT_BYTES });
const superWriteJsonBody = express.json({ limit: SUPER_NETWORK_MAX_BYTES });
// Super-model PATCH may carry up to 4 MiB. The larger parser is chosen only after the OWNED row is loaded and is
// super-model, and only when Content-Length already declares more than 2 MiB (smaller bodies need no lookup).
// ponytail: a chunked (no Content-Length) super PATCH keeps the 2 MiB limit; browsers always send Content-Length.
async function patchBodyParser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.method === "PATCH" && Number(req.headers["content-length"]) > MAX_IMPORT_BYTES) {
      const id = Number(req.path.split("/")[3]);
      const [row] = Number.isInteger(id)
        ? await db.select({ modelId: scenariosTable.modelId }).from(scenariosTable).where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
        : [];
      if (row?.modelId === "super-model") return superWriteJsonBody(req, res, next);
    }
    scenarioWriteJsonBody(req, res, next);
  } catch (err) { next(err); }
}
// requireAuth (signed cookie + one users PK lookup; cookieParser ran above) goes BEFORE
// the 2 MiB parser so an unauthenticated caller is 401'd without the body being read.
app.use((req, res, next) => {
  if (IMPORT_BODY_PATH.test(req.path)) return next();
  if (!SCENARIO_WRITE(req.method, req.path)) return defaultJsonBody(req, res, next);
  requireAuth(req, res, (err?: unknown) => (err ? next(err) : void patchBodyParser(req, res, next)));
});

// PostHog Express middleware: reads X-POSTHOG-SESSION-ID and
// X-POSTHOG-DISTINCT-ID headers sent by posthog-js on the frontend so
// server-side events can be linked to client sessions and person profiles.
if (posthog) {
  setupExpressRequestContext(posthog, app);
}

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
// SM-12/SM-16 — body-parser's oversize error is a client error, not a 500. Mapped
// BEFORE the PostHog and Sentry error handlers so they never see it (Sentry
// ignores <500; PostHog captures everything it is handed).
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if ((err as { type?: string })?.type === "entity.too.large" && !res.headersSent) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  next(err);
});

// PostHog error handler captures unhandled Express exceptions to error
// tracking. Must come before the project's own 500 handler so PostHog sees
// the original error before we swallow it into a generic JSON response.
if (posthog) {
  setupExpressErrorHandler(posthog, app);
}

// Sentry's Express error handler: forwards unhandled exceptions to Sentry
// (scrubbed via instrument.ts's beforeSend) — a no-op when SENTRY_DSN is
// unset, since Sentry.init() never ran. Must also come before the project's
// own 500 handler for the same reason as PostHog's, above.
Sentry.setupExpressErrorHandler(app);

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
