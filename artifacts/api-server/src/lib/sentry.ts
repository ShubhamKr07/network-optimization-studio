import type { ErrorEvent } from "@sentry/node";

const ALLOWED_HEADERS = new Set(["user-agent", "accept", "content-type", "referer"]);

// Shared PII scrub applied via beforeSend. Removes bodies, cookies, auth
// headers, query values, email, and IP; keeps the error + allowlisted tags.
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        event.request.url = `${url.pathname}${url.hash ? url.hash : ""}`;
      } catch {
        event.request.url = event.request.url.split("?")[0];
      }
    }
    if (event.request.headers) {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (ALLOWED_HEADERS.has(k.toLowerCase())) kept[k] = v as string;
      }
      event.request.headers = kept;
    }
  }
  if (event.user) {
    const id = event.user.id;
    event.user = id ? { id } : {};
  }
  return event;
}

export const SENTRY_ENABLED = Boolean(process.env.SENTRY_DSN);
