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

function manifestLockedModelIds(): Set<string> {
  const solversDir = join(findRepoRoot(HERE), "solvers");
  const locked = new Set<string>();
  for (const entry of readdirSync(solversDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(solversDir, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      id?: string;
      capabilities?: { locked?: boolean };
    };
    if (manifest.capabilities?.locked === true) locked.add(manifest.id ?? entry.name);
  }
  return locked;
}

describe("locked chapters — chapters.ts and the solver manifests agree", () => {
  it("declares the same locked model set on both sides", () => {
    const fromChapters = new Set(CHAPTERS.filter(c => c.locked).map(c => c.modelId));
    const fromManifests = manifestLockedModelIds();
    // Sorted arrays, not Sets, so a failure PRINTS the mismatch instead of
    // just "Set{...} !== Set{...}".
    expect([...fromChapters].sort()).toEqual([...fromManifests].sort());
  });

  it("actually finds locked models — the comparison is not vacuously empty", () => {
    // Without this, deleting `locked` from both sides would leave the test
    // above passing on two empty sets while the lock silently disappeared.
    expect(manifestLockedModelIds().size).toBeGreaterThan(0);
  });

  it("locks exactly Chapter 9 today", () => {
    // Chapter 4 (chens-cosmetics-cn) was unlocked on 2026-09-26. This
    // assertion is the deliberate tripwire for that kind of change: it fails
    // on ANY edit to the locked set, so unlocking a chapter cannot happen
    // quietly in one place — the change has to be stated here too.
    expect([...manifestLockedModelIds()].sort()).toEqual(["two-echelon-jade-us"]);
  });

  it("every locked chapter is still a registered route — locked is not hidden", () => {
    // A locked chapter must keep its Route (App.tsx redirects it); dropping
    // the route would send a deep link to NotFound instead, which is the
    // dead-end class App.tsx's single-Switch rule exists to prevent.
    for (const c of CHAPTERS.filter(x => x.locked)) {
      expect(c.path).toBeTruthy();
      expect(c.hiddenFromLanding).not.toBe(true);
    }
  });
});
