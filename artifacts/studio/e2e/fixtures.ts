import { test as base, expect } from "@playwright/test";

export { expect };
export type { Page, Locator } from "@playwright/test";

/**
 * The shared Playwright `test` for this suite. Identical to `@playwright/test`'s
 * except that every page has the analytics/error-tracking ingest hosts stubbed.
 *
 * WHY THIS EXISTS (2026-10-02, ch9-tc). CI now supplies `VITE_POSTHOG_KEY` and
 * `VITE_SENTRY_DSN` — it has to, because `posthog-analytics.spec.ts` and
 * `sentry-capture.spec.ts` assert on real SDK behaviour and both app-side
 * guards are `if (!key) return`. The side effect is that the SDKs now
 * initialise in EVERY spec and fire real ingest requests, which fail (401/404
 * against a non-contactable project) and get logged by the browser itself —
 * not by app code, so the app cannot suppress them. That turned
 * `empty-first-run-workspace.spec.ts`'s `expect(consoleErrors).toEqual([])`
 * red on both tests and both retries, on the first CI run after the e2e job
 * became blocking.
 *
 * Stubbing here rather than filtering console errors in the one spec that
 * checks them: the assertion stays strict for real app errors, no beacons
 * leave CI, and the next spec to add a console-error check inherits the fix
 * instead of rediscovering this.
 *
 * ORDERING MATTERS AND IS WHY THE TWO ANALYTICS SPECS STILL WORK. Playwright
 * matches routes in REVERSE registration order, so a handler registered later
 * wins. This fixture registers before the test body runs; those two specs
 * register their own capturing handlers for the same patterns inside the test,
 * i.e. later, so theirs take precedence and they still observe real payloads.
 * Verified by running all three specs together, not assumed.
 */
const INGEST_PATTERNS = [
  // PostHog: capture endpoint AND the `us-assets.i.posthog.com` config
  // bootstrap. Matches whatever `analytics.ts`'s `VITE_POSTHOG_HOST ??
  // "https://us.i.posthog.com"` resolves to.
  "**i.posthog.com**",
  // Sentry: the DSN's host comes from the secret, so cover both the classic
  // `oNNN.ingest.sentry.io` shape and regional `oNNN.ingest.<region>.sentry.io`
  // — the second pattern catches any `*.sentry.io`. Same pair
  // `sentry-capture.spec.ts` uses.
  "**/*.ingest.sentry.io/**",
  "**/*.sentry.io/**",
];

export const test = base.extend<{ stubAnalyticsIngest: void }>({
  stubAnalyticsIngest: [
    async ({ page }, use) => {
      for (const pattern of INGEST_PATTERNS) {
        await page.route(pattern, route =>
          route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
        );
      }
      await use();
    },
    { auto: true },
  ],
});
