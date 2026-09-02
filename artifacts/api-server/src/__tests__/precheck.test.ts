import { describe, it, expect } from "vitest";
import {
  precheckPMedianInputs,
  precheckTransportInputs,
  precheckTwoEchelonInputs,
  buildTransportIdSpaces,
  buildTwoEchelonIdSpaces,
  buildActivePMedianIds,
  buildActiveTwoEchelonIds,
  BRAZIL_DATASET,
  TRANSPORT_DATASET,
  TWO_ECHELON_DATASET,
  type PrecheckDataset,
  type TwoEchelonPrecheckDataset,
} from "../services/precheck.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";

// Small fake dataset (not the real 26/200-row p-median-us dataset) — the
// whole point of B2.1's "take the dataset as a parameter" design is that
// precheck logic is testable without the real dataset. WAREHOUSES/CUSTOMERS
// coverage against the real dataset is exercised at the route level
// (routes.test.ts), which uses the real default.
const DATASET: PrecheckDataset = {
  warehouses: [{ id: "WH-A" }, { id: "WH-B" }],
  customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
};

const BASE: PMedianInputs = {
  p: 1,
  capacityMode: "none",
  distanceBands: [100, 300, 600],
  gap: 0.01,
  timeLimitSec: 60,
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("precheckPMedianInputs — B2.1 semantic precheck", () => {
  describe("(a) completeness", () => {
    it("passes when an added warehouse has overrides to every active customer", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        distanceOverrides: [
          { fromId: "WH-09", toId: "C-1", distance: 10 },
          { fromId: "WH-09", toId: "C-2", distance: 20 },
          { fromId: "WH-09", toId: "C-3", distance: 30 },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("produces a structured error listing exactly which customers are missing distances", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        distanceOverrides: [{ fromId: "WH-09", toId: "C-1", distance: 10 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-09 missing distances to 2 customers: C-2, C-3",
      });
    });

    it("an excluded base customer's missing distance does NOT trigger a completeness error", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        customerOverrides: [{ id: "C-3", status: "excluded" }],
        distanceOverrides: [
          { fromId: "WH-09", toId: "C-1", distance: 10 },
          { fromId: "WH-09", toId: "C-2", distance: 20 },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("an inactive added warehouse is not required to have distances (it's not active)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "inactive" }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
    });

    it("a base warehouse requires a distance to an added active customer (vice-versa direction)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [{ id: "C-NEW", city: "Fresno", state: "CA", lat: 36.7, lng: -119.7, demand: 500, status: "active" }],
        distanceOverrides: [{ fromId: "WH-A", toId: "C-NEW", distance: 15 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      // WH-B has no override to C-NEW — must be flagged.
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-B missing distances to 1 customer: C-NEW",
      });
      // WH-A is fully covered — must not be flagged.
      expect(result.errors.some((e) => e.message.startsWith("WH-A"))).toBe(false);
    });
  });

  describe("(b) ID collision", () => {
    it("rejects an added warehouse reusing a real base-dataset ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-A", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added warehouse id 'WH-A' collides with an existing base-dataset warehouse id",
      });
    });

    it("rejects two added warehouses sharing the same ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [
          { id: "WH-DUP", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" },
          { id: "WH-DUP", city: "Boise", state: "ID", lat: 43.6, lng: -116.2, status: "active" },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added warehouse id 'WH-DUP' is duplicated across addedWarehouses",
      });
    });

    it("rejects an added customer reusing a real base-dataset ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [{ id: "C-1", city: "Fresno", state: "CA", lat: 36.7, lng: -119.7, demand: 500, status: "active" }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-1' collides with an existing base-dataset customer id",
      });
    });

    it("rejects two added customers sharing the same ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [
          { id: "C-DUP", city: "Fresno", state: "CA", lat: 36.7, lng: -119.7, demand: 500, status: "active" },
          { id: "C-DUP", city: "Sacramento", state: "CA", lat: 38.6, lng: -121.5, demand: 300, status: "active" },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-DUP' is duplicated across addedCustomers",
      });
    });
  });

  describe("(c) reference integrity", () => {
    it("rejects a distanceOverrides pair whose fromId is unknown", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "WH-GHOST", toId: "C-1", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "distanceOverrides fromId 'WH-GHOST' does not reference a known warehouse (base dataset or this scenario's added warehouses)",
      });
    });

    it("rejects a distanceOverrides pair whose toId is unknown", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "WH-A", toId: "C-GHOST", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "distanceOverrides toId 'C-GHOST' does not reference a known customer (base dataset or this scenario's added customers)",
      });
    });

    it("rejects a pair using a city name instead of a stable ID (not silently misinterpreted)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "Springfield", toId: "C-1", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("rejects a backwards pair (fromId is a customer id, toId is a warehouse id)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "C-1", toId: "WH-A", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("accepts a distanceOverrides pair referencing this scenario's own added entities", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        addedCustomers: [{ id: "C-NEW", city: "Fresno", state: "CA", lat: 36.7, lng: -119.7, demand: 500, status: "active" }],
        distanceOverrides: [{ fromId: "WH-09", toId: "C-NEW", distance: 5 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });
  });

  it("returns ok:true with no errors for a scenario with no network edits at all", () => {
    const result = precheckPMedianInputs(BASE, DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("defaults to the real p-median-us dataset when no dataset argument is given", () => {
    // Any real base-dataset warehouse id (ALN, Allentown PA) collides.
    const inputs: PMedianInputs = {
      ...BASE,
      addedWarehouses: [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6, lng: -75.5, status: "active" }],
    };
    const result = precheckPMedianInputs(inputs);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "id_collision",
      message: "Added warehouse id 'ALN' collides with an existing base-dataset warehouse id",
    });
  });
});

// SCN v0.3 Phase B, task B6.3 — p-median-brazil fast-follow. Same
// precheckPMedianInputs function, same PMedianInputs shape (shared schema),
// just called against BRAZIL_DATASET instead of the p-median-us default —
// proves the "dataset is a parameter" design B2.1 built for exactly this
// works unmodified for a real second model. Uses BRAZIL_DATASET (the real
// 25-warehouse/25-region dataset, precheck.ts's own export) rather than a
// synthetic fixture, since the whole point here is confirming the real
// wiring, not re-testing precheckPMedianInputs' own logic (already covered
// exhaustively above against the small fake DATASET).
describe("precheckPMedianInputs — B6.3 p-median-brazil dataset wiring", () => {
  const BRAZIL_BASE: PMedianInputs = {
    ...BASE,
    // p-median-brazil's own shape (singleSource present, no bearing on
    // precheck itself — precheck only reads the network-edit fields).
    singleSource: true,
  };

  it("returns ok:true with no errors for a Brazil scenario with no network edits", () => {
    const result = precheckPMedianInputs(BRAZIL_BASE, BRAZIL_DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects an added warehouse reusing a real Brazil base-dataset id (ANP, Anápolis)", () => {
    const inputs: PMedianInputs = {
      ...BRAZIL_BASE,
      addedWarehouses: [{ id: "ANP", city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
    };
    const result = precheckPMedianInputs(inputs, BRAZIL_DATASET);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "id_collision",
      message: "Added warehouse id 'ANP' collides with an existing base-dataset warehouse id",
    });
  });

  it("rejects a distanceOverrides pair referencing an unknown Brazil region id", () => {
    const inputs: PMedianInputs = {
      ...BRAZIL_BASE,
      distanceOverrides: [{ fromId: "ANP", toId: "GHOST-REGION", distance: 50 }],
    };
    const result = precheckPMedianInputs(inputs, BRAZIL_DATASET);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "reference_integrity",
      message:
        "distanceOverrides toId 'GHOST-REGION' does not reference a known customer (base dataset or this scenario's added customers)",
    });
  });

  it("flags an added Brazil warehouse missing a distance to an active real region (completeness)", () => {
    const inputs: PMedianInputs = {
      ...BRAZIL_BASE,
      addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
      distanceOverrides: [{ fromId: "WH-09", toId: "SP", distance: 100 }],
    };
    const result = precheckPMedianInputs(inputs, BRAZIL_DATASET);
    expect(result.ok).toBe(false);
    // WH-09 is missing distances to every other real region besides SP.
    expect(result.errors.some((e) => e.code === "completeness" && e.message.startsWith("WH-09"))).toBe(true);
  });

  it("accepts a distanceOverrides pair referencing a scenario's own added Brazil warehouse and region", () => {
    const inputs: PMedianInputs = {
      ...BRAZIL_BASE,
      addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
      addedCustomers: [{ id: "REG-NEW", city: "New Region", state: "XX", lat: -8.0, lng: -48.0, demand: 500, status: "active" }],
      distanceOverrides: [{ fromId: "WH-09", toId: "REG-NEW", distance: 5 }],
    };
    const result = precheckPMedianInputs(inputs, BRAZIL_DATASET);
    expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
  });
});

// SCN v0.3 Phase B, task B6.1 — transport-coal fast-follow. Own function
// (not precheckPMedianInputs) because TransportLpInputs has no
// warehouseOverrides/customerOverrides status arrays at all — mines/
// stations have no forced-open/inactive/excluded concept, so "active"
// trivially means every base + added entity, no status filtering needed.
// Small fake dataset (mirrors the p-median describe block above's own
// convention) for isolated unit coverage; the real TRANSPORT_DATASET
// wiring is exercised separately below.
const TRANSPORT_DATASET_FAKE: PrecheckDataset = {
  warehouses: [{ id: "MN-A" }, { id: "MN-B" }],
  customers: [{ id: "ST-1" }, { id: "ST-2" }, { id: "ST-3" }],
};

const TRANSPORT_BASE: TransportLpInputs = {
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0.01,
  timeLimitSec: 60,
  mineCapacities: {},
  stationDemands: {},
  addedMines: [],
  addedStations: [],
  laneCostOverrides: [],
};

describe("precheckTransportInputs — B6.1 semantic precheck", () => {
  describe("(a) completeness", () => {
    it("passes when an added mine has lane costs to every station", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedMines: [{ id: "MN-09", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5_000_000 }],
        laneCostOverrides: [
          { fromId: "MN-09", toId: "ST-1", cost: 10 },
          { fromId: "MN-09", toId: "ST-2", cost: 20 },
          { fromId: "MN-09", toId: "ST-3", cost: 30 },
        ],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("produces a structured error listing exactly which stations are missing lane costs", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedMines: [{ id: "MN-09", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5_000_000 }],
        laneCostOverrides: [{ fromId: "MN-09", toId: "ST-1", cost: 10 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "MN-09 missing lane costs to 2 stations: ST-2, ST-3",
      });
    });

    it("a base mine requires a lane cost to an added station (vice-versa direction)", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedStations: [{ id: "ST-NEW", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 }],
        laneCostOverrides: [{ fromId: "MN-A", toId: "ST-NEW", cost: 15 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      // MN-B has no override to ST-NEW — must be flagged.
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "MN-B missing lane costs to 1 station: ST-NEW",
      });
      // MN-A is fully covered — must not be flagged.
      expect(result.errors.some((e) => e.message.startsWith("MN-A"))).toBe(false);
    });
  });

  describe("(b) ID collision", () => {
    it("rejects an added mine reusing a real base-dataset ID", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedMines: [{ id: "MN-A", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added mine id 'MN-A' collides with an existing base-dataset mine id",
      });
    });

    it("rejects two added mines sharing the same ID", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedMines: [
          { id: "MN-DUP", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19 },
          { id: "MN-DUP", city: "Beckley", state: "WV", lat: 37.78, lng: -81.19 },
        ],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added mine id 'MN-DUP' is duplicated across addedMines",
      });
    });

    it("rejects an added station reusing a real base-dataset ID", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedStations: [{ id: "ST-1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added station id 'ST-1' collides with an existing base-dataset station id",
      });
    });

    it("rejects two added stations sharing the same ID", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedStations: [
          { id: "ST-DUP", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 },
          { id: "ST-DUP", city: "Sacramento", state: "CA", lat: 38.6, lng: -121.5, demand: 300 },
        ],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added station id 'ST-DUP' is duplicated across addedStations",
      });
    });
  });

  describe("(c) reference integrity", () => {
    it("rejects a laneCostOverrides pair whose fromId is unknown", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        laneCostOverrides: [{ fromId: "MN-GHOST", toId: "ST-1", cost: 50 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "laneCostOverrides fromId 'MN-GHOST' does not reference a known mine (base dataset or this scenario's added mines)",
      });
    });

    it("rejects a laneCostOverrides pair whose toId is unknown", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        laneCostOverrides: [{ fromId: "MN-A", toId: "ST-GHOST", cost: 50 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "laneCostOverrides toId 'ST-GHOST' does not reference a known station (base dataset or this scenario's added stations)",
      });
    });

    it("rejects a backwards pair (fromId is a station id, toId is a mine id)", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        laneCostOverrides: [{ fromId: "ST-1", toId: "MN-A", cost: 50 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("accepts a laneCostOverrides pair referencing this scenario's own added entities", () => {
      const inputs: TransportLpInputs = {
        ...TRANSPORT_BASE,
        addedMines: [{ id: "MN-09", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19 }],
        addedStations: [{ id: "ST-NEW", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 }],
        laneCostOverrides: [{ fromId: "MN-09", toId: "ST-NEW", cost: 5 }],
      };
      const result = precheckTransportInputs(inputs, TRANSPORT_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });
  });

  it("returns ok:true with no errors for a scenario with no network edits at all", () => {
    const result = precheckTransportInputs(TRANSPORT_BASE, TRANSPORT_DATASET_FAKE);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("defaults to the real transport-coal dataset when no dataset argument is given", () => {
    // Any real base-dataset mine id (KY) collides.
    const inputs: TransportLpInputs = {
      ...TRANSPORT_BASE,
      addedMines: [{ id: "KY", city: "Pikeville", state: "KY", lat: 37.54, lng: -82.75 }],
    };
    const result = precheckTransportInputs(inputs);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "id_collision",
      message: "Added mine id 'KY' collides with an existing base-dataset mine id",
    });
  });

  it("returns ok:true with no errors for a real transport-coal scenario with no network edits", () => {
    const result = precheckTransportInputs(TRANSPORT_BASE, TRANSPORT_DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

// Task 30 (B6.1 stage 4) — buildTransportIdSpaces, extracted out of
// precheckTransportInputs so import.ts's new laneCosts entity can reuse the
// exact same id-space rule (mirrors buildPMedianIdSpaces's own test coverage
// below... — see that describe block for the p-median analogue).
describe("buildTransportIdSpaces", () => {
  it("includes base mine/station ids plus any added mines/stations", () => {
    const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces(
      {
        addedMines: [{ id: "MN-NEW" }],
        addedStations: [{ id: "ST-NEW" }],
      },
      TRANSPORT_DATASET_FAKE,
    );
    expect(mineIdSpace).toEqual(new Set(["MN-A", "MN-B", "MN-NEW"]));
    expect(stationIdSpace).toEqual(new Set(["ST-1", "ST-2", "ST-3", "ST-NEW"]));
  });

  it("defaults to base ids only when no added entities are given", () => {
    const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces({}, TRANSPORT_DATASET_FAKE);
    expect(mineIdSpace).toEqual(new Set(["MN-A", "MN-B"]));
    expect(stationIdSpace).toEqual(new Set(["ST-1", "ST-2", "ST-3"]));
  });

  it("defaults to the real transport-coal dataset when no dataset argument is given", () => {
    const { mineIdSpace } = buildTransportIdSpaces({});
    expect(mineIdSpace.has("KY")).toBe(true);
  });
});

// SCN v0.3 Phase B, task B6.2 — two-echelon-gold-au fast-follow. Own
// function (not precheckPMedianInputs/precheckTransportInputs) — a THIRD
// entity type (mine/refinery/customer) and two legs sharing one
// distanceOverrides array, where a pair's leg is resolved by which id-space
// each side belongs to. Small fake dataset (mirrors the p-median/transport
// describe blocks' own convention) for isolated unit coverage; the real
// TWO_ECHELON_DATASET wiring is exercised separately below.
const TWO_ECHELON_DATASET_FAKE: TwoEchelonPrecheckDataset = {
  mines: [{ id: "MINE-A" }],
  refineries: [{ id: "REF-A" }, { id: "REF-B" }],
  customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
};

const TWO_ECHELON_BASE: TwoEchelonInputs = {
  bomRatio: 1.1,
  refineryOverrides: [],
  customerOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0.01,
  timeLimitSec: 60,
  addedRefineries: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("precheckTwoEchelonInputs — B6.2 semantic precheck", () => {
  describe("(a) completeness", () => {
    it("passes when an added refinery has distances from the mine and to every customer", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        distanceOverrides: [
          { fromId: "MINE-A", toId: "REF-09", distance: 10 },
          { fromId: "REF-09", toId: "C-1", distance: 20 },
          { fromId: "REF-09", toId: "C-2", distance: 30 },
          { fromId: "REF-09", toId: "C-3", distance: 40 },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("produces a structured error listing exactly which customers are missing distances", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        distanceOverrides: [
          { fromId: "MINE-A", toId: "REF-09", distance: 10 },
          { fromId: "REF-09", toId: "C-1", distance: 20 },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "REF-09 missing distances to 2 customers: C-2, C-3",
      });
    });

    it("produces a structured error listing exactly which mines are missing distances", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        distanceOverrides: [
          { fromId: "REF-09", toId: "C-1", distance: 20 },
          { fromId: "REF-09", toId: "C-2", distance: 30 },
          { fromId: "REF-09", toId: "C-3", distance: 40 },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "REF-09 missing distances from 1 mine: MINE-A",
      });
    });

    it("an excluded base customer's missing distance does NOT trigger a completeness error", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        customerOverrides: [{ id: "C-3", status: "excluded" }],
        distanceOverrides: [
          { fromId: "MINE-A", toId: "REF-09", distance: 10 },
          { fromId: "REF-09", toId: "C-1", distance: 20 },
          { fromId: "REF-09", toId: "C-2", distance: 30 },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("an inactive added refinery is not required to have distances (it's not active)", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "inactive" }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(true);
    });

    it("a base refinery requires a distance to an added active customer (vice-versa direction)", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedCustomers: [{ id: "C-NEW", city: "Perth", state: "WA", lat: -31, lng: 115, demand: 500, status: "active" }],
        distanceOverrides: [{ fromId: "REF-A", toId: "C-NEW", distance: 15 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      // REF-B has no override to C-NEW — must be flagged.
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "REF-B missing distances to 1 customer: C-NEW",
      });
      // REF-A is fully covered — must not be flagged.
      expect(result.errors.some((e) => e.message.startsWith("REF-A"))).toBe(false);
      // Neither base refinery needs a mine-leg override — only added
      // refineries do.
      expect(result.errors.some((e) => e.message.includes("missing distances from"))).toBe(false);
    });
  });

  describe("(b) ID collision", () => {
    it("rejects an added refinery reusing a real base-dataset refinery ID", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-A", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added refinery id 'REF-A' collides with an existing base-dataset refinery id",
      });
    });

    it("rejects an added refinery reusing the mine's own ID", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "MINE-A", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added refinery id 'MINE-A' collides with the mine id",
      });
    });

    it("rejects two added refineries sharing the same ID", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [
          { id: "REF-DUP", city: "X", state: "WA", lat: -30, lng: 121, status: "active" },
          { id: "REF-DUP", city: "Y", state: "WA", lat: -31, lng: 122, status: "active" },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added refinery id 'REF-DUP' is duplicated across addedRefineries",
      });
    });

    it("rejects an added customer reusing a real base-dataset ID", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedCustomers: [{ id: "C-1", city: "Perth", state: "WA", lat: -31, lng: 115, demand: 500, status: "active" }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-1' collides with an existing base-dataset customer id",
      });
    });

    it("rejects two added customers sharing the same ID", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedCustomers: [
          { id: "C-DUP", city: "Perth", state: "WA", lat: -31, lng: 115, demand: 500, status: "active" },
          { id: "C-DUP", city: "Adelaide", state: "SA", lat: -34, lng: 138, demand: 300, status: "active" },
        ],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-DUP' is duplicated across addedCustomers",
      });
    });
  });

  describe("(c) reference integrity", () => {
    it("rejects a distanceOverrides pair whose fromId/toId are both unknown", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        distanceOverrides: [{ fromId: "GHOST-1", toId: "GHOST-2", distance: 50 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "distanceOverrides pair (fromId 'GHOST-1', toId 'GHOST-2') does not resolve as a mine->refinery leg or a refinery->customer leg (base dataset or this scenario's added refineries/customers)",
      });
    });

    it("rejects a backwards pair (fromId is a customer id, toId is a refinery id)", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        distanceOverrides: [{ fromId: "C-1", toId: "REF-A", distance: 50 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("rejects a pair skipping a leg entirely (mine -> customer directly)", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        distanceOverrides: [{ fromId: "MINE-A", toId: "C-1", distance: 50 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("accepts a mine->refinery leg pair referencing a base mine and an added refinery", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        distanceOverrides: [{ fromId: "MINE-A", toId: "REF-09", distance: 5 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });

    it("accepts a refinery->customer leg pair referencing this scenario's own added entities", () => {
      const inputs: TwoEchelonInputs = {
        ...TWO_ECHELON_BASE,
        addedRefineries: [{ id: "REF-09", city: "X", state: "WA", lat: -30, lng: 121, status: "active" }],
        addedCustomers: [{ id: "C-NEW", city: "Perth", state: "WA", lat: -31, lng: 115, demand: 500, status: "active" }],
        distanceOverrides: [{ fromId: "REF-09", toId: "C-NEW", distance: 5 }],
      };
      const result = precheckTwoEchelonInputs(inputs, TWO_ECHELON_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });
  });

  it("returns ok:true with no errors for a scenario with no network edits at all", () => {
    const result = precheckTwoEchelonInputs(TWO_ECHELON_BASE, TWO_ECHELON_DATASET_FAKE);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("defaults to the real two-echelon-gold-au dataset when no dataset argument is given", () => {
    // Any real base-dataset refinery id (cunnamulla) collides.
    const inputs: TwoEchelonInputs = {
      ...TWO_ECHELON_BASE,
      addedRefineries: [{ id: "cunnamulla", city: "X", state: "QLD", lat: 0, lng: 0, status: "active" }],
    };
    const result = precheckTwoEchelonInputs(inputs);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "id_collision",
      message: "Added refinery id 'cunnamulla' collides with an existing base-dataset refinery id",
    });
  });

  it("returns ok:true with no errors for a real two-echelon-gold-au scenario with no network edits", () => {
    const result = precheckTwoEchelonInputs(TWO_ECHELON_BASE, TWO_ECHELON_DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe("buildTwoEchelonIdSpaces", () => {
  it("includes base mine/refinery/customer ids plus any added refineries/customers", () => {
    const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces(
      {
        addedRefineries: [{ id: "REF-NEW" }],
        addedCustomers: [{ id: "C-NEW" }],
      },
      TWO_ECHELON_DATASET_FAKE,
    );
    expect(mineIdSpace).toEqual(new Set(["MINE-A"]));
    expect(refineryIdSpace).toEqual(new Set(["REF-A", "REF-B", "REF-NEW"]));
    expect(customerIdSpace).toEqual(new Set(["C-1", "C-2", "C-3", "C-NEW"]));
  });

  it("defaults to base ids only when no added entities are given", () => {
    const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces({}, TWO_ECHELON_DATASET_FAKE);
    expect(mineIdSpace).toEqual(new Set(["MINE-A"]));
    expect(refineryIdSpace).toEqual(new Set(["REF-A", "REF-B"]));
    expect(customerIdSpace).toEqual(new Set(["C-1", "C-2", "C-3"]));
  });

  it("defaults to the real two-echelon-gold-au dataset when no dataset argument is given", () => {
    const { mineIdSpace } = buildTwoEchelonIdSpaces({});
    expect(mineIdSpace.has("kalgoorlie")).toBe(true);
  });
});

// Bundle 2.2 (B2.2-T1, A3 backend) — an added customer's own `status` is
// only honored as an "active" filter when the model's manifest capability
// supportsAddedCustomerExclusion is true (real manifests via the model
// registry — p-median-us/two-echelon-gold-au true, p-median-brazil false).
// This describes buildActivePMedianIds/buildActiveTwoEchelonIds directly
// (not just through precheckPMedianInputs/precheckTwoEchelonInputs) since
// those are what B4.3's export stub-generator and autoDistance.ts also
// consume — the gate has to hold at the shared-helper level, not just at
// the precheck-function level.
describe("buildActivePMedianIds / buildActiveTwoEchelonIds — B2.2-T1 added-customer exclusion capability gate", () => {
  it("p-median-us (real dataset, capability true): an excluded added customer is NOT counted active", () => {
    const { activeCustomerIds } = buildActivePMedianIds({
      addedCustomers: [{ id: "C-NEW", status: "excluded" }],
    });
    expect(activeCustomerIds).not.toContain("C-NEW");
  });

  it("p-median-us (real dataset, capability true): an active (or default) added customer IS counted active", () => {
    const { activeCustomerIds } = buildActivePMedianIds({
      addedCustomers: [{ id: "C-NEW", status: "active" }],
    });
    expect(activeCustomerIds).toContain("C-NEW");
  });

  it("p-median-brazil (real BRAZIL_DATASET, capability false): an excluded added customer is STILL counted active", () => {
    const { activeCustomerIds } = buildActivePMedianIds(
      { addedCustomers: [{ id: "REG-NEW", status: "excluded" }] },
      BRAZIL_DATASET,
    );
    expect(activeCustomerIds).toContain("REG-NEW");
  });

  it("two-echelon-gold-au (real TWO_ECHELON_DATASET, capability true): an excluded added customer is NOT counted active", () => {
    const { activeCustomerIds } = buildActiveTwoEchelonIds(
      { addedCustomers: [{ id: "perth", status: "excluded" }] },
      TWO_ECHELON_DATASET,
    );
    expect(activeCustomerIds).not.toContain("perth");
  });

  it("two-echelon-gold-au (real TWO_ECHELON_DATASET, capability true): an active added customer IS counted active", () => {
    const { activeCustomerIds } = buildActiveTwoEchelonIds(
      { addedCustomers: [{ id: "perth", status: "active" }] },
      TWO_ECHELON_DATASET,
    );
    expect(activeCustomerIds).toContain("perth");
  });

  it("a fake dataset omitting supportsAddedCustomerExclusion (e.g. TWO_ECHELON_DATASET_FAKE) never filters, matching pre-Bundle-2.2 behavior", () => {
    const { activeCustomerIds } = buildActiveTwoEchelonIds(
      { addedCustomers: [{ id: "C-NEW", status: "excluded" }] },
      TWO_ECHELON_DATASET_FAKE,
    );
    expect(activeCustomerIds).toContain("C-NEW");
  });
});

// Bundle 2.2 (B2.2-T1) — the full precheck-function level Brazil-negative
// case (review-mandated): an added Brazil customer marked "excluded" must
// still be required to have complete distance coverage — i.e. precheck
// treats it as active, matching buildActivePMedianIds' own gated behavior
// above, and matching the fact that Brazil's solver serves it regardless.
describe("precheckPMedianInputs — B2.2-T1 Brazil-negative added-customer exclusion", () => {
  it("a Brazil added customer marked excluded is still required to have distances to every active warehouse (still 'active')", () => {
    const inputs: PMedianInputs = {
      ...BASE,
      singleSource: true,
      addedCustomers: [
        { id: "REG-NEW", city: "New Region", state: "XX", lat: -8.0, lng: -48.0, demand: 500, status: "excluded" },
      ],
      // Deliberately no distanceOverrides for REG-NEW — if it were treated
      // as inactive/excluded (like p-median-us would), this would pass with
      // no completeness error. Since Brazil doesn't honor the capability,
      // it must still be flagged as missing.
    };
    const result = precheckPMedianInputs(inputs, BRAZIL_DATASET);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "completeness" && e.message.includes("REG-NEW"))).toBe(true);
  });
});
