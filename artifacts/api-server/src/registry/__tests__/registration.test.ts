import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import request from "supertest";
import {
  getManifest,
  listModels,
  validateInputs,
  KNOWN_MODEL_IDS,
} from "../modelRegistry.js";
import { PACKAGE_SPECS, readVersion } from "@workspace/dataset-schema";
import { VALID_MODEL_IDS } from "../../routes/scenarios.js";
import { buildPayload, type SolveInput } from "../../solver/pmedian.js";

// The five models that are fully solvable end-to-end today (each has a
// manifest + dataset package + Zod input validator + solver dispatch).
// two-echelon-gold-au (Chapter 10) was added once its solver, schema, and
// allowlist entries all landed; two-echelon-jade-us (Chapter 9, JADE) joins
// here in jade-T5, the atomic commit that registers its KNOWN_SCHEMAS entry
// + VALID_MODEL_IDS + buildPayload branch simultaneously (OBS-5 needs all
// three at once) — this test is the drift guard that catches a model
// registered in one place but missing from the others.
const SOLVABLE = [
  "p-median-us",
  "transport-coal",
  "p-median-brazil",
  "two-echelon-gold-au",
  "two-echelon-jade-us",
];

describe("model registration consistency", () => {
  for (const modelId of SOLVABLE) {
    describe(modelId, () => {
      it("has a discoverable manifest (getManifest returns it)", () => {
        expect(getManifest(modelId)).toBeDefined();
      });

      it("is registered as a valid model id (VALID_MODEL_IDS)", () => {
        expect(VALID_MODEL_IDS.has(modelId)).toBe(true);
      });

      it("has a dataset package spec (PACKAGE_SPECS)", () => {
        expect(PACKAGE_SPECS.some((s) => s.modelId === modelId)).toBe(true);
      });

      it("validateInputs does not report 'Unknown model_id' for empty inputs", () => {
        const result = validateInputs(modelId, {});
        // Empty inputs will fail Zod validation (missing required fields),
        // but the failure must NOT be the "Unknown model_id" guard — that
        // would mean the model isn't registered with a schema at all.
        if (!result.success) {
          expect(result.error).not.toMatch(/Unknown model_id/);
        }
      });

      it("readVersion(id) does not throw", () => {
        expect(() => readVersion(modelId)).not.toThrow();
      });
    });
  }
});

// ── Listability (JADE Wave 1, Task 3 → now also SOLVABLE as of T5) ────────────────────────────
// two-echelon-jade-us (Chapter 9) landed its manifest+dataset package (T1/T2) before its solver
// dispatcher/Zod schema/allowlist entries — it was listable-but-not-solvable through Wave 1. T5
// (this commit) registers KNOWN_SCHEMAS + VALID_MODEL_IDS + buildPayload simultaneously, moving it
// into SOLVABLE above. This block keeps asserting the listability half (manifest discovery, GET
// /api/models) independent of the full OBS-5 consistency sweep below.
// See docs/superpowers/plans/2026-09-13-chapter-9-jade-two-echelon.md Tasks 3 and 5.
describe("listability: two-echelon-jade-us (Chapter 9, JADE) is discoverable", () => {
  it("appears in the registry's scanned model list (listModels())", () => {
    const ids = listModels().map((m) => m.id);
    expect(ids).toContain("two-echelon-jade-us");
  });

  it("has a discoverable manifest (getManifest returns it)", () => {
    expect(getManifest("two-echelon-jade-us")).toBeDefined();
  });

  it("is now registered in SOLVABLE/KNOWN_SCHEMAS (T5 — was listable-only through T3)", () => {
    expect(SOLVABLE).toContain("two-echelon-jade-us");
    expect(KNOWN_MODEL_IDS).toContain("two-echelon-jade-us");
  });

  it("GET /api/models returns 6 models, including two-echelon-jade-us", async () => {
    const { default: app } = await import("../../app.js");
    const res = await request(app).get("/api/models");
    expect(res.status).toBe(200);
    // C4.4 — count is a model-registry fact (chens-cosmetics-cn is the 6th
    // manifest, landed in Wave 1). This is NOT the SOLVABLE fixture — Chen's
    // KNOWN_SCHEMAS/SOLVABLE registration is C4.6's atomic commit.
    expect(res.body).toHaveLength(6);
    const ids = (res.body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain("two-echelon-jade-us");
  });
});

// ── OBS-5: the four registration points agree across their DIFFERENT key spaces ──────────────
// Points 3/4 (KNOWN_SCHEMAS, VALID_MODEL_IDS) key on model-id; point 8 (solve.py) keys on the
// `modelType` WIRE string; point 6 (buildPayload) is the bridge model-id → modelType. A naive
// set-equality is wrong — this test bridges via buildPayload, then checks solve.py handles the
// resulting wire value. Placeholder ids present only in VALID_MODEL_IDS (max_coverage/p_center/
// set_cover) are a WARN, not a failure (product decision: coming-soon placeholders).

// Minimal stub inputs per model so buildPayload can run (it maps, it doesn't validate). The array
// fields it .filter()s over must exist.
const PMEDIAN_STUB = {
  p: 3, capacityMode: "none", distanceBands: [200], gap: 0, timeLimitSec: 60,
  warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};
const STUB_INPUTS: Record<string, unknown> = {
  "p-median-us": PMEDIAN_STUB,
  "p-median-brazil": PMEDIAN_STUB,
  "transport-coal": {
    distanceBands: [200], gap: 0, timeLimitSec: 60,
    addedMines: [], addedStations: [], laneCostOverrides: [],
  },
  "two-echelon-gold-au": {
    bomRatio: 1.5, distanceBands: [200], gap: 0, timeLimitSec: 60,
    refineryOverrides: [], customerOverrides: [], addedRefineries: [], addedCustomers: [], distanceOverrides: [],
  },
  "two-echelon-jade-us": {
    p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 60,
    warehouseOverrides: [], customerOverrides: [], plantProductCapability: [],
    addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
};

/** model-id → modelType wire string, read straight from buildPayload (the real mapping). */
function modelTypeFor(modelId: string): string {
  const payload = buildPayload({ modelId, inputs: STUB_INPUTS[modelId] } as unknown as SolveInput);
  return (payload.modelType as string) ?? "p_median";
}

/** solve.py dispatcher: explicit `model_type == '<k>'` keys plus the default `p_median` fallthrough. */
function solvePyModelTypes(): Set<string> {
  const solvePy = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../solver/solve.py"), "utf8");
  const keys = new Set<string>(["p_median"]); // the `return solve_pmedian(inp)` default
  for (const m of solvePy.matchAll(/model_type == ['"](\w+)['"]/g)) keys.add(m[1]);
  return keys;
}

describe("OBS-5 registration points agree (model-id ↔ modelType ↔ solve.py)", () => {
  const IMPLEMENTED = [...KNOWN_MODEL_IDS];
  const dispatch = solvePyModelTypes();

  it("every implemented model id is in VALID_MODEL_IDS", () => {
    const missing = IMPLEMENTED.filter((id) => !VALID_MODEL_IDS.has(id));
    expect(missing, `implemented ids missing from VALID_MODEL_IDS (routes/scenarios.ts): ${missing.join(", ")}`).toEqual([]);
  });

  it("every implemented model id has a buildPayload branch producing a modelType", () => {
    for (const id of IMPLEMENTED) {
      const mt = modelTypeFor(id);
      expect(typeof mt, `buildPayload (solver/pmedian.ts) produced no modelType for ${id}`).toBe("string");
    }
  });

  it("every implemented model's modelType is handled by solve.py's dispatcher", () => {
    const unhandled = IMPLEMENTED
      .map((id) => ({ id, mt: modelTypeFor(id) }))
      .filter(({ mt }) => !dispatch.has(mt));
    expect(
      unhandled,
      `modelType(s) not handled in solver/solve.py solve(): ${unhandled.map((u) => `${u.id}->${u.mt}`).join(", ")}; solve.py handles [${[...dispatch].join(", ")}]`,
    ).toEqual([]);
  });

  it("warns (does not fail) on VALID_MODEL_IDS entries with no backing schema (placeholders)", () => {
    const unbacked = [...VALID_MODEL_IDS].filter((id) => !IMPLEMENTED.includes(id));
    for (const id of unbacked) {
      // Product decision (OBS-5): coming-soon placeholders are allowed in the route allowlist.
      console.warn(`[OBS-5] un-backed model id in VALID_MODEL_IDS (no schema/payload/solver): ${id}`);
    }
    // Assertion is only that this set is knowable — never a failure.
    expect(Array.isArray(unbacked)).toBe(true);
  });
});
