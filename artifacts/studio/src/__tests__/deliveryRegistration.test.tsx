import { describe, it, expect } from "vitest";
import { CHAPTERS, chapterForModelId } from "@/lib/chapters";
import { objectiveDimension } from "@workspace/units";
import { formatObjective } from "@/lib/formatObjective";
import { defaultInputsForModel, inputEntriesForModel } from "@/pages/Workspace";
// formatObjective's 5th parameter is a UnitApi OBJECT (formatObjective.ts:76,
// contexts/UnitContext.tsx:34-41), not a unit string. Same stub, same type
// imports, as artifacts/studio/src/__tests__/formatObjective.test.ts:1-10,59-68.
import type { UnitApi } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
function stubUnitApi(effective: CanonicalUnit): UnitApi {
  return { pref: effective, setPref: () => {}, effectiveUnit: () => effective,
           toDisplay: (v: number) => v, fromDisplay: (v: number) => v,
           format: (v: number, canonical: CanonicalUnit) => `${v} ${canonical}` };
}
const mi = stubUnitApi("mi");

describe("delivery-teaching-us — chapter registration", () => {
  it("is visible on Landing while the other two Chapter 5 labs stay hidden", () => {
    const entry = chapterForModelId("delivery-teaching-us");
    expect(entry).toBeDefined();
    expect(entry!.hiddenFromLanding).toBeFalsy();
    expect(entry!.locked).toBeFalsy();
    expect(entry!.path).toBe("/chapter-5/delivery");
    expect(chapterForModelId("transport-coal")!.hiddenFromLanding).toBe(true);
    expect(chapterForModelId("p-median-brazil")!.hiddenFromLanding).toBe(true);
  });

  it("takes Landing from three visible labs to four", () => {
    expect(CHAPTERS.filter(c => !c.hiddenFromLanding)).toHaveLength(4);
  });
});

describe("delivery-teaching-us — default inputs", () => {
  it("opens as the case study's Scenario 1, one click from Scenario 2", () => {
    expect(defaultInputsForModel("delivery-teaching-us")).toEqual({
      p: 3,
      distanceBands: [400, 800, 1200, 1600],
      gap: 0,
      timeLimitSec: 120,
      costAdjustEnabled: false,
      distanceThreshold: 800,
      costPerMile: 1,
      costPerMileOver: 10,
      laneCostOverrides: [],
    });
  });
});

describe("delivery-teaching-us — objective units", () => {
  it("is monetary when adjusted and demand-distance when not, never opaque", () => {
    expect(objectiveDimension("delivery-teaching-us", "cost_adjusted")).toBe("monetary");
    expect(objectiveDimension("delivery-teaching-us", "base")).toBe("demand-distance");
    expect(objectiveDimension("delivery-teaching-us", null)).not.toBe("opaque");
  });

  // Spec 8.4: the RENDERED string, not just the dimension. Pinned by identity
  // with the two models that already own those dimensions, so this test needs
  // no knowledge of the suffix/locale format and cannot drift from it.
  it("renders like jade when adjusted and like p-median when not", () => {
    const x = 150194534098.6;
    expect(formatObjective("delivery-teaching-us", "cost_adjusted", x, "mi", mi))
      .toBe(formatObjective("two-echelon-jade-us", null, x, "mi", mi));          // "$…" (formatObjective.ts:53-54,83)
    expect(formatObjective("delivery-teaching-us", "base", 88240913478.1, "mi", mi))
      .toBe(formatObjective("p-median-us", null, 88240913478.1, "mi", mi));      // "… demand-mi"
    expect(formatObjective("delivery-teaching-us", "cost_adjusted", x, "mi", mi))
      .not.toBe(formatObjective("not-a-model", null, x, "mi", mi));             // not the opaque path
  });
});

// ch5-edit-5 (§14) — this describe block used to be titled "the input
// surface is fixed" and pinned the pre-§14 three-tab surface (spec decision
// 11's original form). §14 makes customer demand, customer exclusion and
// warehouse open/close status editable, adding Warehouses/Customers as their
// own tabs; Distances stays withheld (this model still has no editable
// distance surface — Delivery Costs is its analogous editable-cost surface).
// Updated in place rather than deleted: the "omission grants the editable
// surface" risk this block exists to catch is still real and still worth a
// pinned regression test, just against the new five-tab baseline.
describe("delivery-teaching-us — the input surface (post-§14)", () => {
  // The silent failure: inputEntriesForModel's tail is
  //   case "p-median-brazil": case "p-median-us": default:
  // so a model that is merely ABSENT inherits Customers, Warehouses and
  // Distances editors. Omission grants the editable surface; only an explicit
  // case controls it.
  it("offers exactly Input Map, Warehouses, Customers, Delivery Costs and Optimization Parameters", () => {
    expect(inputEntriesForModel("delivery-teaching-us").map(e => e.id))
      .toEqual(["input-map", "warehouses", "customers", "deliveryCosts", "optimization-parameters"]);
  });

  it("offers no distances editor (Delivery Costs is this model's own editable-cost surface)", () => {
    const ids = inputEntriesForModel("delivery-teaching-us").map(e => e.id);
    expect(ids).not.toContain("distances");
  });

  it("does not disturb the p-median default for the models that rely on it", () => {
    expect(inputEntriesForModel("p-median-us").map(e => e.id))
      .toEqual(["input-map", "customers", "warehouses", "distances", "optimization-parameters"]);
  });
});
