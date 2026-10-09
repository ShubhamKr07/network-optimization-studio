import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, sep, join } from "path";
import { assertNoServerOwnedFields } from "../services/scenarioInputWrite.js";

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

describe("assertNoServerOwnedFields — the guard inverts", () => {
  it("ACCEPTS a client-supplied coverageFloorDemand (now user-authored)", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { coverageFloorDemand: 1000 })).toBeNull();
    expect(assertNoServerOwnedFields("max-coverage-us", { coverageFloorDemand: 0, p: 3 })).toBeNull();
  });

  it("REFUSES a client-supplied objective", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: "coverage" })).toMatch(/objective/);
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: "min_distance" })).toMatch(/objective/);
  });

  it("refuses objective when present even as null — `in`, not truthiness", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: null })).toMatch(/objective/);
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: undefined })).toMatch(/objective/);
  });

  it("ignores every other model", () => {
    expect(assertNoServerOwnedFields("p-median-us", { objective: "coverage" })).toBeNull();
  });

  it("ignores a non-object body rather than throwing", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", null)).toBeNull();
    expect(assertNoServerOwnedFields("max-coverage-us", "nope")).toBeNull();
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
    // CH4O-9 — the one-off km->mi scenario migration. Not a request-path
    // route (no client ever reaches it), and it does not bypass the
    // authority's invariant: `objective` is derived through the same
    // `deriveMaxCoverageObjective` function scenarioInputWrite.ts uses,
    // every candidate is re-validated against `maxCoverageInputsSchema`
    // before its UPDATE commits, AND (review fix, Important #1) its
    // `.set()` bumps `solveInputRevision` and advances `inputsUpdatedAt`
    // itself, the same epoch-preservation currency `routes/distanceBands.ts`
    // below is allow-listed for — a kilometre-era in-flight solve job's
    // publication CAS can no longer land on the now-miles row it would
    // otherwise silently overwrite. Added deliberately per this test's own
    // comment above.
    "migrations/ch4ToMiles.ts",
    // WF-8 — the one-off override-precision backfill. Also not a request-path
    // route, and allow-listed with its epoch behaviour INVERTED relative to
    // ch4ToMiles.ts above: it deliberately does NOT bump `solveInputRevision`
    // or touch `inputsUpdatedAt`/`result`/`solvedAt`. That is sound only
    // because of what it is allowed to write — a value rounded to
    // `roundForFile`'s 4 dp, i.e. identical to the stored one at every display
    // and reporting precision, so there is nothing a re-solve would produce
    // differently. The one case where that is false is a value whose rounding
    // changes which distance band it is REPORTED in (which would change the
    // cached envelope's `bandCoverage`), and the migration REFUSES such a row
    // rather than writing it, leaving the re-solve decision to the operator.
    // Added deliberately per this test's own comment above.
    "migrations/roundOverridePrecision.ts",
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
      if (/\.values\(\s*\{[^}]*\binputs\s*:/s.test(src) && !/deriveServerOwnedInputs\(/.test(src)) {
        offenders.push(`${rel} (insert without deriveServerOwnedInputs)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // CH4O-P1 (MINOR #4) — this used to assert only `/\binputs\b/`, which the
  // bare word satisfies from a comment or from an identifier like
  // `migrateInputs`/`nextInputs`, in all three files. It therefore passed
  // even if a file stopped writing `scenarios.inputs` entirely — the exact
  // regression the test's name claims to catch. It now reuses the same two
  // regexes the offender loop above uses, so "still writes inputs" means the
  // same thing on both sides of the allow-list.
  it("the allow-list is not vacuous — every allowed writer still exists and still writes inputs", () => {
    for (const rel of ALLOWED_INPUTS_WRITERS) {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf8");
      const writesInputs =
        /\.set\(\s*\{[^}]*\binputs\s*:/s.test(src) || /\.values\(\s*\{[^}]*\binputs\s*:/s.test(src);
      expect(writesInputs, `${rel} is allow-listed but no longer writes scenarios.inputs — drop it from the allow-list`).toBe(true);
    }
  });

  it("the guard itself is not vacuous — it still finds the insert-side writes it permits", () => {
    const src = readFileSync(resolve(__dirname, "../routes/scenarios.ts"), "utf8");
    // create + clone both insert `inputs:` through deriveServerOwnedInputs.
    expect(src.match(/deriveServerOwnedInputs\(/g)?.length).toBe(2);
    expect(src).toContain("applyScenarioInputWrite(");
  });

  it("distanceBands.ts keeps its atomic field-scoped jsonb_set write", () => {
    const src = readFileSync(resolve(__dirname, "../routes/distanceBands.ts"), "utf8");
    expect(src).toContain("jsonb_set(");
    expect(src.match(/\.set\(\s*\{[^}]*\binputs\s*:\s*sql`jsonb_set/)).toBeTruthy();
  });
});
