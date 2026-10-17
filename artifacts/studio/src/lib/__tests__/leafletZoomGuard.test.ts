import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import L from "leaflet";

// SCND_STUDIO-3 (2026-10-13, /chapter-4): "Cannot read properties of undefined
// (reading '_leaflet_pos')". Leaflet 1.9.4's _animateZoom schedules
// setTimeout(_onZoomTransitionEnd, 250); map.remove() deletes _mapPane but
// neither clears _animatingZoom nor cancels that timer, so a map unmounted
// mid-zoom crashes 250 ms later. This test drives that exact state.
type ZoomInternals = L.Map & {
  _animatingZoom: boolean;
  _animateToCenter: L.LatLng;
  _animateToZoom: number;
  _onZoomTransitionEnd(): void;
};

// Exactly what _animateZoom sets before it schedules the 250 ms timer.
function startZoom(map: ZoomInternals) {
  map._animatingZoom = true;
  map._animateToCenter = map.getCenter();
  map._animateToZoom = 5;
}

function removedMidZoom(): ZoomInternals {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const map = L.map(el).setView([40, -90], 4) as ZoomInternals;
  startZoom(map);
  map.remove();
  return map;
}

describe("leafletZoomGuard (SCND_STUDIO-3)", () => {
  it("reproduces the crash without the guard, and prevents it with the guard", async () => {
    // Non-vacuity: plain Leaflet really throws here, the production error.
    expect(() => removedMidZoom()._onZoomTransitionEnd()).toThrow(/_leaflet_pos/);

    await import("../leafletZoomGuard");

    expect(() => removedMidZoom()._onZoomTransitionEnd()).not.toThrow();
  });

  it("still finishes a zoom on a live map", async () => {
    await import("../leafletZoomGuard");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const map = L.map(el).setView([40, -90], 4) as ZoomInternals;
    startZoom(map);
    map._onZoomTransitionEnd();
    expect(map._animatingZoom).toBe(false);
    map.remove();
  });

  it("is loaded by the app entry point", () => {
    // The guard only works if something imports it; main.tsx is that place.
    const main = readFileSync(resolve(__dirname, "../../main.tsx"), "utf8");
    expect(main).toContain('import "./lib/leafletZoomGuard";');
  });
});
