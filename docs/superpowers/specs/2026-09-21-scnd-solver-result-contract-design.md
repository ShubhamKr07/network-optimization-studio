# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status:** **Approved to execute P0R.1 (go/no-go CBC-evidence spike) and P0R.2 fixture *capture* only. P0R.2 parser tests depend on P0R.1; P0R.3–P0R.4 are conditionally specified and require a post-spike design update + approval review** (§16.6/Q15, §18). Incorporates reviews §14/§16/§18 and decisions Q4–Q21.
**Sacred-test authorization — DEC-2026-09-21-01:** durable, independently-auditable product-owner approval at **GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19)** — verbatim: *"I approve DEC-2026-09-21-01: update e2e_accuracy.py status/termination assertions based on committed CBC evidence, with zero changes to golden objective values."* (resolves §20.2.1). Scope: a narrow, **evidence-driven** correction to `e2e_accuracy.py` approximate-case assertions with **zero golden-objective changes**. Referenced by §3 P0R.4 and §4.
**Program context:** Carved from `2026-09-20-scnd-scaling-phase0-design.md` (§13 ledger) per Q1=Split. Standalone.

**Goal:** Replace the hardcoded `status:"optimal"` envelope with a truthful, versioned two-dimensional outcome contract, enforced by CBC evidence and cross-field invariants, migrate every consumer, and correct the sacred test under DEC-2026-09-21-01 without changing any golden objective.

**Out of scope (other specs):** durable queue / restart / worker split / scheduler / topology / single-flight / retention / stale-result CAS (→ B2); benchmark, MIP-start, warm-worker, plan matrix + topology comparison (→ measurement); Quick mode (→ later).

---

## 1. Problem (verified 2026-09-21)

`solve.py` hardcodes envelope `status="optimal"` on every non-infeasible path; real CBC status only in `quality`. Gap/time-limited incumbents are reported proven-optimal — a teaching-integrity defect across all solve functions. Requested tolerance does **not** determine achieved status; classification must read CBC's actual terminal records.

Verified facts driving the contract:
- Sacred test runs protected `gap=0.05` cases asserting `status=="optimal"` (Brazil BASE 340, P=5/7/10 388; single-source 368–369/427; cross-model 604; TR-3 246); a CBC probe of Brazil P=5/cap=20M shows a **gap-limited feasible** result, not proven.
- **Objectives are model/mode-specific and are NOT the CBC objective in general** (§18.2, verified): `solve_chens` coverage mode makes CBC maximize **covered demand** (131645389) but the public `objective` is **coverage %** (66.0639, `solve.py:1278–1287`, `test_chens.py:57`). App objective and CBC incumbent also differ by recompute/rounding even where units match (Brazil probe: 27022899702 vs 27022899653.8). **No generic raw↔public objective equality is valid.**
- Existing stored envelopes are **unversioned** (`_envelope` emits no `envelopeVersion`).
- `SolveResult.status` enum today = `[optimal, infeasible, error]` (3 values).
- `_envelope_compat.py::flatten_envelope` copies legacy fields and would discard `terminationReason`.
- Render web/worker plan ceiling = **12 CPU** (`12c-96g`); 16/32-CPU are Postgres.

## 2. Target contract

### 2.1 Two dimensions
- `solutionStatus`: `optimal | feasible | infeasible | unbounded | no_solution | error`
- `terminationReason` (closed): `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`

### 2.2 Fields
- `envelopeVersion`: `2` for new solver output/writes. (Historical rows are **unversioned**, not `1`; the number `1` denotes the *normalized read view* only — §2.7.)
- `status`: retained deprecated field, current enum `[optimal, infeasible, error]`; v2 projection (§2.3) expands it — explicit versioned breaking change (Q9), internal readers migrate atomically.
- `objective` (public): **model/mode-specific presentation value, computed exactly as today** (§2.9 table) — unchanged, preserving goldens. Nullable when no incumbent.
- `solverIncumbentObjective`, `solverBestBound` (§18.2): **raw CBC values in the solver's own objective space** (evidence), nullable when absent. **Not required to equal `objective`** (different units/rounding per model).
- `achievedGap`: one canonical value from raw solver values in solver space (§2.9), nullable.
- `requestedGap`, `configuredTimeLimitSec`; (`runTimeSec` exists).
- `quality`: derived-only, exact string per pair (§2.5).
- `infeasibilityReason`: retained for `infeasible`.
- `legacyStatus`: present only on normalized-legacy reads (raw historical `status`); absent on v2.

### 2.3 `status` v2 projection (Q9)
`optimal→"optimal"`, `feasible→"feasible"`, `infeasible→"infeasible"`, `no_solution→"no_solution"`, `unbounded→"unbounded"`, `error→"error"`. Compatibility guarantee = **golden objectives unchanged + protected-suite invariants preserved**, not byte-identical.

### 2.4 Invariant matrix (§14.4, corrected per §18.2)

| `solutionStatus` | allowed `terminationReason` | `objective` / solver incumbent+bound |
|---|---|---|
| `optimal` | `optimality_proven` | objective non-null; solverIncumbent non-null; solverBestBound present when available |
| `feasible` | `gap_limit` | objective + solverIncumbent non-null; **solverBestBound + achievedGap required** (§20.2.3 — a gap-limit stop is not auditable without them) |
| `feasible` | `time_limit \| node_limit \| interrupted` | objective + solverIncumbent non-null; bound + achievedGap nullable when CBC evidence exposes none |
| `infeasible` | `infeasible` | all null |
| `unbounded` | `unbounded` | all null |
| `no_solution` | `time_limit \| node_limit \| interrupted` | objective null; solverIncumbent null; achievedGap null; **`solverBestBound: number \| null`** (§20.2.3/Q24 — CBC can expose a bound with no incumbent via `Cbc_getBestPossibleObjValue`) |
| `error` | `solver_error` | all null |

**No `objective === solverIncumbentObjective` invariant** (§18.2 — units/rounding differ per model). `status` equals §2.3 projection; `quality` equals §2.5. Other combinations schema-**rejected**.

### 2.5 `quality` strings (exact)
`optimal/optimality_proven`→"Proven optimal" · `feasible/gap_limit`→"Feasible — stopped at gap limit" · `feasible/time_limit`→"Feasible — time limit reached" · `feasible/node_limit`→"Feasible — node limit reached" · `feasible/interrupted`→"Feasible — interrupted" · `infeasible/infeasible`→"Infeasible" · `unbounded/unbounded`→"Unbounded" · `no_solution/*`→"No solution found" · `error/solver_error`→"Solver error".

### 2.6 Three schemas (§16.4/§18.3/Q13/Q19)
1. **`SolverEnvelopeV2Schema`** — raw `solve.py` stdout + all new cache writes; v2 only; rejects `solutionStatus:null`; enforces §2.4. Raw solver output never accepted as legacy.
2. **`StoredResultSchema`** — persisted `scenarios.result`/`result_cache` in stored form. **Known legacy generation = the nested unversioned `_envelope` shape** (`{status,objective,runTimeSec,quality,edges,metrics,details,solverUsed,infeasibilityReason}` with **no** `envelopeVersion`), verified as what `jobRunner` currently writes — **not** a flat shape (§20.2.2/Q23; `_envelope_compat.flatten_envelope` is a test shim, not the DB shape). An older flat generation is supported **only if** P0R.3's stored-row inventory finds it. Accepts legacy-nested **and** raw v2.
3. **`NormalizedSolveResultSchema`** — read/API/UI union: v2 as-is, or normalized-legacy (see §2.7).

A **normalizer** converts a stored legacy row → normalized v1. Historical `status:"optimal"` never promoted to proven.

### 2.7 Legacy representation (Q5/Q19/Q23) — complete normalized-v1 output
Read-time only, no backfill/re-solve. Normalized v1 from a stored legacy-nested row:
- `envelopeVersion:1`, `solutionStatus:null`, `terminationReason:"unknown"`, `legacyUnverified:true`;
- `legacyStatus` = the raw historical `status` (isolated; **not** re-exposed as the truthful `status`);
- `quality` = a **non-proof** legacy string, e.g. `"Legacy result (unverified)"` — **never** "Proven optimal"/"Optimal" (would recreate the false-proof defect);
- **preserve payload:** `objective` (as-stored; a legacy no-result `0` sentinel is normalized to `null`), `runTimeSec`, `edges`, `metrics`, `details`, `solverUsed`, `infeasibilityReason` carried through unchanged;
- new solver-evidence fields (`solverIncumbentObjective`/`solverBestBound`/`achievedGap`) = `null`.

Old **result-cache** rows: **cache miss** (re-solve under v2), not normalized — the composite solver-contract version (§2.10) changes anyway. **Every named read/export/template/history/telemetry boundary (§20.2.2/Q29) gets an explicit accept/normalize/reject decision in P0R.3 — no "define later" placeholder.**

### 2.10 Composite solver-contract / cache version (§20.2.5/Q26)
Today `jobRunner.SOLVER_CODE_HASH` hashes only `solve.py` (verified). Replace with a **composite version** hashing everything that can change result semantics: `solve.py` + the P0R.1 termination wrapper/parser module(s) + relevant model/config code + the CBC/PuLP versions. Add a test proving a **parser/contract-version bump invalidates the cache even when `solve.py` bytes and inputs are unchanged.**

### 2.8 Lifecycle + cache/publish policy (§14.2/Q6) — branch before cache-write/`markSucceeded`
`optimal`→succeeded/cache/publish · `feasible`→succeeded/cache **only with full gap-time-version key**/publish-labelled · `infeasible`,`unbounded`→succeeded/cache/publish · `no_solution`→succeeded/**no cache**/publish-no-incumbent · `error`→**failed/no cache/no publish**.

### 2.9 Per-model public-objective derivation + canonical `achievedGap` (§18.2/§18.7)

| model / mode | public `objective` (exact, §20.2.6/Q27) | equals CBC objective? |
|---|---|---|
| `p-median-us` | `round(obj_val)` (integer) | approximately (recompute/rounding) |
| `p-median-brazil` | `round(obj_val)` (integer) | approximately |
| `transport-coal` | `round(obj_val)` (integer) | approximately |
| `two-echelon-gold-au` | `round(value(prob.objective) or 0, 2)` | approximately |
| `two-echelon-jade-us` | `round(value(prob.objective) or 0, 4)` | approximately |
| chens **coverage** | `round(covered*100/total, 4)` | **no** — CBC maximizes covered demand; public is a percentage |
| chens **min_distance** | `round(value(prob.objective), 2)` | yes |

Each row is the exact current derivation (preserve goldens); no ellipsis. Implement as a named per-model function.

Canonical `achievedGap` (one authority, §18.7/§20.2.4/Q25): computed **in the solver's objective space** as `abs(solverIncumbentObjective - solverBestBound) / (abs(solverIncumbentObjective) + EPS)`, `EPS=1e-10`. Domain **non-negative and unbounded — NOT clamped** (a poor incumbent or objective crossing zero can legitimately exceed 1.0, matching CBC `ratioGap`'s `0..∞`). Null when incumbent or bound absent. Absolute numerator (handles min/max + negative objectives); explicit near-zero-incumbent policy (the `EPS` denominator floor is the documented rule, not silent). **Serialized to 6 decimal places.** A parsed CBC-reported gap, if available, is retained **only as separate evidence**, never as the `achievedGap` field. P0R.2 fixtures must cover minimization, maximization, negative objective, zero/near-zero incumbent, and a gap `> 1.0`.

## 3. Tasks

### P0R.1 — CBC termination-evidence spike (**go/no-go; gates P0R.3**) — APPROVED TO EXECUTE
PuLP 3.3.2 `COIN_CMD.solve_CBC()` creates/reads/deletes the `.sol` internally before returning; `keepFiles=True` names collide under concurrency. **Primary approved approach (Q8):** a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper exposing unique temp paths + **per-solve unique temp dir + unique problem name**, parsing before deletion. **Fallback:** a controlled direct CBC subprocess preserving PuLP name mapping — permitted **only** after a recorded P0R.1 no-go on the primary + a design-update approval (§18.8). Deliver `parse_cbc_termination(...) -> (solutionStatus, terminationReason, {achievedGap, solverIncumbentObjective, solverBestBound})` + authoritative-record note. **Go/no-go acceptance:** concurrent same-name solves don't collide; cleanup on success/parser-error/timeout/kill; path-traversal-safe; no repo artifacts; never classify by wall-clock. **P0R.3 blocked until this passes + post-spike review.**

### P0R.2 — fixtures (capture APPROVED now) + parser tests (after P0R.1)
Four **separate** test categories (§20.2.7/Q28), not one CBC-fixture set:
1. **Attainable CBC terminal-record fixtures** (capture may proceed): committed sanitized CBC log/`.sol` for every retained pair CBC can actually emit — optimal/optimality_proven, feasible/gap_limit, feasible/time_limit, **feasible/node_limit** (+ no_solution/node_limit if CBC emits both), feasible/interrupted, no_solution/{time_limit,node_limit,interrupted} (incl. **bound-without-incumbent**, Q24), infeasible, unbounded. Any pair CBC cannot produce is **removed from the v2 contract**, not left untested. `unknown` reserved for normalized legacy.
2. **Synthetic malformed/contradictory parser fixtures** — hand-authored bad logs asserting the parser's error handling.
3. **Wrapper cleanup / concurrency / path-safety tests** — from P0R.1's wrapper.
4. **Process-level `jobRunner` failure tests** — missing exe, nonzero exit, malformed stdout, parser exception, cleanup failure, outer timeout.
- **`error/solver_error` boundary (normative, §20.2.7):** `solve.py`-declared load/model errors → a v2 `error/solver_error` **envelope** (cached: no, published: no). Failures *before/outside* CBC (spawn/timeout/nonzero-exit/JSON/schema) → a **failed job with no published scenario result**, per current `jobRunner` behavior. Do **not** fabricate CBC artifacts for non-CBC failures.
- **Parser unit tests (after P0R.1's interface):** map each attainable fixture → correct pair + metadata; no live solving; authoritative for time/gap/node-limit branches; include the `achievedGap` domain fixtures from §2.9 (min/max/negative/zero/>1.0).

### P0R.3 — contract + 3 schemas + OpenAPI + frontend + policy branch (CONDITIONAL: after P0R.1 + post-spike review)
- `solve.py`: `_envelope` gains `envelopeVersion:2`, two-dim status, raw `solverIncumbentObjective`/`solverBestBound`, canonical `achievedGap`; shared `_termination(...)` wraps P0R.1; public `objective` per §2.9 (unchanged); §2.4 asserted.
- `jobRunner.ts`: §2.8 policy branch before cache-write/`markSucceeded`.
- `openapi.yaml`: the three schemas (§2.6); `status` deprecated/expanded; **regen `lib/api-zod`+`lib/api-client-react` same commit** (rule #1).
- `resultEnvelope.ts`: `SolverEnvelopeV2Schema`+`StoredResultSchema`+`NormalizedSolveResultSchema`+normalizer; §2.4 rejection.
- **Normalizer wired at named read boundaries (§18.3/§18.9):** `toApiScenario()` (`routes/scenarios.ts:131–153`), scenario list/get, exports/templates (define accept-vs-reject of legacy), solve-history, telemetry, smoke checks.
- **Migrate `_envelope_compat.py`** so the protected suite asserts the new contract (don't discard `terminationReason`).
- **Frontend:** render by `(solutionStatus, terminationReason)`; "No incumbent" for null objective (no `?? 0`); `quality` from §2.5.
- **Consumer migration (atomic, Q9):** all of the above + Studio/Workspace, `quality.ts`, cache validation, API tests.

### P0R.4 — integration tests + DEC-2026-09-21-01 correction + e2e_journey repair + full gate (CONDITIONAL)
- `test_result_contract.py`: deterministic optimal + infeasible from real solves; time/gap/node-limit via injectable seam or committed fixture, not a wall-clock race.
- **Evidence-driven protected-suite correction (§16.2/Q11, under DEC-2026-09-21-01):** each protected case's expected `(solutionStatus, terminationReason)` comes from **committed CBC evidence for that exact scenario** — never `requestedGap>0 ? feasible : optimal`. Preserve every objective/monotonicity/A-vs-B/feasibility invariant; **zero golden-objective changes**; document DEC-2026-09-21-01 in the commit body.
- **Repair `e2e_journey.py`** (decision this session): rewrite its auth onto `/auth/register` + `/auth/login` (argon2) so it runs again, and update its assertions to the new contract. Both standalone scripts (`e2e_accuracy.py` **and** `e2e_journey.py`) run after solver changes per AGENTS.md.
- Enumerate + run/update every pytest-discovered solver test whose status assertion changes; frontend tests for new outcomes + normalized-legacy path; `resultEnvelope.test.ts` accepts v2, rejects §2.4 contradictions, accepts stored unversioned legacy + normalizes it.
- **Acceptance:** full repo gate green; **both** `e2e_accuracy.py` (evidence-corrected, unchanged objectives) **and** repaired `e2e_journey.py` pass; a gap-stopped solve reports `feasible`+`gap_limit`; a legacy row reads `legacyUnverified`, never `optimal`; `achievedGap` matches fixture values.

## 4. Hard-rule guardrails
- **#2:** `e2e_accuracy.py` corrected only per **DEC-2026-09-21-01** (authorized by the in-session Q4+Q10 selections, recorded in the header) — evidence-driven assertions, **zero golden-objective changes**.
- **#1:** OpenAPI + regen one commit; generated never hand-edited.
- **#4:** one task = one commit, `[P0R.N] <summary>`.
- No solver **math** changes; both standalone e2e scripts run after solver changes (AGENTS.md).

## 5. Summary

| ID | Task | Gate |
|---|---|---|
| P0R.1 | CBC evidence spike (wrapper+temp-dir primary; direct-CBC fallback needs no-go) | **go/no-go; approved; blocks P0R.3** |
| P0R.2 | Fixture capture (approved now) + parser tests (after P0R.1) | fixtures independent |
| P0R.3 | v2 contract + 3 schemas + OpenAPI/regen + normalizer wiring + frontend + policy branch + `_envelope_compat.py` | conditional: after P0R.1 + review |
| P0R.4 | Integration tests + DEC-2026-09-21-01 correction + `e2e_journey.py` repair + both standalone scripts + full gate | conditional |
