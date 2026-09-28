import { readFileSync } from "fs";
import path from "path";
import { SOLVERS_ROOT, readVersion } from "@workspace/dataset-schema";
import { DELIVERY_WAREHOUSES, DELIVERY_CUSTOMERS } from "./deliveryDataset.js";

// Chapter 5 (ch5-del-7) — boot-time loader for the immutable base×base
// reference lane-cost matrix backing GET /models/:id/reference-costs, the
// cost-side mirror of reference-distances.ts. Only delivery-teaching-us has
// capabilities.supportsReferenceCosts:true today; structured as a per-model
// lookup (REFERENCE_COSTS_BY_MODEL) so a future model can register its own
// build*() without the route needing to change.
//
// costs.json/distances.json are keyed directly by entity id ("W8,C269"),
// the max-coverage-us convention, not p-median-us's ordinal keys. DD-1: base
// dataset files are read-only here — never mutated, never merged with a
// scenario's own laneCostOverrides (see services/precheck.ts).

export interface ReferenceCostPair {
  fromId: string;
  fromCode: string;
  toId: string;
  toCode: string;
  cost: number;
}

export interface ReferenceCostsData {
  modelId: string;
  pairs: ReferenceCostPair[];
  /** Quoted per RFC 9110, derived from the package's version.json sha256. */
  etag: string;
}

/**
 * PACKAGE_SPECS cannot do this: DistanceMap is z.record(z.string(), z.number()),
 * which accepts zeros AND negatives. This builder is the only place a malformed
 * lane table is caught, so it fails loud at load rather than serving a 200 with
 * bad data. Split into a pure core (exported for the malformed-source test) and
 * a file-reading wrapper.
 */
function buildDeliveryReferenceCosts(): ReferenceCostsData {
  const dir = path.join(SOLVERS_ROOT, "delivery-teaching-us", "dataset");
  const costs = JSON.parse(readFileSync(path.join(dir, "costs.json"), "utf8")) as Record<string, number>;
  const distances = JSON.parse(readFileSync(path.join(dir, "distances.json"), "utf8")) as Record<string, number>;
  return buildDeliveryReferenceCostsFrom(costs, distances);
}

export function buildDeliveryReferenceCostsFrom(
  costs: Record<string, number>,
  distances: Record<string, number>,
): ReferenceCostsData {
  const warehouses = new Set(DELIVERY_WAREHOUSES.map((w) => w.id));
  const customers = new Set(DELIVERY_CUSTOMERS.map((c) => c.id));
  const expected = warehouses.size * customers.size;

  if (Object.keys(costs).length !== expected) {
    throw new Error(`referenceCosts: expected ${expected} lanes, found ${Object.keys(costs).length}`);
  }
  const costKeys = Object.keys(costs).sort().join("|");
  const distKeys = Object.keys(distances).sort().join("|");
  if (costKeys !== distKeys) {
    throw new Error("referenceCosts: costs.json and distances.json key sets differ");
  }

  const pairs: ReferenceCostPair[] = [];
  for (const [key, cost] of Object.entries(costs)) {
    const [fromId, toId] = key.split(",");
    if (!fromId || !toId) throw new Error(`referenceCosts: malformed lane key "${key}"`);
    if (!warehouses.has(fromId)) throw new Error(`referenceCosts: unknown warehouse "${fromId}"`);
    if (!customers.has(toId)) throw new Error(`referenceCosts: unknown customer "${toId}"`);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`referenceCosts: lane "${key}" has a non-finite or negative cost`);
    }
    pairs.push({ fromId, fromCode: fromId, toId, toCode: toId, cost });
  }

  const { sha256 } = readVersion("delivery-teaching-us");
  return { modelId: "delivery-teaching-us", pairs, etag: `"${sha256}"` };
}

const REFERENCE_COSTS_BY_MODEL: Record<string, ReferenceCostsData> = {
  "delivery-teaching-us": buildDeliveryReferenceCosts(),
};

/** Undefined for any model that has not registered a builder; the route 422s on that. */
export function getReferenceCosts(modelId: string): ReferenceCostsData | undefined {
  return REFERENCE_COSTS_BY_MODEL[modelId];
}
