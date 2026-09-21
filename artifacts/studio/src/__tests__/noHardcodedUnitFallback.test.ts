import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// chen-bands-units, Part D "No fallback unit — reads" (Task 11). Guards
// against reintroducing a hardcoded "(km)"/"(mi)" unit-label literal or a
// `?? "mi"` unresolved-canonical-unit fallback into any of Task 11's ten
// owned components. Scoped to exactly those ten files — sibling files
// (DistancesTab, ServiceStatsTab, OptimizationParametersTab, SolveDialog,
// JadeBandEditor, Workspace.tsx, etc.) still legitimately contain both while
// their own owning tasks (T12/T13/T14) are in flight, so this guard must
// never widen to a full-`src` walk.
//
// This guard file lives under artifacts/studio/src/ itself, but it is NOT
// one of the ten scanned paths below, so it cannot self-match by inclusion.
// Each needle is still built via string concatenation (rather than typed as
// a literal here) so a plain-text grep of the source tree for the phrase
// itself stays clean, matching this repo's established noHardcodedDemandHint
// pattern.

const SRC_ROOT = path.resolve(__dirname, "..");

const TASK_11_FILES = [
  "components/NetworkMap.tsx",
  "components/workspace/map/MapLegend.tsx",
  "components/workspace/tabs/OutputMapTab.tsx",
  "components/workspace/tabs/CostSummaryTab.tsx",
  "components/workspace/tabs/JadeAssignmentsTab.tsx",
  "components/workspace/tabs/JadeFlowsTab.tsx",
  "components/workspace/tabs/AssignmentsTab.tsx",
  "components/workspace/tabs/FlowsTab.tsx",
  "components/ObjectiveBar.tsx",
  "pages/Landing.tsx",
];

// Built by concatenation, not as a literal, so grepping this file's own
// source for the phrase "(" + "mi" + ")" still comes back clean.
const OPEN = "(";
const CLOSE = ")";
const MI_LABEL_NEEDLE = OPEN + "mi" + CLOSE;
const KM_LABEL_NEEDLE = OPEN + "km" + CLOSE;
// A single `=` bounded by spaces immediately before the quoted unit — this
// deliberately does NOT match a `===` strict-equality comparison (e.g.
// `raw === "mi"`, legitimate narrowing code in Landing.tsx), only a real
// default-parameter/assignment fallback like `distanceUnit = "mi"`.
const MI_DEFAULT_NEEDLE = " " + "=" + " " + '"mi"';
const NULLISH_MI_FALLBACK_NEEDLE = "?" + "?" + " " + '"mi"';

function findMatches(needle: string): string[] {
  const offenders: string[] = [];
  for (const relPath of TASK_11_FILES) {
    const fullPath = path.join(SRC_ROOT, relPath);
    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes(needle)) offenders.push(relPath);
  }
  return offenders;
}

describe("no hardcoded unit-label literal or mi-fallback in Task 11's owned components", () => {
  it("does not contain the literal '(mi)' label anywhere in the ten owned files", () => {
    expect(findMatches(MI_LABEL_NEEDLE)).toEqual([]);
  });

  it("does not contain the literal '(km)' label anywhere in the ten owned files", () => {
    expect(findMatches(KM_LABEL_NEEDLE)).toEqual([]);
  });

  it("does not contain a ' = \"mi\"' default-parameter fallback anywhere in the ten owned files", () => {
    expect(findMatches(MI_DEFAULT_NEEDLE)).toEqual([]);
  });

  it("does not contain a '?? \"mi\"' nullish-fallback anywhere in the ten owned files", () => {
    expect(findMatches(NULLISH_MI_FALLBACK_NEEDLE)).toEqual([]);
  });

  // Sanity: prove the needles are real and the harness can find a planted
  // violation, so a silently-broken guard (e.g. a typo'd path) can't pass by
  // vacuously finding nothing to scan.
  it("the scanned file list is real and non-empty (harness sanity)", () => {
    expect(TASK_11_FILES.length).toBe(10);
    for (const relPath of TASK_11_FILES) {
      expect(fs.existsSync(path.join(SRC_ROOT, relPath))).toBe(true);
    }
  });

  it("does NOT flag a legitimate '===' comparison against \"mi\" (Landing.tsx's asCanonicalUnit narrowing)", () => {
    // Guards the guard itself: a naive substring search for `= "mi"` without
    // space-padding would false-positive on `raw === "mi"` (the `=` in `===`
    // immediately followed by a space then the quote). Confirms the padded
    // needle correctly does NOT match that legitimate pattern.
    const legitimateNarrowing = 'raw === "km" || raw === "mi" ? raw : null';
    expect(legitimateNarrowing.includes(MI_DEFAULT_NEEDLE)).toBe(false);
  });

  it("DOES flag the exact default-parameter pattern this guard exists to catch", () => {
    const bannedDefault = 'distanceUnit = "mi"';
    expect(bannedDefault.includes(MI_DEFAULT_NEEDLE)).toBe(true);
  });
});
