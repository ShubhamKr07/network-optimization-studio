// SCU-2.P2.1 — shared import-test fixtures: valid create-inputs per model, and
// the model-specific ids each descriptor example needs on models other than
// the entity's first (the descriptor example uses the first model's ids).
import Papa from "papaparse";
import { IMPORT_SCHEMAS } from "@workspace/import-schema";
import type { ImportEntity, ImportFieldDescriptor, ModelId } from "@workspace/import-schema";

const PMEDIAN = { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30, addedWarehouses: [], addedCustomers: [], distanceOverrides: [] };

export const MODEL_INPUTS: Record<ModelId, Record<string, unknown>> = {
  "p-median-us": PMEDIAN,
  "p-median-brazil": PMEDIAN,
  "transport-coal": { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false },
  "two-echelon-gold-au": { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 },
  "two-echelon-jade-us": { p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [], plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "max-coverage-us": { p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none", distanceBands: [450, 3400], warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  "delivery-teaching-us": { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] },
};

// Real dataset ids (measured from solvers/*/dataset): Brazil warehouse ANP,
// region SP; JADE wh-1/customer-1/plant-1; delivery W1/C269; gold sydney.
const MODEL_IDS_FOR: Partial<Record<ImportEntity, Partial<Record<ModelId, Record<string, string>>>>> = {
  warehouses: { "p-median-brazil": { id: "ANP" }, "two-echelon-jade-us": { id: "wh-1" }, "delivery-teaching-us": { id: "W1" } },
  customers: { "p-median-brazil": { id: "SP" }, "two-echelon-gold-au": { id: "sydney" }, "two-echelon-jade-us": { id: "customer-1" }, "delivery-teaching-us": { id: "C269" } },
  distances: { "p-median-brazil": { from_id: "ANP", to_id: "SP" } },
  legDistances: { "two-echelon-jade-us": { from_id: "plant-1", to_id: "wh-1" } },
};

export function latestFields(entity: ImportEntity): readonly ImportFieldDescriptor[] {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!.fields;
}

export function exampleCellsFor(entity: ImportEntity, fields: readonly ImportFieldDescriptor[], model: ModelId): string[] {
  const ids = MODEL_IDS_FOR[entity]?.[model] ?? {};
  return fields.map(f => ids[f.csvHeader] ?? f.example);
}

export function exampleCsvFor(entity: ImportEntity, model: ModelId): string {
  const fields = latestFields(entity);
  return Papa.unparse([fields.map(f => f.csvHeader), exampleCellsFor(entity, fields, model)], { newline: "\n" }) + "\n";
}
