import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, sep, join } from "path";
import { assertNoServerOwnedStepFields } from "../services/scenarioInputWrite.js";

// R9 — plain recursive walk; no new dependency, and deliberately defined in
// this file rather than imported, so the guard cannot be weakened by editing
// a shared helper somewhere else.
function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTsFiles(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

describe("CH4-24/CH4-25 — the write-route narrowing guard", () => {
  it("rejects objective min_distance for max-coverage-us", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "min_distance" })).toBeTruthy();
  });

  it("rejects a coverageFloorDemand key at all — present, even when null", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: 1 })).toBeTruthy();
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: null })).toBeTruthy();
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: undefined })).toBeTruthy();
  });

  it("accepts an ordinary coverage payload", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", p: 3 })).toBeNull();
  });

  // stepEpoch is treated differently ON PURPOSE: stripped and overwritten by
  // CH4-23, not rejected, because a client legitimately round-trips the whole
  // inputs blob and would otherwise be unable to save anything. A floor has no
  // such excuse — no well-behaved client ever sends one.
  it("accepts a client-supplied stepEpoch rather than rejecting it", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", stepEpoch: 9 })).toBeNull();
  });

  it("never constrains another model", () => {
    expect(assertNoServerOwnedStepFields("p-median-us", { objective: "min_distance", coverageFloorDemand: 5 })).toBeNull();
  });
});

describe("CH4-26 — no route writes scenarios.inputs outside the authority", () => {
  // R9 — the guard scans the WHOLE api-server source tree, not just
  // routes/scenarios.ts. A future writer added in another route or service
  // would sail past a single-file check, which is precisely the sixth
  // exception CH4-26 exists to prevent. The allow-list is frozen here: any
  // new `inputs:` write anywhere must either route through the authority or
  // be added to this list deliberately, with a reviewer seeing it.
  //
  // readFileSync, NOT Function.prototype.toString(): the vitest/esbuild
  // transform strips comments, so a stringified-function assertion silently
  // tests nothing. Same technique lockedModelGuards.test.ts:33,82 uses.
  const ALLOWED_INPUTS_WRITERS = new Set([
    // the authority itself
    "services/scenarioInputWrite.ts",
    // the documented atomic field-scoped exception (preserves the epoch by
    // construction — see CH4-26's table)
    "routes/distanceBands.ts",
  ]);

  it("no file outside the allow-list writes scenarios.inputs", () => {
    const root = resolve(__dirname, "..");
    const offenders: string[] = [];
    for (const file of walkTsFiles(root)) {
      const rel = relative(root, file).split(sep).join("/");
      if (rel.includes("__tests__/")) continue;
      if (ALLOWED_INPUTS_WRITERS.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (/\.set\(\s*\{[^}]*\binputs\s*:/s.test(src)) offenders.push(rel);
      if (/\.values\(\s*\{[^}]*\binputs\s*:/s.test(src) && !/initialInputsForInsert\(/.test(src)) {
        offenders.push(`${rel} (insert without initialInputsForInsert)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list is not vacuous — both allowed writers still exist and still write inputs", () => {
    for (const rel of ALLOWED_INPUTS_WRITERS) {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf8");
      expect(src).toMatch(/\binputs\b/);
    }
  });

  it("the guard itself is not vacuous — it still finds the insert-side writes it permits", () => {
    const src = readFileSync(resolve(__dirname, "../routes/scenarios.ts"), "utf8");
    // create + clone both insert `inputs:` through initialInputsForInsert.
    expect(src.match(/initialInputsForInsert\(/g)?.length).toBe(2);
    expect(src).toContain("applyScenarioInputWrite(");
  });

  it("distanceBands.ts keeps its atomic field-scoped jsonb_set write", () => {
    const src = readFileSync(resolve(__dirname, "../routes/distanceBands.ts"), "utf8");
    expect(src).toContain("jsonb_set(");
    expect(src.match(/\.set\(\s*\{[^}]*\binputs\s*:\s*sql`jsonb_set/)).toBeTruthy();
  });
});
