import { expect, it } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { MetricsSchema } from "../resultEnvelope.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // package is ESM — no __dirname
const SOLVE_PY = path.resolve(here, "../solve.py");

it("MetricsSchema keeps the shared-core summary metrics from a real Ch9 solve", () => {
  const payload = { modelType: "two_echelon_jade", p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120,
    warehouseStatuses: [{ warehouseId: "wh-11", status: "forced_open" }, { warehouseId: "wh-14", status: "forced_open" }] };
  const r = spawnSync("python3", [SOLVE_PY], { input: JSON.stringify(payload), encoding: "utf8", timeout: 180_000 });
  const out = JSON.parse(r.stdout.trim().split("\n").pop()!);
  const m = MetricsSchema.parse(out.metrics);
  for (const k of ["plantVariableCost", "totalCost", "avgDistPlantToWh", "avgDistWhToCustomer"] as const)
    expect(typeof m[k]).toBe("number");
  expect(m.plantVariableCost).toBe(0);
}, 200_000);
