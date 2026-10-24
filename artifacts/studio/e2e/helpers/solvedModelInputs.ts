/**
 * DU-1.5 — the create-payload `inputs` for each model, shared by
 * `scripts/capture-solved-results.ts` (which solved these to produce
 * `fixtures/solved/<modelId>.json`) and `design-upgrade-p1.spec.ts` (which
 * creates scenarios from the SAME inputs so the seeded result and the
 * scenario's `distanceBands` agree). One copy, so they cannot drift.
 *
 * Mirrors `defaultInputsForModel` in src/pages/Workspace.tsx (kept inline so e2e
 * does not import React code). Deliberate deviations from those defaults:
 *   - max-coverage-us gets `objective: "coverage"` (the default has none and
 *     precheck blocks the solve until one is chosen);
 *   - p-median-brazil gets `singleSource: false` (the default `true` is
 *     INFEASIBLE: Sao Paulo Region demand 29M exceeds the 20M single-warehouse
 *     capacity, so there would be no lanes to colour);
 *   - super-model starts empty (superDefaults.json) and is filled by importing
 *     public/samples/super-model-sample.json (`SUPER_SAMPLE_PATH`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const SUPER_SAMPLE_PATH = path.resolve(here, "../../public/samples/super-model-sample.json");

type Json = Record<string, unknown>;

export const SOLVED_MODEL_INPUTS: Record<string, Json> = {
  "p-median-us": { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 120 },
  "max-coverage-us": {
    objective: "coverage", p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0,
    gap: 0, timeLimitSec: 120, capacityMode: "none", distanceBands: [450, 900, 1800, 3400],
    warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
  "transport-coal": { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false },
  "p-median-brazil": { p: 7, distanceBands: [500, 1000, 2000, 4000], capacityMode: "uniform", uniformCapacity: 20000000, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 120, singleSource: false },
  "delivery-teaching-us": {
    p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800,
    costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [],
  },
  "two-echelon-gold-au": { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 },
  "two-echelon-jade-us": {
    p: 3, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [],
    plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
  "super-model": JSON.parse(fs.readFileSync(path.resolve(here, "../../src/lib/superDefaults.json"), "utf8")),
};
