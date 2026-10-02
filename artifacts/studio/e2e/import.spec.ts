/**
 * Browser E2E — D5.2 import happy path.
 *
 * Exports the customers CSV for a real p-median-us scenario, edits one
 * demand value, re-imports it through the ImportDialog UI, and confirms the
 * change is applied. Uses local HEAD's current API shape (`{name, modelId,
 * inputs}` — unlike `labs.spec.ts`, which is stale against pre-D0 shapes).
 *
 * [e2e-rot repair] Two independent drifts, both confirmed against the live
 * app/API before fixing (not assumed from the old test):
 *   1. Studio.tsx (whose header this test waited on — "Al's Athletics ·
 *      Model Lab") was retired by Bundle 6; every chapter route now renders
 *      Workspace.tsx, which has no such header string at all.
 *   2. The exported CSV's own column order drifted independently of the UI
 *      change — `template_version,id,display_code,city,state,lat,lng,
 *      demand,status` (9 columns) today, not the `...,city,state,demand,
 *      status` (6 columns, demand at index 4) this test hardcoded. Verified
 *      live via `GET /scenarios/:id/export?entity=customers&format=csv`
 *      against a real scenario rather than trusted from the old comment —
 *      the fix below locates the `demand` column by its HEADER NAME, not a
 *      hardcoded index, so a future column reorder can't silently break
 *      this test's own edit the same way.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see vite.config.ts.
 */
import { test, expect, type Page } from "./fixtures";

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
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

test.describe("Import (D5.2)", () => {
  test("export → edit one demand → import applies exactly one change", async ({ page }) => {
    await registerAndGoHome(page);
    const id = await createPMedianScenario(page);

    try {
      // Real export, not a synthetic fixture — the round-trip this feature exists for.
      const exportResp = await page.request.get(`/api/scenarios/${id}/export?entity=customers&format=csv`);
      expect(exportResp.status()).toBe(200);
      const csv = await exportResp.text();
      const lines = csv.trim().split("\n");
      const header = lines[0];
      const headerCols = header.split(",");
      const idIdx = headerCols.indexOf("id");
      const demandIdx = headerCols.indexOf("demand");
      expect(idIdx).toBeGreaterThanOrEqual(0);
      expect(demandIdx).toBeGreaterThanOrEqual(0);
      const dataRows = lines.slice(1, 4); // keep it small — 3 rows

      // Bump the first row's demand by 500 (column located by HEADER NAME,
      // not a hardcoded index — see this file's header comment).
      const cols = dataRows[0].split(",");
      const customerId = cols[idIdx];
      const originalDemand = Number(cols[demandIdx]);
      cols[demandIdx] = String(originalDemand + 500);
      const editedRow = cols.join(",");
      const editedCsv = [header, editedRow, ...dataRows.slice(1)].join("\n");

      await page.getByTestId("sidebar-input-customers").click();
      await expect(page.getByTestId("customers-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-import-customers").click();
      await page.getByTestId("input-import-file-customers").setInputFiles({
        name: "customers.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(editedCsv),
      });

      await expect(page.getByText("Changes (1)")).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-import-confirm").click();

      // Dialog closes on success and the customer row's own demand input
      // reflects the newly-applied override.
      await expect(page.getByTestId("input-import-file-customers")).not.toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId(`input-customer-demand-${customerId}`)).toHaveValue(
        String(originalDemand + 500),
        { timeout: HEADER_TIMEOUT },
      );

      // Redundant structural confirmation via the raw API — exactly one
      // customerOverrides entry, for the edited row, at the new value.
      const persisted = await page.request.get(`/api/scenarios/${id}`);
      const persistedJson = await persisted.json();
      const overrides = persistedJson.inputs.customerOverrides as Array<{ id: string; demand?: number }>;
      expect(overrides).toHaveLength(1);
      expect(overrides[0].id).toBe(customerId);
      expect(overrides[0].demand).toBe(originalDemand + 500);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
