// ch9-tc-3 — scalar bounds for two-echelon-jade-us's editable transport
// costs (jadeInputsSchema's new optional `transportCosts` field), plus the
// manifest-maxima pin and the solve.py numeric-parity check. The companion
// cross-field semantic guard (precheckJadeInputs' new "coefficient_range"
// failure class) is covered in precheck.test.ts instead, since it needs
// the full precheck dataset/reference-distances machinery this file does
// not import.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { readManifest } from "@workspace/dataset-schema";
import {
  jadeInputsSchema,
  JADE_RATE_MAX,
  JADE_MIN_CHARGE_MAX,
  JADE_TEXTBOOK_TRANSPORT_COSTS,
} from "../validation/inputs/jadeInputs.js";
import { buildPayload } from "../solver/pmedian.js";
import { computeInputsHash, computeInputsHashV2 } from "../solver/jobRunner.js";
import { fillEstimatedJadeDistances } from "../services/autoDistance.js";

const BASE = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
};

const RATES = { icTransCost: 0.07, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 10 };

describe("ch9-tc — jadeInputsSchema.transportCosts", () => {
  it("accepts inputs with no transportCosts at all (absence means textbook)", () => {
    const parsed = jadeInputsSchema.parse({ ...BASE });
    expect(parsed.transportCosts).toBeUndefined();
  });

  it("accepts a complete object", () => {
    const parsed = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });
    expect(parsed.transportCosts).toEqual(RATES);
  });

  it("rejects a partial object (all-or-nothing, never a half-merge)", () => {
    for (const key of Object.keys(RATES)) {
      const partial: Record<string, number> = { ...RATES };
      delete partial[key];
      const result = jadeInputsSchema.safeParse({ ...BASE, transportCosts: partial });
      expect(result.success, `omitting ${key} must be rejected`).toBe(false);
    }
  });

  it("accepts zero for every field", () => {
    const zeros = { icTransCost: 0, icMinTrans: 0, obTransCost: 0, obMinTrans: 0 };
    expect(jadeInputsSchema.safeParse({ ...BASE, transportCosts: zeros }).success).toBe(true);
  });

  it("rejects negative, NaN and infinite values", () => {
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = jadeInputsSchema.safeParse({
        ...BASE,
        transportCosts: { ...RATES, icTransCost: bad },
      });
      expect(result.success, `${String(bad)} must be rejected`).toBe(false);
    }
  });

  it("rejects wrong-TYPE values (string, null, boolean, object) at every field", () => {
    // Handoff from Task 1: tc.get(key, default) in solve.py does no type
    // coercion, so a non-numeric rate that reached the solver would raise
    // a TypeError, not the intended ValueError. The Zod schema is what
    // prevents a wrong-typed value from ever reaching solve.py at all.
    for (const bad of ["0.07", null, true, { value: 0.07 }]) {
      const result = jadeInputsSchema.safeParse({
        ...BASE,
        transportCosts: { ...RATES, icTransCost: bad },
      });
      expect(result.success, `${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("rejects a rate above the maximum and accepts the maximum itself", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obTransCost: JADE_RATE_MAX },
    }).success).toBe(true);
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obTransCost: JADE_RATE_MAX + 0.01 },
    }).success).toBe(false);
  });

  it("rejects a minimum charge above the maximum and accepts the maximum itself", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obMinTrans: JADE_MIN_CHARGE_MAX },
    }).success).toBe(true);
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obMinTrans: JADE_MIN_CHARGE_MAX + 1 },
    }).success).toBe(false);
  });

  it("pins the manifest JSON Schema maxima equal to the Zod maxima", () => {
    const schema = readManifest("two-echelon-jade-us").inputsSchema as {
      properties: Record<string, any>;
    };
    const tc = schema.properties.transportCosts;
    expect(tc, "manifest must declare transportCosts").toBeDefined();
    expect(tc.required.sort()).toEqual(
      ["icMinTrans", "icTransCost", "obMinTrans", "obTransCost"],
    );
    expect(tc.properties.icTransCost.maximum).toBe(JADE_RATE_MAX);
    expect(tc.properties.obTransCost.maximum).toBe(JADE_RATE_MAX);
    expect(tc.properties.icMinTrans.maximum).toBe(JADE_MIN_CHARGE_MAX);
    expect(tc.properties.obMinTrans.maximum).toBe(JADE_MIN_CHARGE_MAX);
    for (const key of ["icTransCost", "icMinTrans", "obTransCost", "obMinTrans"]) {
      expect(tc.properties[key].minimum).toBe(0);
    }
  });

  // Reject a literally infinite distance or demand at the SHAPE layer. These
  // were `z.number().nonnegative()` with no `.finite()` before this task, so
  // Infinity used to parse. Fixed here because precheckJadeInputs' new
  // coefficient_range guard checks products of distance/demand values for
  // finiteness, which only means something if the inputs were already
  // required to be finite in the first place. Pre-existing hole, unrelated
  // to the transportCosts feature itself.
  it("rejects a literally infinite distance or demand at the SHAPE layer", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: Number.POSITIVE_INFINITY }],
    }).success).toBe(false);
    expect(jadeInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{
        id: "c-x", city: "X", state: "ZZ", lat: 0, lng: 0,
        demands: { "product-1": Number.POSITIVE_INFINITY, "product-2": 0, "product-3": 0, "product-4": 0 },
      }],
    }).success).toBe(false);
  });

  it("still accepts a finite-but-large distance or demand override (no magnitude ceiling)", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 1e100 }],
    }).success).toBe(true);
    expect(jadeInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{
        id: "c-x", city: "X", state: "ZZ", lat: 0, lng: 0,
        demands: { "product-1": 1e308, "product-2": 0, "product-3": 0, "product-4": 0 },
      }],
    }).success).toBe(true);
  });
});

// Keeps the server precheck's absent-key defaults (JADE_TEXTBOOK_TRANSPORT_COSTS)
// from drifting from the four authoritative Python constants solve.py
// actually falls back to when `transportCosts` is absent. Parses solve.py's
// source directly rather than comparing against a second test-local
// literal, so a future change to either side's numbers fails this test.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SOLVE_PY_PATH = path.join(REPO_ROOT, "artifacts", "api-server", "src", "solver", "solve.py");

function parseSolvePyConstant(name: string): number {
  const src = readFileSync(SOLVE_PY_PATH, "utf8");
  const match = src.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m"));
  if (!match) {
    throw new Error(`solve.py: could not find module-level constant ${name}`);
  }
  return Number(match[1]);
}

describe("JADE_TEXTBOOK_TRANSPORT_COSTS — numeric parity with solve.py", () => {
  it("equals the four JADE_IC_*/JADE_OB_* constants solve.py actually defaults to", () => {
    expect(JADE_TEXTBOOK_TRANSPORT_COSTS).toEqual({
      icTransCost: parseSolvePyConstant("JADE_IC_RATE"),
      icMinTrans: parseSolvePyConstant("JADE_IC_MIN"),
      obTransCost: parseSolvePyConstant("JADE_OB_RATE"),
      obMinTrans: parseSolvePyConstant("JADE_OB_MIN"),
    });
  });
});

// ch9-tc-4 — registration point 4 (model-integration-precheck.md): buildPayload
// is a field-by-field translation, so an unlisted field never reaches the
// solver and the solve quietly uses defaults. transportCosts carries the
// SAME key name on both sides (no wire-name translation, unlike
// plantProductCapability -> capabilityOverrides above it in pmedian.ts).
describe("ch9-tc — buildPayload", () => {
  const jadeInputs = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });

  it("passes transportCosts straight through for JADE", () => {
    const payload = buildPayload({ modelId: "two-echelon-jade-us", inputs: jadeInputs });
    expect(payload.modelType).toBe("two_echelon_jade");
    expect(payload.transportCosts).toEqual(RATES);
  });

  it("omits the key entirely when the scenario has no transportCosts", () => {
    const bare = jadeInputsSchema.parse({ ...BASE });
    const payload = buildPayload({ modelId: "two-echelon-jade-us", inputs: bare });
    expect(payload.transportCosts).toBeUndefined();
  });

  it("never emits transportCosts for a non-JADE model", () => {
    const payload = buildPayload({
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000], gap: 0, timeLimitSec: 60,
        capacityFactor: 1, singleSource: false, capacityInactive: false,
        mineCapacities: {}, stationDemands: {},
        addedMines: [], addedStations: [], laneCostOverrides: [],
      } as never,
    });
    expect("transportCosts" in payload).toBe(false);
  });
});

// Both hashes already incorporate transportCosts as of Task 3 — they hash
// canonicalJson(input.inputs), and Task 3's schema change is what made that
// object actually carry the key. Kept here as regression locks (NOT as
// expected-red evidence for this task — they were already green before the
// buildPayload change below landed).
describe("ch9-tc — cache key separation", () => {
  const a = { modelId: "two-echelon-jade-us" as const, inputs: jadeInputsSchema.parse({ ...BASE }) };
  const b = {
    modelId: "two-echelon-jade-us" as const,
    inputs: jadeInputsSchema.parse({ ...BASE, transportCosts: { ...RATES, obTransCost: 0.2 } }),
  };

  it("gives two scenarios differing only in transportCosts different v1 hashes", () => {
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  it("gives them different v2 hashes too", () => {
    expect(computeInputsHashV2(a)).not.toBe(computeInputsHashV2(b));
  });
});

// Second silent-drop guard from the plan's own self-review: autoDistance.ts's
// fillEstimatedJadeDistances (the real export; the brief's illustrative name
// was applyJadeAutoDistances) re-parses the whole inputs object through
// jadeInputsSchema after filling in estimated distance rows. An optional
// field survives that round trip only because it is DECLARED on the schema
// — this is the regression lock for that same Zod-strips-unknown-keys class.
describe("ch9-tc — applyAutoDistances preserves transportCosts", () => {
  it("fillEstimatedJadeDistances's reparse does not drop transportCosts", () => {
    const withRates = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });
    const after = fillEstimatedJadeDistances(withRates);
    expect(after.transportCosts).toEqual(RATES);
  });
});
