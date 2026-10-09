import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { WarehouseCandidate, Customer } from "./dataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same bundling-safe loader pattern data/dataset.ts documents: esbuild's
// bundle collapses import.meta.url for every merged module to the single
// output file's location, so walk up to the workspace-root marker rather
// than assuming this file's source depth. NOT an import.meta.url-relative
// path into solvers/ (that lies under the bundled server).
function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

// Chapter 4 (max-coverage-us) — a US single-echelon warehouse->customer
// service-level model. Unlike p-median-us's index-keyed dataset, this package
// is a record-map keyed directly by the real entity id (e.g. `ALN`/`C1`), same on-disk
// shape as two-echelon-gold-au — so Object.values (insertion order), not the
// byIndex sort dataset.ts uses. Distances are RAW MILES on disk and ARE the
// effective distances (MIG-6: no circuity factor applied); the
// warehouse/customer rows here carry only geometry, so the km/mi distinction
// is a solver/reporting concern, not a dataset-loader one.
const MAX_COVERAGE_DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "max-coverage-us", "dataset");

interface MaxCoverageWarehouseEntry { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }
interface MaxCoverageCustomerEntry extends MaxCoverageWarehouseEntry { demand: number; }

function loadJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MAX_COVERAGE_DATASET_DIR, filename), "utf8"));
}

export const MAX_COVERAGE_WAREHOUSES: WarehouseCandidate[] = Object.values(
  loadJson("warehouses.json") as Record<string, MaxCoverageWarehouseEntry>,
).map((w) => ({ id: w.id, city: w.city, state: w.state, lat: w.lat, lng: w.lng, zip: w.zip }));

export const MAX_COVERAGE_CUSTOMERS: Customer[] = Object.values(
  loadJson("customers.json") as Record<string, MaxCoverageCustomerEntry>,
).map((c) => ({ id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.demand, zip: c.zip }));

export const MAX_COVERAGE_TOTAL_DEMAND = MAX_COVERAGE_CUSTOMERS.reduce((sum, c) => sum + c.demand, 0);
