# SCND Correctness — Minimal Fix (Option B) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit. Steps use `- [ ]`.

**Goal:** Eliminate the one verified, production-visible defect — `solve.py` reports `status:"optimal"` even when CBC stopped on a gap/time limit — at the smallest footprint. New solves emit a truthful outcome; old stored results are shown without a false proven-optimal claim. **No** queue/rollout/process-supervisor/cache-identity/single-flight work (that is Option A / the B2 spec, cohort-gated).

**Architecture:** Reuse the P0R.1 spike's `cbc_termination.py` (already on this branch): run CBC with a captured `logPath`, classify termination from the real CBC records, and set the envelope status truthfully. Additive contract fields; a lightweight read-path guard for legacy rows (presence-check, **not** the full five-schema/envelopeVersion apparatus).

**Tech stack:** Python (PuLP 3.3.2/CBC) · Express+Drizzle · OpenAPI/Orval/Zod · React.

## Global constraints (from the correctness spec + §34, scoped to B)

- **Hard rule #2 / DEC-2026-09-21-01** (issue #19): `e2e_accuracy.py` may have its **`gap>0` assertions corrected** to the truthful `feasible/gap_limit` from committed CBC evidence, **zero golden-objective changes**; `gap=0` cases stay strict `optimal`. This is the only sanctioned edit to the sacred test.
- Public `status` stays a truthful projection of `solutionStatus` (`optimal→"optimal"`, `feasible→"feasible"`, `infeasible→"infeasible"`, `no_solution→"no_solution"`, `unbounded→"unbounded"`). Expanding its value set is a versioned change; migrate internal readers.
- Objectives stay model/mode-specific (unchanged — preserves goldens). No solver-math change.
- **Excluded from B (→ A/B2):** `solve_jobs` failure/limit columns, fd3 private protocol + errorCode taxonomy, Node process-group supervisor + no-orphan proof, composite cache identity / v2 cache, single-flight, staged v1→v2 rollout, telemetry contract changes, requested/effective limit fields.

---

## Task B1 — parser hardening (fold §34 findings into the spike code)

**Files:** Modify `artifacts/api-server/src/solver/cbc_termination.py`; Modify `artifacts/api-server/src/solver/tests/test_cbc_termination.py`.

- [ ] **§34.2.10 contradiction fix:** when both log and `.sol` are present, `classify_cbc_termination` must **require agreement** for `unbounded` (as it already does for infeasible/gap); disagreement (e.g. optimal-log/unbounded-`.sol`) → an internal parse failure, not a silent `unbounded`. Add negative tests for optimal-log/unbounded-`.sol` and unbounded-log/optimal-`.sol`.
- [ ] **§34.3.1 fail-closed on unsupported PuLP:** the capture hook depends on PuLP internals; if the running PuLP major/minor differs from the validated `3.3.2`, **raise** (fail closed) rather than warn. Test the raise.
- [ ] **§34.3.4 enum alignment:** remove `interrupted` from the parser's `TERMINATION_REASONS` (it's never a parser output — Node-only failure taxonomy, out of B's scope); keep `unknown` for the legacy read path only.
- [ ] Run: `python3 -m pytest tests/test_cbc_termination.py -v` → all pass (incl. new negatives).
- [ ] Commit: `[B1] harden cbc_termination: reject contradictory evidence, fail closed on unsupported PuLP, drop interrupted`.

## Task B2 — solve.py emits truthful status via captured CBC log

**Files:** Modify `artifacts/api-server/src/solver/solve.py`; Modify `artifacts/api-server/src/solver/tests/e2e_accuracy.py` (DEC-2026-09-21-01 only); Test: `artifacts/api-server/src/solver/tests/test_truthful_status.py` (new).

- [ ] Route each model's solve through a shared helper that runs CBC with a **unique `logPath`** (currently `/dev/null`) using the spike's `CapturingCBCSolver`/`solve_with_capture`, then calls `parse_cbc_termination` and sets the envelope `solutionStatus` + `terminationReason` from the **real CBC records** (never from the requested gap or wall-clock). `objective` derivation per model is unchanged.
- [ ] `_envelope` gains `solutionStatus` + `terminationReason` (+ nullable `achievedGap`/`solverIncumbentObjective`/`solverBestBound`); the legacy `status` becomes the truthful projection (no longer hard-coded `"optimal"`).
- [ ] **DEC correction:** in `e2e_accuracy.py`, the `gap>0` cases (Brazil BASE/P=5/7/10, single-source 5%, cross-model, TR-3) assert the truthful `feasible`+`gap_limit` (feasible incumbent + preserved objective/monotonicity invariants); `gap=0` cases keep strict `optimal`. **Zero golden-objective changes.** Document DEC-2026-09-21-01 in the commit body.
- [ ] `test_truthful_status.py`: a gap-stopped solve → `feasible`/`gap_limit`; a proven solve → `optimal`/`optimality_proven`; an infeasible → `infeasible`.
- [ ] Run: `python3 -m pytest tests/ -x` (all solver tests) **and** `python3 tests/e2e_accuracy.py` → 99/99 with the corrected assertions, objectives unchanged.
- [ ] Commit: `[B2] solve.py: truthful solutionStatus/terminationReason from captured CBC log (DEC-2026-09-21-01)`.

## Task B3 — contract + backend read-path

**Files:** Modify `lib/api-spec/openapi.yaml` (+ regen `lib/api-zod`, `lib/api-client-react` same commit); Modify `artifacts/api-server/src/solver/resultEnvelope.ts`; Modify `artifacts/api-server/src/routes/scenarios.ts` (read-path legacy guard); Tests alongside.

- [ ] OpenAPI `SolveResult`: add `solutionStatus` (enum), `terminationReason` (enum), nullable `achievedGap`/`solverIncumbentObjective`/`solverBestBound`; `status` documented as the deprecated truthful projection. Regenerate Zod + React-Query in the **same commit** (hard rule #1).
- [ ] `resultEnvelope.ts` (Zod) matches; accepts new v2-shaped results.
- [ ] **Lightweight legacy guard (no envelopeVersion/5-schema machinery):** on read, a stored result **missing `solutionStatus`** is treated as **legacy-unverified** — its `status` is **not** promoted to a proven-optimal claim in the API response (surfaced as `solutionStatus: null` / unverified). Old rows re-solve to become truthful; no backfill.
- [ ] Tests: api-server accepts a v2 envelope; a legacy (no-`solutionStatus`) stored row reads as unverified, never proven.
- [ ] Commit: `[B3] OpenAPI/Zod SolveResult truthful status + read-path legacy-unverified guard (+regen)`.

## Task B4 — frontend renders the truthful outcome

**Files:** Modify `artifacts/studio/src/lib/quality.ts`; Modify Studio/Workspace result views (`Studio.tsx`/Workspace output tabs); Tests (RTL).

- [ ] `quality.ts` derives its wording from `terminationReason`/`achievedGap` (not the requested gap): `feasible/gap_limit` → "Feasible — within gap", `time_limit`/`node_limit` → their strings, `optimal` → "Proven optimal".
- [ ] Result views render `feasible`/`no_solution` distinctly (not the catch-all "Error"); a null objective shows "No incumbent" (no `?? 0`); a **legacy-unverified** result shows a neutral badge, never "Proven optimal".
- [ ] RTL tests for each newly visible outcome + the legacy-unverified badge.
- [ ] Commit: `[B4] frontend: truthful solve-outcome rendering + legacy-unverified badge`.

## Task B5 — QA (real browser) + gate

**Files:** `artifacts/studio/e2e/truthful-status.spec.ts` (new).

- [ ] `qa-sdet`, real Playwright against local dev servers: solve a **Brazil scenario at `gap=0.05`** → the UI shows a **within-gap / feasible** outcome, **not** "Proven optimal"; solve a fast `gap=0` model → "Proven optimal". Run twice, green.
- [ ] Full verification gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)` + **direct** `python3 tests/e2e_accuracy.py` (99/99, DEC-corrected).
- [ ] **`e2e_journey.py`:** stays in its pre-existing broken state (removed `/login`); B does **not** repair it — documented gate exception (repair is separate scope). Note it in the commit body.
- [ ] Commit: `[B5] QA: real-browser truthful-status spec + gate`.

## Self-review checklist

- [ ] Every B task references only B-scope changes; nothing from the excluded list leaked in.
- [ ] `status` truthful projection keeps `e2e_accuracy` `gap=0` cases byte-identical; only `gap>0` assertions change, objectives unchanged (DEC-2026-09-21-01).
- [ ] No `solve_jobs` schema change, no fd3 protocol, no process supervisor, no cache change.
- [ ] Legacy rows never render as proven-optimal.

## After B → A

The deferred machinery (queue reliability, fd3 failure protocol + errorCode, process-group supervisor + no-orphan proof, composite cache identity/v2 cache, single-flight, staged rollout, telemetry) is **Option A / the B2 spec** — the already-written full contract in `2026-09-21-scnd-solver-result-contract-design.md` becomes A's design, revisited with real cohort telemetry (validating the 50×50 + 20/60/20 load assumptions) before build.
