// QFX-8 — openSiteIds is the ONE per-model open-site authority shared by the
// Output Map narrative and its caption. Real envelopes from the narrative
// fixtures (and the super-model fixture) so the per-model field choice is
// checked against what solve.py actually emits.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { OPEN_SITE_NOUN, OPEN_SITE_NOUN_FALLBACK, openSiteIds } from "@/lib/openSites";

const narrative = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/narrative", `${name}.json`), "utf8")).result;
const superResult = (): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/superResult.json"), "utf8"));

describe("openSiteIds — per-model authority (real envelopes)", () => {
  it.each([
    { modelId: "p-median-us", file: "p-median-us", expected: ["BAL", "DAL", "LA"] },
    { modelId: "max-coverage-us", file: "max-coverage-us-coverage", expected: ["DAL", "LA", "PIT"] },
    { modelId: "delivery-teaching-us", file: "delivery-teaching-us", expected: ["W1", "W2", "W60"] },
    { modelId: "p-median-brazil", file: "p-median-brazil-VARIANT-singleSource-false", expected: ["BEL", "BET", "JDF", "PGR", "REC", "SSA", "STS"] },
    // details.openWarehouseIds holds MINES for transport-coal (solve.py:687).
    { modelId: "transport-coal", file: "transport-coal", expected: ["KY", "WY", "PA", "IA"] },
    { modelId: "two-echelon-gold-au", file: "two-echelon-gold-au", expected: ["cunnamulla"] },
    { modelId: "two-echelon-jade-us", file: "two-echelon-jade-us", expected: ["wh-16", "wh-44", "wh-60"] },
  ])("$modelId", ({ modelId, file, expected }) => {
    expect(openSiteIds(narrative(file), modelId)).toEqual(expected);
  });

  it("super-model reads its real envelope", () => {
    expect(openSiteIds(superResult(), "super-model")).toEqual(["wh-11", "wh-14"]);
  });

  it("an infeasible envelope that genuinely opened nothing is [], not null", () => {
    expect(openSiteIds(narrative("p-median-brazil"), "p-median-brazil")).toEqual([]);
  });
});

describe("openSiteIds — field precedence", () => {
  it("super-model: metrics.openFacilityIds wins even when details disagrees", () => {
    expect(openSiteIds({ metrics: { openFacilityIds: ["w2"] }, details: { openWarehouseIds: ["w9"] } }, "super-model")).toEqual(["w2"]);
  });

  it("super-model never falls back to details.openWarehouseIds", () => {
    expect(openSiteIds({ metrics: {}, details: { openWarehouseIds: ["w9"] } }, "super-model")).toBeNull();
  });

  it("every other model: details.openWarehouseIds, else metrics.openFacilityIds", () => {
    expect(openSiteIds({ metrics: { openFacilityIds: ["b"] }, details: { openWarehouseIds: ["a"] } }, "two-echelon-jade-us")).toEqual(["a"]);
    expect(openSiteIds({ metrics: { openFacilityIds: ["b"] }, details: {} }, "two-echelon-jade-us")).toEqual(["b"]);
  });

  it("absent or malformed fields are null (the narrative then renders nothing)", () => {
    expect(openSiteIds({ metrics: {}, details: {} }, "p-median-us")).toBeNull();
    expect(openSiteIds({ metrics: {}, details: { openWarehouseIds: [1, 2] } }, "p-median-us")).toBeNull();
    expect(openSiteIds(null, "p-median-us")).toBeNull();
    expect(openSiteIds("not a result", "p-median-us")).toBeNull();
  });
});

describe("OPEN_SITE_NOUN (decision L3)", () => {
  it("names every model's open sites", () => {
    expect(OPEN_SITE_NOUN).toEqual({
      "p-median-us": "Open warehouses",
      "p-median-brazil": "Open warehouses",
      "max-coverage-us": "Open warehouses",
      "delivery-teaching-us": "Open warehouses",
      "transport-coal": "Open mines",
      "two-echelon-gold-au": "Open facilities",
      "two-echelon-jade-us": "Open facilities",
      "super-model": "Open facilities",
    });
    expect(OPEN_SITE_NOUN_FALLBACK).toBe("Open sites");
  });
});
