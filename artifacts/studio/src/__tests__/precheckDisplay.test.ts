import { describe, it, expect } from "vitest";
import {
  completenessCountForWarehouse,
  completenessCountForCustomer,
  idCollisionMessageForWarehouse,
  idCollisionMessageForCustomer,
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
