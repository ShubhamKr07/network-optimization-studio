/**
 * Browser E2E — QFX (quick fixes bundle), QFX-QA.
 *
 * Covers what jsdom cannot see: computed CSS (QFX-10), overlay/box layout (QFX-8),
 * real file I/O (QFX-1 / QFX-2b), and the draft -> Save -> reload round trip (QFX-6).
 * Solver results are SEEDED (route-intercepted scenario GET + stubbed solve job), never
 * real CBC — see e2e/max-coverage-objective.spec.ts for the pattern and HARNESS.md for why.
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";
import { downloadVia } from "./helpers/download";

test.use({ actionTimeout: 15_000 });

const HEADER_TIMEOUT = 10_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(fs.readFileSync(path.resolve(HERE, "../public/samples/super-model-sample.json"), "utf8"));
const seededResult = JSON.parse(fs.readFileSync(path.resolve(HERE, "../src/__tests__/fixtures/superResult.json"), "utf8"));

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-qfx-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Creates a super-model scenario holding `inputs` (default: the shipped sample) and opens it. */
async function createSuperScenario(page: Page, inputs: Record<string, unknown> = sample): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `E2E QFX ${Date.now()}`, modelId: "super-model", inputs },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/super-model?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

async function serverInputs(page: Page, id: string): Promise<any> {
  return (await (await page.request.get(`/api/scenarios/${id}`)).json()).inputs;
}

/** A seeded super result opening exactly `open`. */
function resultOpening(open: string[]): Record<string, unknown> {
  return { ...seededResult, metrics: { ...seededResult.metrics, openFacilityIds: open } };
}

const JOB_ID = 987001;

/** Seeded scenario GET + stubbed solve. `jobStatus` "succeeded" completes at once; "running" holds the overlay open. */
async function installStubs(page: Page, id: string, state: { seeded: Record<string, unknown> | null }, jobStatus: "succeeded" | "running") {
  await page.route(`**/api/scenarios/${id}/solve`, async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: JOB_ID }) });
  });
  await page.route(`**/api/scenarios/${id}/solve-jobs/*`, route => {
    const now = Date.now();
    const done = jobStatus === "succeeded";
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        id: JOB_ID, status: jobStatus, error: null, errorCode: null, errorMessage: null, resultSummary: null,
        queuedAt: new Date(now - 2_000).toISOString(), startedAt: new Date(now - 1_500).toISOString(),
        finishedAt: done ? new Date(now).toISOString() : null,
      }),
    });
  });
  await page.route(`**/api/scenarios/${id}`, async route => {
    if (route.request().method() !== "GET" || state.seeded == null) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, result: state.seeded, stale: false, solvedAt: new Date().toISOString() } });
  });
}

async function runSolveViaDialog(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click({ timeout: HEADER_TIMEOUT });
}

interface SelectStyle { appearance: string; paddingRight: number; backgroundImage: string; testid: string | null }

/** Computed style of every visible single-select that the global select rule targets. */
async function selectStyles(page: Page): Promise<SelectStyle[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLSelectElement>("select:not([multiple]):not([size])"))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; })
      .map(el => {
        const cs = getComputedStyle(el);
        return { appearance: cs.appearance, paddingRight: parseFloat(cs.paddingRight), backgroundImage: cs.backgroundImage, testid: el.getAttribute("data-testid") };
      }));
}

function expectChevron(styles: SelectStyle[], where: string): void {
  expect(styles.length, `${where}: at least one visible select`).toBeGreaterThan(0);
  for (const s of styles) {
    expect(s.appearance, `${where} ${s.testid} appearance`).toBe("none");
    expect(s.paddingRight, `${where} ${s.testid} padding-right`).toBeGreaterThanOrEqual(28);
    expect(s.backgroundImage, `${where} ${s.testid} background-image`).toContain("gradient");
  }
}

test.describe("QFX quick fixes", () => {
  test("QFX-10: every visible select draws the gradient chevron with room for it, in light and dark", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createSuperScenario(page);
    try {
      // The Warehouses tab has per-row selects only for select-kind columns; Plant products carries the plantId/productId selects.
      await page.getByTestId("sidebar-input-plantProducts").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-tab-plantProducts")).toBeVisible({ timeout: HEADER_TIMEOUT });
      expectChevron(await selectStyles(page), "plantProducts (light)");

      await page.evaluate(() => document.documentElement.classList.add("dark"));
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
      expectChevron(await selectStyles(page), "plantProducts (dark)");
      await page.evaluate(() => document.documentElement.classList.remove("dark"));

      // Run Optimizer dialog: the super model's renders no selects today. If one is added it must get the chevron
      // check (light + dark, as above) - this assertion fails first so that cannot be forgotten.
      await page.getByTestId("button-run-optimizer").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await page.getByTestId("solve-dialog").locator("select:not([multiple]):not([size])").count()).toBe(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-8: output map caption lists at most 5 open sites, expands and collapses, and clears the map's top edge", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const whIds = sample.warehouses.map((w: { id: string }) => w.id).slice(0, 7);
    const state: { seeded: Record<string, unknown> | null } = { seeded: resultOpening(whIds) };
    // Install the stubs before the scenario page loads so the first GET is already the seeded one.
    const resp = await page.request.post("/api/scenarios", { data: { name: `E2E QFX ${Date.now()}`, modelId: "super-model", inputs: sample } });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);
    try {
      await installStubs(page, id, state, "succeeded");
      await page.goto(`/super-model?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: 30_000 });   // Input Map seed lands first; see QFX-6
      await page.getByTestId("sidebar-output-output-map").click({ timeout: HEADER_TIMEOUT });
      const caption = page.getByTestId("output-map-open-sites");
      await expect(caption).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(caption).toHaveText(/^Open facilities: /);
      const labelCount = async () => ((await caption.innerText()).match(/\bwh-\d+ · /g) ?? []).length;
      expect(await labelCount()).toBe(5);
      const toggle = page.getByTestId("output-map-open-sites-toggle");
      await expect(toggle).toHaveText("+2 more");

      await toggle.click({ timeout: HEADER_TIMEOUT });
      await expect(toggle).toHaveText("Show fewer");
      expect(await labelCount()).toBe(7);
      await toggle.click({ timeout: HEADER_TIMEOUT });
      await expect(toggle).toHaveText("+2 more");
      expect(await labelCount()).toBe(5);

      const cap = (await caption.boundingBox())!;
      expect(cap.width).toBeGreaterThan(0);
      expect(cap.height).toBeGreaterThan(0);
      const map = (await page.getByTestId("output-map-tab").locator(".leaflet-container").first().boundingBox())!;
      expect(map, "map container renders").toBeTruthy();
      expect(cap.y + cap.height, "caption bottom <= map top (no overlap)").toBeLessThanOrEqual(map.y + 1);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-1: toolbar is Save, Import network, Export in DOM order; Export -> XLSX downloads; history hides Import but keeps Export", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const resp = await page.request.post("/api/scenarios", { data: { name: `E2E QFX ${Date.now()}`, modelId: "super-model", inputs: sample } });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);
    const state: { seeded: Record<string, unknown> | null } = { seeded: resultOpening(["wh-11", "wh-14"]) };
    try {
      await installStubs(page, id, state, "succeeded");
      await page.goto(`/super-model?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-toolbar-export")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // DOM order: Save, then Import network, then Export.
      const order = await page.getByTestId("workspace-toolbar-row").evaluate(row => {
        const pos = (tid: string) => {
          const el = row.querySelector(`[data-testid="${tid}"]`);
          return el ? Array.from(row.querySelectorAll("*")).indexOf(el) : -1;
        };
        return { save: pos("button-save"), imp: pos("super-toolbar-import"), exp: pos("super-toolbar-export") };
      });
      expect(order.save).toBeGreaterThanOrEqual(0);
      expect(order.imp).toBeGreaterThan(order.save);
      expect(order.exp).toBeGreaterThan(order.imp);

      // Vertical alignment of the trio (REPORT-only measurement; recorded as annotations).
      const boxes: Record<string, { y: number; h: number } | null> = {};
      for (const tid of ["button-save", "super-toolbar-import", "super-toolbar-export"]) {
        const b = await page.getByTestId(tid).boundingBox();
        boxes[tid] = b ? { y: b.y, h: b.height } : null;
      }
      test.info().annotations.push({ type: "toolbar-trio-boxes", description: JSON.stringify(boxes) });

      const xlsx = await downloadVia(page, "super-toolbar-export", "super-toolbar-export-xlsx");
      expect(xlsx.name).toMatch(/\.xlsx$/);
      const csv = await downloadVia(page, "super-toolbar-export", "super-toolbar-export-csv");
      expect(csv.name.length).toBeGreaterThan(0);

      // Browsing history: needs a second entry -> a stubbed solve whose seeded result differs.
      await expect(page.getByTestId("super-toolbar-import")).toBeVisible();
      state.seeded = resultOpening(["wh-1", "wh-2"]);
      await runSolveViaDialog(page);
      await expect(page.getByTestId("text-result-history-position")).toHaveText("2/2", { timeout: 30_000 });
      await page.getByTestId("button-result-back").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2", { timeout: HEADER_TIMEOUT });
      // The Save/Import/Export row only exists on editable input tabs; a solve lands on Output Map, so go back to one.
      await page.getByTestId("sidebar-input-warehouses").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-tab-warehouses")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-result-history-position")).toHaveText("1/2");
      // Decision C2: Import hidden (it writes), Export stays (exports the latest saved network).
      await expect(page.getByTestId("super-toolbar-import")).toHaveCount(0);
      await expect(page.getByTestId("super-toolbar-export")).toBeVisible();
      await expect(page.getByTestId("super-toolbar-export")).toBeEnabled();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-2b: Warehouses Download CSV -> Upload CSV -> Replace leaves the table unchanged and the draft clean after Save", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createSuperScenario(page);
    try {
      await page.getByTestId("sidebar-input-warehouses").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-tab-warehouses")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const before = (await serverInputs(page, id)).warehouses;

      await page.getByTestId("super-warehouses-download").click({ timeout: HEADER_TIMEOUT });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: HEADER_TIMEOUT }),
        page.getByTestId("super-warehouses-download-csv").click({ timeout: HEADER_TIMEOUT }),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.csv$/);
      // The upload dialog validates the extension, and Playwright's temp path has none: save under the real name.
      const filePath = test.info().outputPath(download.suggestedFilename());
      await download.saveAs(filePath);

      await page.getByTestId("super-warehouses-upload").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-warehouses-upload-csv").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-upload-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.setInputFiles("[data-testid=super-upload-file-warehouses]", filePath);
      await expect(page.getByTestId("super-upload-replace")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-upload-merge-count")).toContainText(`Merge: 0 added, ${before.length} updated, 0 kept`);
      await page.getByTestId("super-upload-replace").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-upload-dialog")).toHaveCount(0, { timeout: HEADER_TIMEOUT });

      // Save only if the draft considers itself changed; either way the end state must be clean and equal.
      const save = page.getByTestId("button-save");
      if (await save.isEnabled()) await save.click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("text-unsaved-changes")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      expect((await serverInputs(page, id)).warehouses).toEqual(before);
      for (const w of before.slice(0, 3)) await expect(page.getByTestId(`super-row-warehouses-${w.id}`)).toBeVisible();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-3: the Solve button at the bottom of Optimization Parameters starts the solve overlay without the Run Optimizer dialog", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const resp = await page.request.post("/api/scenarios", { data: { name: `E2E QFX ${Date.now()}`, modelId: "super-model", inputs: sample } });
    expect(resp.status()).toBe(201);
    const id = String((await resp.json()).id);
    try {
      // Job stays "running" so the overlay is observable, deterministically (no real CBC).
      await installStubs(page, id, { seeded: null }, "running");
      await page.goto(`/super-model?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: 30_000 });   // Input Map seed lands first; see QFX-6
      await page.getByTestId("sidebar-input-optimization-parameters").click({ timeout: HEADER_TIMEOUT });
      // 30s, not HEADER_TIMEOUT: this one missed 10s once in a full gate at load ~50 (green 2/2 alone).
      await expect(page.getByTestId("super-readiness-ok")).toBeVisible({ timeout: 30_000 });
      const solve = page.getByTestId("button-tab-solve");
      await expect(solve).toBeEnabled({ timeout: 30_000 });
      await solve.click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("solve-progress-overlay")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByRole("dialog", { name: "Run Optimizer" })).toHaveCount(0);
      await expect(page.getByTestId("solve-dialog")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-6: Add warehouse / Add capability forms add rows to the draft; Save + reload persists them", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    // Drop one plant x product pair so "Add capability" has a free pair to fill.
    const plantProducts = sample.plantProducts.filter((r: { plantId: string; productId: string }) => !(r.plantId === "plant-1" && r.productId === "product-2"));
    expect(plantProducts).toHaveLength(sample.plantProducts.length - 1);
    const id = await createSuperScenario(page, { ...sample, plantProducts });
    try {
      await page.getByTestId("sidebar-input-warehouses").click({ timeout: HEADER_TIMEOUT });
      const add = page.getByTestId("super-warehouses-add");
      await expect(add).toHaveText("Add warehouse", { timeout: HEADER_TIMEOUT });
      await add.click({ timeout: HEADER_TIMEOUT });
      const dialog = page.getByTestId("super-add-dialog");
      await expect(dialog).toBeVisible({ timeout: HEADER_TIMEOUT });
      const newId = await dialog.getByTestId("super-add-id").inputValue();
      expect(newId.length).toBeGreaterThan(0);
      expect(sample.warehouses.map((w: { id: string }) => w.id)).not.toContain(newId);
      await dialog.getByTestId("super-add-city").fill("Testville");
      await dialog.getByTestId("super-add-state").fill("TX");
      await dialog.getByTestId("super-add-lat").fill("31.5");
      await dialog.getByTestId("super-add-lng").fill("-97.1");
      await dialog.getByTestId("super-add-confirm").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-add-dialog")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId(`super-row-warehouses-${newId}`)).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-input-plantProducts").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-plantProducts-add").click({ timeout: HEADER_TIMEOUT });
      const dialog2 = page.getByTestId("super-add-dialog");
      await expect(dialog2.getByText("Cost per unit")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await dialog2.getByTestId("super-add-plantId").selectOption("plant-1");
      await dialog2.getByTestId("super-add-productId").selectOption("product-2");
      await dialog2.getByTestId("super-add-capacity").fill("1234");
      await dialog2.getByTestId("super-add-costPerUnit").fill("2.5");
      await dialog2.getByTestId("super-add-confirm").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-add-dialog")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId(`super-row-plantProducts-${JSON.stringify(["plant-1", "product-2"])}`)).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await serverInputs(page, id)).warehouses.some((w: { id: string }) => w.id === newId), { timeout: HEADER_TIMEOUT })
        .toBe(true);
      const saved = await serverInputs(page, id);
      expect(saved.warehouses.find((w: { id: string }) => w.id === newId)).toMatchObject({ city: "Testville", state: "TX", lat: 31.5, lng: -97.1, status: "active" });
      expect(saved.plantProducts.find((r: { plantId: string; productId: string }) => r.plantId === "plant-1" && r.productId === "product-2"))
        .toMatchObject({ capacity: 1234, costPerUnit: 2.5 });

      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // A non-empty scenario seeds the Input Map once on entry; clicking a sidebar item before that lands is overridden
      // (seen under load: the click highlighted Warehouses but the map won). Wait for the seed, then navigate.
      await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("sidebar-input-warehouses").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId(`super-row-warehouses-${newId}`)).toBeVisible({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("QFX-9: distance method is a radiogroup with arrow-key navigation; circuity factor validates, Apply is gated, Enter applies", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createSuperScenario(page);
    try {
      await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
      const haversine = page.getByTestId("super-distance-method-haversine");
      const circuity = page.getByTestId("super-distance-method-circuity");
      const road = page.getByTestId("super-distance-method-road");
      await expect(haversine).toHaveAttribute("aria-checked", "true", { timeout: HEADER_TIMEOUT });

      await haversine.focus();
      await page.keyboard.press("ArrowRight");
      await expect(circuity).toHaveAttribute("aria-checked", "true");
      await expect(circuity).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(road).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("ArrowLeft");
      await expect(circuity).toHaveAttribute("aria-checked", "true");

      const factor = page.getByTestId("super-circuity-factor");
      const apply = page.getByTestId("super-circuity-apply");
      await expect(factor).toBeVisible({ timeout: HEADER_TIMEOUT });
      await factor.fill("1.2345");
      await expect(page.getByTestId("super-circuity-error")).toHaveText("Use a number from 1 to 3 with up to 3 decimals.");
      await expect(apply).toBeDisabled();

      await factor.fill("1.234");
      await expect(page.getByTestId("super-circuity-error")).toHaveCount(0);
      await expect(apply).toBeEnabled();
      await factor.press("Enter");
      // Applying makes the factor part of the draft; Save persists it.
      await expect(apply).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await serverInputs(page, id)).circuityFactor, { timeout: HEADER_TIMEOUT })
        .toBe(1.234);
      expect((await serverInputs(page, id)).distanceMethod).toBe("circuity");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
