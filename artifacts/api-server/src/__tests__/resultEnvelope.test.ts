import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ResultEnvelopeSchema } from "../solver/resultEnvelope.js";

// Real (unmocked) solve.py invocations — validates the RAW envelope solve.py
// emits, one layer below pmedian.ts's envelopeToLegacy() shim. This is
// G2.1's own DoD: "all three models emit an envelope that validates against
// the shared Zod schema."
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOLVER_PY = path.resolve(__dirname, "..", "solver", "solve.py");

function runSolver(payload: Record<string, unknown>): unknown {
  const result = spawnSync("python3", [SOLVER_PY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000,
  });
  return JSON.parse(result.stdout);
}

describe("solve.py result envelope (G2.1 DoD)", () => {
  it("p-median-us emits an envelope that validates against the shared schema", () => {
    const raw = runSolver({
      modelType: "p_median", pValue: 3, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 30,
    });
    const parsed = ResultEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("transport-coal emits an envelope that validates against the shared schema", () => {
    const raw = runSolver({
      modelType: "transport", distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 30,
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
    });
    const parsed = ResultEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("p-median-brazil (capacitated_pmedian) emits an envelope that validates against the shared schema", () => {
    const raw = runSolver({
      modelType: "capacitated_pmedian", pValue: 5, warehouseCapacity: 20_000_000,
      distanceBands: [500, 1000, 2000, 4000], gap: 0, timeLimitSec: 30, singleSource: false,
    });
    const parsed = ResultEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("an infeasible result also validates against the shared schema", () => {
    const raw = runSolver({
      modelType: "p_median", pValue: 1, distanceBands: [200], gap: 0, timeLimitSec: 30,
      warehouseStatuses: [
        { warehouseId: "CHI", status: "forced_open" },
        { warehouseId: "LA", status: "forced_open" },
      ],
    }) as { status: string };
    expect(raw.status).toBe("infeasible");
    expect(ResultEnvelopeSchema.safeParse(raw).success).toBe(true);
  });

  it("retains leg and avgDistanceByLeg through Zod parse (S1 guard)", () => {
    // Zod's z.object() strips unknown keys silently. The two-echelon solver
    // emits edge.leg and metrics.avgDistanceByLeg; if EdgeSchema/MetricsSchema
    // didn't declare them optional, both would vanish in transit with zero
    // error. This guard fails the moment someone removes those fields.
    const raw = {
      status: "optimal", objective: 100, runTimeSec: 0.1, quality: "Optimal",
      edges: [{ fromId: "kalgoorlie", toId: "cunnamulla", flow: 1000, distance: 1465, leg: "mine_to_refinery" }],
      metrics: {
        weightedAvgDistance: 500,
        avgDistanceByLeg: [{ leg: "mine_to_refinery", avgDistance: 1465, totalFlow: 1000 }],
      },
      details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    const parsed = ResultEnvelopeSchema.parse(raw);
    expect(parsed.edges[0].leg).toBe("mine_to_refinery");
    expect(parsed.metrics.avgDistanceByLeg).toHaveLength(1);
    expect(parsed.metrics.avgDistanceByLeg![0].avgDistance).toBe(1465);
  });
});
