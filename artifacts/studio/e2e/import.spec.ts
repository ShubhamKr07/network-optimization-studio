/**
 * Browser E2E — D5.2 import happy path.
 *
 * Exports the customers CSV for a real p-median-us scenario, edits one
 * demand value, re-imports it through the ImportDialog UI, and confirms the
 * change is applied. Uses local HEAD's current API shape (`{name, modelId,
 * inputs}` — unlike `labs.spec.ts`, which is stale against pre-D0 shapes).
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-import-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createPMedianScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E Import ${Date.now()}`,
      modelId: "p-median-us",
      inputs: {
        p: 3,
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
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-3?scenario=${id}`);
  await expect(page.getByText(/Al's Athletics · Model Lab/)).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

test.describe("Import (D5.2)", () => {
  test("export → edit one demand → import applies exactly one change", async ({ page }) => {
    await registerAndGoHome(page);
    const id = await createPMedianScenario(page);

    // Real export, not a synthetic fixture — the round-trip this feature exists for.
    const exportResp = await page.request.get(`/api/scenarios/${id}/export?entity=customers&format=csv`);
    expect(exportResp.status()).toBe(200);
    const csv = await exportResp.text();
    const lines = csv.trim().split("\n");
    const header = lines[0];
    const dataRows = lines.slice(1, 4); // keep it small — 3 rows

    // Bump the first row's demand by 500 (column order: template_version,id,city,state,demand,status).
    const cols = dataRows[0].split(",");
    const originalDemand = Number(cols[4]);
    cols[4] = String(originalDemand + 500);
    const editedRow = cols.join(",");
    const editedCsv = [header, editedRow, ...dataRows.slice(1)].join("\n");

    await page.getByTestId("button-import-customers").click();
    await page.getByTestId("input-import-file-customers").setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(editedCsv),
    });

    await expect(page.getByText("Changes (1)")).toBeVisible({ timeout: 8_000 });
    await page.getByTestId("button-import-confirm").click();

    // Dialog closes on success and the Overrides button reflects the applied change.
    await expect(page.getByTestId("input-import-file-customers")).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("button-open-customer-table")).toContainText("1 overridden");

    await page.request.delete(`/api/scenarios/${id}`);
  });
});
