import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// bands-save — every Input Map mount's Layers-row Save must be wired to the
// SHARED save contract, not to `ordinaryDirty` alone.
//
// Why this is a source-reading test rather than four more behavioural ones.
// Four separate `<InputMapTab>` mounts in Workspace.tsx carry this Save (the
// "pmedian" arm, which serves p-median-us / p-median-brazil / max-coverage-us /
// delivery-teaching-us, plus the transport-coal, two-echelon-gold-au and
// two-echelon-jade-us arms). The bug this guards was present in ALL FOUR
// identically: `isDirty={isDirty}` + `onSave={handleSaveInputs}`, both of which
// see only `ordinaryDirty`, so a distance-band-only edit left the single
// visible Save greyed out and inert on that tab.
//
// A behavioural test per mount would be four near-duplicates and would still
// not cover a FIFTH mount added later — and "a per-model gate a sibling model
// silently misses" is this repo's most-documented recurring bug class
// (model-integration-precheck.md, Gate 1). Asserting the wiring at the source
// level covers every current mount and every future one by construction, which
// is the same technique `lockedModelGuards.test.ts` uses for the route guards.
//
// The behavioural proof that the shared contract actually does the right thing
// lives in Workspace.Integration.test.tsx ("a bands-only edit is saveable from
// the Input Map's own Layers-row Save"). This test pins that no mount is
// bypassing it; that one pins that it works.

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}

const WORKSPACE_SRC = readFileSync(
  join(findRepoRoot(HERE), "artifacts/studio/src/pages/Workspace.tsx"),
  "utf8",
);

describe("Input Map Layers-row Save — wiring", () => {
  it("finds the mounts at all — the assertions below are not vacuous", () => {
    // If `isDirty={` ever disappears from this file entirely (prop renamed,
    // mounts refactored away), every "must not contain" assertion below would
    // pass trivially. This is the tripwire for that.
    expect(WORKSPACE_SRC).toContain("isDirty={");
    expect(WORKSPACE_SRC.match(/isDirty=\{/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("no mount gates its Save on ordinaryDirty alone", () => {
    // `isDirty` IS `ordinaryDirty` (Workspace.tsx derives one from the other),
    // so a mount passing it cannot see a lens-only change.
    expect(WORKSPACE_SRC).not.toContain("isDirty={isDirty}");
  });

  it("no mount routes its Save straight at the whole-input writer", () => {
    // `handleSaveInputs` early-returns unless `ordinaryDirty`, so wiring it
    // directly makes the button inert for a bands-only edit even if the
    // enable-flag were fixed. `handleSaveClick` is the dispatcher that picks
    // the whole-input PATCH or the field-scoped bands PATCH per state.
    expect(WORKSPACE_SRC).not.toContain("onSave={handleSaveInputs}");
  });

  it("every mount uses the shared enable flag, dispatcher, pending flag and label", () => {
    const mounts = WORKSPACE_SRC.match(/isDirty=\{saveEnabled\}/g) ?? [];
    expect(mounts.length).toBe(4);

    // Each of the four must carry the complete set, not a partial adoption —
    // e.g. `saveEnabled` without `handleSaveClick` would enable a button that
    // then does nothing for the very case it was enabled for.
    for (const [prop, expected] of [
      ["onSave={handleSaveClick}", 4],
      ["saving={saveIsPending}", 4],
      ["saveLabel={saveLabel}", 4],
    ] as const) {
      expect((WORKSPACE_SRC.match(new RegExp(prop.replace(/[{}]/g, "\\$&"), "g")) ?? []).length)
        .toBe(expected);
    }
  });

  it("the suppression list and the wired mounts stay in step", () => {
    // Workspace.tsx hides the shared toolbar Save exactly when a Layers-row
    // Save is wired, so the two must describe the same set. If a fifth model
    // gains a Layers-row Save and is added to one side only, the student
    // either sees two Save buttons or none — both silent.
    const suppression = WORKSPACE_SRC.match(
      /isEditableInputTab && (![A-Za-z]+(?: && )?)+\(/,
    );
    expect(suppression, "toolbar-Save suppression condition not found").not.toBeNull();
    const flags = suppression![0].match(/!saveInLayersRow[A-Za-z]*/g) ?? [];
    expect(flags.length).toBe(4);
  });
});
