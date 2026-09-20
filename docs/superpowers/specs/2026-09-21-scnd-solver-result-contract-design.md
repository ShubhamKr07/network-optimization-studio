# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status:** **Approved to execute P0R.1** (go/no-go CBC-evidence spike) **and the contract-independent P0R.2 fixture capture. P0R.3–P0R.4 are conditionally specified and require a post-spike design update + approval review** (§16.6/Q15). Incorporates the §14 and §16 reviews and decisions Q4–Q16.
**Sacred-test authorization:** **DEC-2026-09-21-01** — product owner explicitly approved a narrow `e2e_accuracy.py` correction (Q4 confirmed via Q10), **zero golden-objective changes**. Referenced by §3 P0R.4 and §4.
**Program context:** Carved from `2026-09-20-scnd-scaling-phase0-design.md` (§13 ledger) per Q1=Split. Standalone; no dependency on deferred reliability/queue/measurement work.

**Goal:** Replace the hardcoded `status:"optimal"` envelope with a truthful, versioned two-dimensional outcome contract, enforced by evidence and cross-field invariants, migrate every consumer, and correct the sacred test under DEC-2026-09-21-01 without changing any golden objective.

**Out of scope (other specs):** durable queue / restart-safety / worker split / scheduler / topology / single-flight / retention / stale-result CAS guard (→ B2); benchmark, MIP-start, warm-worker, plan matrix + topology comparison (→ measurement); Quick mode (→ later).

---

## 1. Problem (verified 2026-09-21)

`solve.py` returns `_envelope("optimal", status_str, …)` on every non-infeasible path (`solve_jade` ~1186): envelope `status` hardcoded `"optimal"`, real CBC status only in `quality`. Gap/time-limited incumbents are reported proven-optimal — a teaching-integrity defect shared by all solve functions.

Requested tolerance does **not** determine achieved status; PuLP 3.3.2 `COIN_CMD.get_status()` can map `Stopped … objective` to `LpStatusOptimal`. Classification must read CBC's actual terminal records — not `LpStatus`, requested gap, or wall-clock.

**Sacred test is not gap-0-only (§14.1):** `e2e_accuracy.py` runs protected `gap=0.05` cases asserting `status=="optimal"` (Brazil BASE 340, P=5/7/10 388; single-source 368–369/427; cross-model 604; TR-3 246). CBC probe of Brazil P=5/cap=20M: obj 27022899702 (app) vs CBC incumbent 27022899653.8, bound 26971509401.152 → **gap-limited feasible, not proven** — and the app vs CBC objective differ by ~48 (recompute/rounding, §16.3).

## 2. Target contract

### 2.1 Two dimensions

- `solutionStatus`: `optimal | feasible | infeasible | unbounded | no_solution | error`
- `terminationReason` (**closed enum**, §16.7): `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`

### 2.2 Fields

- `envelopeVersion`: `1` (legacy) | `2` (this contract).
- `status`: retained deprecated field. **Its current enum is `[optimal, infeasible, error]` — 3 values** (§16.7 correction). The v2 projection expands it (§2.3); this is an explicit versioned breaking change (Q9), internal readers migrate atomically.
- `objective` (public): the **app-canonical** value, computed/rounded exactly as today (Q12) — **unchanged, preserving goldens**. Nullable when no incumbent.
- `incumbentObjective`: CBC's **raw** incumbent float (solver evidence), nullable when no incumbent.
- `bestBound`: CBC's raw bound, nullable.
- `achievedGap`: derived from raw CBC values (§2.4), nullable.
- `requestedGap`, `configuredTimeLimitSec`: as sent. (`runTimeSec` exists.)
- `quality`: **derived-only**, exact string per pair (§2.5).
- `infeasibilityReason`: retained, populated for `infeasible`.
- `legacyStatus` (§16.4/16.7): present **only** on normalized v1 reads (the preserved raw historical `status`); absent on v2.

### 2.3 `status` v2 projection (Q9, truthful)

`optimal→"optimal"`, `feasible→"feasible"`, `infeasible→"infeasible"`, `no_solution→"no_solution"`, `unbounded→"unbounded"`, `error→"error"`. Expands the 3-value set; not "byte-identical". Compatibility guarantee = **golden objectives unchanged + protected-suite mathematical invariants preserved** (§3 P0R.4).

### 2.4 Invariant matrix (§14.4, corrected per Q12/§16.3) — enforced in Python, Zod, API

| `solutionStatus` | allowed `terminationReason` | objective / incumbent | achievedGap / bestBound |
|---|---|---|---|
| `optimal` | `optimality_proven` | both non-null | achievedGap 0 (or null); bound = incumbent when available |
| `feasible` | `gap_limit \| time_limit \| node_limit \| interrupted` | both non-null | present when CBC exposes them, else null |
| `infeasible` | `infeasible` | both null | null |
| `unbounded` | `unbounded` | both null | null |
| `no_solution` | `time_limit \| node_limit \| interrupted` | both null | null |
| `error` | `solver_error` | both null | null |

Numeric rules (Q12):
- `objective` = app-canonical; `incumbentObjective` = raw CBC. When an incumbent exists, enforce **`abs(objective - incumbentObjective) <= max(ABS_TOL, REL_TOL*abs(incumbentObjective))`** (defaults `ABS_TOL=1.0`, `REL_TOL=1e-6`) — **not `===`**. Both null together otherwise.
- `achievedGap = abs(incumbentObjective - bestBound) / (abs(incumbentObjective) + 1e-10)` from raw values; null when incumbent or bound absent. (Prefer CBC's own reported gap when reliably parsed; else this formula.)
- `status` equals the §2.3 projection; `quality` equals the §2.5 string. Any other combination is schema-**rejected**.

### 2.5 `quality` strings (exact, §16.7)

`optimal/optimality_proven`→"Proven optimal" · `feasible/gap_limit`→"Feasible — stopped at gap limit" · `feasible/time_limit`→"Feasible — time limit reached" · `feasible/node_limit`→"Feasible — node limit reached" · `feasible/interrupted`→"Feasible — interrupted" · `infeasible/infeasible`→"Infeasible" · `unbounded/unbounded`→"Unbounded" · `no_solution/*`→"No solution found" · `error/solver_error`→"Solver error".

### 2.6 Three schemas (§16.4/Q13)

1. **`SolverEnvelopeV2Schema`** — validates raw `solve.py` stdout **and all new cache writes**. v2 only; rejects `solutionStatus:null`; enforces §2.4. Raw solver output is **never** accepted as v1.
2. **`StoredResultSchema`** — validates persisted `scenarios.result` / `result_cache` in stored form (accepts historical v1 **and** v2).
3. **`NormalizedSolveResultSchema`** — the read/API/UI union: v2 as-is, or normalized-legacy `{envelopeVersion:1, solutionStatus:null, terminationReason:"unknown", legacyUnverified:true, legacyStatus:<raw>}`.

A dedicated **normalizer** converts a stored legacy row → normalized v1. Historical `status:"optimal"` is **never** promoted to proven (§2.7).

### 2.7 Legacy representation (Q5)

Read-time only, no backfill/re-solve. Proof state of a historical row is unknowable → `solutionStatus:null` + `legacyUnverified:true` + `legacyStatus` (raw). v2 enum stays clean.

### 2.8 Lifecycle + cache/publish policy (§14.2/Q6) — branch **before** cache-write/`markSucceeded`

| `solutionStatus` | job | cache | publish |
|---|---|---|---|
| `optimal` | succeeded | yes | yes |
| `feasible` | succeeded | yes, **only with full gap/time/version key** | yes, labelled non-proven |
| `infeasible` | succeeded | yes | yes |
| `unbounded` | succeeded | yes | yes |
| `no_solution` | succeeded | **no** (would block retry) | yes, no-incumbent (never zero) |
| `error` | **failed** | **no** | **no** |

## 3. Tasks

### P0R.1 — CBC termination-evidence spike (**go/no-go; gates P0R.3**, §14.5/Q8) — APPROVED TO EXECUTE

PuLP 3.3.2 `COIN_CMD.solve_CBC()` creates the `.sol` name internally, reads it, deletes temp files, then returns — the caller cannot parse it afterward; `keepFiles=True` names collide under concurrency. Prove **one**: a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper exposing unique temp paths + per-solve unique temp dir + unique problem name, parsing **before** deletion (Q8 recommendation); or a controlled direct CBC subprocess preserving PuLP name mapping. Deliver `parse_cbc_termination(...) -> (solutionStatus, terminationReason, {achievedGap,bestBound,incumbentObjective})` + a note on authoritative CBC records. **Go/no-go acceptance:** concurrent same-name solves don't collide; cleanup on success/parser-error/timeout/kill; path-traversal-safe; **no repo artifacts**; never classify by wall-clock. **P0R.3 does not begin until this passes and the post-spike design update is reviewed.**

### P0R.2 — parser unit tests (deterministic, contract-independent, may proceed)

Committed sanitized CBC log/`.sol` fixtures: optimal-proven, gap-limited+incumbent, time-limited+incumbent, time-limited-no-incumbent (`no_solution`), infeasible, unbounded. Map each → correct `(solutionStatus, terminationReason)` + metadata. No live solving; authoritative for time/gap/node-limit branches.

### P0R.3 — contract + schemas + OpenAPI + frontend + policy branch (CONDITIONAL: after P0R.1 + post-spike review)

- `solve.py`: `_envelope` gains `envelopeVersion`, two-dim status, raw `incumbentObjective`/`bestBound`, derived `achievedGap`; shared `_termination(...)` wraps P0R.1; `objective` stays app-canonical + nullable; §2.4 invariants asserted with the Q12 tolerance.
- `jobRunner.ts`: §2.8 policy branch before cache-write/`markSucceeded`.
- `openapi.yaml`: the three schemas (§2.6) as a discriminated set; `status` documented deprecated/expanded; **regen `lib/api-zod`+`lib/api-client-react` same commit** (rule #1).
- `resultEnvelope.ts` (Zod): `SolverEnvelopeV2Schema` + `StoredResultSchema` + `NormalizedSolveResultSchema` + normalizer; §2.4 rejection.
- **Migrate `artifacts/api-server/src/solver/tests/_envelope_compat.py`** (§16.7) — it flattens only legacy fields and would discard `terminationReason`; update so the protected suite asserts the new contract.
- **Frontend:** render by `(solutionStatus, terminationReason)` (≥ `feasible+gap_limit`, `feasible+time_limit`, `no_solution+time_limit`); "No incumbent" for null objective (no `?? 0`); `quality` from §2.5.
- **Consumer migration (atomic, Q9):** OpenAPI, the three Zod schemas, `solve_jobs` summary, Studio + Workspace, `quality.ts`, telemetry, exports/templates, cache validation, API tests, smoke checks, `_envelope_compat.py`.

### P0R.4 — integration tests + DEC-2026-09-21-01 sacred-test correction + gate (CONDITIONAL)

- `test_result_contract.py`: deterministic optimal + infeasible from real solves; time/gap/node-limit via injectable seam or committed fixture, **not** a wall-clock race.
- **Evidence-driven protected-suite correction (§16.2/Q11, under DEC-2026-09-21-01):** for each protected case, the expected `(solutionStatus, terminationReason)` is established from **committed CBC evidence for that exact scenario** — **never** computed as `requestedGap>0 ? feasible : optimal`. Where evidence proves a gap-requested case actually proved optimality, assert `optimal`; where it stopped at the gap, assert `feasible`+`gap_limit`; etc. Preserve every **objective / monotonicity / A-vs-B / feasibility** invariant; **zero golden-objective changes**. Document DEC-2026-09-21-01 in the commit body. This is the sole sanctioned edit to the sacred test.
- Frontend tests for new outcomes + normalized-legacy path; `resultEnvelope.test.ts` accepts v2, rejects §2.4 contradictions, accepts stored v1, and normalizes it.
- **Acceptance:** full gate green; `e2e_accuracy.py` passes with evidence-driven assertions + unchanged objectives; a gap-stopped solve reports `feasible`+`gap_limit`; a legacy row reads `legacyUnverified`, never `optimal`.

## 4. Hard-rule guardrails

- **#2:** `e2e_accuracy.py` corrected only per **DEC-2026-09-21-01** — evidence-driven assertion semantics, **zero golden-objective changes**.
- **#1:** OpenAPI + regen one commit; generated code never hand-edited.
- **#4:** one task = one commit, `[P0R.N] <summary>`.
- No solver **math** changes (reporting/metadata only).

## 5. Summary

| ID | Task | Gate |
|---|---|---|
| P0R.1 | CBC evidence spike (concurrency-safe capture/cleanup) | **go/no-go; approved to execute; blocks P0R.3** |
| P0R.2 | Parser unit tests on committed fixtures | contract-independent; may proceed |
| P0R.3 | v2 contract + 3 schemas + OpenAPI/regen + frontend + policy branch + `_envelope_compat.py` migration | conditional: after P0R.1 + post-spike review |
| P0R.4 | Integration tests + DEC-2026-09-21-01 sacred-test correction + gate | conditional |
