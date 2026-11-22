// artifacts/api-server/src/watbot/errors.ts
import Anthropic from "@anthropic-ai/sdk";
import { WorkloadIdentityError } from "@anthropic-ai/sdk/lib/credentials/types";

// Closed union, in this order, mirrored by the OpenAPI WatBotError enum (Task 6).
export const WATBOT_ERROR_CODES = [
  "watbot_unavailable", "watbot_student_limit", "watbot_project_limit", "watbot_refused", "watbot_failed", "watbot_busy", "watbot_feedback_locked",
] as const;
export type WatBotErrorCode = (typeof WATBOT_ERROR_CODES)[number];

export function classifyAnthropicError(err: unknown): "unavailable" | "project_limit" | "rate_limited" | "failed" {
  if (err instanceof Anthropic.APIConnectionError) return "unavailable";
  // SDK throws a plain Error when no key is configured; match its message only, not every unknown error.
  if (err instanceof Error && err.message.startsWith("Could not resolve authentication method")) return "unavailable";
  // OIDC (Render workload identity) exchange or config failure: a deploy problem, like a missing key.
  if (err instanceof WorkloadIdentityError) return "unavailable";
  if (!(err instanceof Anthropic.APIError)) return "failed";
  const body = err.error as { error?: { message?: string; details?: { error_code?: string } } } | undefined;
  const code = body?.error?.details?.error_code;
  const message = body?.error?.message ?? err.message;
  if (err.status === 400 && /You have reached your specified (workspace )?API usage limits/.test(message)) return "project_limit";
  if (err.status === 429) return code === "enforced_spend_limit_reached" ? "project_limit" : "rate_limited";
  if (err.status === 401 || err.status === 403) return "unavailable"; // missing/rejected key is a deploy problem, not the student's
  if (err.status !== undefined && err.status >= 500) return "unavailable";
  return "failed";
}

// D24 — `retry-after` in seconds, clamped to 1–60; 5 when missing or invalid.
export function retryAfterMs(err: unknown): number {
  const raw = err instanceof Anthropic.APIError ? err.headers?.get("retry-after") : null;
  const seconds = raw == null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return 5000;
  return Math.min(60, Math.max(1, seconds)) * 1000;
}
