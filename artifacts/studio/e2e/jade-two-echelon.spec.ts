/**
 * Browser E2E — Chapter 9 JADE (Multi-Product Two-Echelon), Task 16.
 *
 * Exercises the full JADE model through the Workspace UI: register a fresh
 * account, create a scenario matching the notebook's ground-truth
 * configuration (P=2, wh-11 Phoenix + wh-14 New York forced open, capability
 * diagonal, bands [200,400,800,1600]), solve it and confirm the objective
 * matches the sacred ground truth 254060828.6157 (spec §2.7, hard rule 2),
 * confirm all five output grids render, verify leg-colored routes + the
 * per-leg layer toggles, toggle a capability-matrix cell and re-solve to
 * confirm the solution changes, confirm the capability toggle persists
 * across a real page reload, add a warehouse via the Input Map and confirm
 * estimated distances are auto-filled on save, and round-trip a customers
 * CSV export/edit/import. Also confirms the header shows JADE's own title,
 * not another model's.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy (vite's
 * API_PROXY_TARGET) so the browser sees one origin — see CLAUDE.md's
 * "To run e2e locally" recipe and vite.config.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;
const GROUND_TRUTH_OBJECTIVE = 254060828.6157;

async function registerAndGoHome(page: Page): Promise<string> {
  const email = `e2e-jade-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
  return email;
}

/** Ground-truth JADE inputs (spec §2.7, hard rule 2): P=2, wh-11 (Phoenix)
 * + wh-14 (New York) forced open, capability diagonal (no override —
 * plantProductCapability defaults to []), bands [200,400,800,1600]. */
function groundTruthInputs() {
  return {
    p: 2,
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    warehouseOverrides: [
      { id: "wh-11", status: "forced_open" },
      { id: "wh-14", status: "forced_open" },
    ],
  };
}

async function createJadeScenario(page: Page): Promise<string> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E JADE ${Date.now()}`,
      modelId: "two-echelon-jade-us",
      inputs: groundTruthInputs(),
    },
  });
  expect(resp.status()).toBe(201);
  const id = String((await resp.json()).id);
  await page.goto(`/chapter-9/jade?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

/** Opens the Run Optimizer dialog, triggers Solve, and waits for the
 * async job to succeed — the dialog auto-closes and the Output Map tab
 * auto-opens on success (Workspace.tsx's jobStatus effect). */
async function solveAndWait(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: SOLVE_TIMEOUT });
  await expect(page.getByTestId("sidebar-output-cost-summary")).toBeEnabled({ timeout: HEADER_TIMEOUT });
}

async function readObjective(page: Page): Promise<number> {
  await page.getByTestId("sidebar-output-cost-summary").click();
  const text = await page.getByTestId("cost-summary-value-objective").innerText();
  return Number(text.replace(/,/g, ""));
}

test.describe("Chapter 9 — JADE Multi-Product Two-Echelon", () => {
  test("ground truth solve, capability toggle, leg routes, output grids, persistence, map add, CSV round-trip", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page);
    const id = await createJadeScenario(page);

    try {
      // ── 0. Header shows JADE, not another model's title ─────────────────
      const summary = page.getByTestId("workspace-chapter-summary");
      await expect(summary).toContainText("Chapter 9");
      await expect(summary).toContainText(/multi-product two-echelon/i);
      await expect(summary).not.toContainText(/gold refinery/i);
      await expect(summary).not.toContainText(/AL's Athletics/i);

      // ── 1. Solve at the ground-truth config → objective matches ─────────
      await solveAndWait(page);
      const baselineObjective = await readObjective(page);
      expect(Math.abs(baselineObjective - GROUND_TRUTH_OBJECTIVE)).toBeLessThan(1);

      // ── 2. All five output grids render real content ────────────────────
      await page.getByTestId("sidebar-output-open-warehouses").click();
      await expect(page.locator('[data-testid^="open-warehouse-row-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      const openRows = await page.locator('[data-testid^="open-warehouse-row-"]').count();
      expect(openRows).toBe(2); // wh-11 + wh-14 forced open, P=2

      await page.getByTestId("sidebar-output-customer-assignments").click();
      const assignmentRows = page.locator('[data-testid^="assignment-row-"]');
      await expect(assignmentRows.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await assignmentRows.count()).toBe(100); // ground truth serves all 100 customers

      await page.getByTestId("sidebar-output-flows").click();
      await expect(page.locator('[data-testid^="flow-row-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-list")).toBeVisible({ timeout: HEADER_TIMEOUT });

      await page.getByTestId("sidebar-output-service-stats").click();
      await expect(page.locator('[data-testid^="service-stats-band-"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── 3. Leg-colored routes + per-leg layer toggles ────────────────────
      await page.getByTestId("sidebar-output-output-map").click();
      await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("checkbox-toggle-lanes")).toBeChecked();
      const legToggles = page.getByTestId("output-map-leg-toggles");
      await expect(legToggles).toBeVisible({ timeout: HEADER_TIMEOUT });
      const plantToWarehouseToggle = page.getByTestId("checkbox-toggle-leg-plant_to_warehouse");
      const warehouseToCustomerToggle = page.getByTestId("checkbox-toggle-leg-warehouse_to_customer");
      await expect(plantToWarehouseToggle).toBeVisible();
      await expect(warehouseToCustomerToggle).toBeVisible();
      await expect(legToggles).toContainText("Plant → Warehouse");
      await expect(legToggles).toContainText("Warehouse → Customer");
      await expect(plantToWarehouseToggle).toBeChecked();
      await expect(warehouseToCustomerToggle).toBeChecked();

      // Routes render inside NetworkMap's own dedicated `routePane`
      // (`<Pane name="routePane">`; Leaflet's `createPane` strips the
      // trailing "Pane" and lowercases nothing else, yielding the DOM class
      // `leaflet-route-pane` — confirmed directly against the real rendered
      // DOM, not assumed) — this pane carries ONLY the route Polylines
      // (markers/triangles/squares render as `<path>` too, but in the
      // overlay/marker panes), so counting every `path` element inside it
      // is a real, unambiguous DOM signal of how many routes are rendered.
      const routePaths = page.locator(".leaflet-route-pane path");
      await expect(routePaths.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      const fullRouteCount = await routePaths.count();
      expect(fullRouteCount).toBeGreaterThan(0);

      // Hide the warehouse→customer leg — the visible route count must
      // drop (the plant→warehouse routes, far fewer, remain).
      await warehouseToCustomerToggle.click();
      await expect(warehouseToCustomerToggle).not.toBeChecked();
      await expect(async () => {
        expect(await routePaths.count()).toBeLessThan(fullRouteCount);
      }).toPass({ timeout: HEADER_TIMEOUT });
      const reducedRouteCount = await routePaths.count();
      expect(reducedRouteCount).toBeGreaterThan(0); // plant→warehouse routes remain

      // Re-show it — count goes back up.
      await warehouseToCustomerToggle.click();
      await expect(warehouseToCustomerToggle).toBeChecked();
      await expect(async () => {
        expect(await routePaths.count()).toBe(fullRouteCount);
      }).toPass({ timeout: HEADER_TIMEOUT });

      // ── 4. Toggle a capability-matrix cell → re-solve → solution changes ─
      // plant-4 (Long Beach) is much closer to wh-11 (Phoenix) than the
      // baseline's plant-1 (Ashland, KY) supplier for product-1 — enabling
      // it strictly lowers the objective and switches the supplying plant
      // (mirrors test_jade.py's test_capability_toggle_changes_supplying_plant).
      await page.getByTestId("sidebar-input-capability-matrix").click();
      await expect(page.getByTestId("capability-matrix-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const capabilityCell = page.getByTestId("checkbox-capability-plant-4-product-1");
      await expect(capabilityCell).toBeVisible();
      await expect(capabilityCell).not.toBeChecked();
      await capabilityCell.click();
      await expect(capabilityCell).toBeChecked();

      await expect(page.getByTestId("button-save")).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      await solveAndWait(page);
      const toggledObjective = await readObjective(page);
      expect(toggledObjective).toBeLessThan(baselineObjective);

      await page.getByTestId("sidebar-output-flows").click();
      await expect(page.getByTestId("flow-row-plant-4-wh-11-product-1")).toBeVisible({ timeout: HEADER_TIMEOUT });

      // ── 5. Capability-matrix persistence across save/reload ─────────────
      await page.reload();
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-capability-matrix").click();
      await expect(page.getByTestId("capability-matrix-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("checkbox-capability-plant-4-product-1")).toBeChecked();

      // ── 6. Add a warehouse via the Input Map → estimated distances ──────
      await page.getByTestId("sidebar-input-input-map").click();
      await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("button-input-map-place-wh").click();
      const mapCanvas = page.locator('[data-testid="input-map-tab"] .leaflet-container');
      await expect(mapCanvas).toBeVisible({ timeout: HEADER_TIMEOUT });
      await mapCanvas.click({ position: { x: 250, y: 220 } });

      await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const newWhDisplayCode = await page.getByTestId("create-entity-display-code").innerText();
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible({ timeout: HEADER_TIMEOUT });

      // The map's own Layers row carries Save for this mode (saveInLayersRowJade).
      const mapSaveButton = page.locator('[data-testid="input-map-tab"] [data-testid="button-save"]');
      await expect(mapSaveButton).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await mapSaveButton.click();
      await expect(mapSaveButton).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // The new warehouse's estimated plant→warehouse distances now appear
      // in the Distances tab, filtered by its display code (raw uids don't
      // appear in the filterable display text, which prefers displayCode).
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("input-filter-to").fill(newWhDisplayCode);
      const estimatedBadges = page.locator('[data-testid^="badge-jadedistance-estimated-"]');
      await expect(estimatedBadges.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
      expect(await estimatedBadges.count()).toBeGreaterThan(0);
      await page.getByTestId("input-filter-to").fill("");

      // ── 7. Import/export a customers CSV round trip ─────────────────────
      // JADE's customer CSV column layout:
      // template_version,id,display_code,city,state,lat,lng,demand,status
      // — `demand` is read-only for this model (services/templates.ts's
      // applyJadeCustomerOverrides header comment), so the round-trip edits
      // `status` (the only editable column) instead.
      const exportResp = await page.request.get(`/api/scenarios/${id}/export?entity=customers&format=csv`);
      expect(exportResp.status()).toBe(200);
      const csv = await exportResp.text();
      const lines = csv.trim().split("\n");
      const header = lines[0];
      expect(header).toBe("template_version,id,display_code,city,state,lat,lng,demand,status");
      const firstDataRow = lines[1].split(",");
      const editedCustomerId = firstDataRow[1];
      expect(firstDataRow[8]).toBe("active");
      firstDataRow[8] = "excluded";
      const editedCsv = [header, firstDataRow.join(","), ...lines.slice(2)].join("\n");

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
      await expect(page.getByTestId("input-import-file-customers")).not.toBeVisible({ timeout: 8_000 });

      // Verify server-side persistence directly (the real round trip this
      // feature exists for) rather than trusting only the dialog's own UI.
      const reExportResp = await page.request.get(`/api/scenarios/${id}/export?entity=customers&format=csv`);
      expect(reExportResp.status()).toBe(200);
      const reExportCsv = await reExportResp.text();
      const reExportedRow = reExportCsv
        .trim()
        .split("\n")
        .find(l => l.split(",")[1] === editedCustomerId);
      expect(reExportedRow).toBeDefined();
      expect(reExportedRow!.split(",")[8]).toBe("excluded");
    } finally {
      // ── Cleanup ───────────────────────────────────────────────────────
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
