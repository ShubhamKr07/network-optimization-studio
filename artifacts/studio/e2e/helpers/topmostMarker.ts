/**
 * Picks a Leaflet marker that a pointer would really reach, for tap AND click.
 *
 * Generalised from `super-model.spec.ts` `rightClickPin` (DU-3.5). Warehouses/plants carry
 * zIndexOffset 1000, so a customer coincident with one is only reachable after zooming in;
 * a marker can also sit under a map control or the legend. `elementFromPoint` is used ONLY
 * for hit-testing here ("what would a pointer hit"), never to prove paint order
 * (e2e/CLAUDE.md: it answers the click question, not the stacking question).
 *
 * Every function asserts its candidate set is non-empty first: a loop over zero markers
 * would otherwise "pass" having checked nothing.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** Serialised into the browser. True when the element's centre is inside the map viewport and the element (or a child) is what a pointer hits there. */
export function isReachableAtCentre(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
  const hit = document.elementFromPoint(cx, cy);
  return !!hit && el.contains(hit);
}

/** Indices (within `markers`) of every marker a pointer would reach right now. */
export async function reachableIndices(markers: Locator): Promise<number[]> {
  return markers.evaluateAll(els =>
    els.flatMap((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return [];
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return [];
      const hit = document.elementFromPoint(cx, cy);
      return hit && el.contains(hit) ? [i] : [];
    }),
  );
}

/** Wheel-zoom in over `target` (Leaflet zooms around the cursor) to separate overlapping markers. */
export async function zoomInOver(page: Page, target: Locator, notches = 6): Promise<void> {
  const box = (await target.boundingBox())!;
  expect(box, "zoomInOver: target has a box").toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(150);
  }
}

/**
 * The first marker in `markers` that a pointer reaches; if none does, zoom in over the
 * first and retry once. Returns the locator for that single marker plus its index.
 */
export async function topmostMarker(page: Page, markers: Locator): Promise<{ marker: Locator; index: number }> {
  const n = await markers.count();
  expect(n, "topmostMarker: candidate markers").toBeGreaterThan(0);
  let reach = await reachableIndices(markers);
  if (reach.length === 0) {
    await zoomInOver(page, markers.first());
    reach = await reachableIndices(markers);
  }
  expect(reach.length, `topmostMarker: none of ${n} markers is reachable even after zooming`).toBeGreaterThan(0);
  return { marker: markers.nth(reach[0]), index: reach[0] };
}

/**
 * Make one SPECIFIC marker reachable (zooming in over it as needed), e.g. the single
 * added warehouse sitting under a base customer.
 */
export async function makeReachable(page: Page, marker: Locator, maxRounds = 3): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    if (await marker.evaluate(isReachableAtCentre)) return;
    await zoomInOver(page, marker);
  }
  expect(await marker.evaluate(isReachableAtCentre), "makeReachable: marker still covered after zooming").toBe(true);
}
