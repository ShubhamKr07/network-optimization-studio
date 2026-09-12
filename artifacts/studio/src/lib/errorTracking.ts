import * as Sentry from "@sentry/react";
import type { ErrorEvent } from "@sentry/react";

const ALLOWED_HEADERS = new Set(["user-agent", "accept", "content-type", "referer"]);

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

let initialized = false;

export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  initialized = true;
}

export function setErrorUser(id: string): void {
  if (!initialized) return;
  Sentry.setUser({ id });
}

export function clearErrorUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
