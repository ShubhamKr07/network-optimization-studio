import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { WarehouseCandidate, Customer } from "./dataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

// Chapter 5 (modified) - Delivery Company Teaching Example. Record maps keyed
// by real entity id (W8 / C269), the max-coverage-us convention, not
// p-median-us's ordinal keys - so Object.values (insertion order), not a
// byIndex sort. Distances are miles and are the effective distances as the
// source workbook gives them; no circuity factor is applied.
const DELIVERY_DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "delivery-teaching-us", "dataset");

interface DeliveryWarehouseEntry { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }
interface DeliveryCustomerEntry extends DeliveryWarehouseEntry { demand: number; }

function loadJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DELIVERY_DATASET_DIR, filename), "utf8"));
}

export const DELIVERY_WAREHOUSES: WarehouseCandidate[] =
  Object.values(loadJson("warehouses.json") as Record<string, DeliveryWarehouseEntry>);

export const DELIVERY_CUSTOMERS: Customer[] =
  Object.values(loadJson("customers.json") as Record<string, DeliveryCustomerEntry>);

// Lane-existence set. Lives here rather than beside the reference-cost builder
// so that precheck (Task 6) and the reference-cost endpoint (Task 7) both read
// one source and cannot drift, and so neither task depends on the other.
export const DELIVERY_LANE_KEYS: ReadonlySet<string> =
  new Set(Object.keys(loadJson("costs.json")));
