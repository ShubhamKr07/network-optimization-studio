// SCU-2.P2.3 (B2.7, D1) — pure tests of the deliveryCosts parser and writer.
// Base values measured from solvers/delivery-teaching-us/dataset/costs.json:
// "W8,C269" = 1047.7157, "W8,C8" = 0 (one of 33 zero-cost base lanes out of 10,329).
import { describe, it, expect } from "vitest";
import { TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import { parseAndValidateImport, parseAndValidateJsonImport } from "../services/import.js";
import { deliveryBaseCost } from "../data/referenceCosts.js";
import { applyDeliveryCostOverrides, deliveryCostRowsToCsv } from "../services/templates.js";

const M = "delivery-teaching-us";
const HEADER = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
const csv = (...lines: string[]) => `${HEADER}\n${lines.join("\n")}\n`;
const run = (text: string, laneCostOverrides: Array<{ fromId: string; toId: string; cost: number }> = []) =>
  parseAndValidateImport("deliveryCosts", text, { laneCostOverrides }, 3, M);

describe("deliveryCosts import", () => {
  it("exposes the base matrix", () => {
    expect(deliveryBaseCost("W8", "C269")).toBe(1047.7157);
    expect(deliveryBaseCost("W8", "C8")).toBe(0);
    expect(deliveryBaseCost("W8", "C99999")).toBeUndefined();
  });

  it("a new cost on a base pair is a change from the base value", () => {
    const r = run(csv(`${TEMPLATE_VERSION},W8,C269,1`));
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([{ id: "W8|C269", line: 2, before: { status: "active", value: 1047.7157 }, after: { status: "active", value: 1 }, fromId: "W8", toId: "C269" }]);
  });

  it("presence decides removal (review #8): equal-to-base is a no-op without an override, a reset-to-base with one — even a redundant one", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`)).changes).toEqual([]);
    const back = run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`), [{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect(back.changes).toEqual([expect.objectContaining({ before: { status: "active", value: 1 }, after: { status: "base", value: 1047.7157 } })]);
    // A stored override whose value ALREADY equals base: the effective value is
    // unchanged, but the row must still remove the override.
    const redundant = run(csv(`${TEMPLATE_VERSION},W8,C269,1047.7157`), [{ fromId: "W8", toId: "C269", cost: 1047.7157 }]);
    expect(redundant.changes).toEqual([expect.objectContaining({ before: { status: "active", value: 1047.7157 }, after: { status: "base", value: 1047.7157 } })]);
  });

  it("zero is a legal cost", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,0`)).errors).toEqual([]);
    expect(run(csv(`${TEMPLATE_VERSION},W8,C8,0`)).changes).toEqual([]);
  });

  it("rejects blank (deviation 6), negative and non-numeric cost", () => {
    for (const cost of ["", "-1", "abc"]) {
      expect(run(csv(`${TEMPLATE_VERSION},W8,C269,${cost}`)).errors).toEqual([expect.objectContaining({ errorClass: "logic", line: 2 })]);
    }
  });

  it("rejects a pair outside the base matrix, duplicates, wrong version, wrong header", () => {
    expect(run(csv(`${TEMPLATE_VERSION},W8,C99999,1`)).errors[0]!.message).toMatch(/base cost matrix/);
    expect(run(csv(`${TEMPLATE_VERSION},W8,C269,1`, `${TEMPLATE_VERSION},W8,C269,2`)).errors).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining("Duplicate") })]);
    expect(run(csv(`2,W8,C269,1`)).errors[0]!.message).toMatch(/template_version/);
    expect(run("template_version,unit,from_id,to_id,cost\n2,mi,W8,C269,1\n").errors[0]).toMatchObject({ errorClass: "format", line: 1 });
  });

  it("JSON rows {fromId,toId,cost} import through the same rules", () => {
    const p = parseAndValidateJsonImport("deliveryCosts", { templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [{ fromId: "W8", toId: "C269", cost: 1 }] }, {}, 3, M);
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ rowIndex: 0, after: { status: "active", value: 1 } })]);
    const withUnit = parseAndValidateJsonImport("deliveryCosts", { templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", unit: "mi", rows: [] }, {}, 3, M);
    expect(withUnit.errors).toEqual([expect.objectContaining({ field: "unit" })]); // no unit field on deliveryCosts
  });
});

describe("deliveryCosts export", () => {
  it("emits only overridden pairs that differ from base, unconverted, under the import header", () => {
    const rows = applyDeliveryCostOverrides([{ fromId: "W8", toId: "C269", cost: 1 }, { fromId: "W8", toId: "C8", cost: 0 }]);
    expect(rows).toEqual([{ fromId: "W8", toId: "C269", cost: 1 }]); // W8,C8 = 0 equals base: redundant, filtered
    expect(deliveryCostRowsToCsv(rows)).toBe(`${HEADER}\n${TEMPLATE_VERSION},W8,C269,1\n`);
    expect(run(deliveryCostRowsToCsv(rows)).changes).toHaveLength(1); // export → import closes
  });
});
