import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatInputIssues, INPUT_FIELD_LABELS } from "../formatInputIssues.js";
import { maxCoverageInputsSchema } from "../inputs/maxCoverage.js";

/** Build real Zod issues by parsing a real bad payload — never hand-authored
 *  issue objects, which can drift from what Zod actually emits. */
function issuesFor(patch: Record<string, unknown>, drop: string[] = []): z.ZodIssue[] {
  const base: Record<string, unknown> = {
    p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650,
    coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none",
    distanceBands: [450, 900, 1800, 3400], warehouseOverrides: [],
    customerOverrides: [], addedWarehouses: [], addedCustomers: [],
    distanceOverrides: [],
  };
  const input = { ...base, ...patch };
  for (const k of drop) delete input[k];
  const r = maxCoverageInputsSchema.safeParse(input);
  if (r.success) throw new Error("fixture is valid — it must fail to produce issues");
  return r.error.issues;
}

describe("formatInputIssues", () => {
  it("names the field and states the rule for a range violation", () => {
    expect(formatInputIssues(issuesFor({ avgServiceDistCapMi: 0 })))
      .toBe("Average service distance cap must be greater than 0.");
  });

  it("turns Zod's bare 'Required' into a sentence naming the field", () => {
    expect(formatInputIssues(issuesFor({}, ["coverageFloorDemand"])))
      .toBe("Coverage floor is required.");
  });

  it("joins multiple issues, preserving schema order", () => {
    const out = formatInputIssues(issuesFor({ avgServiceDistCapMi: 0 }, ["coverageFloorDemand"]));
    expect(out).toContain("Average service distance cap must be greater than 0.");
    expect(out).toContain("Coverage floor is required.");
    expect(out.indexOf("Average service")).toBeLessThan(out.indexOf("Coverage floor"));
  });

  it("carries a cross-field custom message through verbatim", () => {
    expect(formatInputIssues(issuesFor({ highServiceDistMi: 9999 })))
      .toBe("High-service distance must be less than max distance.");
  });

  it("degrades to the raw path for an unmapped field instead of dropping it", () => {
    const fake: z.ZodIssue[] = [
      { code: "custom", message: "must be even", path: ["someFutureField"] } as z.ZodIssue,
    ];
    expect(formatInputIssues(fake)).toBe("someFutureField must be even.");
  });

  it("keeps the index for a nested collection path so the bad row is locatable", () => {
    const fake: z.ZodIssue[] = [
      { code: "custom", message: "must be positive", path: ["distanceOverrides", 2, "distance"] } as z.ZodIssue,
    ];
    expect(formatInputIssues(fake)).toContain("Distance overrides");
    expect(formatInputIssues(fake)).toContain("row 3");
  });

  it("never returns an empty string", () => {
    expect(formatInputIssues([])).toBe("The values could not be saved.");
  });

  // Non-vacuity: a new required field must fail here rather than render a raw
  // path to a student. This is the §9 risk mitigation.
  it("has a label for every required field of every model", async () => {
    const { MODEL_IDS, readManifest } = await import("@workspace/dataset-schema");
    const missing: string[] = [];
    for (const id of MODEL_IDS) {
      const req = (readManifest(id).inputsSchema as { required?: unknown }).required;
      if (!Array.isArray(req)) continue;
      for (const key of req) {
        if (typeof key === "string" && !(key in INPUT_FIELD_LABELS)) missing.push(`${id}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
