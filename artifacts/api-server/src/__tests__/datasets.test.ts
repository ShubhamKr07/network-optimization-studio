import { describe, it, expect } from "vitest";
import { PACKAGE_SPECS, validatePackage, computeSha256, readVersion } from "@workspace/dataset-schema";

const EXPECTED_COUNTS: Record<string, Record<string, number>> = {
  "p-median-us": { "warehouses.json": 26, "customers.json": 200, "distances.json": 5200 },
  "transport-coal": { "mines.json": 4, "stations.json": 15, "costs.json": 60 },
  "p-median-brazil": { "warehouses.json": 25, "states.json": 25, "distances.json": 625 },
  "two-echelon-gold-au": { "mines.json": 1, "refineries.json": 2, "customers.json": 10, "distances.json": 22 },
};

describe("solvers/<model-id>/dataset packages", () => {
  for (const spec of PACKAGE_SPECS) {
    describe(spec.modelId, () => {
      it("validates every file against its Zod schema", () => {
        expect(() => validatePackage(spec)).not.toThrow();
      });

      it("has the expected entry counts", () => {
        const parsed = validatePackage(spec);
        const expected = EXPECTED_COUNTS[spec.modelId];
        for (const [filename, count] of Object.entries(expected)) {
          expect(Object.keys(parsed[filename] as object)).toHaveLength(count);
        }
      });

      it("matches its own version.json sha256 (drift guard)", () => {
        const version = readVersion(spec.modelId);
        expect(computeSha256(spec)).toBe(version.sha256);
      });
    });
  }
});
