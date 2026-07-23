import { describe, it, expect } from "vitest";
import { MODEL_IDS, readManifest } from "@workspace/dataset-schema";

describe("solvers/<model-id>/manifest.json", () => {
  for (const modelId of MODEL_IDS) {
    describe(modelId, () => {
      it("validates against the manifest meta-schema", () => {
        expect(() => readManifest(modelId)).not.toThrow();
      });

      it("has id matching its own directory name", () => {
        expect(readManifest(modelId).id).toBe(modelId);
      });

      it("has a datasetDir pointing at its own dataset folder", () => {
        expect(readManifest(modelId).datasetDir).toBe(`solvers/${modelId}/dataset`);
      });

      it("has a non-empty inputsSchema", () => {
        expect(Object.keys(readManifest(modelId).inputsSchema).length).toBeGreaterThan(0);
      });
    });
  }

  it("gives p-median-us and p-median-brazil supportsP=true, transport-coal supportsP=false", () => {
    expect(readManifest("p-median-us").capabilities.supportsP).toBe(true);
    expect(readManifest("p-median-brazil").capabilities.supportsP).toBe(true);
    expect(readManifest("transport-coal").capabilities.supportsP).toBe(false);
  });
});
