// MUST be imported before any other module so Sentry can instrument them.
import * as Sentry from "@sentry/node";
import { scrubEvent } from "./lib/sentry";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}
