import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// __dirname's depth relative to the repo root differs depending on how this
// module is loaded: unbundled (vitest, tsx) it's the true source location
// (artifacts/api-server/src/data), but esbuild's bundle (build.mjs, bundle:
// true) collapses import.meta.url for every merged module to the single
// output file's location (artifacts/api-server/dist/index.mjs) — one level
// shallower. Walk up to the workspace root marker instead of hardcoding a
// parent count, so both contexts resolve correctly.
function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

const DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "p-median-us", "dataset");

// SCN v0.3 Phase B, task B6.3 — p-median-brazil's own dataset directory.
// NOT exposed via GET /dataset (that endpoint's modelId enum still has no
// p-median-brazil value — the frontend has no per-row Brazil dataset UI,
// see Workspace.tsx's placeholder, and adding that endpoint is explicitly
// out of scope for this task). This loader exists solely so the backend
// (precheck.ts's semantic checks) can validate a Brazil scenario's
// addedWarehouses/addedCustomers/distanceOverrides against real base-dataset
// ids, the same way it already does for p-median-us.
const BRAZIL_DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "p-median-brazil", "dataset");

export interface WarehouseCandidate {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  /** Distinguishes non-overridable supply nodes (e.g. two-echelon-gold-au's mine) from overridable ones. Omitted where every row is overridable. */
  kind?: "mine" | "facility";
}

export interface Customer {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
}

function loadJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DATASET_DIR, filename), "utf8"));
}

function byIndex(record: Record<string, unknown>): unknown[] {
  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => record[k]);
}

export const WAREHOUSES = byIndex(loadJson("warehouses.json")) as WarehouseCandidate[];
export const CUSTOMERS = byIndex(loadJson("customers.json")) as Customer[];
export const TOTAL_DEMAND = CUSTOMERS.reduce((sum, c) => sum + c.demand, 0);

// p-median-brazil — already ID-keyed on disk (DD-2's correction: warehouses/
// states are `{str_id: {...}}`, not p-median-us's index-keyed shape), so
// Object.values needs no byIndex sort.
export interface BrazilWarehouse {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface BrazilRegion {
  id: string;
  name: string;
  lat: number;
  lng: number;
  demand: number;
}

function loadBrazilJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(BRAZIL_DATASET_DIR, filename), "utf8"));
}

export const BRAZIL_WAREHOUSES = Object.values(loadBrazilJson("warehouses.json")) as BrazilWarehouse[];
export const BRAZIL_REGIONS = Object.values(loadBrazilJson("states.json")) as BrazilRegion[];
