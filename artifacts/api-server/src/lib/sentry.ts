import * as Sentry from "@sentry/node";
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

// ---------------------------------------------------------------------------
// A12 — the OPERATOR diagnostic sink for a solve failure. Deliberately a
// DIFFERENT, richer contract than posthog's product "scenario solve failed"
// event (bounded `errorCode` only, no diagnostic contents): Sentry is for an
// operator debugging a real failure, so it additionally carries the closed
// internal `failureReason`/`failureStage` enums (the SAME taxonomy already
// persisted to `solve_jobs.failure_reason`/`failure_stage` — never a new,
// wider vocabulary) plus solve.py's own byte-capped, schema-validated
// `errorDetail` record when one exists.
//
// This still must never carry raw stdout/stderr, exception text, secrets, or
// filesystem paths — solve.py's `_failure()` helper is documented to never
// put those into `errorDetail` in the first place (solverProcessMessage.ts's
// SolverFailureSchema caps it at 2048 bytes), but `sanitizeErrorDetail`
// below is a SECOND, independent layer here in the operator sink itself:
// only primitive (string/number/boolean/null) values survive, long strings
// (>200 chars — long enough for any legitimate closed-enum/short-identifier
// value, short enough to reject an accidental traceback/path) are dropped,
// and any key whose name suggests exactly the forbidden content (stdout,
// stderr, traceback, exception, path, secret, token, password, key) is
// dropped regardless of its value. Never trust a single upstream layer to
// be the only thing standing between "structured allowlisted diagnostic"
// and "an accidental leak."
// ---------------------------------------------------------------------------

const MAX_DETAIL_VALUE_LENGTH = 200;
const FORBIDDEN_DETAIL_KEY_PATTERN =
  /stdout|stderr|traceback|exception|path|secret|token|password|passwd|key|cookie|authorization/i;

export function sanitizeErrorDetail(
  detail: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!detail) return null;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN_DETAIL_KEY_PATTERN.test(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      kept[k] = v;
      continue;
    }
    if (typeof v === "string" && v.length <= MAX_DETAIL_VALUE_LENGTH) {
      kept[k] = v;
    }
    // Nested objects/arrays and over-length strings are dropped, not
    // recursed into — a flat, short, primitive-valued record is the whole
    // allowlist; anything shaped differently didn't come from the expected
    // closed source and is treated as untrusted.
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

export interface SolveFailureDiagnostic {
  failureReason: string;
  failureStage: string | null;
  errorDetail?: Record<string, unknown> | null;
}

// The single call site every jobRunner.ts failure branch uses. A fixed
// message string (never built from raw diagnostic text) plus bounded tags —
// exactly mirroring the taxonomy already written to the DB's typed
// `failure_reason`/`failure_stage` columns, never a wider vocabulary. A
// no-op when SENTRY_DSN is unset (SENTRY_ENABLED false), same gating
// convention as instrument.ts's own `if (process.env.SENTRY_DSN)` guard —
// avoids paying for scope construction when there's no sink to receive it.
export function captureSolveFailure(diag: SolveFailureDiagnostic): void {
  if (!SENTRY_ENABLED) return;
  const errorDetail = sanitizeErrorDetail(diag.errorDetail ?? null);
  Sentry.captureMessage("solve job failed", {
    level: "error",
    tags: {
      failureReason: diag.failureReason,
      failureStage: diag.failureStage ?? "none",
    },
    extra: errorDetail ? { errorDetail } : undefined,
  });
}
