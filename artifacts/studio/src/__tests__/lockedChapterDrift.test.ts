import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAPTERS } from "@/lib/chapters";

// ch4-lock — the lock is declared in TWO places on purpose, and this test is
// the price of that choice.
//
//   - `solvers/<model>/manifest.json` -> `capabilities.locked` is the
//     AUTHORITY. The api-server reads it through the model registry and
//     refuses every scenario-scoped call for a locked model. This is the half
//     that actually stops a determined student.
//   - `chapters.ts` -> `Chapter.locked` drives the Landing card and the route
//     guard. It is a separate declaration because Landing must grey a card
//     SYNCHRONOUSLY — sourcing it from GET /api/models would leave a window
//     on every page load where a locked card renders live and clickable.
//
// Two declarations of one fact drift. This asserts they cannot: the moment
// someone locks a chapter in one place and forgets the other, the suite goes
// red and names the offending model. Without it, the likely failure is the
// quiet one — a chapter greyed on Landing whose API is still wide open.

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}

interface SolverManifest {
  id?: string;
  capabilities?: { locked?: boolean };
}

/** Every `solvers/<model>/manifest.json`, parsed. `id` falls back to the
 *  directory name, matching what the model registry does. */
function allManifests(): Array<SolverManifest & { id: string }> {
  const solversDir = join(findRepoRoot(HERE), "solvers");
  const manifests: Array<SolverManifest & { id: string }> = [];
  for (const entry of readdirSync(solversDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(solversDir, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SolverManifest;
    manifests.push({ ...manifest, id: manifest.id ?? entry.name });
  }
  return manifests;
}

function manifestLockedModelIds(): Set<string> {
  return new Set(allManifests().filter(m => m.capabilities?.locked === true).map(m => m.id));
}

describe("locked chapters — chapters.ts and the solver manifests agree", () => {
  it("declares the same locked model set on both sides", () => {
    const fromChapters = new Set(CHAPTERS.filter(c => c.locked).map(c => c.modelId));
    const fromManifests = manifestLockedModelIds();
    // Sorted arrays, not Sets, so a failure PRINTS the mismatch instead of
    // just "Set{...} !== Set{...}".
    expect([...fromChapters].sort()).toEqual([...fromManifests].sort());
  });

  it("scans real manifests — the comparison is not vacuously empty", () => {
    // The agreement check above compares two sets. With no chapter locked
    // today BOTH are empty, so it would also pass if `manifestLockedModelIds`
    // were silently reading nothing at all — a broken solvers path, a renamed
    // directory, a JSON shape change. This asserts the SCAN works rather than
    // asserting the RESULT is non-empty (which is what this test used to do,
    // back when a chapter was actually locked): manifests are found, parsed,
    // and every one of them carries the `capabilities` object the lock lives
    // in. An unlock stays honest; a dead scanner still fails.
    const manifests = allManifests();
    expect(manifests.length).toBeGreaterThan(0);
    for (const m of manifests) expect(m.capabilities).toBeTypeOf("object");
  });

  it("locks no chapter today — every chapter is open to students", () => {
    // Chapter 4 (chens-cosmetics-cn) was locked on 2026-09-27 as Stage A of
    // the dataset migration (MIG-16) and reopened as max-coverage-us in that
    // cutover (ch4-mig-4, Step 8b). Chapter 9 (two-echelon-jade-us) was the
    // last one standing and was unlocked on 2026-09-30 (ch9-unlock), so the
    // locked set is now empty. This assertion is the deliberate tripwire for
    // any edit to the locked set, so lock/unlock changes cannot happen
    // quietly in one place — the change has to be stated here too.
    expect([...manifestLockedModelIds()].sort()).toEqual([]);
    expect(CHAPTERS.filter(c => c.locked).map(c => c.modelId)).toEqual([]);
  });

  it("every locked chapter is still a registered route — locked is not hidden", () => {
    // A locked chapter must keep its Route (App.tsx redirects it); dropping
    // the route would send a deep link to NotFound instead, which is the
    // dead-end class App.tsx's single-Switch rule exists to prevent.
    //
    // VACUOUS TODAY, deliberately kept: nothing is locked as of ch9-unlock,
    // so this loop has no iterations. It is a standing invariant that re-arms
    // by itself the moment a chapter is locked again (the next migration
    // quiesce will do exactly that), which is worth more than deleting it and
    // rediscovering the rule later. The test above is what guards the
    // "nothing is locked" claim itself, so this one being empty cannot hide
    // an unlock.
    for (const c of CHAPTERS.filter(x => x.locked)) {
      expect(c.path).toBeTruthy();
      expect(c.hiddenFromLanding).not.toBe(true);
    }
  });
});
