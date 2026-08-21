import { describe, it, expect } from "vitest";
import {
  completenessCountForWarehouse,
  completenessCountForCustomer,
  idCollisionMessageForWarehouse,
  idCollisionMessageForCustomer,
  completenessCountForMine,
  completenessCountForStation,
  idCollisionMessageForMine,
  idCollisionMessageForStation,
} from "@/lib/precheckDisplay";

// Message shapes copied verbatim from artifacts/api-server/src/services/precheck.ts
// so a wording change there would be caught by this test, not just silently
// stop matching in the UI.

describe("completenessCountForWarehouse", () => {
  it("parses the missing-distance count for a warehouse with a completeness finding", () => {
    const errors = [
      { code: "completeness", message: "new-wh-1 missing distances to 2 customers: C001, C002" },
    ];
    expect(completenessCountForWarehouse(errors, "new-wh-1")).toBe(2);
  });

  it("handles the singular 'customer' wording (1 missing)", () => {
    const errors = [{ code: "completeness", message: "new-wh-1 missing distances to 1 customer: C001" }];
    expect(completenessCountForWarehouse(errors, "new-wh-1")).toBe(1);
  });

  it("returns null when there's no completeness finding for this id", () => {
    const errors = [{ code: "completeness", message: "WH01 missing distances to 2 customers: C001, C002" }];
    expect(completenessCountForWarehouse(errors, "new-wh-1")).toBeNull();
  });

  it("returns null for an empty errors array", () => {
    expect(completenessCountForWarehouse([], "new-wh-1")).toBeNull();
  });

  it("does not false-positive-match a warehouse id that's a prefix of another id", () => {
    const errors = [{ code: "completeness", message: "new-wh-10 missing distances to 1 customer: C001" }];
    expect(completenessCountForWarehouse(errors, "new-wh-1")).toBeNull();
  });
});

describe("completenessCountForCustomer", () => {
  it("counts how many warehouses' missing-lists include this customer id", () => {
    const errors = [
      { code: "completeness", message: "WH01 missing distances to 1 customer: new-cust-1" },
      { code: "completeness", message: "WH02 missing distances to 2 customers: new-cust-1, C002" },
    ];
    expect(completenessCountForCustomer(errors, "new-cust-1")).toBe(2);
  });

  it("returns 0 when the customer id never appears", () => {
    const errors = [{ code: "completeness", message: "WH01 missing distances to 1 customer: C001" }];
    expect(completenessCountForCustomer(errors, "new-cust-1")).toBe(0);
  });

  it("ignores non-completeness error codes", () => {
    const errors = [{ code: "reference_integrity", message: "distanceOverrides toId 'new-cust-1' does not reference a known customer" }];
    expect(completenessCountForCustomer(errors, "new-cust-1")).toBe(0);
  });
});

describe("idCollisionMessageForWarehouse / idCollisionMessageForCustomer", () => {
  it("finds the id_collision message for a warehouse id", () => {
    const errors = [
      { code: "id_collision", message: "Added warehouse id 'WH01' collides with an existing base-dataset warehouse id" },
    ];
    expect(idCollisionMessageForWarehouse(errors, "WH01")).toBe(
      "Added warehouse id 'WH01' collides with an existing base-dataset warehouse id",
    );
  });

  it("returns null when there's no collision for this warehouse id", () => {
    const errors = [{ code: "id_collision", message: "Added warehouse id 'WH02' is duplicated across addedWarehouses" }];
    expect(idCollisionMessageForWarehouse(errors, "WH01")).toBeNull();
  });

  it("finds the id_collision message for a customer id", () => {
    const errors = [{ code: "id_collision", message: "Added customer id 'C001' is duplicated across addedCustomers" }];
    expect(idCollisionMessageForCustomer(errors, "C001")).toBe(
      "Added customer id 'C001' is duplicated across addedCustomers",
    );
  });

  it("returns null for an empty errors array", () => {
    expect(idCollisionMessageForCustomer([], "C001")).toBeNull();
  });
});

// Task 30 (B6.1 stage 4) — transport-coal analogues, message shapes copied
// verbatim from precheckTransportInputs (precheck.ts).
describe("completenessCountForMine", () => {
  it("parses the missing-lane-cost count for a mine with a completeness finding", () => {
    const errors = [
      { code: "completeness", message: "MN-NEW missing lane costs to 2 stations: ST-1, ST-2" },
    ];
    expect(completenessCountForMine(errors, "MN-NEW")).toBe(2);
  });

  it("handles the singular 'station' wording (1 missing)", () => {
    const errors = [{ code: "completeness", message: "MN-NEW missing lane costs to 1 station: ST-1" }];
    expect(completenessCountForMine(errors, "MN-NEW")).toBe(1);
  });

  it("returns null when there's no completeness finding for this id", () => {
    const errors = [{ code: "completeness", message: "KY missing lane costs to 1 station: ST-1" }];
    expect(completenessCountForMine(errors, "MN-NEW")).toBeNull();
  });
});

describe("completenessCountForStation", () => {
  it("counts how many mines' missing-lists include this station id", () => {
    const errors = [
      { code: "completeness", message: "KY missing lane costs to 1 station: ST-NEW" },
      { code: "completeness", message: "WY missing lane costs to 2 stations: ST-NEW, ST-2" },
    ];
    expect(completenessCountForStation(errors, "ST-NEW")).toBe(2);
  });

  it("returns 0 when the station id never appears", () => {
    const errors = [{ code: "completeness", message: "KY missing lane costs to 1 station: ST-1" }];
    expect(completenessCountForStation(errors, "ST-NEW")).toBe(0);
  });
});

describe("idCollisionMessageForMine / idCollisionMessageForStation", () => {
  it("finds the id_collision message for a mine id", () => {
    const errors = [{ code: "id_collision", message: "Added mine id 'KY' collides with an existing base-dataset mine id" }];
    expect(idCollisionMessageForMine(errors, "KY")).toBe(
      "Added mine id 'KY' collides with an existing base-dataset mine id",
    );
  });

  it("returns null when there's no collision for this mine id", () => {
    const errors = [{ code: "id_collision", message: "Added mine id 'MN-02' is duplicated across addedMines" }];
    expect(idCollisionMessageForMine(errors, "MN-01")).toBeNull();
  });

  it("finds the id_collision message for a station id", () => {
    const errors = [{ code: "id_collision", message: "Added station id 'ST-01' is duplicated across addedStations" }];
    expect(idCollisionMessageForStation(errors, "ST-01")).toBe(
      "Added station id 'ST-01' is duplicated across addedStations",
    );
  });

  it("returns null for an empty errors array", () => {
    expect(idCollisionMessageForStation([], "ST-01")).toBeNull();
  });
});
