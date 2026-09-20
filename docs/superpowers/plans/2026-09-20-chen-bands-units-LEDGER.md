# Chen Bands & Units — Live Task Ledger

**Updated:** 2026-09-20 · **Branch:** `chen-bands-units-impl` · **Worktree:** `/private/tmp/chen-impl`
**Plan:** `2026-09-20-chen-bands-units.md` · **Spec:** `2026-09-19-chen-bands-units-design.md`

This is the running record of execution state. It is updated at every checkpoint — after each task lands, after each gate, and whenever a blocker or deviation appears. The plan says what to build; **this file says what is actually true right now.**

Status key: ✅ landed & gate-verified · 🔄 in flight · ⬜ queued · ⛔ blocked · ⏸ deferred to Pass 2

---

## Pass 1 — backend only (no overlap with the concurrent `workspace-fixups-2` bundle)

| # | Task | Status | Commit | Owner | Notes |
|---|---|---|---|---|---|
| T1 | `@workspace/units` pure package + monorepo wiring | ✅ | `6b01f03` | backend-eng | 25 tests. `typecheck:libs` proves the project reference is genuinely wired, not just present in JSON. |
| T2 | `solve_jobs.result` + `scenarios.result_run_id` | ✅ | `08d3388` | backend-eng | Both nullable. FK `ON DELETE SET NULL` verified by psql introspection. `AnyPgColumn` annotation resolves the real import cycle. |
| T3 | Chen free-band input contract | ✅ | `7e0570f` | backend-eng | `[high,max]` overwrite removed. Preservation proven on **all three** write paths (create / whole-input PATCH / import-apply-to-storage). |
| T3b | Sibling band schemas → positive numbers | ✅ | `35bc4fa` | backend-eng | `.int()` dropped in pMedian/transportLp/twoEchelon + 4 manifests. **JADE deliberately excluded** — see Blocker B1. |
| — | docs: decision 1j amendment + T3b re-scope | ✅ | `37ac980` | controller | Re-committed after Incident I2 destroyed the original. |
| T5 | OpenAPI contract + codegen | 🔄 | — | backend-eng | `resultRunId`, export `unit`/`runId` params, distance-bands PATCH, **v1/v2/v3 `oneOf` envelope families**. |
| T6 | `jobRunner` single-transaction `markSucceeded` | ⬜ | — | — | Depends on T2. Writes job + scenario atomically on both solver and cache-hit paths. |
| T7 | `services/templates.ts` — v2 input files, v3 output files, band recompute | ⬜ | — | — | Depends on T1 (shared helpers) + T5 (shapes). Sole writer of that file. |
| T8 | `services/import.ts` — read unit, convert to canonical | ⬜ | — | — | After T7 (consumes its column constants). |
| T9 | Routes — `unit=`, `runId`, field-scoped bands PATCH | ⬜ | — | — | Depends on T5/T6/T7. New `routes/distanceBands.ts` with atomic `jsonb_set`. |

## Pass 2 — frontend, deferred

⛔ **Blocked on the `workspace-fixups-2` bundle landing.** Every task below touches a file that bundle also owns.

| # | Task | Why deferred |
|---|---|---|
| T3b-JADE | `jadeInputs.ts` `.int()` drop + `two-echelon-jade-us` manifest | fixups-2's `[T4]` is sitting on the exact same lines |
| T1b | `studio/src/lib/bands.ts` → re-export shared classifier | fixups-2 edits `lib/bands.ts` |
| T4 | Remove the 199M hint (both surfaces) | fixups-2's INT owns `SolveDialog` / `OptimizationParametersTab` |
| T10 | `UnitContext` + toggle + `formatObjective` wrapper + `useDistanceDraft` | downstream of the above |
| T11 | Read-path de-hardcoding | fixups-2 edits `NetworkMap.tsx` |
| T11b | `ExportContext` + helper + `exportEntity.ts` signature | — |
| T12 | Write-path draft contract (4 distance editors) | — |
| T13 | Chen band editor + live coverage + 3 band surfaces | fixups-2 edits `ServiceStatsTab.tsx` |
| T14 | `Workspace.tsx` integration + `ExportProvider` mount | fixups-2 edits `Workspace.tsx` (9 refs) |
| T14b | Convert all 26 export controls | — |
| T15 | QA — real browser | last |

**Pass 2 entry checklist (do not skip):**
1. Confirm fixups-2 merged to `main`.
2. Rebase `chen-bands-units-impl` onto `main`; resolve.
3. **Re-derive every pinned line reference** — they will have moved: `SolveDialog.tsx:165-175`, `ServiceStatsTab.tsx:27-31`, `Workspace.tsx:2935/3311/3326/3357/3599`, `JadeBandEditor.tsx:87/89`, `JadeFlowsTab.tsx:136/210/218`, `AssignmentsTab.tsx:107/137`, `FlowsTab.tsx:78`.
4. Re-count the export inventory (`24 calls / 15 files + JADE's 2 client CSVs`) — fixups-2 may have changed it.
5. Verify fixups-2's JADE `.min(1)` is present before dropping `.int()`; **do not restore `.length(4)`**.

---

## Blockers

| id | Blocker | State |
|---|---|---|
| **B1** | **Duplicate JADE-band decision.** fixups-2 `[T4]` (`e6ca4ef`) relaxed JADE to `.min(1)` but kept `.int()`; this bundle needs `.int()` dropped. | **Resolved by decision** — spec 1j amended to the *union* of both relaxations: `z.array(z.number().positive()).min(1)` + strict ascent. Implementation deferred to Pass 2 to avoid editing the same hunks concurrently. |
| **B2** | Pass 2 cannot start until fixups-2 merges. | Open — see Monitor. |

## Incident log

| id | Incident | Impact | Resolution |
|---|---|---|---|
| **I1** | **Cross-file sweep — root cause now known.** `git commit -m "..." -- <paths>` commits the **working-tree** content of those paths and **bypasses the index**. T2 correctly staged only its hunk with `git add -p` and verified via `git diff --cached`, then passed a pathspec — which discarded that staging and swept all 7 of T3's in-flight `routes.test.ts` hunks. | Content correct and tested; attribution wrong (T3's Chen band tests live in T2's commit `08d3388`). | Accepted — rewriting shared history with agents mid-flight is riskier than the cosmetic mis-attribution. **The plan's own "always use an explicit pathspec" rule was the cause and has been corrected.** |
| **I2** | **Destructive `git reset HEAD~1`.** T2 ran it to undo its own over-broad commit from I1 — but a controller commit had landed on top in the interim, so `HEAD~1` destroyed *that* instead. T2's own commit survived, leaked hunks and all. | Discarded controller commit `5199c20` (spec 1j amendment). | Detected via reflog; working tree matched the lost commit byte-for-byte; re-committed as `37ac980`. |
| **I3** | 2 transient api-server failures on a chained 4-suite run. | None. | Clean on isolated re-run (1015/1015). Matches this repo's documented `cors`/`resultEnvelope` CPU-contention flake class. Names not captured before the clean pass — called environmental on that basis, not a root-cause. |

**Process change after I1+I2 (corrected):** parallel dispatch into a shared worktree is **discontinued**; T5 onward run **sequentially**. The commit rule is now the opposite of what the plan originally said:

> Stage with `git add`/`git add -p` → verify with `git diff --cached` → `git commit` with **NO pathspec** (index-only). A pathspec re-reads the working tree and sweeps concurrent edits.

Every agent prompt also forbids `reset` / `rebase` / `stash` / `checkout <branch>`.

## Deviations from the plan (accepted, hard rule #8)

| Task | Plan said | Reality | Call |
|---|---|---|---|
| T1 | add dep to studio `dependencies` | studio has **zero** `@workspace` entries in `dependencies`; `@workspace/api-client-react` lives in `devDependencies` | Followed the repo's existing pattern. Functionally identical for a `workspace:*` link. |
| T3 | add a `maxDistKm > highServiceDistKm` refine | Already enforced by a pre-existing `superRefine` | Declined to add a duplicate rule. |
| T3b | tests live in `validation/inputs/__tests__/*` per model | Only true for pMedian; transportLp/twoEchelon are tested in `src/__tests__/` | Used the real locations. |
| T3b | may need a manifest-hash fixture update | `computeSha256()` hashes only `dataset/*.json`, never `manifest.json` | No fixture change needed — traced, not guessed. |

## Gate history

| When | typecheck | api-server | units | dataset-schema | studio | solver pytest |
|---|---|---|---|---|---|---|
| Baseline (pre-work) | clean | 989/989 | — | — | 1768/1768 | 176/176 |
| After Wave 0 (T1·T2·T3·T3b) | clean | **1015/1015** | 25/25 | 38/38 | 1768/1768 | not re-run (no Python touched) |

`e2e_accuracy.py` is **not** re-run per-wave — no Python is touched in this bundle. It runs once at T15.

**Every DB-touching command needs** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline, or DB tests fail at *collection* (not assertion) with "DATABASE_URL must be set".

## Monitor — `workspace-fixups-2`

Branch `workspace-fixups-2-2026-09-20` · worktree `.claude/worktrees/jade-ch9`

| Checked | Tasks done | Merged to `main`? | Tip |
|---|---|---|---|
| Wave 0 dispatch | 5 of 13 + INT + QA (T1–T5) | no — `main` still docs-only | `f2e2669` |
| Wave 0 gate | 5 — no movement | no | `f2e2669` |

Files it has already touched that Pass 2 depends on: `lib/bands.ts`, `NetworkMap.tsx`, `JadeFlowsTab.test.tsx`, `jadeInputs.ts`, `routes.test.ts`, `EntityMarkers.tsx`, `chapters.ts`.

**Check command:**
```bash
git log --oneline main..workspace-fixups-2-2026-09-20 | head -20
git log main -3 --name-only --pretty=format: | grep -vE '^docs/|^$'   # non-empty => it has merged code
```
