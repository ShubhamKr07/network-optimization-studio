/**
 * Browser E2E — POSTHOG-10 QA: analytics events actually fire, and no PII
 * ever leaves the browser.
 *
 * Intercepts every request to the PostHog ingest host (stubbed 200, never
 * a real network call), registers a disposable account, opens a Workspace
 * chapter, and triggers a real solve. Asserts:
 *   1. A captured payload contains the `"solve triggered"` event
 *      (`lib/analytics.ts`'s `track()` call in `Workspace.tsx`'s
 *      `handleSolve`).
 *   2. NO captured payload — across every event PostHog's SDK actually sent
 *      to its event-capture endpoint (`track()` calls, `identify()`,
 *      `$pageview`) — ever contains an email (`@`), a password, or a
 *      scenario `inputs` value class (`demand`, `capacity`), or a real city
 *      string from the base dataset. This is the load-bearing privacy
 *      assertion for the whole PostHog integration: `lib/analytics.ts`'s
 *      `ALLOWED_PROP_KEYS` allowlist is supposed to guarantee this
 *      end-to-end, in a REAL browser sending REAL network requests, not
 *      just in the wrapper's own unit tests.
 *
 * ── Two real environment gotchas found while writing this spec (neither
 * documented anywhere else in this repo) ─────────────────────────────────
 *
 * (1) posthog-js has a BUILT-IN bot filter (`opt_out_useragent_filter`
 * defaults to `false`) that silently drops every `capture()` call — no
 * error, no network request at all, nothing to catch in a try/catch — when
 * it detects automation. It checks the UA string against a hardcoded
 * blocklist (includes `"headlesschrome"`) AND two independent low-level
 * signals that survive a plain UA-string override:
 *   - `navigator.webdriver === true` (always true under CDP automation).
 *   - `navigator.userAgentData.brands` still contains a `"HeadlessChrome"`
 *     brand entry even after `navigator.userAgent` itself has been
 *     overridden — the two are populated by different browser internals,
 *     and overriding one does not override the other.
 * (`navigator.userAgent` itself is fine here — the `chromium` project's
 * `devices["Desktop Chrome"]` preset already sets a normal, non-headless
 * string, so only the two signals below need spoofing.) Confirmed
 * empirically: with neither override, ZERO requests ever reach
 * `**i.posthog.com**` — not `$pageview`, not `identify`, nothing, not just
 * the events this spec cares about. Both signals must be spoofed via
 * `page.addInitScript` (test-harness-only, before any page script runs —
 * no app code is touched) for any PostHog event to leave the page under
 * Playwright at all. A real student's browser has neither signal set, so
 * this override does not mask any privacy behavior this spec verifies — it
 * only unblocks the SDK's own automation guard so the events under test
 * can be observed.
 *
 * (2) posthog-js gzip-compresses SOME of its capture-endpoint (`/e/`)
 * request bodies and not others (observed: small early batches like a
 * lone `$identify` call go out gzip-compressed; a later, larger batch
 * containing `$pageview` + `solve triggered` goes out as plain JSON) —
 * there is no reliable size/event-count rule visible from the outside, so
 * this spec cannot assume either encoding. A naive `route.request()
 * .postData()` (string) mangles binary/gzip bytes into un-decodable
 * garbage that can spuriously "contain" almost any short forbidden token
 * by chance (confirmed while writing this spec: a false failure on the "@"
 * token came from raw gzip byte noise, not a real leak). This spec instead
 * reads `postDataBuffer()`, detects the gzip magic (`0x1f 0x8b`), and
 * `zlib.gunzipSync`s it before the PII sweep — so a real leak inside a
 * compressed batch would still be caught, and binary noise never produces
 * a false failure.
 *
 * Requires `VITE_POSTHOG_KEY` set on the studio dev server (a real key is
 * never contacted — every ingest request is intercepted and stubbed before
 * it leaves the page). See CLAUDE.md's e2e run recipe.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy
 * (`API_PROXY_TARGET`) so the browser sees one origin — see vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import zlib from "node:zlib";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 60_000;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// A real base-dataset city (solvers/p-median-us/dataset/warehouses.json,
// WH "ALN" = Allentown, PA) — the load-bearing non-generic-string check. If
// this ever shows up in a captured payload, something (autocapture, an
// event prop, a $current_url query string, etc.) is leaking real
// scenario/dataset data, not just a generic word.
const REAL_CITY = "Allentown";

// Forbidden substrings per the plan's Global Constraints allowlist: email
// marker, password, and the two scenario-`inputs` value classes most likely
// to leak via a careless event prop (demand, capacity), plus the real city.
const FORBIDDEN_TOKENS = ["@", "password", "demand", "capacity", REAL_CITY];

/**
 * Neutralize posthog-js's built-in bot filter for this page only — see gotcha
 * (1) above. Must run via `addInitScript` (before any page script, including
 * main.tsx's synchronous `initAnalytics()` call, ever executes) — a
 * `page.evaluate` after `goto` is too late.
 */
async function bypassPosthogBotFilter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Not)A;Brand", version: "24" },
          { brand: "Chromium", version: "149" },
          { brand: "Google Chrome", version: "149" },
        ],
        mobile: false,
        platform: "Windows",
      }),
    });
  });
}

/** Decode a captured request body regardless of gzip vs plain — see gotcha (2) above. */
function decodeBody(buf: Buffer): string {
  if (buf.length >= 2 && buf.subarray(0, 2).equals(GZIP_MAGIC)) {
    return zlib.gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}

async function registerFreshAccount(page: Page): Promise<string> {
  const email = `e2e-posthog-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

async function createPMedianScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E PostHog ${Date.now()}`,
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

test.describe("PostHog analytics — event capture + PII boundary", () => {
  test("fires 'solve triggered' on a real solve, and never leaks PII across any captured payload", async ({ page }) => {
    test.setTimeout(90_000);

    await bypassPosthogBotFilter(page);

    const captured: string[] = [];
    // Intercept EVERY PostHog host this SDK talks to (ingest `us.i.posthog.com`,
    // config bootstrap `us-assets.i.posthog.com`) — a literal `**/i.posthog.com/**`
    // glob requires a `/` immediately before the host, which never matches a
    // regional subdomain like `us.i.posthog.com` (the actual configured
    // default host in `lib/analytics.ts`); confirmed empirically while
    // writing this spec (zero interceptions, and every request falling
    // through to the real network, 404ing for the fake test key). Every
    // matched request is stubbed 200 so nothing ever leaves this machine for
    // real. Only the actual event-capture endpoint's (`/e/`) body is decoded
    // and recorded for the PII sweep — `/flags` (feature-flag bootstrap,
    // fires before any application `track()` call) and `/array/.../config*`
    // (remote-config bootstrap) carry no application event data at all, so
    // there is nothing of substance to check there.
    await page.route("**i.posthog.com**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/e")) {
        const buf = route.request().postDataBuffer();
        if (buf) captured.push(decodeBody(buf));
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    const email = await registerFreshAccount(page);
    const scenarioId = await createPMedianScenario(page);

    await page.goto(`/chapter-3?scenario=${scenarioId}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Trigger a real solve through the UI (not the API) — the analytics
    // `track("solve triggered", ...)` call lives inside Workspace.tsx's
    // `handleSolve`, on the Solve-dialog button click path, not on the raw
    // POST /solve request.
    await page.getByTestId("button-run-optimizer").click();
    await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("solve-dialog-solve").click();
    // Real CBC solve — wait for the dialog to close (solve succeeded) rather
    // than a fixed sleep, same convention as workspace-ux-r1-r9.spec.ts.
    await expect(page.getByTestId("solve-dialog")).not.toBeVisible({ timeout: SOLVE_TIMEOUT });

    // posthog-js batches captures; poll rather than assume they've all
    // landed the instant the dialog closes.
    await expect.poll(() => captured.join("\n"), { timeout: 10_000 }).toContain("solve triggered");

    // Give any trailing batched captures (e.g. a post-solve $pageview or
    // autocapture event) a moment to flush before the final PII sweep.
    await page.waitForTimeout(1_000);

    const blob = captured.join("\n").toLowerCase();
    for (const bad of FORBIDDEN_TOKENS) {
      expect(blob, `forbidden token "${bad}" found in a captured PostHog payload`).not.toContain(bad.toLowerCase());
    }
    // Sanity: the email itself (not just the generic "@" token) never
    // appears verbatim either.
    expect(blob).not.toContain(email.toLowerCase());

    // Cleanup — delete the disposable scenario via the real API (no
    // user-deletion endpoint exists in this app; the disposable account
    // itself is left in place, same convention as every other e2e spec in
    // this suite). The operator running this spec against real dev servers
    // confirms the DELETE landed by grepping the api-server dev log for
    // `DELETE /api/scenarios/<id>` — this repo has no in-spec log-tailing
    // mechanism, matching every other spec's convention here.
    const deleteResp = await page.request.delete(`/api/scenarios/${scenarioId}`);
    expect(deleteResp.status()).toBe(204);
  });
});
