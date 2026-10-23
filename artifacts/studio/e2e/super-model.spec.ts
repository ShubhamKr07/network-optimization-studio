/**
 * Browser E2E — Super Model (SM-10).
 *
 * Test A: home -> Super Model card -> create a scenario through the UI -> empty
 *   state (sample download link) -> import the shipped sample through the real
 *   import dialog (Replace) -> 100 customer rows -> readiness "ready".
 * Test B: solve the imported sample with real CBC (accepted by plan constraint
 *   C4: the only real-browser proof of the solver path). The sample has p=2 and
 *   FORCES wh-11 + wh-14 open (both status "forced_open"), so the open-set
 *   assertion proves forced-status plumbing + rendering ("Phoenix, AZ" /
 *   "Nassau-Suffolk, NY"; the sample's wh-14 is named New York, its city field is
 *   Nassau-Suffolk), NOT optimality. The objective 254,060,828 (Chapter 9 ground
 *   truth) is the optimality proof.
 * Test C: delete a product -> confirmation states the referencing-row count ->
 *   confirm -> save -> reload -> the deletion (and its cascade) persisted.
 *
 * Tests D-F (SM2-11): CSV set / XLSX workbook import -> Input Map pins -> edit on the
 *   map -> Save -> persisted; CSV error mapping. Test G: the Road method's privacy
 *   notice (no real ORS fetch - the 503 road_distances_unavailable path only).
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { test, expect, type Page } from "./fixtures";
import { readSolvedAt } from "./helpers/solvedAt";

test.use({ actionTimeout: 15_000 });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;
const SAMPLE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/samples/super-model-sample.json");
const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-super-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Creates an EMPTY super-model scenario through the real "+ create" dialog. */
async function createScenarioViaUi(page: Page): Promise<string> {
  await page.getByTestId("button-create-scenario").click({ timeout: HEADER_TIMEOUT });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: HEADER_TIMEOUT });
  await dialog.getByRole("button", { name: /create/i }).click();
  // SM-13: a new super-model scenario opens on the Products tab, so the empty state shows immediately.
  await expect(page.getByTestId("super-empty-state")).toBeVisible({ timeout: HEADER_TIMEOUT });
  const id = new URL(page.url()).searchParams.get("scenario");
  expect(id, "created scenario id must be in the URL").toBeTruthy();
  return id as string;
}

/** Imports the shipped sample through the real dialog (Replace). */
async function importSampleViaUi(page: Page): Promise<void> {
  await page.getByTestId("super-open-import").click({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("super-import-mode-replace").click({ timeout: HEADER_TIMEOUT });
  await page.setInputFiles("[data-testid=super-import-file]", SAMPLE_PATH);
  await expect(page.getByTestId("super-import-confirm")).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("super-import-confirm").click({ timeout: HEADER_TIMEOUT });
  // Empty scenario: Replace needs no overwrite confirmation, and the empty state goes away.
  await expect(page.getByTestId("super-empty-state")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
  // SM2-1 (§6.1): a successful import switches to the Input Map.
  await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Opens the import dialog (Replace) and feeds it the given in-memory files, then confirms. */
async function importBuffersViaUi(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  await page.getByTestId("super-open-import").click({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("super-import-mode-replace").click({ timeout: HEADER_TIMEOUT });
  await page.setInputFiles("[data-testid=super-import-file]", files);
  await expect(page.getByTestId("super-import-confirm")).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("super-import-confirm").click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
}

/** Clicks a download button and returns the downloaded bytes. */
async function downloadBytes(page: Page, testId: string): Promise<Buffer> {
  const wait = page.waitForEvent("download", { timeout: HEADER_TIMEOUT });
  await page.getByTestId(testId).click({ timeout: HEADER_TIMEOUT });
  const dl = await wait;
  return fs.readFileSync(await dl.path());
}

async function expectPins(page: Page): Promise<void> {
  const map = page.getByTestId("input-map-tab");
  await expect(map.locator(".leaflet-marker-icon.pl-marker")).toHaveCount(sample.plants.length, { timeout: HEADER_TIMEOUT });
  await expect(map.locator(".leaflet-marker-icon.wh-marker")).toHaveCount(sample.warehouses.length, { timeout: HEADER_TIMEOUT });
  await expect(map.locator(".leaflet-marker-icon.cs-marker")).toHaveCount(sample.customers.length, { timeout: HEADER_TIMEOUT });
}

/**
 * Right-clicks a pin the way a user must: a real pointer right-click on a pin that is
 * actually on top at its centre. Warehouses/plants carry zIndexOffset 1000, so a customer
 * coincident with a warehouse is only reachable after zooming; this picks the first pin of
 * the kind that is already topmost, and zooms in over the first one if none is.
 * Returns the index (within the selector's matches) of the pin it clicked.
 */
async function rightClickPin(page: Page, selector: string): Promise<number> {
  const pins = page.locator(`[data-testid="input-map-tab"] .leaflet-marker-icon${selector}`);
  const topmost = () => pins.evaluateAll(els => els.findIndex(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && el.contains(hit);
  }));
  let idx = await topmost();
  if (idx < 0) {
    const box = (await pins.first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150); }
    idx = Math.max(await topmost(), 0);
  }
  await pins.nth(idx).click({ button: "right", timeout: HEADER_TIMEOUT });
  return idx;
}

async function serverInputs(page: Page, id: string): Promise<any> {
  return (await (await page.request.get(`/api/scenarios/${id}`)).json()).inputs;
}

const TABLES = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "distanceOverrides"] as const;

test.describe("Super Model", () => {
  test("A: home -> Super Model card -> create -> empty state -> import sample (replace) -> 100 customers, ready", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);

    const card = page.getByTestId("landing-card-super-model");
    await expect(card).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("landing-card-footer-super-model")).toContainText("SM");
    await card.click();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    const id = await createScenarioViaUi(page);
    try {
      await expect(page.getByTestId("super-download-sample")).toHaveAttribute("href", /super-model-sample\.json$/);
      await expect(page.getByTestId("super-download-template")).toHaveAttribute("href", /super-model-template\.json$/);
      await expect(page.getByTestId("super-download-sample-csv")).toBeVisible();
      await expect(page.getByTestId("super-download-sample-xlsx")).toBeVisible();

      await importSampleViaUi(page);
      // SM2-1: the header export is now labelled "Export JSON" (testid unchanged).
      await expect(page.getByTestId("super-header-export")).toHaveText("Export JSON");

      await page.getByTestId("sidebar-input-customers").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-tab-customers")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // The persisted scenario is the source of truth for "100 customers"; the table is paged,
      // so assert the server row count AND that the first customer renders.
      const saved = await (await page.request.get(`/api/scenarios/${id}`)).json();
      expect(saved.inputs.customers).toHaveLength(100);
      await expect(page.getByTestId(`super-row-customers-${sample.customers[0].id}`)).toBeVisible({ timeout: HEADER_TIMEOUT });
      // The shared DataTable pager has no testid here; 100 rows at 50/page is "Page 1 of 2".
      await expect(page.getByText("Page 1 of 2")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-input-optimization-parameters").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-readiness-ok")).toBeVisible({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("B: solve the sample (forces wh-11 + wh-14 open, p=2) -> objective 254,060,828 proves optimality; forced open set renders", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      await importSampleViaUi(page);

      const before = await readSolvedAt(page, id);
      await page.getByTestId("button-run-optimizer").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("solve-dialog-solve").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
        .not.toBe(before);
      await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("254,060,828", { timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-open-warehouses").click({ timeout: HEADER_TIMEOUT });
      const rows = page.locator('[data-testid^="open-warehouse-row-"]');
      await expect(rows.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(rows).toHaveCount(2);
      const wh11 = page.getByTestId("open-warehouse-row-wh-11");
      const wh14 = page.getByTestId("open-warehouse-row-wh-14");
      // The grid shows the sample's "city, state" label plus the id. wh-14's NAME in the
      // sample is "New York" but its city field is the Ch9 dataset's "Nassau-Suffolk", NY.
      await expect(wh11).toContainText("wh-11");
      await expect(wh11).toContainText("Phoenix, AZ");
      await expect(wh14).toContainText("wh-14");
      await expect(wh14).toContainText("Nassau-Suffolk, NY");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("C: delete a product -> confirmation states referencing rows -> save -> reload -> deletion persisted", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      await importSampleViaUi(page);

      const refs =
        sample.plantProducts.filter((r: { productId: string }) => r.productId === "product-1").length +
        sample.demand.filter((r: { productId: string }) => r.productId === "product-1").length;
      expect(refs).toBeGreaterThan(0);

      await page.getByTestId("sidebar-input-products").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-products-product-1-delete").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-delete-count")).toHaveText(`This also deletes ${refs} referencing row(s).`, { timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-delete-confirm-button").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-row-products-product-1")).toHaveCount(0, { timeout: HEADER_TIMEOUT });

      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await (await page.request.get(`/api/scenarios/${id}`)).json()).inputs.products.length, { timeout: HEADER_TIMEOUT })
        .toBe(3);

      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      // SM2-1: a non-empty scenario opens on the Input Map.
      await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-products").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-row-products-product-2")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-row-products-product-1")).toHaveCount(0);

      const persisted = (await (await page.request.get(`/api/scenarios/${id}`)).json()).inputs;
      expect(persisted.products.map((p: { id: string }) => p.id)).not.toContain("product-1");
      expect(persisted.plantProducts.some((r: { productId: string }) => r.productId === "product-1")).toBe(false);
      expect(persisted.demand.some((r: { productId: string }) => r.productId === "product-1")).toBe(false);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
  test("D: CSV set (zip from the sample button) -> Input Map pins -> edit a plant on the map -> save -> persisted", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      const files = unzipSync(await downloadBytes(page, "super-download-sample-csv"));
      expect(Object.keys(files)).toHaveLength(8);
      await importBuffersViaUi(page, Object.entries(files).map(([name, u]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(u) })));
      await expectPins(page);

      const saved = await serverInputs(page, id);
      for (const t of TABLES) expect(saved[t], t).toMatchObject(sample[t]);

      const plIdx = await rightClickPin(page, ".pl-marker");
      await page.getByTestId("map-action-edit").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-entity-id")).toHaveValue(sample.plants[plIdx].id, { timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-entity-name").fill("Edited on map");
      await page.getByTestId("super-entity-submit").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await serverInputs(page, id)).plants[plIdx].name, { timeout: HEADER_TIMEOUT })
        .toBe("Edited on map");

      await page.reload();
      await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-plants").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId(`super-plants-${sample.plants[plIdx].id}-name`)).toHaveValue("Edited on map", { timeout: HEADER_TIMEOUT });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("E: XLSX workbook -> Input Map pins -> copy a customer on the map -> save -> 101 customers", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      const buffer = await downloadBytes(page, "super-download-sample-xlsx");
      await importBuffersViaUi(page, [{ name: "super-model-sample.xlsx", mimeType: MIME_XLSX, buffer }]);
      await expectPins(page);

      const saved = await serverInputs(page, id);
      for (const t of TABLES) expect(saved[t], t).toMatchObject(sample[t]);

      const csIdx = await rightClickPin(page, ".cs-marker");
      await page.getByTestId("map-action-copy").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await serverInputs(page, id)).customers.length, { timeout: HEADER_TIMEOUT })
        .toBe(sample.customers.length + 1);
      const customers = (await serverInputs(page, id)).customers as { id: string; name: string }[];
      expect(customers.map(c => c.name)).toContain(`${sample.customers[csIdx].name} (copy)`);
      expect(new Set(customers.map(c => c.id)).size).toBe(sample.customers.length + 1);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("F: a malformed CSV maps to file, row and column and posts nothing", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      const before = await serverInputs(page, id);
      const imports: string[] = [];
      page.on("request", r => { if (r.method() === "POST" && /\/network\/import/.test(r.url())) imports.push(r.url()); });
      await page.getByTestId("super-open-import").click({ timeout: HEADER_TIMEOUT });
      await page.setInputFiles("[data-testid=super-import-file]", [
        { name: "plants.csv", mimeType: "text/csv", buffer: Buffer.from("id,name,lat,lng\nA,P,north,2\n") },
      ]);
      await expect(page.getByTestId("super-import-file-error")).toContainText("plants.csv row 2 column lat: is not a number", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-import-confirm")).toBeDisabled();
      expect(imports, "no POST .../network/import may fire for an unparseable file").toEqual([]);
      expect(await serverInputs(page, id)).toEqual(before);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  // Assumes ORS_API_KEY is UNSET in the api-server's environment (routes/superNetwork.ts:84-86 returns 503
  // road_distances_unavailable only then); with a key set, the confirm click would start a real ORS fetch.
  test("G: the Road method shows the privacy notice; with no ORS key the fetch surfaces road_distances_unavailable", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
    try {
      await importSampleViaUi(page);
      await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-distance-method").selectOption("road", { timeout: HEADER_TIMEOUT });
      // Fetch is disabled until the method is saved ("Save your changes first").
      await expect(page.getByTestId("super-road-fetch")).toBeDisabled();
      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
      await expect
        .poll(async () => (await serverInputs(page, id)).distanceMethod, { timeout: HEADER_TIMEOUT })
        .toBe("road");
      await expect(page.getByTestId("super-road-fetch")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("super-road-fetch").click({ timeout: HEADER_TIMEOUT });

      await expect(page.getByTestId("super-road-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-road-privacy")).toContainText("OpenRouteService");
      await expect(page.getByTestId("super-road-privacy")).toContainText("Names and demand are not sent");
      // No ORS key locally: the server answers 503 road_distances_unavailable and the dialog shows its sentence.
      await page.getByTestId("super-road-confirm").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("super-road-error")).toContainText("no OpenRouteService key is configured", { timeout: HEADER_TIMEOUT });
      expect((await serverInputs(page, id)).roadDistances ?? null).toBeNull();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
