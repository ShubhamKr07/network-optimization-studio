# Chen Bands & Units — Session Handoff

**Written:** 2026-09-20 · **Branch:** `chen-bands-units-impl` · **Worktree:** `/private/tmp/chen-impl`
**Base:** rebased onto `main` @ `2f6916b`, **0 behind** at time of writing.

Everything a fresh session needs to resume this bundle without re-deriving it. The **spec** and **plan** are the normative documents — this file is state, context, and traps.

- Spec: `docs/superpowers/specs/2026-09-19-chen-bands-units-design.md` (nine review rounds; decisions 1–7, 1b–1k)
- Plan: `docs/superpowers/plans/2026-09-20-chen-bands-units.md` (19 tasks; nine plan-review rounds folded in)

---

## 1. Read this first — the three rules that cost us

**1. The controller must not commit while any agent is dispatched.** Two incidents came from this (I1, I4). In a shared worktree:
- `git commit` (bare) commits the **whole index** → sweeps another agent's staged files.
- `git commit -- <paths>` commits the **working tree** for those paths, **bypassing the index** → sweeps another agent's unstaged edits, and silently discards your own `git add -p` staging.

There is no "safe" commit form while someone else is working. Either be the only actor, or give each agent its own worktree.

**2. Agents must never run `git reset` / `rebase` / `stash` / `checkout <branch>` / `commit --amend`.** I2: an agent ran `git reset HEAD~1` to undo its own over-broad commit, but another commit had landed on top, so it destroyed the wrong one. Every agent prompt must carry this prohibition explicitly.

**3. `DATABASE_URL` is required or DB tests fail at *collection*, not assertion.**
```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
```
Without it you get `DATABASE_URL must be set` and 3–4 whole files fail to load — easily misread as real breakage.

---

## 2. Where execution stands

### Pass 1 — backend (chosen to avoid a concurrent bundle; see §4)

| # | Task | Status | Commit |
|---|---|---|---|
| T1 | `@workspace/units` pure package + monorepo wiring | ✅ | `6b01f03` |
| T2 | `solve_jobs.result` + `scenarios.result_run_id` | ✅ | `08d3388` |
| T3 | Chen free-band input contract | ✅ | `7e0570f` |
| T3b | Sibling band schemas → positive numbers (JADE excluded) | ✅ | `35bc4fa` |
| T5 | OpenAPI + codegen, v1/v2/v3 `oneOf` envelopes | ✅ | `673943c` |
| T6 | `jobRunner` single-transaction `markSucceeded` | ✅ | `386193f` |
| T7 | `services/templates.ts` — v2 input, v3 output, band recompute | ⬜ | — |
| T8 | `services/import.ts` — read unit, convert to canonical | ⬜ | — |
| T9 | Routes — `unit=`, `runId`, field-scoped bands PATCH | ⬜ | — |

**First action on resume:** `git log --oneline main..HEAD` and `git status --porcelain` — confirm the last `[Tn]` commit matches this table and the tree is clean. **T7 is next.**

### Pass 2 — frontend, deferred

⛔ Blocked on the `workspace-fixups-2` bundle (§4). In order: **T3b-JADE, T1b, T4, T10, T11, T11b, T12, T13, T14, T14b, T15.**

---

## 3. Gate

| Suite | Baseline | Now |
|---|---|---|
| typecheck | clean | clean |
| api-server | 989/989 | **1021/1021** |
| `@workspace/units` | — | 25/25 |
| dataset-schema | — | 38/38 |
| studio | 1768/1768 | 1768/1768 (unregressed) |
| solver pytest | 176/176 | not re-run — **no Python is touched in this bundle** |

`e2e_accuracy.py` runs **once, at T15**. It must pass unmodified (hard rule #2).

**Known flake:** `cors.test.ts` and `resultEnvelope.test.ts` fail intermittently when other worktrees on this machine run `tsc`/`vitest`/`vite` concurrently. They pass in isolation (verified 3/3 and 47/47). If only those fail, re-run isolated before reporting a regression. Anything else is real.

---

## 4. The concurrent bundle — why Pass 1 is backend-only

`workspace-fixups-2-2026-09-20` (worktree `.claude/worktrees/jade-ch9`) is executing in parallel. At last check: **6 commits, not yet merged to `main`.**

It claims files this bundle's Pass 2 owns:

| File | This bundle | fixups-2 |
|---|---|---|
| `pages/Workspace.tsx` | T14 sole writer | 9 references |
| `tabs/ServiceStatsTab.tsx` | T13 both halves | 2 references |
| `lib/bands.ts` | T1b re-export | 2 references |
| `SolveDialog` / `OptimizationParametersTab` | T13 | its INT task owns their tests |
| `NetworkMap.tsx` | T11 | already edited |

**Resolved decision collision (spec 1j, amended):** fixups-2's `[T4]` (`e6ca4ef`) relaxed JADE bands from `.length(4)` → `.min(1)` but **kept `.int()`**. This bundle needs `.int()` **dropped** (the unit toggle converts `500 km` → `310.6856 mi`, which `.int()` rejects). User decision: **union both relaxations** → final JADE shape `z.array(z.number().positive()).min(1)` + strict-ascent refine. The JADE half of T3b was deferred to Pass 2 so both bundles never edit the same hunks concurrently.

**Monitor command:**
```bash
git log --oneline main..workspace-fixups-2-2026-09-20 | head -20
git log main -3 --name-only --pretty=format: | grep -vE '^docs/|^$'   # non-empty ⇒ it has merged code
```

### Pass 2 entry checklist — do not skip

1. Confirm fixups-2 merged to `main`.
2. Rebase `chen-bands-units-impl` onto `main`.
3. **Re-derive every pinned line reference.** They *will* have moved: `SolveDialog.tsx:165-175`, `ServiceStatsTab.tsx:27-31`, `Workspace.tsx:2935/3311/3326/3357/3599`, `JadeBandEditor.tsx:87/89`, `JadeFlowsTab.tsx:136/210/218`, `AssignmentsTab.tsx:107/137`, `FlowsTab.tsx:78`.
4. **Re-count the export inventory.** Currently 24 `downloadEntityExport` calls across 15 production tab files, **plus** `JadeFlowsTab`'s two client-generated CSVs (`downloadClientCsv`/`handleDownloadPw`/`handleDownloadWc`) = 26 controls / 16 files. fixups-2 may change this.
5. Verify fixups-2's JADE `.min(1)` is present before dropping `.int()`; **do not restore `.length(4)`**.

---

## 5. Incidents

| id | What | Impact | Resolution |
|---|---|---|---|
| **I1** | Pathspec commit bypasses the index. T2 staged one hunk with `git add -p`, verified with `git diff --cached`, then passed a pathspec — discarding that staging and sweeping 7 of T3's in-flight `routes.test.ts` hunks. | Content correct; attribution wrong (T3's tests live in T2's commit `08d3388`). | Accepted. Rewriting shared history mid-flight was riskier than the mis-attribution. **Plan guidance was the cause and has been corrected.** |
| **I2** | Agent ran `git reset HEAD~1` to undo its own commit; a controller commit had landed on top, so it destroyed that instead. | Lost controller commit `5199c20`. | Recovered via reflog (working tree matched byte-for-byte), re-committed as `37ac980`. |
| **I3** | 2 transient api-server failures on a chained multi-suite run. | None. | Clean on isolated re-run. Documented flake class (§3). |
| **I4** | **Controller** bare-committed docs *while T5 was running*, sweeping T5's entire staged 45-file change into a docs commit under the wrong message. | T5's content intact but mis-committed. T5 correctly refused to rewrite history and escalated. | Split with `reset --soft` **after** T5 finished and no agent was running → `673943c [T5]` + `94d288a` docs. Re-gated green. |

---

## 6. Accepted deviations from the plan (hard rule #8 — trust the repo)

| Task | Plan said | Reality | Call |
|---|---|---|---|
| T1 | add dep to studio `dependencies` | studio has **zero** `@workspace` entries there; `@workspace/api-client-react` is in `devDependencies` | followed the repo's pattern; identical for a `workspace:*` link |
| T3 | add a `maxDistKm > highServiceDistKm` refine | already enforced by a pre-existing `superRefine` | declined to add a duplicate rule |
| T3b | per-model tests live in `validation/inputs/__tests__/` | only true for pMedian; transportLp/twoEchelon live in `src/__tests__/` | used the real locations |
| T3b | may need a manifest-hash fixture update | `computeSha256()` hashes only `dataset/*.json`, never `manifest.json` | no fixture change needed — traced, not guessed |
| T5 | literal YAML for the new PATCH | every sibling scenario route also documents `401` | added `401` for consistency |
| T5 | — | `UpdateDistanceBandsBody` hit the same ambiguous star-export collision already documented for `ExportScenarioParams` | added an explicit re-export in `lib/api-zod/src/index.ts` (not generated code) |

---

## 7. Environment

- **Worktrees:** ~45 exist on this repo; most are stale `jade-*` agent worktrees. Ours is `/private/tmp/chen-impl`. The docs-only branch `chen-bands-units` lives at `/private/tmp/chen-bands-units` (superseded by this branch — the impl branch contains both docs).
- **Never** touch `/Users/shubhamkr/network-optimization-studio` (the main checkout) — another session works there, and it has been switched between branches mid-session before.
- `pnpm` only. Codegen is `pnpm --filter @workspace/api-spec codegen` (**not** `generate`).
- Generated code (`lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`) is **never** hand-edited; change `openapi.yaml` and regenerate, committing both together.

## 8. Deferred / out of scope (recorded, deliberately not done)

- Gold's `buildAssignmentRows` maps **all** edges with no leg filter, so its assignments export includes `mine_to_refinery` rows. **Pre-existing defect**, not introduced here; this bundle changes only the `band` value, never a row source.
- An explicit "restore an older entry's inputs" action (decision 1h removed the implicit one; `Save as scenario` covers the real use case).
- JSON import — import stays CSV-only.

## 9. Post-merge obligations

- `/harness-retro chen-bands-units` — a branch is not finished until this has run.
- **Deploy is outward-facing: surface it and get explicit confirmation before triggering.** `autoDeploy` does **not** fire for this repo; both `nos-api` and `nos-studio` need a manual `trigger_deploy`.
