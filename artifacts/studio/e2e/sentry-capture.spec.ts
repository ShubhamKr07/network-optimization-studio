/**
 * Browser E2E — SENTRY-7 QA: a real client-side render error trips the
 * top-level `<ErrorBoundary>` fallback AND is actually reported to Sentry,
 * with no PII leaking into the captured envelope.
 *
 * Intercepts every request to Sentry's ingest host (stubbed 200, never a
 * real network call), registers a disposable account, opens a Workspace
 * chapter, and forces a genuine synchronous React render-phase error.
 * Asserts:
 *   1. The `<SentryErrorBoundary>` fallback (`main.tsx`'s
 *      "Something went wrong. Please reload.") actually renders.
 *   2. A Sentry envelope was actually sent to the ingest host (`@sentry/
 *      react`'s `ErrorBoundary` calls `Sentry.captureException` internally
 *      by default when it catches — this is the thing under test, not
 *      assumed).
 *   3. NO captured payload — across every request Sentry's SDK sent to its
 *      ingest host — ever contains an email (`@`), a password, a scenario
 *      `inputs` value class (`demand`, `capacity`), a real base-dataset city
 *      string, or the session-cookie name (`nos_session`). This is the
 *      load-bearing privacy assertion for the whole frontend Sentry
 *      integration: `lib/errorTracking.ts`'s `scrubEvent` (SENTRY-3) is
 *      supposed to guarantee this end-to-end, in a REAL browser sending REAL
 *      requests, not just in the wrapper's own unit tests.
 *
 * ── How the render error is forced (no app-source changes) ───────────────
 *
 * This repo's Workspace components are unusually defensively coded (every
 * dataset/scenario access is `?.`-guarded) — there is no reachable "natural"
 * unguarded crash to exploit via malformed data. Per the plan's own allowed
 * options ("a test-only route/component that throws, OR an existing hook
 * you can trip"), this spec trips an EXISTING, always-rendered hook instead
 * of adding new app code (kept out of the commit per the task instruction
 * to commit only this spec file): `page.addInitScript` overrides
 * `Number.prototype.toLocaleString` (browser-context-only, before any page
 * script runs) to throw ONLY once a test-set `window.__throwOnToLocaleString`
 * flag is flipped — NOT unconditionally from page load.
 * `OptimizationParametersTab.tsx` renders each configured distance band via
 * `{b.toLocaleString()}` unconditionally whenever it's the active tab, so
 * opening it (a real sidebar click) then clicking its "+ Add" band button
 * (`button-bands-plus`, which flips this component's own local state and so
 * forces React to re-run its render function) after arming throws
 * synchronously during that render — a genuine React render-phase error,
 * guaranteed within the top-level `ErrorBoundary`'s catchable window.
 *
 * Two things about this shape are deliberate, both found empirically while
 * writing this spec:
 *   1. Flag-gated, not unconditional-from-load: `Workspace.tsx`'s one-shot
 *      tab-seed effect always opens the Input Map tab first on mount, whose
 *      own legend (`MapLegend.tsx`'s `formatDemand()`) ALSO calls
 *      `toLocaleString()` unconditionally — an unconditional override would
 *      throw there first, before this spec ever reaches Optimization
 *      Parameters.
 *   2. Switching tabs BEFORE arming, not just clicking past the legend:
 *      Input Map stays mounted underneath a dialog overlay (confirmed by
 *      first trying the "Run Optimizer" dialog approach — even with the
 *      dialog open, `Workspace`'s own re-render on any state change
 *      re-renders its still-mounted active-tab content too, so `MapLegend`
 *      threw again regardless of which UI was clicked). Only an actual tab
 *      SWITCH unmounts Input Map's `MapLegend` for good. This matters
 *      because `formatDemand`'s own stack-trace frame name contains the
 *      substring "demand", which would spuriously trip this spec's own
 *      forbidden-token sweep even though the plan explicitly allows
 *      exception type/message/stack content (a source-code identifier in a
 *      stack frame is not a data leak) — `OptimizationParametersTab` has no
 *      such naming collision with any forbidden token.
 * This override only affects THIS test's browser context; no application
 * code path is different for a real user.
 *
 * ── Envelope decoding (mirrors posthog-analytics.spec.ts's gotcha #2) ────
 *
 * Sentry's browser transport may gzip-compress an envelope body or send it
 * as plain newline-delimited JSON, with no reliable rule visible from the
 * outside. A naive string `postData()` read mangles binary/gzip bytes into
 * undecodable garbage that can spuriously "contain" a forbidden token by
 * chance. This spec reads `postDataBuffer()`, detects the gzip magic bytes,
 * and `zlib.gunzipSync`s when present — so a real leak inside a compressed
 * envelope is still caught, and binary noise never produces a false
 * failure.
 *
 * Requires `VITE_SENTRY_DSN` set on the studio dev server to a syntactically
 * valid DSN (a real DSN is never contacted — every request to the ingest
 * host is intercepted and stubbed before it leaves the page). See CLAUDE.md
 * / the plan's local run recipe.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy
 * (`API_PROXY_TARGET`) so the browser sees one origin — see vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import zlib from "node:zlib";

const HEADER_TIMEOUT = 15_000;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// A real base-dataset city (solvers/p-median-us/dataset/warehouses.json,
// WH "ALN" = Allentown, PA) — the load-bearing non-generic-string check. If
// this ever shows up in a captured payload, something (a stack-trace frame
// with embedded data, a breadcrumb, a tag, etc.) is leaking real
// scenario/dataset data, not just a generic word.
const REAL_CITY = "Allentown";

// Forbidden substrings per the plan's Global Constraints allowlist:
// password, the two scenario-`inputs` value classes most likely to leak via
// an unscrubbed request body/tag, the real city, and the session cookie
// name (would only appear if `scrubEvent`'s cookie/header stripping
// regressed). Email is checked separately below via a real email-shaped
// regex, NOT a blind "@" substring — see EMAIL_PATTERN's comment for why.
const FORBIDDEN_TOKENS = ["password", "demand", "capacity", REAL_CITY, "nos_session"];

// Every @sentry/react envelope unconditionally embeds its own SDK metadata
// as `sdk.packages: [{ name: "npm:@sentry/react", ... }]` — a benign,
// always-present field with a literal "@" that has nothing to do with user
// PII (confirmed empirically while writing this spec: a naive `.not.
// toContain("@")` check false-positives on every single run, unlike
// PostHog's envelopes, which never carry an "@"-containing field). A blind
// "@" substring check would therefore never be able to pass against a real
// Sentry envelope regardless of whether email PII actually leaked, making
// it a useless assertion. This regex instead requires the actual shape of
// an email address (local-part@domain.tld) so it still catches a genuine
// leak (including the exact disposable test account's own email, asserted
// separately below) without flagging the SDK's own non-PII metadata.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

// The distinctive marker used by this spec's induced error — asserting it
// appears is how we confirm a real envelope (not some unrelated background
// event) was actually captured, before running the PII sweep.
const INDUCED_ERROR_MARKER = "sentry_e2e_induced_render_error";

const ERROR_BOUNDARY_FALLBACK_TEXT = "Something went wrong. Please reload.";

/**
 * Arm (but do not yet trip) `Number.prototype.toLocaleString()` to throw in
 * this page's browser context — see the file-level comment for why this is
 * a safe, deterministic way to trip a real React render-phase error without
 * touching application source, and why it's flag-gated rather than
 * unconditional from page load. Must run via `addInitScript` (before any
 * page script, including `main.tsx`'s synchronous `initErrorTracking()`
 * call, ever executes).
 */
async function armNumberFormattingThrow(page: Page): Promise<void> {
  await page.addInitScript((marker) => {
    (window as unknown as { __throwOnToLocaleString: boolean }).__throwOnToLocaleString = false;
    const original = Number.prototype.toLocaleString;
    // eslint-disable-next-line no-extend-native
    Number.prototype.toLocaleString = function toLocaleStringThatThrowsWhenArmed(...args: unknown[]) {
      if ((window as unknown as { __throwOnToLocaleString: boolean }).__throwOnToLocaleString) {
        throw new Error(marker);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any).apply(this, args);
    };
  }, INDUCED_ERROR_MARKER);
}

/** Flip the armed flag — the next `toLocaleString()` call in the page throws. */
async function triggerRenderError(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __throwOnToLocaleString: boolean }).__throwOnToLocaleString = true;
  });
}

/** Decode a captured request body regardless of gzip vs plain — see the file-level comment. */
function decodeBody(buf: Buffer): string {
  if (buf.length >= 2 && buf.subarray(0, 2).equals(GZIP_MAGIC)) {
    return zlib.gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}

async function registerFreshAccount(page: Page): Promise<string> {
  const email = `e2e-sentry-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

async function createPMedianScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E Sentry ${Date.now()}`,
      modelId: "p-median-us",
      inputs: {
        p: 1,
        distanceBands: [250, 500, 750],
        capacityMode: "none",
        uniformCapacity: null,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0.02,
        timeLimitSec: 120,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

test.describe("Sentry error tracking — ErrorBoundary capture + PII boundary", () => {
  test("a real render error trips the ErrorBoundary and reports to Sentry with no PII in the envelope", async ({ page }) => {
    test.setTimeout(60_000);

    await armNumberFormattingThrow(page);

    const captured: string[] = [];
    // Intercept both host shapes the plan calls out: the project-scoped
    // ingest subdomain a real DSN uses (`o0.ingest.sentry.io`) and the bare
    // `sentry.io` apex some SDK internals/config calls may hit. Every
    // matched request is stubbed 200 so nothing ever leaves this machine
    // for real, and its body (if any) is captured for the PII sweep.
    const captureHandler = async (route: import("@playwright/test").Route) => {
      const buf = route.request().postDataBuffer();
      if (buf) captured.push(decodeBody(buf));
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    };
    await page.route("**/*.ingest.sentry.io/**", captureHandler);
    await page.route("**/*.sentry.io/**", captureHandler);

    const email = await registerFreshAccount(page);
    const scenarioId = await createPMedianScenario(page);

    await page.goto(`/chapter-3?scenario=${scenarioId}`);

    // The real (unarmed) Input Map renders normally first — proves the
    // override doesn't fire prematurely and that we're about to crash a
    // genuinely working page, not one that was already broken.
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-input-optimization-parameters")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Switch to Optimization Parameters — this unmounts Input Map (and its
    // MapLegend) for good, still unarmed, so this navigation itself renders
    // cleanly too.
    await page.getByTestId("sidebar-input-optimization-parameters").click();
    await expect(page.getByTestId("button-bands-plus")).toBeVisible({ timeout: HEADER_TIMEOUT });

    await triggerRenderError(page);
    // Clicking "+ Add" flips this component's own local state, forcing a
    // re-render that re-evaluates every distance band's `.toLocaleString()`
    // — now armed to throw. Playwright's click can race the resulting
    // synchronous unmount; ignore a click-target-detached error, since the
    // ErrorBoundary assertion below is the real signal.
    await page.getByTestId("button-bands-plus").click().catch(() => {});

    // Assertion (1): the ErrorBoundary fallback actually renders, replacing
    // the whole app tree (not a sibling of it).
    await expect(page.getByText(ERROR_BOUNDARY_FALLBACK_TEXT)).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Assertion (2): a Sentry envelope was actually sent — `Sentry.
    // ErrorBoundary`'s default `componentDidCatch` reports the caught error
    // automatically. Poll rather than assume it landed the instant the
    // fallback painted (the report call and the render-fallback commit are
    // not strictly ordered).
    await expect.poll(() => captured.join("\n"), { timeout: 10_000 }).toContain(INDUCED_ERROR_MARKER);

    // Give any trailing batched/retried envelope a moment to flush before
    // the final PII sweep.
    await page.waitForTimeout(1_000);

    const blob = captured.join("\n").toLowerCase();
    for (const bad of FORBIDDEN_TOKENS) {
      expect(blob, `forbidden token "${bad}" found in a captured Sentry payload`).not.toContain(bad.toLowerCase());
    }
    // No email-shaped string anywhere (see EMAIL_PATTERN's comment) — and,
    // as a stronger direct check, the disposable account's own real email
    // never appears verbatim either.
    expect(blob, "an email-shaped string was found in a captured Sentry payload").not.toMatch(EMAIL_PATTERN);
    expect(blob).not.toContain(email.toLowerCase());

    // Cleanup — delete the disposable scenario via the real API (independent
    // of the now-crashed React tree; `page.request` shares this context's
    // cookies, same as every other e2e spec in this suite). The operator
    // running this spec against real dev servers confirms the DELETE landed
    // by grepping the api-server dev log for `DELETE /api/scenarios/<id>`
    // — this repo has no in-spec log-tailing mechanism, matching every
    // other spec's convention here. The disposable account itself is left
    // in place (no user-deletion endpoint exists), also matching convention.
    const deleteResp = await page.request.delete(`/api/scenarios/${scenarioId}`);
    expect(deleteResp.status()).toBe(204);
  });
});
