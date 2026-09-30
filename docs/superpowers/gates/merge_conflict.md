# Gate proposal: merge_conflict

**Symptom:** A long-lived branch and `main` both evolve the same hot files. Resolving the conflict can silently drop the other side's props or ids — and the most dangerous cases produce **no conflict marker at all**, so nothing prompts the resolver to look.

**Occurrences:**
- 2026-09-29 `ch5-delivery` — merging `main` into the branch.
- 2026-09-30 `CH4UX` — 7 conflicts merging Chapter 5 in. Three distinct failure shapes, only one of which git flagged:
  1. **Delete-hunk vs modify-hunk** in `Workspace.tsx`: `main`'s `pMax` and four `ch5-del-10` props lived *inside* a JSX block this branch deleted when hoisting props into a shared object. Git flagged it — but "keep ours" was the natural resolution and would have dropped `delivery-teaching-us`'s cost controls **and** its P≤33 cap, with no test failure.
  2. **No conflict reported, real collision**: `main` added ten `data-testid`/`id`/`htmlFor` literals to `OptimizationParametersTab.tsx`. This branch made that component double-mountable and namespaced every id via `pid()`/`tid()`. The two edits never touched the same lines, so git auto-merged cleanly — leaving ten unprefixed ids in a component that now renders twice. A live duplicate-id bug, invisible to both git and the test suite.
  3. **A conflict boundary swallowed a closing `});`** in an add/add test-file resolution. Caught by `tsc`, not by reading the diff.

**Why a gate rather than more care.** Shape 2 is the one that matters: there is no marker, no failing test, and no diff hunk to review. The only thing that catches it is a check that knows the *invariant* — "every prop the call site passes must be in the shared object", "no bare id literal may exist in a double-mounted component".

**Proposed automated gate — two assertions, both cheap and both already written by hand during this merge:**

1. **No bare id literal in a namespaced component.** A test asserting
   `rg 'data-testid="[^"]|id="[^"{]|htmlFor="[^"{]'` over `OptimizationParametersTab.tsx` returns nothing. This is exactly the manual grep the CH4UX merge ran; promoting it to a test makes shape 2 impossible to merge silently. Generalise to any component taking an `idPrefix`/`testIdPrefix` prop.

2. **Prop-set parity.** A test asserting the set of props `<OptimizationParametersTab>` is mounted with equals the keys of `optimizationParamsBaseProps`, modulo a documented allow-list (`step`, `idPrefix`, `testIdPrefix`). This is the hand-run prop-set diff from the merge's 6-point checklist, and it catches shape 1 — a dropped prop becomes a failing assertion rather than a silently missing control.

**How to enable:** both as plain vitest tests under `artifacts/studio/src/__tests__/`, so they run in the existing studio gate with no CI change.

**Not proposed:** shortening branch life or forbidding hoists. Both are real mitigations but neither is automatable, and the plan already carries the "check local main isn't stale before merging" rule from the 2026-09-24 incident.

**Status:** proposed — awaiting human approval (not enabled)
