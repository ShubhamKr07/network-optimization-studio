# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status:** **Approved to execute P0R.1 (go/no-go CBC-evidence spike) and P0R.2 fixture *capture* only. P0R.2 parser tests depend on P0R.1; P0R.3–P0R.4 are conditionally specified and require a post-spike design update + approval review** (§16.6/Q15, §18). Incorporates reviews §14/§16/§18/§20/§22/§24 and decisions Q4–Q42. **Open gates carried forward:** Q35/Q41 (deterministic cache hash) and Q43–Q49 (private failure transport, v1/v2 discriminated schemas, limit ceilings, process/temp protocol, cache transition, telemetry naming) — all close in the **post-spike design update**, not now. Narrow execution authority (P0R.1 + P0R.2 fixture capture) is distinct from full P0R.3/P0R.4 implementation approval.
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
- `terminationReason` (**public, closed**): `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`. For `solutionStatus=error` the single public reason is `solver_error` (coarse — see §2.11 for the internal granular classification). Spawn/outer-timeout/JSON/schema failures are **not** reasons — they are a failed job with no published result.
- **Public copy** for any error = **"Solve failed"** (§2.5) — honest and coarse; never leaks the failure origin. The granular data/model/internal/solver classification lives in the **internal** `failureReason` (§2.11/§24.2.3/Q39), never in the public envelope.

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

`quality` for `error/solver_error` = **"Solve failed"** (coarse, public); the granular internal classification is §2.11. **No `objective === solverIncumbentObjective` invariant** (§18.2 — units/rounding differ per model). `status` equals §2.3 projection; `quality` equals §2.5. Other combinations schema-**rejected**.

### 2.5 `quality` strings (exact)
`optimal/optimality_proven`→"Proven optimal" · `feasible/gap_limit`→"Feasible — stopped at gap limit" · `feasible/time_limit`→"Feasible — time limit reached" · `feasible/node_limit`→"Feasible — node limit reached" · `feasible/interrupted`→"Feasible — interrupted" · `infeasible/infeasible`→"Infeasible" · `unbounded/unbounded`→"Unbounded" · `no_solution/*`→"No solution found" · `error/solver_error`→**"Solve failed"** (public copy honest for every failure origin; the granular cause is internal, §2.11).

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
- **preserve payload:** `runTimeSec`, `edges`, `metrics`, `details`, `solverUsed`, `infeasibilityReason` carried through unchanged;
- **`objective` (status/evidence-aware, §22.2.4/Q33 — never `===0` alone):** legacy `status:"infeasible"|"error"` → `objective:null`; legacy successful/`optimal` row → **preserve the stored numeric (including a legitimate `0`** — zero-demand scenarios can solve to 0); malformed/contradictory legacy row → conservative, explicitly-tested rule;
- new solver-evidence fields (`solverIncumbentObjective`/`solverBestBound`/`achievedGap`) = `null`.

**Exact discriminated schema (§26.2.2/Q44) — prose is not enough:**
- **v2:** `envelopeVersion:2`, non-null truthful `solutionStatus`/`terminationReason`, `status` = §2.3 projection, `legacyUnverified:false`, complete field set incl. §2.12 limit fields.
- **normalized v1:** `envelopeVersion:1`, `solutionStatus:null`, `terminationReason:"unknown"`, `legacyUnverified:true`, **`status:null`** — the deprecated `status` is made **nullable** in the union; the legacy value is **never** copied into truthful `status`, only into `legacyStatus`; **all v2-only fields null** (`solverIncumbentObjective`/`solverBestBound`/`achievedGap`/`requestedGap`/`requestedTimeLimitSec`/`configuredGap`/`configuredTimeLimitSec`).
- **stored legacy:** its own raw nested unversioned shape (§2.6), **never** accepted by `SolverEnvelopeV2Schema`.
- OpenAPI + consumers updated to the nullable-`status` union; tests exercise mixed v1/v2 collections.

### 2.7.1 Normative legacy-consumer boundary matrix (§22.2.1/Q30 — decided now, no "define later")

| Boundary | Decision |
|---|---|
| Scenario list/get + `toApiScenario()` (`routes/scenarios.ts:131–153`) | **Normalize** stored legacy → v1 view. |
| Output exports (`assignments`/`openWarehouses`/`costSummary`/`serviceStats`/`flows`) | **Reject** a legacy-unverified result: **HTTP 409** + stable code **`LEGACY_RESULT_REQUIRES_RESOLVE`** + non-sensitive message (§24.2.4/Q40) — never export data of unknowable proof state. |
| Input/template exports | Result-contract version **irrelevant** (no result read); unaffected. |
| Solve history `resultSummary` | Handled **separately** from `scenarios.result`; legacy summaries read as-is, tagged unverified; no promotion to proven. |
| Telemetry (`solve-completed`) | Legacy reads **tagged** `legacyUnverified`; new solves emit v2. |
| Smoke checks / tests | Each states which schema it validates (`SolverEnvelopeV2Schema` for new; `NormalizedSolveResultSchema` for reads). |
| Result cache (unversioned rows) | **Cache miss / re-solve** (composite version §2.10 changes anyway). |

**Concrete contract (§24.2.4/§26.2.6/Q40/Q48):** a typed `legacyUnverified: boolean` on the normalized read (always emitted; `false` for v2). Export rejection = `409`/`LEGACY_RESULT_REQUIRES_RESOLVE`. **Telemetry:** the existing event **`"scenario solve completed"`** gains a bounded snake_case property **`result_contract: "v2" | "legacy"`** (matching current snake_case convention; **no** payload/objective/result/input/path/diagnostic contents); emission rules defined for cache-hit / fresh-v2 / normalized-legacy-read / failed-job. **Solve history:** `resultSummary` gains a typed `legacyUnverified` marker (OpenAPI). P0R.3 delivers the full scenario-read / history / output-export / input-template-export / cache call-site inventory + per-row integration tests (authorization + mixed v1/v2 collections) + telemetry cardinality/no-leak tests.

### 2.10 Composite solver-contract / cache version (§20.2.5/§22.2.6/Q26/Q35)
Today `jobRunner.SOLVER_CODE_HASH` hashes only `solve.py` (verified). Replace with a **composite version**. The **post-spike design update** must define it **deterministically** (§22.2.6/Q35):
- an explicit **sorted manifest** of hash-input files (`solve.py` + P0R.1 wrapper/parser module(s) + relevant model/config code) — or a build-generated manifest;
- **byte-delimited hashing** including each path + contents unambiguously (stable ordering/encoding);
- the **pinned PuLP version** + an authoritative **CBC binary version/build identifier**;
- **fail-closed startup** if any required hash input/version can't be read;
- an explicit **`SOLVER_CONTRACT_VERSION`** constant for semantic changes not represented by file bytes;
- tests proving a change to the parser, wrapper, dependency/build identifier, **or** the contract constant each invalidates the cache, while identical artifacts stay stable.

**Q35 is an OPEN, mandatory P0R.3 gate (§24.2.5/Q41)** — not resolved yet. No cache read/write ships until the exact manifest, byte framing, PuLP/CBC identities, example hash vectors, fail-closed behavior, and invalidation/stability tests are in the post-spike design update and approved.

**Cache transition (§26.2.5/Q47):** **P0R.1/P0R.2 artifacts are evidence-only** — not merged into a release/deploy path before approved P0R.3. The current `solve.py`-only cache hash keeps operating unchanged until the composite version lands with P0R.3; a wrapper/parser file must not deploy against the old hash. Define existing-unversioned-cache-row behavior (cache miss), release rollback, and mixed rolling instances so **no old instance can write an entry a new instance mistakes for v2** (the composite version discriminates).

### 2.11 Internal failure record + private transport (§24.2.3/§26.2.1/Q39/Q43) — NOT in the public envelope
Granular failure classification is **internal/operator-facing only**:
- `failureReason` (internal enum): `solver_error` (CBC started then failed/abandoned/numerically errored) | `data_error` (dataset/config load/validate failure) | `model_error` (dispatch/model construction failed before CBC) | `internal_error` (unexpected application exception).
- `errorDetail` (internal, **sanitized**): bounded diagnostic text.

**Private transport (Q43):** the runner subprocess message carries the **public result separately from internal failure metadata** — Python emits, on a defined private channel, both the public envelope (or nothing on pre-CBC failure) **and** `{failureReason, errorDetail}`. Node maps every path: `data_error`/`model_error`/`internal_error`/`solver_error` from Python; pre-spawn/outer-timeout/nonzero-exit/JSON/schema failures classified Node-side. Node never derives a distinction it wasn't sent.

**Persistence (Q43, rule #3):** add nullable `failure_reason` + `error_detail` columns to `solve_jobs` (Drizzle schema + `drizzle-kit push`). The **existing public `SolveJob.error` field is replaced** with a stable coarse **code + safe message** (never the operator diagnostic); the raw diagnostic lives only in `error_detail` (internal) + Sentry.

**Sanitization (Q43):** one `sanitizeErrorDetail(raw) -> string` with an explicit byte/char bound and allow/deny policy; tests against filesystem paths, secrets, solver stdout/stderr, payload fragments, and schema dumps.

**Leakage:** the public envelope only ever carries `solutionStatus:error` + `terminationReason:solver_error` + `quality:"Solve failed"`. **Negative-leakage tests** across scenario reads, solve-job polling, history, exports, logs, telemetry, and Sentry assert no `failureReason`/`errorDetail`/path/secret/stdout appears in any public response.
- Sentry/telemetry mapping: `failureReason` = bounded tag; `errorDetail` = sanitized message.

### 2.12 Solver-limit metadata contract (§24.2.6/§26.2.3/Q42/Q45)
**Requested vs effective pairs** (the reviewer's Q45 rec — retain both because limits clamp):
- `requestedGap` / `requestedTimeLimitSec` = as submitted (original request).
- `configuredGap` / `configuredTimeLimitSec` = **effective** values after defaults + clamping = the **actual `PULP_CBC_CMD` arguments**.
- **Ceilings/defaults (Q45):** `timeLimitSec` — default 60, min 1, **max 60, clamp above** (a value >60 is clamped, not rejected; both requested + configured recorded so the clamp is auditable). `gap` — default 0 (proven), min 0, max 1.0, clamp above.
- types/units: gaps = number (relative, ≥0, finite); time = number (seconds, finite, in `[1,60]` effective).
- **single normalization point** before CBC invocation **and** cache-key construction; the cache key uses the **effective** values.
- presence: all four emitted on **every** terminal result incl. `no_solution` and `error` (they describe the attempt).
- invariants: result + cache-key effective values equal the actual CBC arguments; a change to either effective limit → distinct cache key.
- tests: defaults, boundaries (0/1/60/61→60), invalid/non-finite, retries, and cache separation when an effective limit changes; a pre-CBC validation failure (never starts a solver) is a failed job, not a terminal envelope.

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

Canonical `achievedGap` (one authority, §18.7/§20.2.4/§22.2.5/Q25/Q34): a **numeric** JSON field computed in the solver's objective space as **`round(abs(solverIncumbentObjective - solverBestBound) / max(abs(solverIncumbentObjective), EPS), 6)`**, `EPS=1e-10`. The denominator is an explicit **floor** (`max(…, EPS)`), **not** `+EPS` (§22.2.5). Domain **non-negative and unbounded — NOT clamped** (can exceed 1.0, matching CBC `ratioGap` `0..∞`). Null when incumbent or bound absent. Absolute numerator (min/max + negative objectives). Zero policy: `I==B==0` → `0`. It is a **number rounded to ≤6 fractional digits**, not a fixed-width string; display formatting is a frontend concern, kept out of the evidence field. A parsed CBC-reported gap, if available, is separate evidence, never this field. P0R.2 fixtures cover minimization, maximization, negative objective, zero/near-zero incumbent, and a gap `> 1.0`.

## 3. Tasks

### P0R.1 — CBC termination-evidence spike (**go/no-go; gates P0R.3**) — APPROVED TO EXECUTE
PuLP 3.3.2 `COIN_CMD.solve_CBC()` creates/reads/deletes the `.sol` internally before returning; `keepFiles=True` names collide under concurrency. **Primary approved approach (Q8):** a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper exposing unique temp paths + **per-solve unique temp dir + unique problem name**, parsing before deletion. **Fallback:** a controlled direct CBC subprocess preserving PuLP name mapping — permitted **only** after a recorded P0R.1 no-go on the primary + a design-update approval (§18.8). Deliver `parse_cbc_termination(...) -> (solutionStatus, terminationReason, {achievedGap, solverIncumbentObjective, solverBestBound})` + authoritative-record note.

**Process-tree ownership = Node owns the process group (§24.2.2/§26.2.4/Q38/Q46 — the surviving actor).** A dead Python wrapper (SIGKILL) cannot kill CBC or clean its temp dir, so the surviving parent owns it. Exact protocol:
- **Temp:** **Node** `mkdtemp`s a unique dir → passes the **validated absolute path** to Python → Python is **constrained to that dir** → **Node idempotently removes it** after direct-child close **and** group-death verification (Node creates it precisely so it can clean it after a Python kill).
- **Process group:** Node spawns Python **`detached:true`** as a process-group/session leader (**POSIX only** — Node guarantees this on non-Windows); tracks the PGID; on outer timeout/cancel signals the **negative PGID** `TERM`→(grace)→`KILL`. Node directly waits/reaps its **Python child**; for CBC descendants it **signals + probes group death** (ESRCH/race handled), not direct reap.
- **State machine:** timeout and cancellation share **one once-only** publisher/terminal-state machine; cleanup order + cleanup-failure disposition defined.
- **Platform:** production + CI are **Linux/POSIX** (Render); Windows is **unsupported/fail-fast**, not a silent assumption.
(Bounded group-kill only; full graceful-drain stays B2.)

**Go/no-go acceptance:** concurrent same-name solves don't collide; cleanup on success/parser-error/timeout/kill; path-traversal-safe; no repo artifacts; never classify by wall-clock; **no-orphan test on the production OS (Linux) — record Python + CBC PIDs/PGID, force timeout/cancel AND a forced-kill/crash case (incl. a killed Python parent with CBC still alive holding inherited descriptors), prove within a bounded interval that neither process survives, temp is reclaimed, completion is once-only, and repeated timeouts accumulate no processes/artifacts.** **P0R.3 blocked until this passes + post-spike review.**

### P0R.2 — fixtures (capture APPROVED now) + parser tests (after P0R.1)
Four **separate** test categories (§20.2.7/Q28), not one CBC-fixture set:
1. **Attainable CBC terminal-record fixtures** (capture may proceed): committed sanitized CBC log/`.sol` for every retained pair CBC can actually emit — optimal/optimality_proven, feasible/gap_limit, feasible/time_limit, **feasible/node_limit** (+ no_solution/node_limit if CBC emits both), feasible/interrupted, no_solution/{time_limit,node_limit,interrupted} (incl. **bound-without-incumbent**, Q24), infeasible, unbounded. Any pair CBC cannot produce is **removed from the v2 contract**, not left untested. `unknown` reserved for normalized legacy.
2. **Synthetic malformed/contradictory parser fixtures** — hand-authored bad logs asserting the parser's error handling.
3. **Wrapper cleanup / concurrency / path-safety tests** — from P0R.1's wrapper.
4. **Process-level `jobRunner` failure tests** — missing exe, nonzero exit, malformed stdout, parser exception, cleanup failure, outer timeout.
- **Error boundary (per canonical §2.1/§2.4/§2.11 — Q37):** an error envelope is always public `solutionStatus:error` + `terminationReason:solver_error` + `quality:"Solve failed"`; the granular cause (`data_error`/`model_error`/`internal_error`/`solver_error`) is the **internal `failureReason`** (§2.11), never public (cached: no, published: no). Failures *before/outside* CBC (spawn/timeout/nonzero-exit/JSON/schema) → a **failed job with no published scenario result**. Do **not** fabricate CBC artifacts for non-CBC failures. Fixtures per category (§20.2.7): attainable-CBC / synthetic-parser / wrapper / jobRunner-process + negative-leakage assertions (§2.11).
- **Parser unit tests (after P0R.1's interface):** map each attainable fixture → correct pair + metadata; no live solving; authoritative for time/gap/node-limit branches; include the `achievedGap` domain fixtures from §2.9 (min/max/negative/zero/>1.0).

### P0R.3 — contract + 3 schemas + OpenAPI + frontend + policy branch (CONDITIONAL: after P0R.1 + post-spike review)
- `solve.py`: `_envelope` gains `envelopeVersion:2`, two-dim status, raw `solverIncumbentObjective`/`solverBestBound`, canonical `achievedGap`; shared `_termination(...)` wraps P0R.1; public `objective` per §2.9 (unchanged); §2.4 asserted.
- `jobRunner.ts`: §2.8 policy branch before cache-write/`markSucceeded`.
- `openapi.yaml`: the three schemas (§2.6); `status` deprecated/expanded; **regen `lib/api-zod`+`lib/api-client-react` same commit** (rule #1).
- `resultEnvelope.ts`: `SolverEnvelopeV2Schema`+`StoredResultSchema`+`NormalizedSolveResultSchema`+normalizer; §2.4 rejection.
- **Normalizer wired at every boundary per the canonical §2.7.1 matrix (Q37/Q40 — decisions already made, not re-opened):** `toApiScenario()` (`routes/scenarios.ts:131–153`) + scenario list/get → normalize; output exports → `409`/`LEGACY_RESULT_REQUIRES_RESOLVE`; solve-history/telemetry/smoke/cache per §2.7.1; emit typed `legacyUnverified`; deliver the full call-site inventory + per-row integration tests.
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
- **#2:** `e2e_accuracy.py` corrected only per **DEC-2026-09-21-01**, authorized at **GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19)** (§20.2.1/Q22/Q36) — evidence-driven status/termination assertion changes, **zero golden-objective changes**. Every DEC reference (header, this guardrail, P0R.4, commit body) cites issue #19.
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
