import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { groupAssignmentsByCustomer } from "../groupAssignments";

const row = (customerId: string, productId: string, warehouseId: string, distanceMi: number) => ({ customerId, productId, warehouseId, distanceMi });

describe("groupAssignmentsByCustomer", () => {
  it("all products to one warehouse -> warehouseId set, count 1", () => {
    const [g] = groupAssignmentsByCustomer([row("C1", "P1", "W1", 10), row("C1", "P2", "W1", 10)]);
    expect(g.warehouseId).toBe("W1");
    expect(g.warehouseCount).toBe(1);
    expect(g.lines).toHaveLength(2);
  });

  it("two warehouses -> warehouseId null, count 2, lines complete", () => {
    const [g] = groupAssignmentsByCustomer([row("C1", "P1", "W1", 10), row("C1", "P2", "W2", 20)]);
    expect(g.warehouseId).toBeNull();
    expect(g.warehouseCount).toBe(2);
    expect(g.lines).toEqual([
      { productId: "P1", warehouseId: "W1", distance: 10 },
      { productId: "P2", warehouseId: "W2", distance: 20 },
    ]);
  });

  it("keeps first-appearance customer order and sorts lines by label", () => {
    const groups = groupAssignmentsByCustomer(
      [row("C2", "P1", "W1", 1), row("C1", "P1", "W1", 2), row("C1", "P2", "W1", 2)],
      id => ({ P1: "Zinc", P2: "Alloy" })[id]!,
    );
    expect(groups.map(g => g.customerId)).toEqual(["C2", "C1"]);
    expect(groups[1].lines.map(l => l.productId)).toEqual(["P2", "P1"]);
  });

  it("single-product customer is one line", () => {
    const [g] = groupAssignmentsByCustomer([row("C1", "P1", "W1", 5)]);
    expect(g.lines).toHaveLength(1);
    expect(g.warehouseCount).toBe(1);
  });
});

// DU-4.R1 — documents an assumption, not a feature: solve.py single-sources every
// JADE customer (~:1305), so the "Split (n warehouses)" UI is unreachable today.
// If a solver change makes a customer split, this fails and the split UI needs real coverage.
describe("groupAssignmentsByCustomer on the real solved JADE fixture", () => {
  it("assumes solve.py single-sources every customer: no group has warehouseCount > 1", () => {
    const fixture = resolve(process.cwd(), "../api-server/src/__tests__/fixtures/solveResults/jade.json") // vitest runs from artifacts/studio;
    const { details } = JSON.parse(readFileSync(fixture, "utf8")) as { details: { assignments: Parameters<typeof groupAssignmentsByCustomer>[0] } };
    expect(details.assignments.length).toBeGreaterThan(0);
    const groups = groupAssignmentsByCustomer(details.assignments);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(g => g.warehouseCount === 1)).toBe(true);
  });
});
