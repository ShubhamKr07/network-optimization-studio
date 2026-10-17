/**
 * SBR (review finding 7) — real-browser coverage for the collapsible sidebar
 * rail. SCU-1.6 (spec B1.5): the sidebar loads EXPANDED on every model page,
 * collapses when Run Optimizer opens the solve dialog, and nothing is persisted.
 *
 * Why this spec has to exist: the bundle's other new assertions are all
 * jsdom/RTL, and jsdom cannot verify either of the two mechanisms the feature
 * actually rests on. There is no Tailwind stylesheet there, so `group-hover`
 * and `opacity-0` have no effect and a "hidden" pill is indistinguishable from
 * a visible one; and `src/__tests__/setup.ts` installs a no-op ResizeObserver,
 * so the container-resize -> `invalidateSize()` path never runs. Both are only
 * observable in a real browser.
 *
 * Target: E2E_BASE_URL. Requires the local dev proxy (`API_PROXY_TARGET`) so
 * the browser sees one origin — see vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

const HEADER_TIMEOUT = 10_000;

// Local helpers, matching the established pattern in this directory — e2e/
// has no shared auth/scenario helper module (only modelLock.ts and
// solvedAt.ts), and every spec defines its own. Copied from
// bundle6-ui-tweaks.spec.ts so the scenario shape stays identical.
async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

async function createPMedianScenario(page: Page, name: string, p: number): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name,
      modelId: "p-median-us",
      inputs: {
        p,
        distanceBands: [200, 400, 800, 1600],
        capacityMode: "none",
        uniformCapacity: null,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

/** Computed opacity of an element, as the browser actually paints it. */
async function opacityOf(page: Page, testid: string): Promise<string> {
  return page.getByTestId(testid).evaluate(el => getComputedStyle(el).opacity);
}

async function navWidth(page: Page): Promise<number> {
  return page
    .getByTestId("sidebar-tree")
    .evaluate(el => Math.round(el.getBoundingClientRect().width));
}

test.describe("Sidebar rail — expanded on load, collapses on Run Optimizer", () => {
  test("loads expanded, collapses to the rail, reveals exactly one label on hover, does not persist, and Run Optimizer collapses it", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-rail");
    const id = await createPMedianScenario(page, `E2E SBR rail ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // 1. Expanded is the load state (SCU-1.6).
    const nav = page.getByTestId("sidebar-tree");
    await expect(nav).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => navWidth(page), { timeout: HEADER_TIMEOUT }).toBe(224);

    // 2. The hamburger collapses it to the 44px rail.
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(nav).toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => navWidth(page), { timeout: HEADER_TIMEOUT }).toBe(44);

    // 3. Every entry keeps its testid and stays clickable in the rail.
    await expect(page.getByTestId("sidebar-input-input-map")).toBeVisible();
    await expect(page.getByTestId("sidebar-input-warehouses")).toBeVisible();

    // 4. Hovering ONE rail icon paints ONE label (jsdom cannot check this).
    const warehousesPill = page.getByTestId("sidebar-input-warehouses").locator("span");
    const customersPill = page.getByTestId("sidebar-input-customers").locator("span");
    await page.getByTestId("sidebar-input-warehouses").hover({ timeout: HEADER_TIMEOUT });
    await expect
      .poll(async () => warehousesPill.evaluate(el => getComputedStyle(el).opacity), { timeout: HEADER_TIMEOUT })
      .toBe("1");
    expect(await customersPill.evaluate(el => getComputedStyle(el).opacity)).toBe("0");

    // 5. The pill paints ABOVE the map — asserted with stacking, never
    //    elementFromPoint (the pill is pointer-events-none by design).
    const pillBox = await warehousesPill.boundingBox();
    const mapBox = await page.locator(".leaflet-container").first().boundingBox();
    expect(pillBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    expect(pillBox!.x + pillBox!.width).toBeGreaterThan(mapBox!.x);
    const stacking = await page.evaluate(() => {
      const navEl = document.querySelector('[data-testid="sidebar-tree"]')!;
      const map = document.querySelector(".leaflet-container")!;
      const navStyle = getComputedStyle(navEl);
      return { navZ: Number(navStyle.zIndex), navPosition: navStyle.position, mapZ: Number(getComputedStyle(map).zIndex) };
    });
    expect(stacking.navPosition).not.toBe("static");
    expect(stacking.navZ).toBeGreaterThan(stacking.mapZ);

    // 6. Not persisted: a reload is a fresh model-page load -> expanded again.
    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");

    // 7. Run Optimizer collapses it as it opens the solve dialog.
    await page.getByTestId("button-run-optimizer").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
  });

  test("the map redraws to the new width when the rail toggles", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-railmap");
    const id = await createPMedianScenario(page, `E2E SBR railmap ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    // Input Map is the seeded view on entry, and it is InputMapTab's OWN
    // MapContainer — not NetworkMap's. A fix mounted only in NetworkMap would
    // leave this stale, which is precisely the bug this guards.
    await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");

    const mapWidth = () =>
      page.locator(".leaflet-container").first().evaluate(el => Math.round(el.getBoundingClientRect().width));
    const tileSpan = () =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll(".leaflet-tile-loaded")];
        if (!tiles.length) return 0;
        const left = Math.min(...tiles.map(t => t.getBoundingClientRect().left));
        const right = Math.max(...tiles.map(t => t.getBoundingClientRect().right));
        return Math.round(right - left);
      });

    const expandedWidth = await mapWidth();
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");

    // The container must grow by exactly the rail's shrink (224 - 44).
    await expect.poll(async () => await mapWidth(), { timeout: HEADER_TIMEOUT }).toBe(expandedWidth + 180);

    // And Leaflet must have been told about it: tiles have to cover the new
    // container, not the old one (InvalidateOnResize).
    await expect
      .poll(async () => (await tileSpan()) >= (await mapWidth()), { timeout: HEADER_TIMEOUT })
      .toBe(true);
  });

  test("an abandoned delete-confirm does not leave the flyout capturing clicks", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-railflyout");
    const id = await createPMedianScenario(page, `E2E SBR flyout ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    // SCU-1.6 — loads expanded; collapse to the rail to reach the flyout.
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");

    // Start a delete, then walk away without answering.
    await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });
    await page.getByTestId(`button-delete-scenario-${id}`).click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    // Move the pointer off the rail entirely.
    await page.mouse.move(900, 400);

    // The flyout must release: otherwise a 224px interactive panel stays parked
    // over the content column and swallows clicks on the map beneath it.
    await expect(page.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
    await expect(page.getByTestId(`button-confirm-delete-${id}`)).toHaveCount(0);
    await expect
      .poll(async () => opacityOf(page, "sidebar-scenarios-flyout"), { timeout: HEADER_TIMEOUT })
      .toBe("0");

    // The scenario still exists — abandoning the confirm must not delete.
    // After the reload the sidebar is expanded again (not persisted), so the
    // row is directly in the panel.
    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId(`sidebar-scenario-${id}`)).toHaveCount(1);
  });
});
