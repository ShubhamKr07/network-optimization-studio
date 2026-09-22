# SCND Correctness — Full Contract (Option A) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit. Design source: `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (§§2–3; ~19 review rounds, decisions Q4–Q72). This plan turns that contract into executable tasks. **Runs AFTER Option B ships.**

**Goal:** Make the async solve path *reliable and truthful under concurrency*: durable payloads, safe process supervision, exhaustive failure taxonomy, versioned result cache, and a safe v1→v2 rollout — the reliability layer B deliberately deferred.

**Gating (must clear before A2+ execute):**
- **G-cache (Q35/Q41):** run the CBC-build smoke check on the deployed service; pin the authoritative CBC binary id (2.10.3 vs 2.10.10) — input to the composite cache identity. **No v2 cache task ships until this is a known value.**
- **G-review:** the consolidated approval review §34 required (post-spike) must pass. This plan assumes it did; if it surfaces changes, fold them before A execution.
- **Cohort gate:** per the reassessment, A is justified only once a real (or synthetic-load-proven) cohort shows reliability pain. Do not execute speculatively.

## Global constraints (from the contract)

- Hard rules #1 (OpenAPI+regen one commit), #2 (`e2e_accuracy.py` — B already applied the DEC correction; A must not change goldens), #3 (nullable-add + drizzle push), #4 (one task = one commit), #6 (no solver-math branches).
- Builds on B: B already ships truthful `solutionStatus`/`terminationReason` on the envelope + read-path legacy guard. A adds the *failure*, *durability*, *cache*, and *rollout* layers.

---

## Task A1 — `solve_jobs` durable schema (§2.11/§2.12/Q59/Q61/Q68)

**Files:** `lib/db/src/schema/solve_jobs.ts`; migration via `drizzle-kit push`; `artifacts/api-server/src/solver/jobRunner.ts` (enqueue writes).
- [ ] Add **nullable** columns: `failure_reason` (enum), `failure_stage` (enum), `error_detail` (text ≤2 KiB), `error_code` (enum), `requested_gap` (double precision), `requested_gap_source` (enum `request|default`), `requested_time_limit_sec` (integer), `requested_time_limit_source` (enum). Historical rows stay null forever (§32.2.4).
- [ ] `enqueueSolveJob` writes requested values/sources atomically at enqueue.
- [ ] Tests: enqueue-atomicity, historical-null tolerance, restart reconstruction of `error_code`.
- [ ] Commit: `[A1] solve_jobs durable failure + requested-limit columns`.

## Task A2 — fd3 private `SolverProcessMessage` (Python side) (§2.11/Q52/Q64/Q71)

**Files:** `artifacts/api-server/src/solver/solve.py`; `artifacts/api-server/src/solver/cbc_termination.py` (reuse B1's parser).
- [ ] `solve.py` emits, on **fd 3**, exactly one newline-terminated JSON object `{envelope | failure}` (success-envelope-xor-failure), ≤1 MiB, close-on-exec before spawning CBC. Success = the B v2 envelope; failure = `{failureReason, failureStage, errorDetail}` with structured allowlisted detail (never raw stdout/exception).
- [ ] Map every current `_load_error_envelope`/error exit → the failure branch with the right `failureReason`/`failureStage`.
- [ ] Tests: each failure site emits the right failure; oversize/partial/extra-line → internal_error at the reader.
- [ ] Commit: `[A2] solve.py emits fd3 SolverProcessMessage (success-xor-failure)`.

## Task A3 — Node process-group supervision + no-orphan (§2.11 race table/Q38/Q46)

**Files:** `jobRunner.ts`.
- [ ] Spawn Python **detached (process-group leader)**, read fd 3, on outer timeout/cancel send TERM→(grace)→KILL to the **whole group**, wait/reap the Python child + probe group death, **Node owns** the per-solve temp dir (mkdtemp → pass validated path → idempotent removal after group death).
- [ ] Implement the **once-only race-precedence** state machine (timeout > cancel > exit-code×message×cleanup) from §2.11.
- [ ] **Go/no-go acceptance test on Linux:** record Python+CBC PIDs/PGID, force timeout + forced-kill (incl. killed-parent/CBC-alive), prove no survivor, temp reclaimed, publish-once, repeated-timeout leak-free.
- [ ] Commit: `[A3] Node process-group supervisor + no-orphan proof`.

## Task A4 — five schemas + OpenAPI + Zod + normalizer + composition (§2.6/Q65)

**Files:** `lib/api-spec/openapi.yaml` (+regen `lib/api-zod`/`lib/api-client-react` same commit); `resultEnvelope.ts`; `routes/scenarios.ts`.
- [ ] `SolverSuccessEnvelopeV2` / `ResultCacheEntryV2` / `PublishedSolveResultV2` / `StoredScenarioResult` / `NormalizedSolveResult` + `composePublishedResult(cacheableResult, job)` (attaches requested values on fresh + cache-hit). Assert only the published shape reaches `scenarios.result`/public APIs.
- [ ] §2.4 invariant rejection incl. no failure validates as any result shape.
- [ ] Commit: `[A4] five result schemas + composePublishedResult + normalizer`.

## Task A5 — public `errorCode` + `SolveJob.error` transition (§2.11/Q61)

**Files:** `openapi.yaml`(+regen), `jobRunner.ts`, `routes`.
- [ ] Exhaustive `failureReason`/Node-class → `errorCode∈{SOLVE_FAILED,TIMEOUT}` table + fixed safe messages (interruption → SOLVE_FAILED/"Solve interrupted"); `INPUT_INVALID` stays synchronous 422/no-job.
- [ ] Public `SolveJob.error` → derived safe message (never raw stored diagnostic); negative-leakage tests across job polling/history/exports/logs.
- [ ] Commit: `[A5] public errorCode + safe-message transition + leakage tests`.

## Task A6 — composite cache identity + v2 cache (§2.10/Q35 — needs G-cache)

**Files:** `jobRunner.ts` cache path; a version manifest module.
- [ ] Deterministic composite version: sorted file manifest (solve.py + cbc_termination + model/config) byte-framed + pinned PuLP + **authoritative CBC build id** (from G-cache) + `SOLVER_CONTRACT_VERSION`; fail-closed startup if any input unreadable; example hash vectors.
- [ ] v2 cache read/write keyed on it; parser/contract-version bump invalidates even with unchanged solve.py.
- [ ] Commit: `[A6] composite solver-contract cache identity + v2 cache`.

## Task A7 — staged v1→v2 rollout + rollback floor (§2.13/Q54/Q63)

**Files:** feature-flag config, deploy runbook doc.
- [ ] R1 (nullable schema + dual reader, writes v1) → R2 (frontend both-compatible + additive error field) → R3 (`v2_write` flag default-off → on after drain proof). Rollback floor = never below R1 after a v2 write; explicit legacy/v2 discrimination in new readers (not envelopeVersion-on-old-binary). Legacy stored-row reader retained indefinitely.
- [ ] Commit: `[A7] staged v1→v2 rollout config + runbook`.

## Task A8 — telemetry per emission site (§2.7.1/Q56) + Task A9 — QA/gate

- [ ] Telemetry: `scenario solve completed` (v2) / `scenario solve failed` (`errorCode` tag) / no legacy-read event; no payload/objective-input/path leakage; Sentry allowlist.
- [ ] QA (`qa-sdet`, real browser + Linux): the A3 no-orphan proof, a restart-mid-load reliability run (no stuck jobs), single-flight (N identical cold → 1 solve), full gate + direct `e2e_accuracy.py` (99/99 unchanged) + `e2e_journey.py` repair (onto `/auth/register`+`/auth/login`).
- [ ] Commit: `[A8] per-site telemetry + Sentry allowlist` · `[A9] QA no-orphan/restart/single-flight + full gate`.

## Ordering & parallelism

A1→A2→A3 (the failure/supervision spine, sequential). A4/A5 after A2. A6 after A4 + G-cache. A7 after A4/A5. A8/A9 last. Single-flight rides A6's cache identity. Dispatch via the agent team with pre-created locked worktrees (per the CLAUDE.md gotcha), controller cherry-picks + re-gates.
