/**
 * Browser E2E — Bundle 3 (book-cover design system), Task T11.
 *
 * Real-browser computed-style smoke test. jsdom (vitest) cannot resolve CSS
 * custom properties, real font loading, or `var()` inside SVG presentation
 * attributes the way real Chromium does (see workspace-ux-r1-r9.spec.ts's
 * own R3 precedent, which established the same pattern for map markers) —
 * this spec exists to catch exactly the class of bug a jsdom component test
 * can't: a token wired correctly in index.css but never actually reaching a
 * real rendered pixel.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "labs.spec.ts is stale" gotcha for the exact local run recipe.
 *
 * KNOWN DEVIATION FROM THE PLAN (confirmed via grep, not an oversight): the
 * plan's Step 1 asks for a live Select/dropdown focus-contrast check, but
 * neither `components/ui/select.tsx` nor `components/ui/dropdown-menu.tsx`
 * has any live consumer anywhere in this app today — every real dropdown in
 * this repo is either a native `<select>` (Workspace.tsx's scenario picker)
 * or a button-group (WarehouseTable/CustomerTable status pickers). There is
 * no mounted Radix Select/DropdownMenu to click through, and fabricating one
 * is out of this task's scope (create ONLY this spec file). Instead, the
 * focus-contrast assertion below verifies the exact compiled
 * `.bg-accent`/`.text-accent-foreground` utility pair those two ui/
 * primitives already use verbatim (`focus:bg-accent focus:text-accent-
 * foreground` — ui/select.tsx's SelectItem, ui/dropdown-menu.tsx's
 * SubTrigger) against real DOM computed style in a real browser. Any future
 * live consumer inherits this pair unchanged, so this genuinely proves
 * finding 1's AA fix (ink accent-foreground, not white, over green-400) at
 * the token/utility level rather than faking a UI interaction that doesn't
 * exist.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page, tag: string): Promise<void> {
  const email = `e2e-design-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenarioApi(page: Page, modelId: string, name: string, inputs: Record<string, unknown>): Promise<number> {
  const resp = await page.request.post("/api/scenarios", { data: { name, modelId, inputs } });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

async function solveViaApi(page: Page, id: number): Promise<void> {
  const solveResp = await page.request.post(`/api/scenarios/${id}/solve`);
  expect(solveResp.status()).toBe(202);
  const { jobId } = await solveResp.json();
  for (let i = 0; i < 60; i++) {
    const jobResp = await page.request.get(`/api/scenarios/${id}/solve-jobs/${jobId}`);
    const job = await jobResp.json();
    if (job.status === "succeeded") return;
    if (job.status === "failed") throw new Error(`solve job ${jobId} failed`);
    await page.waitForTimeout(500);
  }
  throw new Error(`solve job ${jobId} did not complete in time`);
}

async function gotoScenario(page: Page, path: string, id: number): Promise<void> {
  await page.goto(`${path}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
}

/** Resolves a CSS custom property to its real computed value in the live
 * page, via an offscreen probe element — avoids ever hand-converting
 * HSL/hex ourselves (a hand conversion is exactly the kind of drift risk
 * the source-contract test (designTokens.contract.test.ts) doesn't catch,
 * since it only checks token *shape*, not what a real browser resolves it
 * to). Only valid for raw hex custom properties (e.g. --band-0, --green-600,
 * --ink-900) that are legal as a bare `var(--x)` color value — HSL-triple
 * tokens like --primary/--accent need `hsl(var(--x))` and are resolved via
 * `resolveUtilityClasses` below instead, off their real Tailwind utility. */
async function resolveCssVar(page: Page, cssVar: string, prop: "color" | "backgroundColor"): Promise<string> {
  return page.evaluate(
    ({ cssVar, prop }) => {
      const probe = document.createElement("div");
      probe.style.position = "fixed";
      probe.style.top = "-9999px";
      probe.style.left = "-9999px";
      probe.style.setProperty(prop === "color" ? "color" : "background-color", `var(${cssVar})`);
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe)[prop];
      probe.remove();
      return resolved;
    },
    { cssVar, prop },
  );
}

/** Resolves the real computed color/backgroundColor of a set of compiled
 * Tailwind utility classes, via an offscreen probe — used for HSL-triple
 * tokens (--accent, --accent-foreground, ...) that only resolve through
 * their `hsl(var(--x))` @theme mapping, not a bare `var(--x)`. */
async function resolveUtilityClasses(page: Page, classNames: string): Promise<{ color: string; backgroundColor: string }> {
  return page.evaluate((classNames) => {
    const probe = document.createElement("div");
    probe.className = classNames;
    probe.style.position = "fixed";
    probe.style.top = "-9999px";
    probe.style.left = "-9999px";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const result = { color: cs.color, backgroundColor: cs.backgroundColor };
    probe.remove();
    return result;
  }, classNames);
}

function parseRgb(rgb: string): [number, number, number] {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`not an rgb()/rgba() color string: "${rgb}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Small per-channel tolerance — enough to absorb HSL<->hex rounding
 * differences between two tokens that are meant to represent the same
 * color (e.g. --primary's HSL triple vs --green-600's hex), while still
 * clearly discriminating a real mismatch (e.g. white vs ink is ~230/channel
 * off, nowhere near this tolerance). */
function expectApproxRgb(actual: string, expected: string, tolerance = 4): void {
  const [ar, ag, ab] = parseRgb(actual);
  const [er, eg, eb] = parseRgb(expected);
  expect(Math.abs(ar - er), `R channel: got ${actual}, expected ~${expected}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(ag - eg), `G channel: got ${actual}, expected ~${expected}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(ab - eb), `B channel: got ${actual}, expected ~${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Asserts a computed `box-shadow` carries the exact expected depth-tier
 * layer as its real (non-transparent) shadow — NOT merely `!== "none"` (a
 * fully-transparent `rgba(.../0)` layer would pass that weaker check but be
 * invisible), which is what this task asks for. Confirmed against the real
 * running app (not assumed from the plan's v3-style single-layer
 * expectation): Tailwind v4 composes `box-shadow` as up to 5 stacked layers
 * (inset-shadow, inset-ring-shadow, ring-offset-shadow, ring-shadow,
 * shadow), and any layer a given element's classes don't use renders as a
 * fully-transparent `rgba(0, 0, 0, 0) 0px 0px 0px 0px` placeholder ahead of
 * the real one — so the real `shadow`/`shadow-sm`/`shadow-lg` utility value
 * is always the LAST layer. Matching the whole multi-layer string would be
 * fragile (it depends on which other ring/inset utilities happen to be
 * present on a given element); matching the exact trailing layer is both
 * exact and robust. */
function expectRealShadowLayer(actual: string, expectedLayer: string): void {
  expect(actual.endsWith(expectedLayer), `expected box-shadow to end with "${expectedLayer}", got: "${actual}"`).toBe(true);
}

test.describe("Bundle 3 — book-cover design system", () => {
  test("auth chrome: band header ink bg + primary button ≈ green-600 + accent focus-contrast (AA fix)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("auth-band")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Band header background ≈ ink. --surface-band is a literal complete
    // hex (#181A15), so this is an exact assertion, not an approximation.
    const bandBg = await page.getByTestId("auth-band").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bandBg).toBe("rgb(24, 26, 21)");

    // Primary button (Login's submit — default/primary Button variant)
    // color ≈ green-600. --primary is an HSL triple (82 52% 33%), meant to
    // represent the same color as --green-600's hex — resolved via the real
    // browser on both sides rather than hand-converting HSL ourselves.
    const loginButtonBg = await page.getByTestId("button-login").evaluate((el) => getComputedStyle(el).backgroundColor);
    const green600 = await resolveCssVar(page, "--green-600", "backgroundColor");
    expectApproxRgb(loginButtonBg, green600);

    // Focus-state AA contrast (review finding 1's fix): SelectItem
    // (ui/select.tsx) and DropdownMenuSubTrigger (ui/dropdown-menu.tsx)
    // both use `focus:bg-accent focus:text-accent-foreground` verbatim —
    // see the file header for why this checks the compiled utility pair
    // directly rather than a live Select/DropdownMenu (neither has a live
    // consumer in this app). accent-foreground must be ink (dark), not
    // white, over the accent (green-400) background — white-on-green-400 is
    // ~2.31:1 (fails AA); ink is ~8.2:1.
    const { color: accentFg, backgroundColor: accentBg } = await resolveUtilityClasses(page, "bg-accent text-accent-foreground");
    const ink900 = await resolveCssVar(page, "--ink-900", "color");
    const green400 = await resolveCssVar(page, "--green-400", "backgroundColor");
    expectApproxRgb(accentFg, ink900);
    expectApproxRgb(accentBg, green400);
  });

  test("workspace chrome: Landing hero + AppShell header ink + Card radii/shadow + band-colored legend swatch", async ({ page }) => {
    await registerAndGoHome(page, "pmedian");

    // AppShell header (the real authed shell, distinct from the auth
    // page's own inline band header checked above).
    const header = page.locator("header").first();
    const headerBg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBg).toBe("rgb(24, 26, 21)");

    // Additive-only copy rule: the new band hero title AND Landing's own
    // pre-existing body <h1>"Labs"> both render.
    await expect(page.getByText("Network Design Labs")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Labs", exact: true })).toBeVisible();

    // Card radii (rounded-xl -> --radius-xl = 6px, not the shadcn default
    // 8px) + EXACT shadow (not merely `!== "none"` — a transparent
    // rgba(.../0) would pass that weaker check but be invisible) on a real
    // Landing chapter card.
    const card = page.getByTestId("link-/chapter-3").locator("div").first();
    const cardRadius = await card.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(cardRadius).toBe("6px");
    const cardShadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    expectRealShadowLayer(cardShadow, "rgba(24, 26, 21, 0.06) 0px 1px 2px 0px");

    // Band-colored route legend swatch (NetworkMap's own Output Map legend)
    // resolves to a --band-* token, not a hand-picked literal hex — proves
    // bandPalette.ts's `var(--band-N)` refs (T10) actually paint.
    const id = await createScenarioApi(page, "p-median-us", `E2E design-system ${Date.now()}`, {
      p: 2,
      distanceBands: [250, 500, 750],
      capacityMode: "none",
      uniformCapacity: null,
      warehouseOverrides: [],
      customerOverrides: [],
      gap: 0,
      timeLimitSec: 120,
    });
    try {
      await solveViaApi(page, id);
      await gotoScenario(page, "/chapter-3", id);
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

      const band1Row = page.locator("div.flex.items-center.gap-1", { hasText: "Band 1" });
      await expect(band1Row).toBeVisible({ timeout: HEADER_TIMEOUT });
      const swatch = band1Row.locator("div").first();
      const swatchColor = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
      const band0 = await resolveCssVar(page, "--band-0", "backgroundColor");
      expect(swatchColor).toBe(band0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("Switch thumb shadow (utility depth) vs Dialog overlay shadow (overlay depth) stay decoupled", async ({ page }) => {
    await registerAndGoHome(page, "switchshadow");

    const id = await createScenarioApi(page, "transport-coal", `E2E design-system switch ${Date.now()}`, {
      distanceBands: [500, 1000, 1500, 2000],
      gap: 0,
      timeLimitSec: 120,
      capacityFactor: 1.0,
      singleSource: false,
      capacityInactive: false,
    });
    try {
      await gotoScenario(page, "/chapter-5/transport", id);

      // Switch thumb (OptimizationParametersTab's "Single-source" toggle) —
      // decoupled onto shadow-sm (Step 5b) so it does NOT inherit the
      // overlay-scale shadow-lg.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      const thumb = page.getByTestId("switch-single-source").locator("span").first();
      await expect(thumb).toBeVisible({ timeout: HEADER_TIMEOUT });
      const thumbShadow = await thumb.evaluate((el) => getComputedStyle(el).boxShadow);
      expectRealShadowLayer(thumbShadow, "rgba(24, 26, 21, 0.06) 0px 1px 2px 0px"); // shadow-sm

      // Dialog overlay (Run Optimizer / SolveDialog's DialogContent) — the
      // deep overlay shadow (shadow-lg), genuinely different from the
      // Switch thumb's small one above.
      await page.getByTestId("button-run-optimizer").click();
      const dialog = page.getByTestId("solve-dialog");
      await expect(dialog).toBeVisible({ timeout: HEADER_TIMEOUT });
      const dialogShadow = await dialog.evaluate((el) => getComputedStyle(el).boxShadow);
      expectRealShadowLayer(dialogShadow, "rgba(24, 26, 21, 0.18) 0px 8px 30px 0px"); // shadow-lg
      expect(dialogShadow).not.toBe(thumbShadow);

      await page.getByTestId("solve-dialog-cancel").click();
      await expect(dialog).not.toBeVisible({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
