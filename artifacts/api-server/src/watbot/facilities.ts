// artifacts/api-server/src/watbot/facilities.ts
// D20 — candidate-facility names: the model's dataset (warehouses, plants,
// refineries, mines) plus the facilities in the context scenario's own inputs
// (added facilities, and super-model's imported network). `city` is what the
// Output Map and the context summary's "open sites" show.
import { WAREHOUSES } from "../data/dataset.js";
import { BRAZIL_DATASET_WAREHOUSES } from "../data/brazilDataset.js";
import { MAX_COVERAGE_WAREHOUSES } from "../data/maxCoverageDataset.js";
import { DELIVERY_WAREHOUSES } from "../data/deliveryDataset.js";
import { TRANSPORT_COAL_WAREHOUSES } from "../data/transportCoalDataset.js";
import { JADE_PLANTS, JADE_WAREHOUSES } from "../data/jadeDataset.js";
import { GOLD_WAREHOUSES } from "../data/twoEchelonDataset.js";

const BY_MODEL: Record<string, Array<{ city: string }>> = {
  "p-median-us": WAREHOUSES,
  "p-median-brazil": BRAZIL_DATASET_WAREHOUSES,
  "max-coverage-us": MAX_COVERAGE_WAREHOUSES,
  "delivery-teaching-us": DELIVERY_WAREHOUSES,
  "transport-coal": TRANSPORT_COAL_WAREHOUSES,           // the coal mines
  "two-echelon-jade-us": [...JADE_PLANTS, ...JADE_WAREHOUSES],
  "two-echelon-gold-au": GOLD_WAREHOUSES,                // mines + refineries
  // super-model: no base dataset; its facilities are imported per scenario.
};

const datasetNames = (modelId: string) =>
  [...new Set((BY_MODEL[modelId] ?? []).map((f) => f.city.trim()).filter(Boolean))];

// Facility lists across the models' input schemas: super-model's imported
// `warehouses`/`plants` (city optional, QFX-7) and every model's added-facility arrays.
const SCENARIO_FACILITY_KEYS = ["warehouses", "plants", "addedWarehouses", "addedPlants", "addedMines", "addedRefineries"] as const;

export function scenarioFacilityNames(inputs: unknown): string[] {
  const record = (inputs ?? {}) as Record<string, unknown>;
  const names: string[] = [];
  for (const key of SCENARIO_FACILITY_KEYS) {
    const rows = record[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as { id?: unknown; city?: unknown }[]) {
      const name = typeof row.city === "string" && row.city.trim() ? row.city : typeof row.id === "string" ? row.id : "";
      if (name.trim()) names.push(name.trim());
    }
  }
  return names;
}

export function facilityNames(modelId: string, scenarioInputs?: unknown): string[] {
  const base = datasetNames(modelId);
  return scenarioInputs === undefined ? base : [...new Set([...base, ...scenarioFacilityNames(scenarioInputs)])];
}
