import posthog from "posthog-js";

// Allowlist — mirrors the plan's Global Constraints. Any prop key not in this
// set is stripped before an event leaves the browser, so scenario values,
// emails, and free text can never be captured even if a caller passes them.
export const ALLOWED_PROP_KEYS: ReadonlySet<string> = new Set([
  "scenario_id", "model_id", "job_id", "queue_depth", "entity", "field",
  "format", "tab", "rows", "run_time_sec", "cache_hit", "objective",
]);

let initialized = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || initialized) return; // no-op mirrors the backend null-guard
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    autocapture: true,
    capture_pageview: false, // we fire $pageview manually on wouter nav
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
  });
  initialized = true;
}

function sanitize(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (ALLOWED_PROP_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    posthog.capture(event, sanitize(props));
  } catch {
    // fire-and-forget: analytics must never break the app
  }
}

export function identifyUser(id: string): void {
  if (!initialized) return;
  try { posthog.identify(id); } catch { /* no-op */ }
}

export function resetUser(): void {
  if (!initialized) return;
  try { posthog.reset(); } catch { /* no-op */ }
}
