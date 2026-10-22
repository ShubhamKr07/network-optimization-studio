/**
 * Browser E2E — Super Model (SM-10).
 *
 * Test A: home -> Super Model card -> create a scenario through the UI -> empty
 *   state (sample download link) -> import the shipped sample through the real
 *   import dialog (Replace) -> 100 customer rows -> readiness "ready".
 * Test B: solve the imported sample with real CBC (accepted by plan constraint
 *   C4: the only real-browser proof of the solver path) -> objective is the
 *   Chapter 9 ground truth 254,060,828 and exactly wh-11 + wh-14 are open,
 *   shown as "Phoenix, AZ" / "Nassau-Suffolk, NY" (the sample's wh-14 is named New York; its city field is Nassau-Suffolk).
 * Test C: delete a product -> confirmation states the referencing-row count ->
 *   confirm -> save -> reload -> the deletion (and its cascade) persisted.
 *
 * Target: E2E_BASE_URL (NEVER run without it — see e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "./fixtures";
import { readSolvedAt } from "./helpers/solvedAt";

test.use({ actionTimeout: 15_000 });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;
const SAMPLE_PATH = path.resolve(process.cwd(), "public/samples/super-model-sample.json");
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
}

test.describe("Super Model", () => {
  test("A: home -> Super Model card -> create -> empty state -> import sample (replace) -> 100 customers, ready", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);

    const card = page.getByTestId("landing-card-super-model");
    await expect(card).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("landing-card-footer-super-model")).toContainText("SM");
    await card.click();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    await createScenarioViaUi(page);
    await expect(page.getByTestId("super-download-sample")).toHaveAttribute("href", /super-model-sample\.json$/);
    await expect(page.getByTestId("super-download-template")).toHaveAttribute("href", /super-model-template\.json$/);

    await importSampleViaUi(page);

    await page.getByTestId("sidebar-input-customers").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("super-tab-customers")).toBeVisible({ timeout: HEADER_TIMEOUT });
    // The persisted scenario is the source of truth for "100 customers"; the table is paged,
    // so assert the server row count AND that the first customer renders.
    const id = new URL(page.url()).searchParams.get("scenario");
    const saved = await (await page.request.get(`/api/scenarios/${id}`)).json();
    expect(saved.inputs.customers).toHaveLength(100);
    await expect(page.getByTestId(`super-row-customers-${sample.customers[0].id}`)).toBeVisible({ timeout: HEADER_TIMEOUT });

    await page.getByTestId("sidebar-input-optimization-parameters").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("super-readiness-ok")).toBeVisible({ timeout: HEADER_TIMEOUT });
  });

  test("B: solve the sample -> objective 254,060,828, open warehouses wh-11 + wh-14 (Phoenix, New York)", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
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
  });

  test("C: delete a product -> confirmation states referencing rows -> save -> reload -> deletion persisted", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    await page.goto("/super-model");
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    const id = await createScenarioViaUi(page);
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
    await page.getByTestId("sidebar-input-products").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("super-row-products-product-2")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("super-row-products-product-1")).toHaveCount(0);

    const persisted = (await (await page.request.get(`/api/scenarios/${id}`)).json()).inputs;
    expect(persisted.products.map((p: { id: string }) => p.id)).not.toContain("product-1");
    expect(persisted.plantProducts.some((r: { productId: string }) => r.productId === "product-1")).toBe(false);
    expect(persisted.demand.some((r: { productId: string }) => r.productId === "product-1")).toBe(false);
  });
});
