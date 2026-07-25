import { describe, it, expect } from "vitest";
import {
  getManifest,
  validateInputs,
} from "../modelRegistry.js";
import { PACKAGE_SPECS, readVersion } from "@workspace/dataset-schema";
import { VALID_MODEL_IDS } from "../../routes/scenarios.js";

// The four models that are fully solvable end-to-end today (each has a
// manifest + dataset package + Zod input validator + solver dispatch).
// two-echelon-gold-au (Chapter 10) was added once its solver, schema, and
// allowlist entries all landed — this test is the drift guard that catches
// a model registered in one place but missing from the others.
const SOLVABLE = ["p-median-us", "transport-coal", "p-median-brazil", "two-echelon-gold-au"];

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
