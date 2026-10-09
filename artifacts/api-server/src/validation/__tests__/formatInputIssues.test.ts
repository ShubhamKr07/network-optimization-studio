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
    // Real fixture, not hand-authored: a bad distanceOverrides[2].distance
    // produces Zod's own "Number must be greater than 0" at that nested
    // path, which is what actually exercises the GENERIC_SUBJECT strip.
    const issues = issuesFor({
      distanceOverrides: [
        { fromId: "a", toId: "b", distance: 5 },
        { fromId: "c", toId: "d", distance: 5 },
        { fromId: "e", toId: "f", distance: -1 },
      ],
    });
    expect(formatInputIssues(issues)).toBe("Distance overrides row 3 must be greater than 0.");
  });

  it("keeps an acronym label uppercase in both the subject and mid-sentence position, unlike an ordinary label", () => {
    // Subject position: labelFor's raw table value, never run through lower().
    expect(formatInputIssues([
      { code: "custom", message: "Required", path: ["bomRatio"] } as z.ZodIssue,
    ])).toBe("BOM ratio is required.");
    expect(formatInputIssues([
      { code: "custom", message: "Required", path: ["maxDistMi"] } as z.ZodIssue,
    ])).toBe("Max distance is required.");

    // Mid-sentence position: hand-built, because no real cross-field message
    // names either field from another field's issue today (same
    // not-reachable-via-a-real-schema justification as someFutureField above).
    // Uses `refineryOverrides` as the issue's own (labelled) field to check
    // that substitution of the OTHER field in the message body still works
    // when the head field has a label too.
    expect(formatInputIssues([
      { code: "custom", message: "refineryOverrides must not exceed bomRatio", path: ["refineryOverrides"] } as z.ZodIssue,
    ])).toBe("Refinery overrides must not exceed BOM ratio.");
    expect(formatInputIssues([
      { code: "custom", message: "refineryOverrides must not exceed maxDistMi", path: ["refineryOverrides"] } as z.ZodIssue,
    ])).toBe("Refinery overrides must not exceed max distance.");
  });

  it("never returns an empty string", () => {
    expect(formatInputIssues([])).toBe("The values could not be saved.");
  });

  // Non-vacuity: a new field — required or not — must fail here rather than
  // render a raw path to a student. Scoped to `required[]` alone, this test
  // missed eight real optional fields (added-entity arrays and
  // capacity/demand override records across transport-coal and the
  // two-echelon models) that are neither required nor labelled, so they fell
  // through this guard AND the reverse one below. Checking every
  // `properties` key, not just `required[]`, is what closes that gap. This
  // is the §9 risk mitigation.
  it("has a label for every real input field of every model", async () => {
    const { MODEL_IDS, readManifest } = await import("@workspace/dataset-schema");
    const missing: string[] = [];
    for (const id of MODEL_IDS) {
      const props = (readManifest(id).inputsSchema as { properties?: Record<string, unknown> })
        .properties;
      if (!props) continue;
      for (const key of Object.keys(props)) {
        if (!(key in INPUT_FIELD_LABELS)) missing.push(`${id}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Reverse direction: a label for a field that no model actually has (a
  // typo, or a rename the table was never updated for) is a dead key that
  // the forward test above cannot catch — it only checks that required
  // fields HAVE a label, not that every label corresponds to a real field.
  // This is what makes a misspelled/stale key fail loudly.
  it("has no label for a field that does not exist in any model's schema", async () => {
    const { MODEL_IDS, readManifest } = await import("@workspace/dataset-schema");
    const realFields = new Set<string>();
    for (const id of MODEL_IDS) {
      const props = (readManifest(id).inputsSchema as { properties?: Record<string, unknown> })
        .properties;
      if (props) for (const key of Object.keys(props)) realFields.add(key);
    }
    const dead = Object.keys(INPUT_FIELD_LABELS).filter((key) => !realFields.has(key));
    expect(dead).toEqual([]);
  });
});
