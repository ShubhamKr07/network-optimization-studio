import { describe, it, expect } from "vitest";
import {
  precheckPMedianInputs,
  precheckTransportInputs,
  precheckTwoEchelonInputs,
  precheckJadeInputs,
  precheckMaxCoverageInputs,
  runNetworkEditsPrecheckForModel,
  buildTransportIdSpaces,
  buildTwoEchelonIdSpaces,
  buildActivePMedianIds,
  buildActiveTwoEchelonIds,
  buildActiveJadeIds,
  BRAZIL_DATASET,
  TRANSPORT_DATASET,
  TWO_ECHELON_DATASET,
  JADE_DATASET,
  MAX_COVERAGE_DATASET,
  type PrecheckDataset,
  type TwoEchelonPrecheckDataset,
  type JadePrecheckDataset,
  type MaxCoveragePrecheckDataset,
} from "../services/precheck.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";
import { JADE_RATE_MAX, JADE_MIN_CHARGE_MAX } from "../validation/inputs/jadeInputs.js";
import type { JadeInputs } from "../validation/inputs/jadeInputs.js";
import type { MaxCoverageInputs } from "../validation/inputs/maxCoverage.js";

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

// jade-T6 — semantic precheck for two-echelon-jade-us. Small fake dataset,
// same "take the dataset as a parameter" testability precedent as every
// other model above. Product ids are the real 4 canonical ids (not
// arbitrary fake ones) because addedCustomerSchema (jadeInputs.ts) requires
// EXACTLY those 4 keys regardless of what fake dataset a test passes to
// precheckJadeInputs — the schema's product-id set isn't parameterized by
// the dataset argument, so a fake dataset with a different product-id set
// would force every addedCustomers fixture to violate its own type.
const JADE_DATASET_FAKE: JadePrecheckDataset = {
  plants: [{ id: "PLANT-A" }, { id: "PLANT-B" }],
  warehouses: [{ id: "WH-A" }, { id: "WH-B" }],
  customers: [
    { id: "C-1", demands: { "product-1": 100, "product-2": 0, "product-3": 0, "product-4": 0 } },
    { id: "C-2", demands: { "product-1": 0, "product-2": 50, "product-3": 0, "product-4": 0 } },
  ],
  productIds: ["product-1", "product-2", "product-3", "product-4"],
  capabilityCells: [
    { plantId: "PLANT-A", productId: "product-1", capacity: 1000 },
    { plantId: "PLANT-A", productId: "product-2", capacity: 1000 },
    { plantId: "PLANT-B", productId: "product-1", capacity: 0 },
    { plantId: "PLANT-B", productId: "product-2", capacity: 0 },
    // product-3/product-4 have NO enabled plant anywhere in the base data —
    // deliberately, so the capacity check has a real failure case to catch.
    { plantId: "PLANT-A", productId: "product-3", capacity: 0 },
    { plantId: "PLANT-A", productId: "product-4", capacity: 0 },
    { plantId: "PLANT-B", productId: "product-3", capacity: 0 },
    { plantId: "PLANT-B", productId: "product-4", capacity: 0 },
  ],
};

const JADE_BASE: JadeInputs = {
  p: 1,
  distanceBands: [200, 400, 800, 1600],
  gap: 0.01,
  timeLimitSec: 60,
  warehouseOverrides: [],
  customerOverrides: [],
  plantProductCapability: [],
  addedPlants: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("precheckJadeInputs — jade-T6 semantic precheck", () => {
  it("returns ok:true with no errors for a scenario with no network edits at all", () => {
    const result = precheckJadeInputs(JADE_BASE, JADE_DATASET_FAKE);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("returns ok:true with no errors for a real two-echelon-jade-us scenario with no network edits", () => {
    const result = precheckJadeInputs(JADE_BASE, JADE_DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  describe("(d) completeness — both legs", () => {
    it("blocks with a completeness cause when an added warehouse is missing plant-leg distances", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedWarehouses: [{ id: "WH-09", city: "X", state: "NV", lat: 1, lng: 2, status: "active" }],
        distanceOverrides: [
          { leg: "warehouse_to_customer", fromId: "WH-09", toId: "C-1", distance: 5 },
          { leg: "warehouse_to_customer", fromId: "WH-09", toId: "C-2", distance: 5 },
          // No plant_to_warehouse rows at all for WH-09.
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-09 missing distances from 2 plants: PLANT-A, PLANT-B",
      });
    });

    it("passes when an added warehouse has distances from every plant and to every customer", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedWarehouses: [{ id: "WH-09", city: "X", state: "NV", lat: 1, lng: 2, status: "active" }],
        distanceOverrides: [
          { leg: "plant_to_warehouse", fromId: "PLANT-A", toId: "WH-09", distance: 10 },
          { leg: "plant_to_warehouse", fromId: "PLANT-B", toId: "WH-09", distance: 20 },
          { leg: "warehouse_to_customer", fromId: "WH-09", toId: "C-1", distance: 5 },
          { leg: "warehouse_to_customer", fromId: "WH-09", toId: "C-2", distance: 5 },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("a base warehouse requires a distance from an added plant (vice-versa direction, plant leg)", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedPlants: [{ id: "PLANT-NEW", city: "X", state: "NV", lat: 1, lng: 2 }],
        distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "PLANT-NEW", toId: "WH-A", distance: 5 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-B missing distances from 1 plant: PLANT-NEW",
      });
      expect(result.errors.some((e) => e.message.startsWith("WH-A"))).toBe(false);
    });

    it("a base warehouse requires a distance to an added customer (vice-versa direction, customer leg)", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedCustomers: [
          {
            id: "C-NEW",
            city: "Fresno",
            state: "CA",
            lat: 36.7,
            lng: -119.7,
            demands: { "product-1": 5, "product-2": 0, "product-3": 0, "product-4": 0 },
            status: "active",
          },
        ],
        distanceOverrides: [{ leg: "warehouse_to_customer", fromId: "WH-A", toId: "C-NEW", distance: 15 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-B missing distances to 1 customer: C-NEW",
      });
      expect(result.errors.some((e) => e.message.startsWith("WH-A"))).toBe(false);
    });

    it("an inactive added warehouse is not required to have distances (it's not active)", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedWarehouses: [{ id: "WH-09", city: "X", state: "NV", lat: 1, lng: 2, status: "inactive" }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(true);
    });

    it("an excluded base customer's missing distance does NOT trigger a completeness error", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedWarehouses: [{ id: "WH-09", city: "X", state: "NV", lat: 1, lng: 2, status: "active" }],
        customerOverrides: [{ id: "C-2", status: "excluded" }],
        distanceOverrides: [
          { leg: "plant_to_warehouse", fromId: "PLANT-A", toId: "WH-09", distance: 10 },
          { leg: "plant_to_warehouse", fromId: "PLANT-B", toId: "WH-09", distance: 20 },
          { leg: "warehouse_to_customer", fromId: "WH-09", toId: "C-1", distance: 5 },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("(a) ID collision — global across all three added entity types", () => {
    it("rejects an added plant id colliding with a base warehouse id", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedPlants: [{ id: "WH-A", city: "X", state: "NV", lat: 1, lng: 2 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added plant id 'WH-A' collides with an existing base-dataset id",
      });
    });

    it("rejects an added warehouse id colliding with an added customer id from the same scenario", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedWarehouses: [{ id: "NEW-1", city: "X", state: "NV", lat: 1, lng: 2, status: "active" }],
        addedCustomers: [
          {
            id: "NEW-1",
            city: "Y",
            state: "NV",
            lat: 3,
            lng: 4,
            demands: { "product-1": 1, "product-2": 0, "product-3": 0, "product-4": 0 },
            status: "active",
          },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "id_collision" && e.message.includes("NEW-1"))).toBe(true);
    });

    it("rejects two added plants sharing the same ID", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedPlants: [
          { id: "PLANT-DUP", city: "X", state: "NV", lat: 1, lng: 2 },
          { id: "PLANT-DUP", city: "Y", state: "NV", lat: 3, lng: 4 },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added plant id 'PLANT-DUP' is duplicated across added entities (already used by an added plant)",
      });
    });
  });

  describe("(b) known product ids", () => {
    it("rejects a customerOverrides demand key that isn't a known product id", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        customerOverrides: [{ id: "C-1", status: "active", demands: { "product-99": 10 } }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message: "customerOverrides for 'C-1' has a demand entry for unknown product id 'product-99'",
      });
    });
  });

  describe("(c) reference integrity — leg vs. actual endpoint roles", () => {
    it("rejects a distanceOverrides pair whose leg doesn't match its endpoints' actual roles", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "WH-A", toId: "C-1", distance: 10 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("rejects a warehouse_to_customer pair whose fromId is actually a plant", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        distanceOverrides: [{ leg: "warehouse_to_customer", fromId: "PLANT-A", toId: "C-1", distance: 10 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("accepts a plant_to_warehouse pair referencing an added plant and a base warehouse", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        addedPlants: [{ id: "PLANT-NEW", city: "X", state: "NV", lat: 1, lng: 2 }],
        distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "PLANT-NEW", toId: "WH-A", distance: 5 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });
  });

  describe("(e) p range — forced_open <= p <= active warehouse count", () => {
    it("blocks when p is less than the forced-open warehouse count", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        p: 1,
        warehouseOverrides: [
          { id: "WH-A", status: "forced_open" },
          { id: "WH-B", status: "forced_open" },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "p_range",
        message: "p (1) is less than the number of forced-open warehouses (2)",
      });
    });

    it("blocks when p exceeds the active warehouse count", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        p: 5,
        warehouseOverrides: [{ id: "WH-B", status: "inactive" }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "p_range",
        message: "p (5) exceeds the number of active warehouses (1)",
      });
    });

    it("passes when p is within [forced_open, active warehouse count]", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        p: 2,
        warehouseOverrides: [{ id: "WH-A", status: "forced_open" }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "p_range")).toBe(false);
    });
  });

  describe("(f) plant capacity — enabled capacity vs. effective demand per product", () => {
    it("blocks, naming the specific product, when it has demand but no enabled plant capacity", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        customerOverrides: [{ id: "C-1", status: "active", demands: { "product-3": 40 } }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "capacity",
        message: "product-3 has effective demand 40 but only 0 enabled plant capacity",
      });
    });

    it("does not flag a product with zero effective demand even though no plant can make it", () => {
      // product-4 has 0 demand everywhere in JADE_BASE and no override adds any.
      const result = precheckJadeInputs(JADE_BASE, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "capacity" && e.message.startsWith("product-4"))).toBe(false);
    });

    it("a plantProductCapability override enabling an off-diagonal cell resolves an otherwise-blocked product", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        customerOverrides: [{ id: "C-1", status: "active", demands: { "product-3": 40 } }],
        plantProductCapability: [{ plantId: "PLANT-A", productId: "product-3", enabled: true }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "capacity")).toBe(false);
    });

    it("an added plant defaults every capability cell to disabled — it does not resolve a capacity gap on its own", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        customerOverrides: [{ id: "C-1", status: "active", demands: { "product-3": 40 } }],
        addedPlants: [{ id: "PLANT-NEW", city: "X", state: "NV", lat: 1, lng: 2 }],
        distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "PLANT-NEW", toId: "WH-A", distance: 5 }, { leg: "plant_to_warehouse", fromId: "PLANT-NEW", toId: "WH-B", distance: 5 }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "capacity" && e.message.startsWith("product-3"))).toBe(true);
    });

    it("an excluded customer's demand does not count toward the capacity requirement", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        customerOverrides: [{ id: "C-1", status: "excluded", demands: { "product-3": 40 } }],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "capacity")).toBe(false);
    });
  });

  // ch9-tc-3 — (g) coefficient_range: every individual number can be finite
  // and within its own schema bounds while the objective's own PRODUCT
  // (rate x distance, or outbound-cost x demand) is not. The implementation
  // review's own finding: a scenario with no transportCosts override at all
  // can still overflow, because the textbook 0.12 $/ton-mi default times a
  // huge-but-finite override is itself non-finite.
  describe("(g) coefficient_range — cross-field finite-product guard", () => {
    const MAX_RATES = {
      icTransCost: JADE_RATE_MAX,
      icMinTrans: JADE_MIN_CHARGE_MAX,
      obTransCost: JADE_RATE_MAX,
      obMinTrans: JADE_MIN_CHARGE_MAX,
    };

    it("rejects huge finite distance x demand arithmetic before solve dispatch", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        transportCosts: { icTransCost: 0.07, icMinTrans: 10, obTransCost: 10, obMinTrans: 10 },
        addedCustomers: [
          {
            id: "C-HUGE", city: "X", state: "NV", lat: 1, lng: 2,
            demands: { "product-1": 1e308, "product-2": 0, "product-3": 0, "product-4": 0 },
            status: "active",
          },
        ],
        // Completeness requires a distance from every active (base)
        // warehouse to this added customer (the "vice versa" direction).
        distanceOverrides: [
          { leg: "warehouse_to_customer", fromId: "WH-A", toId: "C-HUGE", distance: 1e100 },
          { leg: "warehouse_to_customer", fromId: "WH-B", toId: "C-HUGE", distance: 1e100 },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "coefficient_range" }),
      ]));
    });

    it("accepts the measured baseline and scalar maxima when every derived coefficient is finite", () => {
      const inputs: JadeInputs = { ...JADE_BASE, transportCosts: MAX_RATES };
      // Real two-echelon-jade-us dataset + reference distances, not the
      // small fake — proves getReferenceDistances wiring doesn't false-
      // positive against real distances/demands even at the scalar maxima.
      const result = precheckJadeInputs(inputs, JADE_DATASET);
      expect(result.errors.filter((e) => e.code === "coefficient_range")).toEqual([]);
    });

    it("fires with NO transportCosts at all — the hazard predates this feature", () => {
      const inputs: JadeInputs = {
        ...JADE_BASE,
        // transportCosts omitted entirely: the textbook 0.12 $/ton-mi
        // default still overflows against these overrides.
        addedCustomers: [
          {
            id: "C-HUGE2", city: "X", state: "NV", lat: 1, lng: 2,
            demands: { "product-1": 1e308, "product-2": 0, "product-3": 0, "product-4": 0 },
            status: "active",
          },
        ],
        distanceOverrides: [
          { leg: "warehouse_to_customer", fromId: "WH-A", toId: "C-HUGE2", distance: 1e100 },
          { leg: "warehouse_to_customer", fromId: "WH-B", toId: "C-HUGE2", distance: 1e100 },
        ],
      };
      const result = precheckJadeInputs(inputs, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "coefficient_range")).toBe(true);
    });

    it("does not fire on ordinary finite inputs with no network edits", () => {
      const result = precheckJadeInputs(JADE_BASE, JADE_DATASET_FAKE);
      expect(result.errors.some((e) => e.code === "coefficient_range")).toBe(false);
    });
  });
});

describe("buildActiveJadeIds — jade-T6", () => {
  it("every base and added plant is always active — plants have no status/override concept in this model", () => {
    const result = buildActiveJadeIds({ addedPlants: [{ id: "PLANT-NEW" }] }, JADE_DATASET_FAKE);
    expect(result.activePlantIds.sort()).toEqual(["PLANT-A", "PLANT-B", "PLANT-NEW"].sort());
  });
});

// ---------------------------------------------------------------------------
// C4.8 — Chapter 4 (max-coverage-us) semantic precheck. Small fake dataset
// (not the real 26/200-row package) so the coverage/min-distance thresholds
// are testable in isolation — same design as every other model's precheck
// fixtures. §2.1: distances are RAW MILES and ARE the effective distance — no
// circuity factor anywhere. Chosen so the baseline is feasible and C-3 is
// reachable by exactly one warehouse (WH-C), giving inactivate/override edits
// a single clean lever.
//   raw ≤ threshold (no multiplier):
//     highServiceDistMi 500
//     maxDistMi        1000
const MAX_COVERAGE_DATASET_FAKE: MaxCoveragePrecheckDataset = {
  warehouses: [{ id: "WH-A" }, { id: "WH-B" }, { id: "WH-C" }],
  customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
  supportsAddedCustomerExclusion: true,
  customerDemands: { "C-1": 100, "C-2": 200, "C-3": 300 },
  baseDistanceMi: {
    "WH-A|C-1": 100, "WH-A|C-2": 300, "WH-A|C-3": 1100,
    "WH-B|C-1": 200, "WH-B|C-2": 100, "WH-B|C-3": 1150,
    "WH-C|C-1": 800, "WH-C|C-2": 850, "WH-C|C-3": 300,
  },
};

// CH4O-5 — a ZERO floor is coverage mode (§2.3); the cap is required in both
// modes (§2.4). `objective` is server-derived and deliberately absent here:
// precheck must never read it.
// CH4O-6 — avgServiceDistCapMi is deliberately slack (100_000, far above any
// plausible nearest-active-warehouse weighted average against either
// MAX_COVERAGE_DATASET_FAKE or the real dataset): the cap rule is a
// necessary-condition check that ignores maxDistMi by design, so a tight
// default here co-fires with any test that inactivates a warehouse or
// overrides a distance past maxDistMi (both bounds can legitimately break
// together) and obscures what that test is actually asserting. Tests that
// want to exercise the cap itself override this field explicitly downward
// (see the "infeasibility attribution" describe block below).
const MAX_COVERAGE_BASE_COVERAGE: MaxCoverageInputs = {
  p: 2,
  highServiceDistMi: 500,
  maxDistMi: 1000,
  avgServiceDistCapMi: 100_000,
  coverageFloorDemand: 0,
  gap: 0.01,
  timeLimitSec: 60,
  capacityMode: "none",
  distanceBands: [500, 1000],
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

// A POSITIVE floor is what makes this min-distance mode — the cap is carried
// over from the base because it binds here too.
const MAX_COVERAGE_BASE_MIN_DISTANCE: MaxCoverageInputs = {
  ...MAX_COVERAGE_BASE_COVERAGE,
  coverageFloorDemand: 100,
};

const addedCustomer = (over: Partial<MaxCoverageInputs["addedCustomers"][number]> = {}) => ({
  id: "C-NEW",
  city: "New City",
  state: "",
  lat: 30,
  lng: 110,
  demand: 400,
  status: "active" as const,
  ...over,
});

const addedWarehouse = (over: Partial<MaxCoverageInputs["addedWarehouses"][number]> = {}) => ({
  id: "WH-NEW",
  city: "New WH",
  state: "",
  lat: 31,
  lng: 111,
  status: "active" as const,
  ...over,
});

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe("precheckMaxCoverageInputs — C4.8 semantic precheck", () => {
  it("returns ok:true for a coverage scenario with no network edits (fake dataset)", () => {
    expect(precheckMaxCoverageInputs(MAX_COVERAGE_BASE_COVERAGE, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });
  });

  it("returns ok:true for a min_distance scenario with no network edits (fake dataset)", () => {
    expect(precheckMaxCoverageInputs(MAX_COVERAGE_BASE_MIN_DISTANCE, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });
  });

  it("returns ok:true for a real max-coverage-us coverage scenario with no network edits (default dataset)", () => {
    // Uses the real MAX_COVERAGE_DATASET default: every one of the 200
    // customers has a warehouse within maxDistMi (the coverage golden is
    // feasible at maxDistMi 5000), so no_feasible_route never fires.
    const inputs: MaxCoverageInputs = {
      ...MAX_COVERAGE_BASE_COVERAGE,
      p: 3,
      highServiceDistMi: 600,
      maxDistMi: 5000,
      distanceBands: [600, 5000],
    };
    expect(precheckMaxCoverageInputs(inputs)).toEqual({ ok: true, errors: [] });
  });

  describe("zero_demand", () => {
    it("fires when a demand override zeroes every active customer's demand", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        customerOverrides: [
          { id: "C-1", status: "active", demand: 0 },
          { id: "C-2", status: "active", demand: 0 },
          { id: "C-3", status: "active", demand: 0 },
        ],
      };
      const result = precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(["zero_demand"]);
    });

    it("fires when every customer is excluded (empty active set)", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        customerOverrides: [
          { id: "C-1", status: "excluded" },
          { id: "C-2", status: "excluded" },
          { id: "C-3", status: "excluded" },
        ],
      };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["zero_demand"]);
    });
  });

  describe("no_feasible_route (maxDistMi, §2.1: raw miles, no circuity)", () => {
    it("fires when an inactive-warehouse edit strands a customer beyond maxDistMi", () => {
      // WH-C is C-3's ONLY reachable warehouse (WH-A 1100 > 1000, WH-B
      // 1150 > 1000). Inactivating it leaves C-3 unreachable.
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        warehouseOverrides: [{ id: "WH-C", status: "inactive" }],
      };
      const result = precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(["no_feasible_route"]);
      expect(result.errors[0].message).toContain("C-3");
    });

    it("fires when a distance override pushes a customer's only route past maxDistMi", () => {
      // 1100 > 1000. C-3's other base routes are already too far.
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        distanceOverrides: [{ fromId: "WH-C", toId: "C-3", distance: 1100 }],
      };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["no_feasible_route"]);
    });

    it("compares raw miles directly with no circuity multiplier: exactly at maxDistMi passes, one mile over fails", () => {
      // MIG-6: precheck must mirror solve_max_coverage exactly — raw ≤
      // threshold, nothing else. WH-C→C-3 at exactly maxDistMi (1000) is
      // reachable; bumping it 1 km over makes it unreachable.
      const atBoundary: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        p: 1,
        distanceOverrides: [{ fromId: "WH-C", toId: "C-3", distance: 1000 }],
        warehouseOverrides: [{ id: "WH-A", status: "inactive" }, { id: "WH-B", status: "inactive" }],
      };
      expect(precheckMaxCoverageInputs(atBoundary, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });

      const overBoundary: MaxCoverageInputs = {
        ...atBoundary,
        distanceOverrides: [{ fromId: "WH-C", toId: "C-3", distance: 1000.01 }],
      };
      expect(codes(precheckMaxCoverageInputs(overBoundary, MAX_COVERAGE_DATASET_FAKE))).toEqual(["no_feasible_route"]);
    });
  });

  describe("coverage_floor_infeasible (positive floor only, highServiceDistMi, §2.1: raw miles, no circuity)", () => {
    it("fires when excluding a customer drops coverable demand below coverageFloorDemand", () => {
      // Baseline coverable = 600 (all three within highServiceDistMi, raw).
      // Floor 350 is fine at baseline; excluding C-3 (demand 300) drops
      // coverable to 300 < 350.
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_MIN_DISTANCE,
        coverageFloorDemand: 350,
        customerOverrides: [{ id: "C-3", status: "excluded" }],
      };
      const result = precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(["coverage_floor_infeasible"]);
    });

    it("fires when a demand override lowers coverable demand below coverageFloorDemand", () => {
      // Floor 550 ≤ baseline coverable 600. Zeroing C-3's demand drops
      // coverable to 300 < 550 (C-3 stays coverable but contributes 0).
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_MIN_DISTANCE,
        coverageFloorDemand: 550,
        customerOverrides: [{ id: "C-3", status: "active", demand: 0 }],
      };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["coverage_floor_infeasible"]);
    });

    it("does NOT fire on a ZERO floor (coverage mode) however small coverable demand gets", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        customerOverrides: [{ id: "C-3", status: "excluded" }],
      };
      // Excluding C-3 with a zero floor is fine — 0 can never exceed coverable
      // demand, and C-1/C-2 still have demand and routes.
      expect(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });
    });

    it("fires on a positive floor even when a STALE objective: coverage is carried alongside it", () => {
      // CH4O-5 — the rule no longer gates on `objective`, because `objective`
      // is DERIVED from this very field: gating on it would make the rule
      // depend on its own output, and a persisted row written before the
      // derivation landed can carry an `objective` that disagrees with its
      // floor. Baseline coverable demand at highServiceDistMi 500 (raw) is
      // 100+200+300=600, so 999999 exceeds it by a wide margin.
      const inputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        objective: "coverage" as const,
        coverageFloorDemand: 999999,
      } as MaxCoverageInputs;
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["coverage_floor_infeasible"]);
    });
  });

  describe("p_range (reused, D18)", () => {
    it("fires when p exceeds the active candidate count", () => {
      const inputs: MaxCoverageInputs = { ...MAX_COVERAGE_BASE_COVERAGE, p: 5 };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["p_range"]);
    });

    it("fires when the forced-open count exceeds p", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        p: 1,
        warehouseOverrides: [
          { id: "WH-A", status: "forced_open" },
          { id: "WH-B", status: "forced_open" },
        ],
      };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toContain("p_range");
    });
  });

  describe("structural checks (reused from p-median)", () => {
    it("id_collision — an added warehouse id colliding with a base id", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        addedWarehouses: [addedWarehouse({ id: "WH-A", status: "inactive" })],
      };
      // The collision also makes the shared p-median completeness loop treat
      // base WH-A as "added" (it's in the addedWarehouseIds set), a benign
      // secondary error — the point here is that id_collision fires.
      const result = precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("id_collision");
    });

    it("completeness — an active added entity missing its distance overrides", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        addedCustomers: [addedCustomer()],
      };
      const result = precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("completeness");
    });

    it("reference_integrity — a distanceOverrides fromId that is not a warehouse", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_COVERAGE,
        distanceOverrides: [{ fromId: "C-1", toId: "C-2", distance: 50 }],
      };
      expect(codes(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE))).toEqual(["reference_integrity"]);
    });
  });
});

// CH4O-6 — avg_distance_cap_infeasible. These exercise
// runNetworkEditsPrecheckForModel against the REAL default max-coverage-us
// dataset (not MAX_COVERAGE_DATASET_FAKE) per the task-6 brief.
describe("max-coverage-us — infeasibility attribution", () => {
  it("names the cap when it is below the nearest-warehouse lower bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 0, avgServiceDistCapMi: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("avg_distance_cap_infeasible");
  });

  it("names the floor when it exceeds coverable demand", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 500_100_100,
    });
    expect(res.errors.map((e) => e.code)).toContain("coverage_floor_infeasible");
  });

  // The regression guard for the contradiction review found: with the cap check
  // in solve.py this was unreachable, because precheck short-circuits before
  // Python runs, so a both-violating scenario was attributed to the floor alone.
  it("names BOTH when both bounds are violated", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 500_100_100, avgServiceDistCapMi: 1,
    });
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain("coverage_floor_infeasible");
    expect(codes).toContain("avg_distance_cap_infeasible");
  });

  it("passes a scenario that violates neither bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 0, avgServiceDistCapMi: 1000,
    });
    expect(res.ok).toBe(true);
  });
});

describe("precheckDeliveryInputs", () => {
  const base = {
    p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
    costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10,
    laneCostOverrides: [],
  };

  it("passes a clean payload", () => {
    expect(runNetworkEditsPrecheckForModel("delivery-teaching-us", base).ok).toBe(true);
  });

  it("rejects an unknown warehouse id as reference_integrity, naming it", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W999", toId: "C1", cost: 5 }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe("reference_integrity");
    expect(r.errors[0]!.message).toContain("W999");
  });

  it("rejects an unknown customer id", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C999", cost: 5 }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toContain("C999");
  });

  // A role-swapped pair is individually valid on both sides and still not a lane.
  it("rejects a pair that exists in neither lane table", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "C1", toId: "W1", cost: 5 }] });
    expect(r.ok).toBe(false);
  });

  it("accepts a zero override, matching the dataset's 33 zero self-lanes", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C1", cost: 0 }] });
    expect(r.ok).toBe(true);
  });

  // Spec 6.2.1 / Gate D: the Zod schema already refuses these on PATCH, but
  // the precheck runs on the STORED row at solve time and must not trust it.
  it("rejects a duplicate (fromId,toId) pair and a negative or non-finite cost", () => {
    const dup = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: 5 }, { fromId: "W1", toId: "C2", cost: 6 }] });
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]!.code).toBe("id_collision");
    const neg = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: -1 }] });
    expect(neg.ok).toBe(false);
    expect(neg.errors[0]!.code).toBe("completeness");
    const inf = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C2", cost: Number.POSITIVE_INFINITY }] });
    expect(inf.ok).toBe(false);
  });

  // The regression that matters: before this task the dispatcher's fallback
  // returned ok:true for this model, so every one of the cases above passed.
  it("no longer falls through to the unknown-model pre-approval", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "nonsense", toId: "nonsense", cost: 1 }] });
    expect(r.ok).toBe(false);
  });

  // Task 4 / §14.8 gap G2 — Zod checks shape and the status enum, never
  // existence. Without this, an override naming W999/C999 reaches the
  // solver and surfaces as a generic internal_error.
  describe("precheckDeliveryInputs — section 14 override ids", () => {
    it("rejects an unknown warehouse override id and names it", () => {
      const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
        ...base, warehouseOverrides: [{ id: "W999", status: "inactive" }],
      });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r.errors)).toContain("W999");
    });

    it("rejects an unknown customer override id and names it", () => {
      const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
        ...base, customerOverrides: [{ id: "C999", demand: 5, status: "active" }],
      });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r.errors)).toContain("C999");
    });

    // A role-swapped id is individually well-formed and still wrong.
    it("rejects a customer id used as a warehouse override", () => {
      const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
        ...base, warehouseOverrides: [{ id: "C1", status: "inactive" }],
      });
      expect(r.ok).toBe(false);
    });

    it("accepts valid ids", () => {
      expect(runNetworkEditsPrecheckForModel("delivery-teaching-us", {
        ...base,
        warehouseOverrides: [{ id: "W8", status: "forced_open" }],
        customerOverrides: [{ id: "C1", demand: 0, status: "excluded" }],
      }).ok).toBe(true);
    });
  });
});
