import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guards against reintroducing the hardcoded "199M" total-demand hint that
// used to live on the Chen coverage-floor input in both
// OptimizationParametersTab and SolveDialog (see
// docs/superpowers/specs/2026-09-19-chen-bands-units-design.md, Part C /
// decision 3). The real feasibility guard is the server-side
// `coverage_floor_infeasible` precheck — no client-side hint, static or
// dynamic, should replace it.
//
// This file necessarily contains the needles it searches for (in order to
// search for them at all), so it excludes its own path from the walk. Each
// needle is built via string concatenation so a plain-text grep of the
// source tree for the literal phrase/test-ids still comes back clean.

const SRC_ROOT = path.resolve(__dirname, "..");
const SELF_PATH = path.resolve(__filename);

const PHRASE_NEEDLE = "total demand " + "199M";
const OPT_TAB_TESTID_NEEDLE = "coverage-floor" + "-hint";
const SOLVE_DIALOG_TESTID_NEEDLE = "solve-dialog-" + OPT_TAB_TESTID_NEEDLE;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function findMatches(needle: string): string[] {
  const offenders: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    if (path.resolve(file) === SELF_PATH) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(needle)) offenders.push(path.relative(SRC_ROOT, file));
  }
  return offenders;
}

describe("no hardcoded Chen total-demand hint in studio source", () => {
  it("does not contain the '199M' total-demand phrase anywhere under src/ (excluding this guard)", () => {
    expect(findMatches(PHRASE_NEEDLE)).toEqual([]);
  });

  it("does not contain the OptimizationParametersTab coverage-floor-hint test-id anywhere under src/ (excluding this guard)", () => {
    // Note: this needle is a substring of the SolveDialog test-id below, so
    // any file reintroducing either surface's hint will show up here too —
    // that's expected, not double-counting, since both are genuinely gone.
    expect(findMatches(OPT_TAB_TESTID_NEEDLE)).toEqual([]);
  });

  it("does not contain the SolveDialog solve-dialog-coverage-floor-hint test-id anywhere under src/ (excluding this guard)", () => {
    expect(findMatches(SOLVE_DIALOG_TESTID_NEEDLE)).toEqual([]);
  });

  it("does NOT flag the surviving coverage-floor input test-ids (input-coverage-floor / solve-dialog-input-coverage-floor)", () => {
    // These elements must survive removal of the hint — sanity-check the
    // needles above don't accidentally match them.
    expect("input-coverage-floor".includes(OPT_TAB_TESTID_NEEDLE)).toBe(false);
    expect("solve-dialog-input-coverage-floor".includes(SOLVE_DIALOG_TESTID_NEEDLE)).toBe(false);
  });
});
