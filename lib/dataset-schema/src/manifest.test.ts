import { describe, it, expect } from "vitest";
import { ManifestSchema } from "./index";

describe("ManifestSchema — capabilities.outputGrids", () => {
  const baseManifest = {
    id: "p-median-us",
    name: "Al's Athletics",
    chapter: "Chapter 3",
    datasetDir: "solvers/p-median-us/dataset",
    countryBounds: { sw: [25, -125] as [number, number], ne: [50, -66] as [number, number] },
    capabilities: {
      supportsP: true,
      capacityModes: ["none", "uniform", "per_wh"],
      demandEditable: true,
      outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
    },
    inputsSchema: {},
  };

  it("parses and retains outputGrids on capabilities", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.capabilities.outputGrids).toEqual(["openWarehouses", "assignments", "costSummary", "serviceStats"]);
  });

  it("rejects a manifest missing outputGrids (required field)", () => {
    const { capabilities, ...rest } = baseManifest;
    const { outputGrids, ...capabilitiesWithoutOutputGrids } = capabilities;
    expect(() => ManifestSchema.parse({ ...rest, capabilities: capabilitiesWithoutOutputGrids })).toThrow();
  });
});

describe("ManifestSchema — distanceUnit (R5)", () => {
  const baseManifest = {
    id: "p-median-us",
    name: "Al's Athletics",
    chapter: "Chapter 3",
    datasetDir: "solvers/p-median-us/dataset",
    countryBounds: { sw: [25, -125] as [number, number], ne: [50, -66] as [number, number] },
    capabilities: {
      supportsP: true,
      capacityModes: ["none", "uniform", "per_wh"],
      demandEditable: true,
      outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
    },
    inputsSchema: {},
  };

  it("validates a manifest that declares distanceUnit", () => {
    const parsed = ManifestSchema.parse({ ...baseManifest, distanceUnit: "km" });
    expect(parsed.distanceUnit).toBe("km");
  });

  it("validates a manifest with distanceUnit absent (optional, pre-R5 manifests)", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.distanceUnit).toBeUndefined();
  });

  it("rejects an invalid distanceUnit value", () => {
    expect(() => ManifestSchema.parse({ ...baseManifest, distanceUnit: "meters" })).toThrow();
  });
});
