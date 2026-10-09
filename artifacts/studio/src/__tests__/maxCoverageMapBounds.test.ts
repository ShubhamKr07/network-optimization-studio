import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getMapBoundsProps, type CountryBounds } from "@/lib/mapBounds";

// C4.14 (Gate-1 mapped audit) — the map is bounded by the model's manifest
// `countryBounds`, NOT a per-page constant. Confirm max-coverage-us's US
// {sw, ne} box actually CONTAINS every warehouse and customer point in the
// real dataset — a wrong/mis-scaled box would silently clamp the map and
// hide half the network (model-integration-precheck.md Gate 6, "map bounds
// come from the manifest").
//
// jsdom's `import.meta.url` isn't a file:// URL (see ObjectiveBar.test.tsx's
// own note), so resolve the repo root by walking up from the vitest cwd
// until the manifest is found — robust to being run from the package dir or
// root.
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "solvers/max-coverage-us/manifest.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate repo root (solvers/max-coverage-us/manifest.json) from " + process.cwd());
}
const repoRoot = findRepoRoot();
function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), "utf8"));
}

const manifest = readJson("solvers/max-coverage-us/manifest.json") as {
  countryBounds: CountryBounds;
  distanceUnit: string;
};
const warehouses = readJson("solvers/max-coverage-us/dataset/warehouses.json") as Record<
  string,
  { lat: number; lng: number }
>;
const customers = readJson("solvers/max-coverage-us/dataset/customers.json") as Record<
  string,
  { lat: number; lng: number }
>;

describe("max-coverage-us map bounds — manifest countryBounds contain all points", () => {
  const { sw, ne } = manifest.countryBounds;
  const [swLat, swLng] = sw;
  const [neLat, neLng] = ne;

  const points = [
    ...Object.values(warehouses).map(w => ({ ...w, kind: "warehouse" as const })),
    ...Object.values(customers).map(c => ({ ...c, kind: "customer" as const })),
  ];

  it("has a non-trivial number of points to check", () => {
    // Guards against a silently-empty dataset making the containment vacuous.
    expect(Object.keys(warehouses).length).toBeGreaterThan(0);
    expect(Object.keys(customers).length).toBeGreaterThan(0);
  });

  it("every warehouse and customer lat/lng falls inside {sw, ne}", () => {
    for (const p of points) {
      expect(p.lat, `${p.kind} lat ${p.lat}`).toBeGreaterThanOrEqual(swLat);
      expect(p.lat, `${p.kind} lat ${p.lat}`).toBeLessThanOrEqual(neLat);
      expect(p.lng, `${p.kind} lng ${p.lng}`).toBeGreaterThanOrEqual(swLng);
      expect(p.lng, `${p.kind} lng ${p.lng}`).toBeLessThanOrEqual(neLng);
    }
  });

  it("getMapBoundsProps maps the US bounds through to Leaflet maxBounds (not a stale fallback)", () => {
    const props = getMapBoundsProps(manifest.countryBounds);
    expect(props.maxBounds).toEqual([[swLat, swLng], [neLat, neLng]]);
    // max-coverage-us's own bounds must be a negative (western-hemisphere)
    // longitude, distinguishing it from the old chens-cosmetics-cn China
    // bounds (positive longitude) this test previously guarded.
    expect(props.center[1]).toBeLessThan(0);
  });

  // CH4O-8 (§2.1) — Chapter 4 was this repo's only km-canonical model and is
  // now miles like every other. The assertion is inverted deliberately rather
  // than deleted: the unit is the field whose regression is silent everywhere
  // else, and this file already loads the real manifest.
  it("the manifest declares mi (not km) for max-coverage-us", () => {
    expect(manifest.distanceUnit).toBe("mi");
  });
});
