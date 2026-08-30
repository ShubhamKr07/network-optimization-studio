import { describe, it, expect } from "vitest";
import { PACKAGE_SPECS, validatePackage, readManifest, computeSha256, WarehouseEntry } from "./index";

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
    expect(hash).toBe("b6df1a31f6a03e5d57aa7bc92bd1eda5c5d5e691d1f8dfec5fd21ac2f2ac0b94");
  });
});

describe("WarehouseEntry zip field (Phase 3.2, Task 3)", () => {
  it("keeps zip when present", () => {
    const parsed = WarehouseEntry.parse({ id: "ALN", city: "Allentown", state: "PA", lat: 40.6028, lng: -75.4704, zip: "18101" });
    expect(parsed.zip).toBe("18101");
  });

  it("still parses successfully when zip is absent", () => {
    const parsed = WarehouseEntry.parse({ id: "ATL", city: "Atlanta", state: "GA", lat: 33.7537, lng: -84.3895 });
    expect(parsed.zip).toBeUndefined();
  });
});
