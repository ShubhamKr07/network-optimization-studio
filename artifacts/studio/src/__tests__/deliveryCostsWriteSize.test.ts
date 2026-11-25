// WQF-C5 — an unfiltered Apply writes all 10,329 lanes in one PATCH. Measured 2026-11-25: 463,259 bytes at ×1
// and 634,990 bytes with every cost at Number.MAX_VALUE (the longest JSON number), vs MAX_IMPORT_BYTES
// 2,097,152 (app.ts:97). The runtime size guard (rowsThatFit, Workspace's handleApplyDeliveryCosts) handles an
// over-limit Apply; this test pins that a real unfiltered Apply on today's dataset never reaches it, and fails
// first if the dataset or the override shape grows toward the limit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";

const COSTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../solvers/delivery-teaching-us/dataset/costs.json");

describe("WQF-C5 — an unfiltered Base-multiplier write fits the scenario write limit", () => {
  const costs = JSON.parse(readFileSync(COSTS, "utf8")) as Record<string, number>;
  const pairs = Object.keys(costs).map(k => {
    const [fromId, toId] = k.split(",");
    return { fromId, toId };
  });

  it("reads the whole 33 × 313 matrix (non-vacuous)", () => {
    expect(pairs).toHaveLength(10_329);
  });

  it("stays under half of MAX_IMPORT_BYTES even with the longest possible number in every cost", () => {
    const body = JSON.stringify({ inputs: { laneCostOverrides: pairs.map(p => ({ ...p, cost: Number.MAX_VALUE })) } });
    expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_IMPORT_BYTES / 2);
  });
});
