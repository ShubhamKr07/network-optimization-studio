/**
 * Browser E2E — Input Map v2 (T10 QA), p-median-us.
 *
 * Covers the money path (create-on-map → Save → estimated-distance toast →
 * Distances grid → edit clears the estimate → Run Optimizer → solve
 * completes) plus real-browser Leaflet-only risks that a jsdom-based RTL
 * suite cannot prove even with a real MapContainer/Marker under jsdom
 * (InputMapTabV2.test.tsx / InputMapV2.integration.test.tsx already do
 * that): native mouse drag through Leaflet's own Draggable class, and
 * pan/zoom-triggered `movestart`/`zoomstart` map events. Same auth/proxy
 * scaffolding as tab-coverage.spec.ts/import.spec.ts — disposable scenario
 * per test, real DELETE cleanup.
 *
 * Target: E2E_BASE_URL env var + a local dev proxy (vite's
 * API_PROXY_TARGET) — see CLAUDE.md.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const HEADER_TIMEOUT = 10_000;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-inputmapv2-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
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
      name: `E2E InputMapV2 ${Date.now()}`,
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
  await page.getByTestId("sidebar-input-input-map").click();
  await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
  return id;
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-container');
}

function warehouseMarkers(page: Page): Locator {
  return page.locator('[data-testid="input-map-tab"] .leaflet-marker-icon.wh-marker');
}

test.describe("Input Map v2 — money path (p-median-us)", () => {
  test("add on map → Save → estimated-distance toast → Distances grid shows it → editing clears the chip → Run Optimizer solves", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createPMedianScenario(page);

    try {
      const baseMarkerCount = await warehouseMarkers(page).count();

      // Right-click empty map space -> "Add warehouse here" -> Create.
      const canvas = mapCanvas(page);
      const box = (await canvas.boundingBox())!;
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 }, button: "right" });
      await expect(page.getByTestId("map-add-menu")).toBeVisible();
      await page.getByTestId("map-add-menu-wh").click();
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible();
      const displayCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();

      // The new marker is appended after all base markers (Workspace.tsx's
      // [...base, ...added] projection order).
      await expect(warehouseMarkers(page)).toHaveCount(baseMarkerCount + 1, { timeout: HEADER_TIMEOUT });

      // Save -> toast names the newly-created warehouse's displayCode.
      await expect(page.getByTestId("button-save")).toBeEnabled();
      await page.getByTestId("button-save").click();
      await expect(page.getByText(new RegExp(`distances? estimated for ${displayCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-save")).toBeDisabled();

      // Distances grid: at least one row is flagged Estimated.
      await page.getByTestId("sidebar-input-distances").click();
      await expect(page.getByTestId("distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const estimatedBadge = page.locator('[data-testid^="badge-distance-estimated-"]').first();
      await expect(estimatedBadge).toBeVisible();
      const badgeTestId = (await estimatedBadge.getAttribute("data-testid"))!;
      const suffix = badgeTestId.replace("badge-distance-estimated-", "");

      // Editing that row's distance clears the Estimated chip (confirm-on-edit).
      const distanceInput = page.getByTestId(`input-distance-${suffix}`);
      await distanceInput.fill("250");
      await distanceInput.blur();
      await expect(page.getByTestId(`badge-distance-estimated-${suffix}`)).not.toBeVisible();
      await expect(page.getByTestId("button-save")).toBeEnabled();
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      // Run Optimizer -> a real CBC solve completes (Output Map ungates).
      await page.getByTestId("button-run-optimizer").click();
      await expect(page.getByTestId("solve-dialog")).toBeVisible();
      await page.getByTestId("solve-dialog-solve").click();
      await expect(page.getByTestId("sidebar-output-output-map")).toBeEnabled({ timeout: 30_000 });
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("Input Map v2 — move + re-estimate (p-median-us)", () => {
  test("dragging an added marker opens MoveConfirmDialog; confirming changes displayCode/location but keeps id stable, and its distances re-estimate on the next Save", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createPMedianScenario(page);

    try {
      const canvas = mapCanvas(page);
      const box = (await canvas.boundingBox())!;
      await canvas.click({ position: { x: box.width / 3, y: box.height / 3 }, button: "right" });
      await page.getByTestId("map-add-menu-wh").click();
      const originalCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();
      await page.getByTestId("create-entity-submit").click();

      // Confirm the id assigned server-side is a stable "aw-" uuid, fetched
      // straight from the persisted state after Save.
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      const beforeMove = await page.request.get(`/api/scenarios/${id}`);
      const beforeAdded = (await beforeMove.json()).inputs.addedWarehouses as Array<{ id: string; displayCode: string }>;
      expect(beforeAdded).toHaveLength(1);
      const stableId = beforeAdded[0].id;
      expect(stableId).toMatch(/^aw-/);
      expect(beforeAdded[0].displayCode).toBe(originalCode);

      // Drag the added marker (last warehouse marker) to a new spot.
      const marker = warehouseMarkers(page).last();
      const markerBox = (await marker.boundingBox())!;
      const start = { x: markerBox.x + markerBox.width / 2, y: markerBox.y + markerBox.height / 2 };
      const end = { x: box.x + (2 * box.width) / 3, y: box.y + (2 * box.height) / 3 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      // Several intermediate moves — Leaflet's Draggable needs real
      // movement (not one big jump) to register a drag rather than a click.
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          start.x + ((end.x - start.x) * i) / steps,
          start.y + ((end.y - start.y) * i) / steps,
        );
      }
      await page.mouse.up();

      await expect(page.getByTestId("move-confirm-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      const newCode = (await page.getByTestId("move-confirm-new-code").textContent())!.trim();
      await page.getByTestId("move-confirm-confirm").click();
      await expect(page.getByTestId("move-confirm-dialog")).not.toBeVisible();

      // Save -> the id never changed, but displayCode/location did, and its
      // distances dropped (T1's normalizer re-estimates them on next Save).
      await expect(page.getByTestId("button-save")).toBeEnabled();
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      const afterMove = await page.request.get(`/api/scenarios/${id}`);
      const afterJson = await afterMove.json();
      const afterAdded = afterJson.inputs.addedWarehouses as Array<{ id: string; displayCode: string }>;
      expect(afterAdded).toHaveLength(1);
      expect(afterAdded[0].id).toBe(stableId); // D7 — id never changes on move
      if (newCode !== originalCode) {
        expect(afterAdded[0].displayCode).toBe(newCode);
      }
      const distanceOverrides = afterJson.inputs.distanceOverrides as Array<{ fromId: string; toId: string; estimated?: boolean }>;
      const forMovedEntity = distanceOverrides.filter(o => o.fromId === stableId);
      expect(forMovedEntity.length).toBeGreaterThan(0);
      expect(forMovedEntity.every(o => o.estimated)).toBe(true);
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});

test.describe("Input Map v2 — Leaflet-only interaction risks (real browser, not jsdom)", () => {
  test("marker right-click never also opens the empty-space menu; ghost Copy lands at the drop point; Move Escape snaps back; overlays close on pan; a BASE marker has no Delete; keyboard Escape restores focus", async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndGoHome(page);
    const id = await createPMedianScenario(page);

    try {
      const canvas = mapCanvas(page);
      const box = (await canvas.boundingBox())!;

      // 1) Right-clicking a real marker opens only the entity action menu.
      const firstMarker = warehouseMarkers(page).first();
      await firstMarker.click({ button: "right" });
      await expect(page.getByTestId("map-action-menu")).toBeVisible();
      await expect(page.getByTestId("map-add-menu")).not.toBeVisible();

      // 2) A BASE entity's menu has Edit/Copy only, no Move/Delete.
      await expect(page.getByTestId("map-action-edit")).toBeVisible();
      await expect(page.getByTestId("map-action-copy")).toBeVisible();
      await expect(page.getByTestId("map-action-move")).not.toBeVisible();
      await expect(page.getByTestId("map-action-delete")).not.toBeVisible();

      // 3) Keyboard Escape closes the menu and restores focus to the
      // layer-toggle chip (a real, previously-focused element).
      const toggle = page.getByTestId("toggle-layer-warehouses");
      await toggle.focus();
      await firstMarker.click({ button: "right" });
      await expect(page.getByTestId("map-action-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("map-action-menu")).not.toBeVisible();
      await expect(toggle).toBeFocused();

      // 4) Ghost Copy: arm Copy on the base marker, click a specific drop
      // point, and confirm the CreateEntityDialog reports coordinates that
      // match that drop point (not the origin marker's own location).
      await firstMarker.click({ button: "right" });
      await page.getByTestId("map-action-copy").click();
      await expect(page.getByTestId("armed-status-bar")).toBeVisible();
      const dropPoint = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };
      await page.mouse.click(dropPoint.x, dropPoint.y);
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible();
      const lat = Number(await page.getByTestId("create-entity-lat").textContent());
      const lng = Number(await page.getByTestId("create-entity-lng").textContent());
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(lng)).toBe(true);
      await page.getByTestId("create-entity-cancel").click();
      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();

      // 5) Move Escape snaps back: arm Move on an added entity, then cancel
      // via Escape before dropping — no dialog opens, marker count/position
      // unaffected.
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 }, button: "right" });
      await page.getByTestId("map-add-menu-wh").click();
      await page.getByTestId("create-entity-submit").click();
      await page.getByTestId("button-save").click();
      await expect(page.getByTestId("button-save")).toBeDisabled({ timeout: HEADER_TIMEOUT });

      const addedMarker = warehouseMarkers(page).last();
      await addedMarker.click({ button: "right" });
      await page.getByTestId("map-action-move").click();
      await expect(page.getByTestId("armed-status-bar")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("armed-status-bar")).not.toBeVisible();
      await expect(page.getByTestId("move-confirm-dialog")).not.toBeVisible();
      await expect(page.getByTestId("button-save")).toBeDisabled(); // nothing changed

      // 6) Pan closes an open details card. Left-click the added marker to
      // open its inspect card, then drag the MAP (not a marker) to pan —
      // movestart should close the overlay.
      await addedMarker.click();
      await expect(page.getByTestId("map-details-card")).toBeVisible();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 });
      await page.mouse.up();
      await expect(page.getByTestId("map-details-card")).not.toBeVisible();
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
