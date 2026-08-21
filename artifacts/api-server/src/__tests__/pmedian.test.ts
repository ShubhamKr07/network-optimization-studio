import { describe, it, expect } from "vitest";
import { buildPayload } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";

// Phase 3.5 (G3.1): buildPayload is a pure translation function now (the
// async spawn + job lifecycle lives in jobRunner.ts, tested separately in
// jobRunner.test.ts) — no more child_process mocking needed to test the
// translation logic itself. Phase 4 retired envelopeToLegacy() entirely —
// jobRunner now stores solve.py's envelope as-is; nothing translates it
// back to a flat shape anymore (see resultEnvelope.test.ts for the
// envelope's own shape validation).

const baseInput: SolveInput = {
  modelId: "p-median-us",
  inputs: {
    p: 3,
    distanceBands: [200, 400, 800, 1600],
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [],
    customerOverrides: [],
    gap: 0,
    timeLimitSec: 120,
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  },
};

const transportInput: SolveInput = {
  modelId: "transport-coal",
  inputs: {
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    capacityFactor: 1.1,
    singleSource: true,
    capacityInactive: false,
    mineCapacities: {},
    stationDemands: {},
  },
};

describe("buildPayload()", () => {
  it("sends modelType=p_median for modelId p-median-us", () => {
    expect(buildPayload(baseInput).modelType).toBe("p_median");
  });

  it("sends modelType=capacitated_pmedian, warehouseCapacity, pValue, singleSource for modelId p-median-brazil", () => {
    const input: SolveInput = {
      modelId: "p-median-brazil",
      inputs: {
        p: 5,
        distanceBands: [500, 1000, 2000, 4000],
        capacityMode: "uniform",
        uniformCapacity: 20000000,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
        singleSource: true,
        addedWarehouses: [],
        addedCustomers: [],
        distanceOverrides: [],
      },
    };
    const payload = buildPayload(input);
    expect(payload.modelType).toBe("capacitated_pmedian");
    expect(payload.warehouseCapacity).toBe(20000000);
    expect(payload.pValue).toBe(5);
    expect(payload.singleSource).toBe(true);
  });

  it("forwards mineCapacities/stationDemands for transport-coal", () => {
    const input: SolveInput = {
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000, 1500, 2000],
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.1,
        singleSource: true,
        capacityInactive: false,
        mineCapacities: { KY: 1000000 },
        stationDemands: { CHI: 12000000 },
      },
    };
    const payload = buildPayload(input);
    expect(payload.mineCapacities).toEqual({ KY: 1000000 });
    expect(payload.stationDemands).toEqual({ CHI: 12000000 });
  });

  it("sends modelType=transport and all transport fields for modelId transport-coal", () => {
    const payload = buildPayload(transportInput);
    expect(payload.modelType).toBe("transport");
    expect(payload.capacityFactor).toBe(1.1);
    expect(payload.singleSource).toBe(true);
    expect(payload.capacityInactive).toBe(false);
  });

  it("translates p-median inputs (pValue, capacity, warehouseOverrides) onto the wire payload", () => {
    const input: SolveInput = {
      modelId: "p-median-us",
      inputs: {
        p: 5,
        distanceBands: [100, 500, 1000],
        capacityMode: "uniform",
        uniformCapacity: 50000000,
        warehouseOverrides: [{ id: "CHI", status: "forced_open" }],
        customerOverrides: [],
        gap: 0.01,
        timeLimitSec: 60,
        addedWarehouses: [],
        addedCustomers: [],
        distanceOverrides: [],
      },
    };

    const payload = buildPayload(input);
    expect(payload.pValue).toBe(5);
    expect(payload.distanceBands).toEqual([100, 500, 1000]);
    expect(payload.uniformCapacity).toBe(50000000);
    expect(payload.warehouseStatuses).toEqual([{ warehouseId: "CHI", status: "forced_open" }]);
    expect(payload.gap).toBe(0.01);
    expect(payload.timeLimitSec).toBe(60);
  });

  it("capacityMode 'none' sends null capacity regardless of a stale uniformCapacity value", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: { ...baseInput.inputs, capacityMode: "none", uniformCapacity: 999 },
    };
    expect(buildPayload(input).uniformCapacity).toBeNull();
  });

  it("excludes only non-active warehouseOverrides from warehouseStatuses", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        warehouseOverrides: [
          { id: "CHI", status: "active" },
          { id: "LA", status: "inactive" },
        ],
      },
    };
    expect(buildPayload(input).warehouseStatuses).toEqual([{ warehouseId: "LA", status: "inactive" }]);
  });

  it("translates excluded customerOverrides into excludedCustomerIds", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "excluded" },
          { id: "C2", status: "active" },
        ],
      },
    };
    expect(buildPayload(input).excludedCustomerIds).toEqual(["C1"]);
  });

  it("translates per-warehouse capacity overrides into warehouseCapacities, omitting entries with no capacity", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        // capacityMode "per_wh" (not baseInput's default "none") — this
        // test is about the override-translation mechanic itself, which
        // only makes sense outside "none" mode (see the task-27 tests
        // below for the "none" interaction).
        capacityMode: "per_wh",
        warehouseOverrides: [
          { id: "CHI", status: "active", capacity: 500000 },
          { id: "LA", status: "forced_open" },
        ],
      },
    };
    expect(buildPayload(input).warehouseCapacities).toEqual({ CHI: 500000 });
  });

  // Task 27: code review found the prior task-24 fix (capacityMode "none"
  // nulls an added warehouse's own capacity) left a matching asymmetry
  // unfixed — base warehouses' per-warehouse capacity overrides
  // (warehouseCapacities, built from i.warehouseOverrides[].capacity) are
  // the closer structural analog to an added warehouse's own capacity
  // field, and were still binding under "none". "none" must mean no
  // per-warehouse capacity constraint reaches solve.py from ANY source:
  // uniform (effectiveCapacity, pre-existing), per-warehouse override
  // (warehouseCapacities, this fix), or added-warehouse's own record
  // (addedWarehouses[].capacity, task 24).
  it("capacityMode 'none' also nulls out per-warehouse capacity overrides (warehouseCapacities empty, not silently binding)", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        capacityMode: "none",
        warehouseOverrides: [
          { id: "CHI", status: "active", capacity: 500000 },
          { id: "LA", status: "forced_open" },
        ],
      },
    };
    expect(buildPayload(input).warehouseCapacities).toEqual({});
  });

  it("capacityMode 'uniform' still forwards per-warehouse capacity overrides as-authored (no regression)", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        capacityMode: "uniform",
        uniformCapacity: 1000000,
        warehouseOverrides: [{ id: "CHI", status: "active", capacity: 500000 }],
      },
    };
    expect(buildPayload(input).warehouseCapacities).toEqual({ CHI: 500000 });
  });

  it("capacityMode 'per_wh' still forwards per-warehouse capacity overrides as-authored (no regression)", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        capacityMode: "per_wh",
        warehouseOverrides: [{ id: "CHI", status: "active", capacity: 500000 }],
      },
    };
    expect(buildPayload(input).warehouseCapacities).toEqual({ CHI: 500000 });
  });

  it("translates per-customer demand overrides into customerDemands, omitting entries with no demand", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "active", demand: 42 },
          { id: "C2", status: "excluded" },
        ],
      },
    };
    expect(buildPayload(input).customerDemands).toEqual({ C1: 42 });
  });

  // Task 24: wire addedWarehouses/addedCustomers/distanceOverrides through to
  // solve.py — merge_inputs.py already reads these by B1.1's exact schema
  // names off `inp.get(..., [])`, so absent/empty is byte-identical to
  // today's behavior; this pins the exact payload shape so a future change
  // can't silently regress the empty/absent case (DD-8's rollback-safety
  // story depends on this staying true).
  it("byte-identical no-regression: full payload for baseInput (empty added*/distanceOverrides) matches the pre-existing shape exactly", () => {
    expect(buildPayload(baseInput)).toEqual({
      modelType: "p_median",
      pValue: 3,
      distanceBands: [200, 400, 800, 1600],
      uniformCapacity: null,
      warehouseCapacity: undefined,
      warehouseCapacities: {},
      customerDemands: {},
      warehouseStatuses: [],
      excludedCustomerIds: [],
      gap: 0,
      timeLimitSec: 120,
      singleSource: undefined,
      addedWarehouses: [],
      addedCustomers: [],
      distanceOverrides: [],
    });
  });

  it("forwards populated addedWarehouses/addedCustomers/distanceOverrides through unchanged (same array contents, same field names)", () => {
    const addedWarehouses = [
      { id: "NEW1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: 100000, status: "active" as const },
    ];
    const addedCustomers = [
      { id: "NEWC1", city: "Boise", state: "ID", lat: 43.6, lng: -116.2, demand: 5000 },
    ];
    const distanceOverrides = [{ fromId: "CHI", toId: "C1", distance: 123.4 }];
    const input: SolveInput = {
      ...baseInput,
      // capacityMode "per_wh" (not baseInput's default "none") so this test
      // exercises plain passthrough, independent of the capacityMode/
      // added-warehouse-capacity interaction covered by its own dedicated
      // tests below.
      inputs: {
        ...baseInput.inputs,
        capacityMode: "per_wh",
        addedWarehouses,
        addedCustomers,
        distanceOverrides,
      },
    };
    const payload = buildPayload(input);
    expect(payload.addedWarehouses).toEqual(addedWarehouses);
    expect(payload.addedCustomers).toEqual(addedCustomers);
    expect(payload.distanceOverrides).toEqual(distanceOverrides);
  });

  it("also forwards addedWarehouses/addedCustomers/distanceOverrides for p-median-brazil (harmless today, ready for B6.3)", () => {
    const addedCustomers = [{ id: "NEWC1", city: "Boise", state: "ID", lat: 43.6, lng: -116.2, demand: 5000 }];
    const input: SolveInput = {
      modelId: "p-median-brazil",
      inputs: {
        p: 5,
        distanceBands: [500, 1000, 2000, 4000],
        capacityMode: "uniform",
        uniformCapacity: 20000000,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
        singleSource: true,
        addedWarehouses: [],
        addedCustomers,
        distanceOverrides: [],
      },
    };
    const payload = buildPayload(input);
    expect(payload.addedCustomers).toEqual(addedCustomers);
  });

  // Product decision (this task): capacityMode is a scenario-wide toggle —
  // "none" strips capacity from BASE warehouses already (see the
  // "capacityMode 'none' sends null capacity..." test above). An added
  // warehouse's own `capacity` field binding regardless of that toggle
  // would make "none" mean "no capacity constraints, except the ones a
  // student just added" — silently inconsistent with the mental model the
  // toggle sells. buildPayload strips added-warehouse capacity to null
  // under capacityMode "none" so the toggle is a real, uniform switch
  // across base AND added warehouses; capacityMode "uniform"/"per_wh" leave
  // it exactly as the student authored it (a warehouse-level fact, not
  // something implied by the global mode).
  it("capacityMode 'none' strips capacity from addedWarehouses before forwarding (consistent with base-warehouse behavior)", () => {
    const addedWarehouses = [
      { id: "NEW1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: 100000, status: "active" as const },
    ];
    const input: SolveInput = {
      ...baseInput,
      inputs: { ...baseInput.inputs, capacityMode: "none", addedWarehouses },
    };
    const payload = buildPayload(input);
    expect(payload.addedWarehouses).toEqual([{ ...addedWarehouses[0], capacity: null }]);
  });

  it("capacityMode 'per_wh' forwards addedWarehouses capacity as-authored", () => {
    const addedWarehouses = [
      { id: "NEW1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: 100000, status: "active" as const },
    ];
    const input: SolveInput = {
      ...baseInput,
      inputs: { ...baseInput.inputs, capacityMode: "per_wh", addedWarehouses },
    };
    const payload = buildPayload(input);
    expect(payload.addedWarehouses).toEqual(addedWarehouses);
  });

  it("buildPayload forwards two-echelon-gold-au inputs to the solver payload", () => {
    const payload = buildPayload({
      modelId: "two-echelon-gold-au",
      inputs: {
        bomRatio: 1.5,
        refineryOverrides: [{ id: "daggar-hills", status: "inactive" }],
        customerOverrides: [{ id: "sydney", demand: 3000000, status: "active" }],
        distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
      },
    });
    expect(payload.modelType).toBe("two_echelon");
    expect(payload.bomRatio).toBe(1.5);
    expect(payload.refineryStatuses).toEqual([{ refineryId: "daggar-hills", status: "inactive" }]);
    expect(payload.customerDemands).toEqual({ sydney: 3000000 });
  });
});
