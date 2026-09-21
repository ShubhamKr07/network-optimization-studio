import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// chen-bands-units, Task 14 Step 4 (history action matrix) + decision 1h.
//
// While an older result-history entry is displayed, ordinary input editing is
// unreachable. The load-bearing half of that guarantee lives at the save/solve
// call sites, which refuse outright regardless of caller. This test pins the
// defence-in-depth half: every user-edit function that mutates `localInputs`
// must ALSO no-op, so a stale edit never lands in the draft at all — an edit
// that did land would survive a step back to the latest entry and silently
// become part of the next save.
//
// A structural assertion rather than a behavioural one, deliberately: there are
// ten such functions across four models, and the failure mode being guarded
// against is someone adding an eleventh without the guard. A per-function
// render test would not catch that; scanning the source does.
const WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../pages/Workspace.tsx",
);

/**
 * Every `localInputs`-mutating function reachable from a user edit.
 *
 * Deliberately EXCLUDES the non-edit assignments, which must keep working
 * while browsing history and would break if guarded:
 *   - the scenario-switch effect (seeds the draft)
 *   - `stepResultBack`/`stepResultForward` (replace the draft with an entry)
 *   - the discard path (restores `savedInputsRef`)
 *   - import-apply / reset responses (server-authored inputs)
 */
const GUARDED_MUTATORS = [
  "updateInputsField",
  "setChenObjectiveMode",
  "updateChenServiceDistance",
  "deleteAddedEntityAndOverrides",
  "deleteAddedTransportEntityAndOverrides",
  "deleteAddedPlantAndOverrides",
  "handlePMedianMapInputsChange",
  "handleTransportMapInputsChange",
  "handleTwoEchelonMapInputsChange",
  "handleJadeMapInputsChange",
] as const;

describe("Workspace — history read-only guards (Task 14 Step 4)", () => {
  const src = fs.readFileSync(WORKSPACE, "utf8");
  const lines = src.split("\n");

  it.each(GUARDED_MUTATORS)(
    "%s no-ops while an older history entry is displayed",
    name => {
      const start = lines.findIndex(l =>
        new RegExp(`^\\s*(?:async )?function ${name}\\(`).test(l),
      );
      expect(start, `${name} not found in Workspace.tsx`).toBeGreaterThan(-1);

      // The guard must be the function's first statement — a guard placed after
      // any mutation has already let the stale edit through.
      const body = lines.slice(start + 1, start + 12).join("\n");
      expect(body).toContain("if (isBrowsingHistoryNow) return;");
    },
  );

  it("no user-edit mutator was added without the guard", () => {
    // Counts `setLocalInputs` callers against the known-good inventory, so a
    // new mutator forces a deliberate decision here rather than slipping in.
    const callers = lines.filter(l => /\bsetLocalInputs\(/.test(l)).length;
    expect(
      callers,
      "setLocalInputs caller count changed — classify the new call site as a " +
        "user edit (add it to GUARDED_MUTATORS and guard it) or as a non-edit " +
        "assignment (scenario switch / history step / discard / server response), " +
        "then update this count.",
    ).toBe(15);
  });
});
