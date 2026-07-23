import { describe, it, expect } from "vitest";
import { deepEqual, diffInputs, diffOutputs } from "@/lib/compareDiff";
import type { DiffScenarioInputs, DiffScenarioResult } from "@/lib/compareDiff";

describe("deepEqual", () => {
  it("treats primitives, arrays, and objects structurally", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false); // plain arrays are order-sensitive
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("diffs arrays of {id: ...} objects by id, ignoring order (generic rule, not model-specific)", () => {
    const a = [
      { id: "w1", status: "active" },
      { id: "w2", status: "active" },
    ];
    const b = [
      { id: "w2", status: "active" },
      { id: "w1", status: "active" },
    ];
    expect(deepEqual(a, b)).toBe(true); // same ids/values, different order

    const c = [
      { id: "w1", status: "forced_open" },
      { id: "w2", status: "active" },
    ];
    expect(deepEqual(a, c)).toBe(false); // w1's status differs
  });

  it("applies the id-keyed-array rule recursively at any nesting depth, not just top-level", () => {
    const a = { site: { id: "s1", nested: [{ id: "n1", v: 1 }] } };
    const b = { site: { id: "s1", nested: [{ id: "n1", v: 1 }] } };
    expect(deepEqual(a, b)).toBe(true);
    const c = { site: { id: "s1", nested: [{ id: "n1", v: 2 }] } };
    expect(deepEqual(a, c)).toBe(false);
  });
});

describe("diffInputs — generic shallow-diff-by-key", () => {
  // PRD acceptance: two solved same-model scenarios differing only in p (4 vs 5)
  const baseInputs = {
    p: 4,
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [{ id: "wh1", status: "active" }],
    customerOverrides: [],
    distanceBands: [200, 400, 800],
    gap: 0.02,
    timeLimitSec: 120,
  };

  it("highlights exactly the p row when only p differs", () => {
    const scenarios: DiffScenarioInputs[] = [
      { id: 1, name: "P=4", inputs: baseInputs },
      { id: 2, name: "P=5", inputs: { ...baseInputs, p: 5 } },
    ];
    const rows = diffInputs(scenarios);
    const changedKeys = rows.filter((r) => r.changed).map((r) => r.key);
    expect(changedKeys).toEqual(["p"]);
    // every other key is de-emphasized (changed === false)
    for (const row of rows) {
      if (row.key !== "p") expect(row.changed).toBe(false);
    }
  });

  it("works generically for an arbitrary/unseen model's inputs shape with zero special-casing", () => {
    const scenarios: DiffScenarioInputs[] = [
      { id: 1, name: "A", inputs: { coverageRadius: 10, sites: [{ id: "x1", open: true }] } },
      { id: 2, name: "B", inputs: { coverageRadius: 20, sites: [{ id: "x1", open: true }] } },
    ];
    const rows = diffInputs(scenarios);
    expect(rows.find((r) => r.key === "coverageRadius")?.changed).toBe(true);
    expect(rows.find((r) => r.key === "sites")?.changed).toBe(false);
  });

  it("diffs warehouseOverrides/customerOverrides-shaped arrays by id, flagging only the changed id", () => {
    const scenarios: DiffScenarioInputs[] = [
      {
        id: 1,
        name: "A",
        inputs: {
          ...baseInputs,
          warehouseOverrides: [
            { id: "wh1", status: "active" },
            { id: "wh2", status: "active" },
          ],
        },
      },
      {
        id: 2,
        name: "B",
        inputs: {
          ...baseInputs,
          warehouseOverrides: [
            { id: "wh2", status: "active" },
            { id: "wh1", status: "forced_open" }, // reordered + changed
          ],
        },
      },
    ];
    const rows = diffInputs(scenarios);
    const row = rows.find((r) => r.key === "warehouseOverrides")!;
    expect(row.changed).toBe(true);
    expect(row.itemDiffs).toBeDefined();
    const wh1Diff = row.itemDiffs!.find((d) => d.itemId === "wh1")!;
    const wh2Diff = row.itemDiffs!.find((d) => d.itemId === "wh2")!;
    expect(wh1Diff.changed).toBe(true);
    expect(wh2Diff.changed).toBe(false);
  });

  it("flags an added/removed override id as changed for that item", () => {
    const scenarios: DiffScenarioInputs[] = [
      { id: 1, name: "A", inputs: { ...baseInputs, customerOverrides: [] } },
      { id: 2, name: "B", inputs: { ...baseInputs, customerOverrides: [{ id: "c1", status: "excluded" }] } },
    ];
    const rows = diffInputs(scenarios);
    const row = rows.find((r) => r.key === "customerOverrides")!;
    expect(row.changed).toBe(true);
    expect(row.itemDiffs).toEqual([
      { itemId: "c1", changed: true, values: [undefined, { id: "c1", status: "excluded" }] },
    ]);
  });

  it("marks every row unchanged when all scenarios share identical inputs", () => {
    const scenarios: DiffScenarioInputs[] = [
      { id: 1, name: "A", inputs: baseInputs },
      { id: 2, name: "B", inputs: { ...baseInputs } },
    ];
    const rows = diffInputs(scenarios);
    expect(rows.every((r) => !r.changed)).toBe(true);
  });
});

describe("diffOutputs — objective delta, site add/remove, reassignment count, metric deltas", () => {
  function scenario(
    id: number,
    name: string,
    objective: number,
    edges: DiffScenarioResult["edges"],
    metrics: Record<string, unknown> = {},
  ): DiffScenarioResult {
    return { id, name, objective, edges, metrics };
  }

  it("computes objective delta abs & pct vs the chosen baseline", () => {
    const a = scenario(1, "A", 200000, []);
    const b = scenario(2, "B", 150000, []);
    const diff = diffOutputs([a, b], 1);
    expect(diff.objective.values).toEqual([200000, 150000]);
    expect(diff.objective.deltaAbs).toEqual([0, -50000]);
    expect(diff.objective.deltaPct[1]).toBeCloseTo(-25, 5);
  });

  it("derives opened/closed sites from unique fromIds across edges, vs baseline", () => {
    const a = scenario(1, "A", 1, [
      { fromId: "CHI", toId: "c1", flow: 10, distance: 5 },
      { fromId: "CHI", toId: "c2", flow: 10, distance: 5 },
    ]);
    const b = scenario(2, "B", 1, [
      { fromId: "CHI", toId: "c1", flow: 10, distance: 5 },
      { fromId: "ATL", toId: "c2", flow: 10, distance: 5 },
    ]);
    const diff = diffOutputs([a, b], 1);
    const bSites = diff.openSites.find((s) => s.scenarioId === 2)!;
    expect(bSites.openSites).toEqual(["ATL", "CHI"]);
    expect(bSites.added).toEqual(["ATL"]);
    expect(bSites.removed).toEqual([]);
    const aSites = diff.openSites.find((s) => s.scenarioId === 1)!;
    // A vs itself-as-baseline: nothing added/removed
    expect(aSites.added).toEqual([]);
    expect(aSites.removed).toEqual([]);
  });

  it("counts reassigned customers as the number of toIds whose fromId differs from baseline", () => {
    const a = scenario(1, "A", 1, [
      { fromId: "CHI", toId: "c1", flow: 10, distance: 5 },
      { fromId: "CHI", toId: "c2", flow: 10, distance: 5 },
      { fromId: "CHI", toId: "c3", flow: 10, distance: 5 },
    ]);
    const b = scenario(2, "B", 1, [
      { fromId: "CHI", toId: "c1", flow: 10, distance: 5 }, // unchanged
      { fromId: "ATL", toId: "c2", flow: 10, distance: 5 }, // reassigned
      { fromId: "ATL", toId: "c3", flow: 10, distance: 5 }, // reassigned
    ]);
    const diff = diffOutputs([a, b], 1);
    expect(diff.reassignedCount).toEqual([null, 2]);
  });

  it("diffs metrics generically by iterating keys: numeric keys get deltas, keyed-arrays (bandCoverage/utilizationByNode) diff by their natural key field", () => {
    const a = scenario(1, "A", 1, [], {
      weightedAvgDistance: 500,
      bandCoverage: [
        { band: 200, percent: 50 },
        { band: 400, percent: 80 },
      ],
      utilizationByNode: [{ warehouseId: "CHI", city: "Chicago", utilization: 90 }],
    });
    const b = scenario(2, "B", 1, [], {
      weightedAvgDistance: 400,
      bandCoverage: [
        { band: 200, percent: 60 }, // shifted
        { band: 400, percent: 80 }, // unchanged
      ],
      utilizationByNode: [{ warehouseId: "CHI", city: "Chicago", utilization: 90 }],
    });
    const diff = diffOutputs([a, b], 1);

    const avgDist = diff.metrics.find((m) => m.key === "weightedAvgDistance")!;
    expect(avgDist.kind).toBe("numeric");
    expect(avgDist.changed).toBe(true);
    expect(avgDist.deltaAbs).toEqual([0, -100]);
    expect(avgDist.deltaPct![1]).toBeCloseTo(-20, 5);

    const bandCov = diff.metrics.find((m) => m.key === "bandCoverage")!;
    expect(bandCov.kind).toBe("keyed-array");
    expect(bandCov.changed).toBe(true);
    expect(bandCov.itemDiffs!.find((d) => d.itemKey === "200")!.changed).toBe(true);
    expect(bandCov.itemDiffs!.find((d) => d.itemKey === "400")!.changed).toBe(false);

    const util = diff.metrics.find((m) => m.key === "utilizationByNode")!;
    expect(util.kind).toBe("keyed-array");
    expect(util.changed).toBe(false);
  });

  it("anchors every 'changed' flag to the chosen baseline, not array position 0 (baseline is re-pointable)", () => {
    // Three scenarios: A and B share the same metrics; C differs. If the
    // baseline is C (array index 2, not 0), A and B must both read as
    // *unchanged* relative to C, and C's own column is the baseline (not
    // "changed"). A prior bug anchored comparisons to index 0 regardless of
    // which scenario was actually chosen as baseline.
    const a = scenario(1, "A", 1, [], {
      weightedAvgDistance: 500,
      bandCoverage: [{ band: 200, percent: 50 }],
    });
    const b = scenario(2, "B", 1, [], {
      weightedAvgDistance: 500,
      bandCoverage: [{ band: 200, percent: 50 }],
    });
    const c = scenario(3, "C", 1, [], {
      weightedAvgDistance: 700,
      bandCoverage: [{ band: 200, percent: 90 }],
    });

    const diff = diffOutputs([a, b, c], 3); // baseline = C, at array index 2

    const avgDist = diff.metrics.find((m) => m.key === "weightedAvgDistance")!;
    expect(avgDist.deltaAbs).toEqual([-200, -200, 0]); // vs C=700
    expect(avgDist.changed).toBe(true); // A/B do differ from baseline C

    const bandCov = diff.metrics.find((m) => m.key === "bandCoverage")!;
    const band200 = bandCov.itemDiffs!.find((d) => d.itemKey === "200")!;
    expect(band200.changed).toBe(true); // A/B (50%) differ from baseline C (90%)
  });

  it("de-emphasizes identical values: no changed flags anywhere when both scenarios are identical", () => {
    const edges = [{ fromId: "CHI", toId: "c1", flow: 10, distance: 5 }];
    const metrics = { weightedAvgDistance: 500, bandCoverage: [{ band: 200, percent: 100 }] };
    const a = scenario(1, "A", 100, edges, metrics);
    const b = scenario(2, "B", 100, edges, metrics);
    const diff = diffOutputs([a, b], 1);
    expect(diff.objective.deltaAbs).toEqual([0, 0]);
    expect(diff.metrics.every((m) => !m.changed)).toBe(true);
    expect(diff.openSites.every((s) => s.added.length === 0 && s.removed.length === 0)).toBe(true);
    expect(diff.reassignedCount).toEqual([null, 0]);
  });
});
