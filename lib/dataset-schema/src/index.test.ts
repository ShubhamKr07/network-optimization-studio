import { describe, it, expect } from "vitest";
import { PACKAGE_SPECS, validatePackage, readManifest, computeSha256 } from "./index";

describe("two-echelon-gold-au registration", () => {
  it("validates the two-echelon-gold-au package against its schema", () => {
    const spec = PACKAGE_SPECS.find(s => s.modelId === "two-echelon-gold-au");
    expect(spec).toBeDefined();
    const result = validatePackage(spec!);
    expect(result["mines.json"]).toBeDefined();
    expect(result["refineries.json"]).toBeDefined();
    expect(Object.keys(result["refineries.json"] as object)).toHaveLength(2);
    expect(Object.keys(result["customers.json"] as object)).toHaveLength(10);
  });

  it("readManifest loads the two-echelon-gold-au manifest", () => {
    const manifest = readManifest("two-echelon-gold-au");
    expect(manifest.id).toBe("two-echelon-gold-au");
    expect(manifest.capabilities.supportsP).toBe(false);
    expect(manifest.capabilities.demandEditable).toBe(true);
  });

  // Step 5 critical check: the TS computeSha256() must match the sha256 stored
  // in version.json (produced by the Python extraction script). If these
  // disagree, the two hashing methods are not byte-compatible.
  it("computeSha256 matches the version.json sha256 for two-echelon-gold-au", () => {
    const spec = PACKAGE_SPECS.find(s => s.modelId === "two-echelon-gold-au");
    expect(spec).toBeDefined();
    const hash = computeSha256(spec!);
    expect(hash).toBe("b79d16d920712faff854f5da2e72a852783c3fb653cb449ba559154dde37088c");
  });
});
