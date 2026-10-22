import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { precheckSuperInputs } from "../services/precheckSuper.js";
import { superInputsSchema } from "../validation/inputs/superInputs.js";

const sample = JSON.parse(readFileSync(new URL("../../../studio/public/samples/super-model-sample.json", import.meta.url), "utf8"));
const base = sample;
const S = (o: object) => superInputsSchema.parse({ ...base, ...o });
const codes = (o: object) => precheckSuperInputs(S(o)).errors.map(e => e.code);

describe("precheckSuperInputs", () => {
  it("sample is ready", () => expect(precheckSuperInputs(S({}))).toEqual({ ok: true, errors: [] }));
  it("empty tables -> completeness", () => expect(codes({ products: [], plantProducts: [], demand: [] })).toContain("completeness"));
  it("no positive demand -> zero_demand", () => expect(codes({ demand: [] })).toContain("zero_demand"));
  it("capacity below demand -> capacity", () =>
    expect(codes({ plantProducts: sample.plantProducts.map((r: { capacity: number }) => ({ ...r, capacity: r.capacity > 0 ? 1 : 0 })) })).toContain("capacity"));
  it("p above eligible warehouses -> p_range", () => expect(codes({ p: 26 })).toContain("p_range"));
  it("forced-open above p -> p_range", () => expect(codes({ p: 1 })).toContain("p_range"));
});
