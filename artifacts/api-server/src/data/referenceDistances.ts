import { readFileSync } from "fs";
import path from "path";
import { SOLVERS_ROOT, readVersion } from "@workspace/dataset-schema";
import { WAREHOUSES, CUSTOMERS, type WarehouseCandidate, type Customer } from "./dataset.js";

// Bundle 2.2 (B2.2-T2, B3 backend) — boot-time loader for the immutable
// base×base reference-distance matrix backing GET
// /models/:id/reference-distances. Only p-median-us has
// capabilities.supportsReferenceDistances:true today (T0); this module is
// deliberately structured as a per-model lookup (REFERENCE_DISTANCES_BY_MODEL)
// so a future model can register its own build*() without the route needing
// to change.
//
// solvers/p-median-us/dataset/distances.json is keyed by 1-based ordinal
// pairs "w,c" (warehouse ordinal, customer ordinal) — NOT by entity id. The
// ordinal→id mapping is array order: ordinal N -> WAREHOUSES[N-1] /
// CUSTOMERS[N-1] (data/dataset.ts's WAREHOUSES/CUSTOMERS are already sorted
// by their own index keys, so this is the same array order solve.py itself
// relies on). DD-1: base dataset files are read-only here — never mutated,
// never merged with scenario-local addedWarehouses/addedCustomers/
// distanceOverrides (those are a purely scenario-scoped, separate concern —
// see services/precheck.ts / solver/pmedian.ts's own override merging).

export interface ReferenceDistancePair {
  fromId: string;
  /** Base entities' `id` IS already a short display code (e.g. "ALN", "C1") — fromCode/toCode echo fromId/toId here. Kept as separate fields to match the added-entity `displayCode` shape used elsewhere (DistancesTab.tsx), even though for this read-only base×base matrix the two always coincide (added entities are never included). */
  fromCode: string;
  toId: string;
  toCode: string;
  distance: number;
}

export interface ReferenceDistancesData {
  modelId: string;
  pairs: ReferenceDistancePair[];
  /** Explicit ETag (quoted per RFC 9110) derived from the dataset package's version.json sha256 — the app disables Express's automatic weak ETags globally (app.set("etag", false)), so this route must set its own. */
  etag: string;
}

/**
 * Pure ordinal->id mapping, exported for testing (including a deliberately
 * corrupted-ordinal case) without touching the real on-disk dataset.
 */
export function buildReferenceDistancePairs(
  distancesRaw: Record<string, number>,
  warehouses: WarehouseCandidate[],
  customers: Customer[],
): ReferenceDistancePair[] {
  const pairs: ReferenceDistancePair[] = [];
  for (const [key, distance] of Object.entries(distancesRaw)) {
    const [wOrdinalStr, cOrdinalStr] = key.split(",");
    const wOrdinal = Number(wOrdinalStr);
    const cOrdinal = Number(cOrdinalStr);
    const warehouse = Number.isInteger(wOrdinal) ? warehouses[wOrdinal - 1] : undefined;
    const customer = Number.isInteger(cOrdinal) ? customers[cOrdinal - 1] : undefined;
    if (!warehouse || !customer) {
      throw new Error(
        `referenceDistances: unmapped ordinal pair "${key}" (warehouse ordinal=${wOrdinalStr}, customer ordinal=${cOrdinalStr})`,
      );
    }
    pairs.push({
      fromId: warehouse.id,
      fromCode: warehouse.id,
      toId: customer.id,
      toCode: customer.id,
      distance,
    });
  }
  return pairs;
}

function buildPMedianUsReferenceDistances(): ReferenceDistancesData {
  const distancesPath = path.join(SOLVERS_ROOT, "p-median-us", "dataset", "distances.json");
  const raw = JSON.parse(readFileSync(distancesPath, "utf8")) as Record<string, number>;
  const pairs = buildReferenceDistancePairs(raw, WAREHOUSES, CUSTOMERS);
  const { sha256 } = readVersion("p-median-us");
  return {
    modelId: "p-median-us",
    pairs,
    etag: `"${sha256}"`,
  };
}

const REFERENCE_DISTANCES_BY_MODEL: Record<string, ReferenceDistancesData> = {
  "p-median-us": buildPMedianUsReferenceDistances(),
};

/** Undefined for any model that hasn't registered a builder above (route 422s on that, gated first by the manifest capability). */
export function getReferenceDistances(modelId: string): ReferenceDistancesData | undefined {
  return REFERENCE_DISTANCES_BY_MODEL[modelId];
}
