import { describe, it, expect } from "vitest";
import { warehouseStatusPresentation } from "@/components/workspace/map/statusPresentation";

describe("warehouseStatusPresentation", () => {
  it("maps active to Potential/outline — NOT filled, active is Potential", () => {
    expect(warehouseStatusPresentation.active).toEqual({ label: "Potential", marker: "outline" });
  });

  it("maps forced_open to Fixed-Open/filled", () => {
    expect(warehouseStatusPresentation.forced_open).toEqual({ label: "Fixed-Open", marker: "filled" });
  });

  it("maps inactive to Inactive/dashed", () => {
    expect(warehouseStatusPresentation.inactive).toEqual({ label: "Inactive", marker: "dashed" });
  });

  it("is the only place the label vocabulary is declared — exactly the 3 stored statuses", () => {
    expect(Object.keys(warehouseStatusPresentation).sort()).toEqual(["active", "forced_open", "inactive"]);
  });
});
