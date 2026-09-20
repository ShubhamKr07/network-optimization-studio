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

describe("ManifestSchema — capabilities.supportsFacilityStatus (Bundle 2, B2-T1)", () => {
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

  it("parses and retains an explicit supportsFacilityStatus: true", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsFacilityStatus: true },
    });
    expect(parsed.capabilities.supportsFacilityStatus).toBe(true);
  });

  it("parses an explicit supportsFacilityStatus: false", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsFacilityStatus: false },
    });
    expect(parsed.capabilities.supportsFacilityStatus).toBe(false);
  });

  it("defaults to false when supportsFacilityStatus is absent (pre-Bundle-2 manifests)", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.capabilities.supportsFacilityStatus).toBe(false);
  });

  it("each real manifest carries the correct supportsFacilityStatus", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("p-median-us").capabilities.supportsFacilityStatus).toBe(true);
    expect(readManifest("p-median-brazil").capabilities.supportsFacilityStatus).toBe(true);
    expect(readManifest("two-echelon-gold-au").capabilities.supportsFacilityStatus).toBe(true);
    expect(readManifest("transport-coal").capabilities.supportsFacilityStatus).toBe(false);
  });
});

describe("ManifestSchema — capabilities.supportsReferenceDistances (Bundle 2.2, B2.2-T0)", () => {
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

  it("parses and retains an explicit supportsReferenceDistances: true", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsReferenceDistances: true },
    });
    expect(parsed.capabilities.supportsReferenceDistances).toBe(true);
  });

  it("defaults to false when supportsReferenceDistances is absent", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.capabilities.supportsReferenceDistances).toBe(false);
  });

  it("real manifest: p-median-us carries supportsReferenceDistances: true", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("p-median-us").capabilities.supportsReferenceDistances).toBe(true);
  });

  it("real manifests: two-echelon-gold-au, p-median-brazil, transport-coal default to false (not set)", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("two-echelon-gold-au").capabilities.supportsReferenceDistances).toBe(false);
    expect(readManifest("p-median-brazil").capabilities.supportsReferenceDistances).toBe(false);
    expect(readManifest("transport-coal").capabilities.supportsReferenceDistances).toBe(false);
  });
});

describe("ManifestSchema — capabilities.supportsAddedCustomerExclusion (Bundle 2.2, B2.2-T0)", () => {
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

  it("parses and retains an explicit supportsAddedCustomerExclusion: true", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsAddedCustomerExclusion: true },
    });
    expect(parsed.capabilities.supportsAddedCustomerExclusion).toBe(true);
  });

  it("parses an explicit supportsAddedCustomerExclusion: false", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsAddedCustomerExclusion: false },
    });
    expect(parsed.capabilities.supportsAddedCustomerExclusion).toBe(false);
  });

  it("defaults to false when supportsAddedCustomerExclusion is absent", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.capabilities.supportsAddedCustomerExclusion).toBe(false);
  });

  it("real manifests: p-median-us and two-echelon-gold-au carry supportsAddedCustomerExclusion: true", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("p-median-us").capabilities.supportsAddedCustomerExclusion).toBe(true);
    expect(readManifest("two-echelon-gold-au").capabilities.supportsAddedCustomerExclusion).toBe(true);
  });

  it("real manifest: p-median-brazil explicitly carries supportsAddedCustomerExclusion: false", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("p-median-brazil").capabilities.supportsAddedCustomerExclusion).toBe(false);
  });
});

describe("ManifestSchema — inputsSchema.addedCustomers[].status (Bundle 2.2, B2.2-T0)", () => {
  it("p-median-us manifest's addedCustomers item schema carries a status property with the active/excluded enum", async () => {
    const { readManifest } = await import("./index");
    const manifest = readManifest("p-median-us");
    const inputsSchema = manifest.inputsSchema as {
      properties: { addedCustomers: { items: { properties: { status: { enum: string[] } } } } };
    };
    expect(inputsSchema.properties.addedCustomers.items.properties.status.enum).toEqual(["active", "excluded"]);
  });

  it("two-echelon-gold-au manifest's addedCustomers item schema carries a status property with the active/excluded enum", async () => {
    const { readManifest } = await import("./index");
    const manifest = readManifest("two-echelon-gold-au");
    const inputsSchema = manifest.inputsSchema as {
      properties: { addedCustomers: { items: { properties: { status: { enum: string[] } } } } };
    };
    expect(inputsSchema.properties.addedCustomers.items.properties.status.enum).toEqual(["active", "excluded"]);
  });

  it("addedCustomers.status is not in the item's required list (back-compat default active)", async () => {
    const { readManifest } = await import("./index");
    for (const modelId of ["p-median-us", "two-echelon-gold-au"] as const) {
      const manifest = readManifest(modelId);
      const inputsSchema = manifest.inputsSchema as {
        properties: { addedCustomers: { items: { required: string[] } } };
      };
      expect(inputsSchema.properties.addedCustomers.items.required).not.toContain("status");
    }
  });
});

describe("ManifestSchema — capabilities.supportsPlantProductCapability (Chapter 9, jade-T2)", () => {
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

  it("parses and retains an explicit supportsPlantProductCapability: true", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, supportsPlantProductCapability: true },
    });
    expect(parsed.capabilities.supportsPlantProductCapability).toBe(true);
  });

  it("defaults to false when supportsPlantProductCapability is absent", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.capabilities.supportsPlantProductCapability).toBe(false);
  });

  it("real manifest: two-echelon-jade-us carries supportsPlantProductCapability: true", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("two-echelon-jade-us").capabilities.supportsPlantProductCapability).toBe(true);
  });

  it("real manifests: p-median-us, transport-coal, p-median-brazil, two-echelon-gold-au default to false (not set)", async () => {
    const { readManifest } = await import("./index");
    expect(readManifest("p-median-us").capabilities.supportsPlantProductCapability).toBe(false);
    expect(readManifest("transport-coal").capabilities.supportsPlantProductCapability).toBe(false);
    expect(readManifest("p-median-brazil").capabilities.supportsPlantProductCapability).toBe(false);
    expect(readManifest("two-echelon-gold-au").capabilities.supportsPlantProductCapability).toBe(false);
  });
});

describe("ManifestSchema — all real manifests still validate (Bundle 2.2, B2.2-T0)", () => {
  it("every model's manifest.json parses cleanly against ManifestSchema", async () => {
    const { readManifest, MODEL_IDS } = await import("./index");
    for (const modelId of MODEL_IDS) {
      expect(() => readManifest(modelId)).not.toThrow();
    }
  });
});

describe("ManifestSchema — chens-cosmetics-cn (Chapter 4, C4.2)", () => {
  it("parses cleanly and carries the km unit + Chapter 4 + exact outputGrids", async () => {
    const { readManifest } = await import("./index");
    const manifest = readManifest("chens-cosmetics-cn");
    expect(manifest.id).toBe("chens-cosmetics-cn");
    expect(manifest.distanceUnit).toBe("km");
    expect(manifest.chapter).toBe("Chapter 4");
    expect(manifest.capabilities.outputGrids).toEqual([
      "openWarehouses",
      "assignments",
      "costSummary",
      "serviceStats",
    ]);
    expect(manifest.capabilities.supportsP).toBe(true);
    expect(manifest.capabilities.capacityModes).toEqual(["none"]);
    expect(manifest.capabilities.supportsFacilityStatus).toBe(true);
    expect(manifest.capabilities.supportsAddedCustomerExclusion).toBe(true);
    expect(manifest.capabilities.supportsReferenceDistances).toBe(true);
  });

  it("inputsSchema is complete and shape-exact (mirrors p-median nested constraints, drops warehouse capacity)", async () => {
    const { readManifest } = await import("./index");
    const inputsSchema = readManifest("chens-cosmetics-cn").inputsSchema as {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };

    // Exact 15-key property set.
    expect(Object.keys(inputsSchema.properties).sort()).toEqual(
      [
        "objective",
        "p",
        "highServiceDistKm",
        "maxDistKm",
        "avgServiceDistCapKm",
        "coverageFloorDemand",
        "gap",
        "timeLimitSec",
        "capacityMode",
        "distanceBands",
        "warehouseOverrides",
        "customerOverrides",
        "addedWarehouses",
        "addedCustomers",
        "distanceOverrides",
      ].sort(),
    );

    const props = inputsSchema.properties;

    // objective enum + p bounds (1..25).
    expect(props.objective.enum).toEqual(["coverage", "min_distance"]);
    expect(props.p.type).toBe("integer");
    expect(props.p.minimum).toBe(1);
    expect(props.p.maximum).toBe(25);

    // distanceBands (T3, spec Part A supersedes D19): a free reporting lens —
    // at least one positive boundary, no upper bound on count.
    expect(props.distanceBands.minItems).toBe(1);
    expect(props.distanceBands.maxItems).toBeUndefined();
    expect(props.distanceBands.items.exclusiveMinimum).toBe(0);

    // Nested required arrays.
    expect(props.addedWarehouses.items.required).toEqual(["id", "city", "state", "lat", "lng", "status"]);
    expect(props.addedWarehouses.items.required).toContain("state");
    expect(props.addedCustomers.items.required).toEqual(["id", "city", "state", "lat", "lng", "demand"]);
    expect(props.addedCustomers.items.required).toContain("state");
    expect(props.customerOverrides.items.required).toEqual(["id", "status"]);
    expect(props.distanceOverrides.items.required).toEqual(["fromId", "toId", "distance"]);

    // Status enums exact.
    expect(props.warehouseOverrides.items.properties.status.enum).toEqual(["active", "forced_open", "inactive"]);
    expect(props.customerOverrides.items.properties.status.enum).toEqual(["active", "excluded"]);
    expect(props.addedWarehouses.items.properties.status.enum).toEqual(["active", "forced_open", "inactive"]);
    expect(props.addedCustomers.items.properties.status.enum).toEqual(["active", "excluded"]);

    // addedCustomers[].status is optional (NOT in required) — the advertised exclusion capability, default active.
    expect(props.addedCustomers.items.required).not.toContain("status");

    // Added-entity ids carry minLength: 1.
    expect(props.addedWarehouses.items.properties.id.minLength).toBe(1);
    expect(props.addedCustomers.items.properties.id.minLength).toBe(1);

    // distanceOverrides.distance exclusiveMinimum 0 + estimated boolean.
    expect(props.distanceOverrides.items.properties.distance.exclusiveMinimum).toBe(0);
    expect(props.distanceOverrides.items.properties.estimated.type).toBe("boolean");

    // Integer demand (D30).
    expect(props.addedCustomers.items.properties.demand.type).toBe("integer");
    expect(props.customerOverrides.items.properties.demand.type).toBe("integer");
    expect(props.coverageFloorDemand.type).toBe("integer");

    // timeLimitSec integer >= 1.
    expect(props.timeLimitSec.type).toBe("integer");
    expect(props.timeLimitSec.minimum).toBe(1);

    // Chen has NO warehouse capacity fields.
    expect(props.warehouseOverrides.items.properties.capacity).toBeUndefined();
    expect(props.addedWarehouses.items.properties.capacity).toBeUndefined();
  });
});
