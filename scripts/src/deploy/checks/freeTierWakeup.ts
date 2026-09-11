import { type Check, timed } from "./types.js";

export const WAKEUP_WARN_MS = 10_000;

/**
 * Times a health request as a proxy for cold-start latency on Render's Starter tier. A slow first
 * response is a soft `warn` (not a failure) above 10s — it degrades UX but the service is up.
 */
export const freeTierWakeup: Check = async (env, ctx) => {
  const name = "free_tier_wakeup";
  const { value: res, ms } = await timed(() => ctx.fetch(`${env.apiBase}/api/healthz`));
  const slow = ms > WAKEUP_WARN_MS;
  return {
    name,
    pass: res.ok && !slow,
    warn: res.ok && slow, // soft: up but slow
    ms,
    detail: res.ok ? (slow ? `slow cold start: ${ms}ms (> ${WAKEUP_WARN_MS}ms)` : `${ms}ms`) : `health status ${res.status}`,
  };
};
