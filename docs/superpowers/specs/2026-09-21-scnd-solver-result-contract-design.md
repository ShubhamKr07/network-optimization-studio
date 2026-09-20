# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status:** Implementation-ready draft; **P0R.1 is a go/no-go spike that gates P0R.3.** Pending user sign-off. Incorporates the §14 split-map review (2026-09-20 program doc) and its Q4–Q9 decisions.
**Program context:** Carved out of the SCND scaling program (`2026-09-20-scnd-scaling-phase0-design.md`, §13 ledger) per Q1=Split. Near-term, standalone deliverable: fix the verified result-status defect with a truthful, versioned contract. No dependency on the deferred reliability/queue/measurement work.

**Goal:** Replace the hardcoded `status:"optimal"` envelope with a truthful two-dimensional outcome contract (`solutionStatus` + `terminationReason`), enforce cross-field invariants, migrate every consumer, and correct the sacred `e2e_accuracy.py` under the approved rule-#2 override (Q4) without changing any golden objective value.

**Out of scope (other specs):** durable queue / restart-safety / worker split / scheduler / horizontal scaling / single-flight / retention / stale-result CAS publication guard (→ B2 spec); benchmark harness, MIP-start, warm-worker, Render plan matrix + topology comparison (→ measurement spec); student-facing Quick mode (→ later).

---

## 1. Problem (verified 2026-09-21)

`solve.py` returns `_envelope("optimal", status_str, …)` on every non-infeasible path (`solve_jade` ~line 1186): envelope `status` is hardcoded `"optimal"`, real CBC status (`LpStatus[prob.status]`) only in `quality`. A gap-stopped or time-limited incumbent is reported as proven-optimal — a teaching-integrity defect. All solve functions share `_envelope`.

Requested tolerance does **not** determine achieved status. PuLP 3.3.2's `COIN_CMD.get_status()` can map a `Stopped … objective` header to `LpStatusOptimal` while the separate solution status is integer-feasible. So `LpStatus`, requested gap, and wall-clock inference are all insufficient — classification must read CBC's actual terminal records.

**The sacred test is not gap-0-only (corrected, §14.1).** `e2e_accuracy.py` runs several protected cases at `gap=0.05` that assert `status=="optimal"`: Brazil BASE `gap=0.05` (line 340) with P=5/7/10 asserting optimal (388); single-source `gap=0.05` (368–369, 427); cross-model Brazil `gap=0.05` (604); TR-3 single-source 5% (246). A CBC probe of Brazil P=5/cap=20M (obj 27022899653.80, bound 26971509401.152) confirms these are **gap-limited feasible incumbents, not proven optimal.** The earlier "e2e only runs gap=0 → byte-identical alias" premise was wrong.

## 2. Target contract

### 2.1 Two dimensions

- `solutionStatus`: `optimal | feasible | infeasible | unbounded | no_solution | error`
- `terminationReason`: `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`

### 2.2 Fields

- `envelopeVersion`: integer discriminator (`1` = legacy shape, `2` = this contract).
- `status`: **retained, truthful, expanded** (Q9). Deprecated but kept for un-migrated readers; its value now equals a fixed projection of `solutionStatus` (§2.3) — no longer collapses everything to `"optimal"`. Expanding its value set is an **explicit versioned breaking change**; all internal readers migrate atomically.
- `objective`: **nullable** — `null` when no incumbent (infeasible/unbounded/no_solution/error). No `0` sentinel.
- `quality`: **derived-only/deprecated** — a deterministic function of (`solutionStatus`, `terminationReason`, `achievedGap`), not an independent field.
- `infeasibilityReason`: retained; populated for `infeasible`.
- Nullable-when-unavailable metadata (never `0`): `requestedGap`, `achievedGap`, `bestBound`, `incumbentObjective`, `configuredTimeLimitSec`. (`runTimeSec` exists.)

### 2.3 `status` projection (Q9 — truthful, not lenient)

`optimal→"optimal"`, `feasible→"feasible"`, `infeasible→"infeasible"`, `no_solution→"no_solution"`, `unbounded→"unbounded"`, `error→"error"`. This **expands** the old two-value (`optimal`/`infeasible`) set — a breaking change handled by migrating all internal readers in P0R.3 and correcting `e2e_accuracy.py` per Q4. The compatibility guarantee is **not** "byte-identical output" (adding fields changes the JSON); it is: **golden objective values unchanged, and the protected suite's mathematical invariants preserved** (§3, P0R.4).

### 2.4 Allowed-pair + metadata invariant matrix (§14.4) — enforced identically in Python, Zod, and API validation

| `solutionStatus` | allowed `terminationReason` | incumbent/objective | achievedGap / bestBound |
|---|---|---|---|
| `optimal` | `optimality_proven` | non-null, `objective===incumbentObjective` | achievedGap 0 (or null); bestBound=objective when available |
| `feasible` | `gap_limit \| time_limit \| node_limit \| interrupted` | non-null, `objective===incumbentObjective` | achievedGap+bestBound present when CBC exposes them, else null |
| `infeasible` | `infeasible` | both null | null |
| `unbounded` | `unbounded` | both null | null |
| `no_solution` | `time_limit \| node_limit \| interrupted` (no incumbent) | both null | null |
| `error` | `solver_error` (or an explicitly-approved infra reason) | both null | null |

Also: `objective===incumbentObjective` whenever an incumbent exists; both null otherwise; `status` equals the §2.3 projection; `quality` derived deterministically. Any other combination is **rejected** by the schema (e.g. `optimal`+`time_limit`, non-null incumbent with `infeasible`, `envelopeVersion:2` missing a status dimension, `envelopeVersion:1` claiming `optimality_proven`).

### 2.5 Legacy representation (Q5 — one exact shape)

Normalized legacy view (read-time only, no backfill/re-solve): `envelopeVersion:1`, `solutionStatus:null`, `terminationReason:"unknown"`, `legacyUnverified:true`, raw legacy `status` preserved separately for display/debug. A historical `status:"optimal"` is **never** promoted to proven — its proof state is unknowable (it may have been a gap/time-limited result). The v2 `solutionStatus` enum stays clean (no `legacy_unverified` member).

### 2.6 Job-lifecycle + cache/publish policy (§14.2, Q6) — a branch **before** cache-write/`markSucceeded`

Today `jobRunner.ts` caches + `markSucceeded` unconditionally once Zod passes; a valid `error` envelope would be cached and published as succeeded. P0R.3 adds:

| `solutionStatus` | job lifecycle | cache | publish to scenario |
|---|---|---|---|
| `optimal` | succeeded | yes | yes |
| `feasible` | succeeded | yes, **only with the full gap/time/version cache key** | yes, labelled non-proven |
| `infeasible` | succeeded (math outcome) | yes | yes |
| `unbounded` | succeeded (math outcome) | yes | yes |
| `no_solution` | succeeded (math outcome) | **no** (caching could block a later retry from ever solving) | yes, as no-incumbent (never numeric zero) |
| `error` | **failed** | **no** | **no** |

Tests cover job status, result summary, telemetry, cache write/no-write, and scenario publication for every row. (The stale-result *older-overwrites-newer* CAS guard remains B2 — this branch only stops mislabelled/error envelopes from being cached/published.)

## 3. Tasks

### P0R.1 — CBC termination-evidence spike (**go/no-go; gates P0R.3**, §14.5/Q8)

In pinned PuLP 3.3.2, `COIN_CMD.solve_CBC()` creates the `.sol` filename internally, reads it, deletes its temp files, then returns — the caller **cannot** parse the normal solution file afterward, and `keepFiles=True` names derive from repeated problem names (not concurrency-safe). Prove **one** integration:

- a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper exposing the unique temp paths, parsing **before** deletion; **plus a per-solve unique temp directory + unique problem name** (Q8 recommendation); or
- a controlled direct CBC subprocess invocation preserving PuLP's variable/constraint-name mapping.

Deliver `parse_cbc_termination(...) -> (solutionStatus, terminationReason, {achievedGap,bestBound,incumbentObjective})` + a note naming the authoritative CBC records. **Acceptance (go/no-go):** concurrent solves with the same model/problem name don't collide; cleanup on success/parser-error/timeout/process-kill; path-traversal-safe; **no artifacts written into the repo**. Never classify a time-limit stop by wall-clock. **P0R.3 does not begin until this passes.**

- Files: `artifacts/api-server/src/solver/cbc_termination.py` (+ wrapper), spike note.

### P0R.2 — parser unit tests (deterministic, §14.9/12.9)

Committed sanitized CBC log/solution **fixtures** for: optimal-proven, gap-limited-with-incumbent, time-limited-with-incumbent, time-limited-without-incumbent (`no_solution`), infeasible, unbounded. Tests map each → correct `(solutionStatus, terminationReason)` + metadata. **No live solving** — authoritative for time/gap/node-limit classification; CI never races a live timeout.

- Files: `tests/fixtures/cbc/*`, `tests/test_cbc_termination.py`.

### P0R.3 — contract + OpenAPI + frontend + compatibility + policy branch

- `solve.py`: `_envelope` gains `envelopeVersion`, two-dim status, nullable metadata; shared `_termination(...)` wraps P0R.1; every solve function routed through it; `objective` null when no incumbent; §2.4 invariants asserted.
- `jobRunner.ts`: the §2.6 policy branch **before** cache-write/`markSucceeded`.
- `openapi.yaml`: `SolveResult` as a v1/v2 discriminated union (§2.2/2.5), `status` documented deprecated/expanded; **regenerate `lib/api-zod` + `lib/api-client-react` same commit** (rule #1).
- `resultEnvelope.ts` (Zod): match, incl. §2.4 rejection + §2.5 legacy shape.
- **Frontend:** render by `(solutionStatus, terminationReason)` — at least `feasible+gap_limit`, `feasible+time_limit`, `no_solution+time_limit`; "No incumbent" for null objective (no `?? 0`); `quality.ts` derives from `terminationReason`/`achievedGap`.
- **Consumer migration (atomic, §14.2/12.5/Q9):** OpenAPI, `ResultEnvelopeSchema`, `solve_jobs` result summary, Studio + Workspace views, `quality.ts`, telemetry (`solve-completed`), exports/templates, result-cache validation, API tests, smoke checks.

### P0R.4 — integration tests + Q4 sacred-test correction + gate

- `test_result_contract.py`: deterministic optimal + infeasible from real solves; time/gap/node-limit via an **injectable seam or committed subprocess fixture**, not a wall-clock race.
- Frontend tests for every newly visible outcome + the normalized-legacy path.
- `resultEnvelope.test.ts`: accepts v2 for all models; rejects §2.4 contradictions; accepts the v1 legacy shape.
- **`e2e_accuracy.py` correction (approved rule-#2 override, Q4):** every protected assertion on a `gap>0` run that currently requires `status=="optimal"` is corrected to the truthful `feasible` + `terminationReason=gap_limit`, asserting the incumbent is feasible and the existing **objective / monotonicity / A-vs-B invariants are preserved**. `gap==0` runs keep strict `optimal`. **No golden objective value changes.** This is the sole sanctioned edit to the sacred test; document the override in the commit body.
- **Acceptance:** full repo verification gate green; `e2e_accuracy.py` passes with the Q4-corrected assertions and unchanged objectives; a gap-stopped JADE/Brazil solve reports `feasible`+`gap_limit`; a legacy row renders `legacyUnverified`, never `optimal`.

## 4. Hard-rule guardrails

- **#2:** `e2e_accuracy.py` corrected **only** as the Q4 override permits — assertion semantics for approximate cases, **zero golden-objective changes**; gap-0 proofs stay strict. Human approval recorded (Q4, 2026-09-21).
- **#1:** OpenAPI + regen in one commit; generated code never hand-edited.
- **#4:** one task = one commit, `[P0R.N] <summary>`.
- No solver **math** changes (reporting/metadata only).

## 5. Task/deliverable summary

| ID | Task | Kind | Gate |
|---|---|---|---|
| P0R.1 | CBC termination-evidence spike (concurrency-safe capture/cleanup) | Code (spike) | **go/no-go; blocks P0R.3** |
| P0R.2 | Parser unit tests on committed CBC-log fixtures | Tests | — |
| P0R.3 | v2 contract + OpenAPI/regen + Zod + frontend + policy branch + consumer migration | Code + contract | after P0R.1 |
| P0R.4 | Integration tests + Q4 sacred-test correction + full gate | Tests | after P0R.3 |
