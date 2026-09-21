# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status (updated 2026-09-22):** **P0R.1 is AUTHORIZED TO EXECUTE** — explicit product-owner approval on 2026-09-22, lifting the §30.2.1/Q58 HOLD after §30/§32 (Q58–Q72) closed. This is the new explicit approval Q58 required (not a silent reinterpretation). P0R.1 runs as a **go/no-go evidence spike**; P0R.2 attainable-CBC fixture capture proceeds alongside. **P0R.3/P0R.4 remain NOT approved** — they need P0R.1's evidence + a post-spike design update + a new approval review; the **Q35/Q41 composite cache identity** stays a mandatory P0R.3 gate. Incorporates reviews §14–§32 and decisions Q4–Q72.
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
- `solutionStatus` (**success/math outcomes only**, §30.2.3/Q60=A): `optimal | feasible | infeasible | unbounded | no_solution`. **`error` is NOT a solutionStatus** — every execution failure travels the private failure branch (§2.11) → a **failed job + public `errorCode`**, never a published/cacheable/normalized result. This removes the prior contradiction (error was called both public and runner-private).
- `terminationReason` (**public, closed**): `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | unknown`. (No `solver_error` — failures aren't envelope outcomes.)
- **Failure UX:** a failed solve surfaces as a failed `SolveJob` with a coarse public `errorCode` + safe message (§2.11); the granular `failureReason` is internal-only.

### 2.2 Fields
- `envelopeVersion`: `2` for new solver output/writes. (Historical rows are **unversioned**, not `1`; the number `1` denotes the *normalized read view* only — §2.7.)
- `status`: retained deprecated field, current enum `[optimal, infeasible, error]`; v2 projection (§2.3) expands it — explicit versioned breaking change (Q9), internal readers migrate atomically.
- `objective` (public): **model/mode-specific presentation value, computed exactly as today** (§2.9 table) — unchanged, preserving goldens. Nullable when no incumbent.
- `solverIncumbentObjective`, `solverBestBound` (§18.2): **raw CBC values in the solver's own objective space** (evidence), nullable when absent. **Not required to equal `objective`** (different units/rounding per model).
- `achievedGap`: one canonical value from raw solver values in solver space (§2.9), nullable.
- **effective** limit fields on the cacheable result (§2.12): `configuredGap`, `configuredTimeLimitSec` (actual CBC args). The **requested** originals (`requestedGap`/`requestedTimeLimitSec` + `source`) live on the **job/request record**, composed onto the API response after cache lookup — not baked into the cacheable result. (`runTimeSec` exists.)
- `quality`: derived-only, exact string per pair (§2.5).
- `infeasibilityReason`: retained for `infeasible`.
- `legacyStatus`: present only on normalized-legacy reads (raw historical `status`); absent on v2.
- `errorCode` (public `SolveJob`): stable enum (§2.11); the granular `failureReason`/`errorDetail` are **internal-only**, never in this envelope.

### 2.3 `status` v2 projection (Q9)
`optimal→"optimal"`, `feasible→"feasible"`, `infeasible→"infeasible"`, `no_solution→"no_solution"`, `unbounded→"unbounded"`. (**No `error` projection** — §30.2.3/§32.2.2/Q66: `error` is not a v2 status; it exists only as a historical raw `legacyStatus`, never in any v2 projection/lifecycle/cache/result.) Compatibility guarantee = **golden objectives unchanged + protected-suite invariants preserved**, not byte-identical.

### 2.4 Invariant matrix (§14.4, corrected per §18.2)

| `solutionStatus` | allowed `terminationReason` | `objective` / solver incumbent+bound |
|---|---|---|
| `optimal` | `optimality_proven` | objective non-null; solverIncumbent non-null; solverBestBound present when available |
| `feasible` | `gap_limit` | objective + solverIncumbent non-null; **solverBestBound + achievedGap required** (§20.2.3 — a gap-limit stop is not auditable without them) |
| `feasible` | `time_limit \| node_limit \| interrupted` | objective + solverIncumbent non-null; bound + achievedGap nullable when CBC evidence exposes none |
| `infeasible` | `infeasible` | all null |
| `unbounded` | `unbounded` | all null |
| `no_solution` | `time_limit \| node_limit \| interrupted` | objective null; solverIncumbent null; achievedGap null; **`solverBestBound: number \| null`** (§20.2.3/Q24 — CBC can expose a bound with no incumbent via `Cbc_getBestPossibleObjValue`) |

**No `error` row (§30.2.3/Q60=A)** — execution failures are not envelope outcomes; they are a failed job + public `errorCode` (§2.11). **No `objective === solverIncumbentObjective` invariant** (§18.2 — units/rounding differ per model). `status` equals §2.3 projection; `quality` equals §2.5. Other combinations schema-**rejected**.

### 2.5 `quality` strings (exact)
`optimal/optimality_proven`→"Proven optimal" · `feasible/gap_limit`→"Feasible — stopped at gap limit" · `feasible/time_limit`→"Feasible — time limit reached" · `feasible/node_limit`→"Feasible — node limit reached" · `feasible/interrupted`→"Feasible — interrupted" · `infeasible/infeasible`→"Infeasible" · `unbounded/unbounded`→"Unbounded" · `no_solution/*`→"No solution found". (No `error` quality — failures aren't envelope outcomes; the failed job's public safe message per `errorCode` is defined in §2.11.)

### 2.6 Five schemas (§16.4/§18.3/§32.2.1/Q13/Q19/Q65)
The `result_cache` value and the `scenarios.result` value now intentionally differ (effective-only vs request-composed), so one shape can't serve both. Five conceptual types (a type alias is fine where two are byte-identical):
1. **`SolverSuccessEnvelopeV2Schema`** — success/math outcomes received on **fd3** (not stdout); v2, `solutionStatus` non-null (no `error`); configured/effective limit values only; enforces §2.4.
2. **`ResultCacheEntryV2Schema`** — the exact `result_cache` value; normally an alias of #1 (effective values only, **no** request-specific fields).
3. **`PublishedSolveResultV2Schema`** — #2 **plus** the current job's `requestedGap`/`requestedGapSource`/`requestedTimeLimitSec`/`requestedTimeLimitSource` + public-read markers (`legacyUnverified:false`). This is the only shape that reaches `scenarios.result`/public APIs.
4. **`StoredScenarioResultSchema`** — published v2 (#3) **or** the known raw unversioned legacy `_envelope` shape (`{status,objective,runTimeSec,quality,edges,metrics,details,solverUsed,infeasibilityReason}`, no `envelopeVersion` — verified as what `jobRunner` writes; `_envelope_compat.flatten_envelope` is a test shim, not the DB shape). An older flat generation is supported only if P0R.3's stored-row inventory finds it.
5. **`NormalizedSolveResultSchema`** — read/API/UI union: published v2 (#3) or normalized-legacy v1 (§2.7).

**Composition function (§32.2.1/Q59):** one named `composePublishedResult(cacheableResult, job)` attaches the current job's requested values/sources onto #2 → #3, on **both** fresh-solve and cache-hit paths. Assert **only** #3 (or normalized legacy) reaches `scenarios.result`/public APIs — never #1/#2. A **normalizer** converts a stored legacy row → normalized v1; historical `status:"optimal"` is never promoted to proven.

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
| Telemetry | **No legacy-read event** (§30.2.8 — matches the Q56 concrete rule below; a legacy result is surfaced via the typed `legacyUnverified` field, not an event). New solves emit v2 on the completed event. |
| Smoke checks / tests | Each states which schema it validates (`SolverEnvelopeV2Schema` for new; `NormalizedSolveResultSchema` for reads). |
| Result cache (unversioned rows) | **Cache miss / re-solve** (composite version §2.10 changes anyway). |

**Concrete contract (§24.2.4/§26.2.6/§28.2.7/Q40/Q48/Q56):** a typed `legacyUnverified: boolean` on the normalized read (always emitted; `false` for v2). Export rejection = `409`/`LEGACY_RESULT_REQUIRES_RESOLVE`. **Telemetry — per real emission site (Q56; the events are distinct, my earlier single-tag design was incoherent):**
- `"scenario solve completed"` (fresh solve or cache hit) — necessarily **v2** post-cutover; keeps its current allowed properties (existing `objective` property **retained** — a legacy result never reaches this event, so no `result_contract` tag needed here).
- `"scenario solve failed"` — bounded `errorCode` tag only; **no** result-contract claim, no diagnostic contents.
- **normalized legacy reads** — **no telemetry** (reads are high-cardinality; legacy is surfaced via the typed `legacyUnverified` field, not an event) unless a sampled read-event is later justified.
- **Solve history:** `resultSummary` gains a typed `legacyUnverified` marker (OpenAPI).
- Tests at **every actual emission site** for property allow-list + no payload/objective-input/path/diagnostic leakage.

### 2.13 Staged v1→v2 rollout + rollback floor (§28.2.5/§30.2.6/Q54/Q63) — additive, not atomic
`nos-api` and `nos-studio` deploy separately and API instances overlap. **Correction (§30.2.6):** `envelopeVersion` does **NOT** protect an already-deployed old binary — the current Zod result object is **non-strict** and strips unknown keys, so a v2 row validates as the old shape. Safety therefore comes from **explicit legacy/v2 discrimination in the NEW dual-reader**, plus a rollback floor — never from an old binary rejecting unknowns.

Named releases:
1. **R1 (schema + dual reader):** nullable `solve_jobs` column push; deploy an API whose new readers **explicitly discriminate** stored legacy vs v2; **public responses stay old-client-compatible**; writer still emits v1.
2. **R2 (frontend):** deploy a frontend treating all new fields as optional, working against the old API; additive job-error transition (`errorCode` **alongside** old `error` for the window).
3. **R3 (writer, flagged):** after **every pre-dual-reader API instance drains** (proven from Render deploy/health evidence), enable the **default-off** `v2_write` server flag (owner: API); v2 writes begin.
4. **Rollback floor:** once any v2 row exists, rollback is allowed **only to R1 (dual reader)** — never below it. Disable `v2_write` **before** any rollback; define treatment of existing v2 `scenarios.result` + cache rows on rollback.
5. **Cleanup:** remove the **removable public-compatibility fields** (the transitional public `SolveJob.error` alias, old response fields) only after a named window + observed client/version criteria. **The legacy STORED-row reader + normalizer is NOT removed (§32.2.6/Q69=retain)** — unversioned `scenarios.result` rows persist forever (no backfill/re-solve, §2.7), so the reader stays **indefinitely**. Separate "removable public-compat field" from "permanent legacy storage reader" explicitly.

**During R1 (§32.2.6):** the new public serializer is **gated separately from v2 writes** — R1 responses stay old-client-compatible (new fields absent/optional) while internal readers already discriminate legacy/v2. **Transitional public `error`** during the window is always a **derived fixed safe message** for the mapped `errorCode` (§2.11) — **never** the raw stored `solve_jobs.error` diagnostic (which currently holds spawn/stderr/stdout/schema text); historical failed rows read as a conservative `SOLVE_FAILED` + safe message. **Rollback floor:** once any v2 row exists, rollback only to R1; disable the `v2_write` flag before rollback.
Closed items: flag = `v2_write` (owner: API, default off); drain-proof = Render deploy/health showing zero pre-R1 instances; tests = **R3-writer/R1-dual-reader** (a pre-R1 reader is forbidden after the first v2 write — the old `new-writer/old-reader` test is invalid); deploy order `nos-api`→`nos-studio`; compatibility-window exit = observed client versions past the cutoff.

### 2.10 Composite solver-contract / cache version (§20.2.5/§22.2.6/Q26/Q35)
Today `jobRunner.SOLVER_CODE_HASH` hashes only `solve.py` (verified). Replace with a **composite version**. The **post-spike design update** must define it **deterministically** (§22.2.6/Q35):
- an explicit **sorted manifest** of hash-input files (`solve.py` + P0R.1 wrapper/parser module(s) + relevant model/config code) — or a build-generated manifest;
- **byte-delimited hashing** including each path + contents unambiguously (stable ordering/encoding);
- the **pinned PuLP version** + an authoritative **CBC binary version/build identifier**;
- **fail-closed startup** if any required hash input/version can't be read;
- an explicit **`SOLVER_CONTRACT_VERSION`** constant for semantic changes not represented by file bytes;
- tests proving a change to the parser, wrapper, dependency/build identifier, **or** the contract constant each invalidates the cache, while identical artifacts stay stable.

**Q35 is an OPEN, mandatory P0R.3 gate (§24.2.5/Q41)** — not resolved yet. No **v2** cache read/write ships (§32.2.9/Q72 — the existing v1 cache keeps operating unchanged) until the exact manifest, byte framing, PuLP/CBC identities, example hash vectors, fail-closed behavior, and invalidation/stability tests are in the post-spike design update and approved.

**Cache transition (§26.2.5/Q47):** **P0R.1/P0R.2 artifacts are evidence-only** — not merged into a release/deploy path before approved P0R.3. The current `solve.py`-only cache hash keeps operating unchanged until the composite version lands with P0R.3; a wrapper/parser file must not deploy against the old hash. Define existing-unversioned-cache-row behavior (cache miss), release rollback, and mixed rolling instances so **no old instance can write an entry a new instance mistakes for v2** (the composite version discriminates).

### 2.11 Internal failure record + private transport (§24.2.3/§26.2.1/Q39/Q43) — NOT in the public envelope
Failures are the **sole** failure path (§30.2.3/Q60=A — no error envelope). **One** internal taxonomy (§32.2.3/Q67 — the earlier duplicate 4-value block is deleted):
- `failureReason` (internal enum): `solver_error` (CBC started, failed/abandoned/numerically errored) | `data_error` (dataset/config load/validate) | `model_error` (dispatch/model construction before CBC) | `internal_error` (unexpected exception) | `timeout` (outer deadline) | `interrupted` (cancel / deploy / server-restart-reaper / external kill).
- `failureStage` (internal enum, exhaustive): `spawn | load | dispatch | build | solve | serialize | protocol | validate | exit | timeout | cleanup | reaper`.
- `errorDetail` (internal, **structured allowlist** — §28.2.3): built from `{stage, code, knownMessage}` at each failure site; **never** raw stdout/stderr/exception/paths/payloads; **≤ 2,048 bytes** (truncated with a marker if longer).

**Private transport `SolverProcessMessage` (§30.2.7/§32.2.8/Q64/Q71) — exact bytes:** dedicated **fd 3**; **exactly one newline-terminated JSON object**; **max 1,048,576 bytes** (byte count); read incrementally, **abort at the cap** (no buffer-then-check); extra non-empty line / trailing bytes / missing-newline-at-EOF / partial write → `internal_error`. **Descriptor lifecycle (two-stage):** Node creates the pipe and passes its write end **as fd 3 into Python** (`stdio: ['pipe','pipe','pipe','pipe']`); **Python sets fd 3 non-inheritable (close-on-exec) before spawning CBC**, so a CBC descendant cannot hold the transport open after Python exits. Schema `{ envelope: SolverSuccessEnvelopeV2 | null, failure: {failureReason, failureStage, errorDetail} | null }` — exactly one non-null; both/neither → `internal_error`. **stdout/stderr are separately capped at ≤ 64 KiB each** (capped capture, discard beyond cap with a truncation marker) — moving the contract to fd3 does not remove the current unbounded-string memory path.

**Race precedence (§32.2.3 — one terminal state, once-only):** a job reaches exactly one terminal outcome by this precedence, evaluated once: (1) **outer timeout fired** → `timeout`, even if a late fd3 message/exit arrives after; (2) **cancellation/kill** → `interrupted`; (3) otherwise **process exit**: nonzero → classify by fd3 `failure` if present else `solver_error`/`internal_error`; zero exit + valid success envelope → success, **unless cleanup then fails** → the success still publishes (result already valid) and cleanup failure is logged internal-only (never downgrades a valid result). A late message after a terminal decision is dropped.

**Public `errorCode` — exhaustive mapping (§30.2.4/§32.2.3/Q61/Q67):**

| source (internal `failureReason` / Node class) | public `errorCode` | safe message |
|---|---|---|
| `solver_error`, `data_error`, `model_error`, `internal_error`, protocol-absent/partial/oversize/invalid, `exit` nonzero, `serialize`, unexpected exception | `SOLVE_FAILED` | "Solve failed" |
| `timeout` (outer deadline) | `TIMEOUT` | "Solve timed out" |
| `interrupted` (cancel/deploy/reaper/kill) | `SOLVE_FAILED` | **"Solve interrupted"** (§32.2.3/Q67 — truthful, NOT `TIMEOUT`) |
| `cleanup` failure after a valid success | (no failure — success publishes; cleanup logged internal) | — |
| pre-enqueue input validation | (no async job — **HTTP 422**, §2.12/Q62) | — |

Async `errorCode` enum = `{ SOLVE_FAILED, TIMEOUT }`. `INPUT_INVALID` is **not** an async outcome (invalid input → synchronous 422/no job). **Persistence:** `solve_jobs` gains nullable `failure_reason`, `failure_stage`, `error_detail`, **and `error_code`** (persist the derived code so a restart reconstructs `TIMEOUT` vs `SOLVE_FAILED` losslessly — rule #3). Public `SolveJob.error` is replaced by `errorCode` + fixed safe message (transition per §2.13).

**Leakage / Sentry (§30.2.8):** negative-leakage tests across scenario reads, job polling, history, exports, logs, and **public** telemetry assert no `failureReason`/`failureStage`/`errorDetail`/path/secret/stdout appears in any **public** response. **Sentry is an operator sink, not public** — it receives an explicit **allowlist** (`failureReason`/`failureStage` as bounded tags, the structured `errorDetail`); its tests are operator-observability tests (distinct from public-leakage tests) and still prohibit raw payloads/secrets/paths/stdout/stderr/arbitrary exception text.

### 2.12 Solver-limit metadata contract (§24.2.6/§26.2.3/§28.2.1-2/Q42/Q45/Q50=A/Q51)
**Q50=A + Q62=A — TRUE no-behavior-change (§30.2.5).** Preserve the **current** request contract exactly: `gap` and `timeLimitSec` stay **required**, existing accepted ranges (**min 0, NO new `gap` max, NO new time ceiling, NO omitted/default contract**); the current per-model manifests/validators are untouched. Invalid input stays **HTTP 422 before enqueue** (no async job). Any future max/default/ceiling is separately authorized product work (not this contract, not DEC-01).
- The new fields only **record** what was used — since nothing clamps, `configured* == requested*` today; `source` is always `request`.
- **Separation/persistence (§30.2.2/Q59):** per-field on the **job record** (written atomically at enqueue): `requestedGap`, `requestedGapSource`, `requestedTimeLimitSec`, `requestedTimeLimitSource` (per-field source — gap may differ from time). The **cacheable solver result** carries only effective `configuredGap`/`configuredTimeLimitSec` (= actual `PULP_CBC_CMD` args) + the cache key. A **distinct published/stored scenario-result schema** composes the current job's requested values onto the response **after** cache lookup — one exact composition point on both fresh-solve and cache-hit paths, so a cache hit never returns a different request's requested value (fixes §28.2.2).
- tests: required-field validation stays 422/no-job; retries/restart/cache-hit reconstruction proves requested values come from the *current* job and survive process loss.

### 2.8 Lifecycle + cache/publish policy (§14.2/Q6) — branch before cache-write/`markSucceeded`
**Envelope (success/math) outcomes only** — no `error` row (§32.2.2/Q66): `optimal`→succeeded/cache/publish · `feasible`→succeeded/cache **only with full gap-time-version key**/publish-labelled · `infeasible`,`unbounded`→succeeded/cache/publish · `no_solution`→succeeded/**no cache**/publish-no-incumbent. **Execution failure is a separate lifecycle (§2.11):** `failure → failed job / no cache / no scenario publish / public errorCode` — never an envelope outcome.

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

### P0R.1 — CBC termination-evidence spike (**go/no-go; gates P0R.3**) — AUTHORIZED TO EXECUTE (product owner, 2026-09-22)
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

### P0R.3 — contract + schemas + OpenAPI + frontend + policy + rollout (CONDITIONAL: after P0R.1 + post-spike review). Every §27/§28 decision has a named task/seam/test (§28.2.4/Q53):
Rewritten to the §31/§32 canonical clauses (§32.2.7/Q70) — completing every task necessarily satisfies Q59–Q64:
- **T-solve** `solve.py`: `_envelope`→v2 success-only (`envelopeVersion:2`, `solutionStatus∈{optimal,feasible,infeasible,unbounded,no_solution}`, raw `solverIncumbentObjective`/`solverBestBound`, canonical `achievedGap` §2.9, `configuredGap`/`configuredTimeLimitSec` §2.12); shared `_termination(...)` wraps P0R.1; public `objective` per §2.9 (unchanged); §2.4 asserted. **Enumerate + migrate every current `_load_error_envelope`/`_envelope("error",…)` exit** to the private failure branch (§2.11). Test: envelope shape per solutionStatus; **no failure path can produce an envelope**.
- **T-msg** private `SolverProcessMessage` (fd3, §2.11): success-envelope-xor-failure; two-stage descriptor lifecycle (Node passes fd3 → Python sets close-on-exec pre-CBC); byte caps (fd3 1 MiB, stdout/stderr 64 KiB, errorDetail 2 KiB); race-precedence state machine. Test: mismatch/partial/oversize/extra-line/EOF → `internal_error`; inherited-descriptor; timeout-vs-late-message; cleanup-after-success.
- **T-db** `solve_jobs` migration (rule #3, exact nullable columns): `requested_gap` (real), `requested_gap_source` (enum `request|default`), `requested_time_limit_sec` (real), `requested_time_limit_source` (enum), `failure_reason` (enum), `failure_stage` (enum), `error_detail` (text ≤2 KiB), `error_code` (enum). New enqueues write requested values/sources atomically; **historical rows stay null forever** (no reliable immutable source, §32.2.4). Test: enqueue-atomicity, historical-null, restart reconstruction of `errorCode`.
- **T-limits** one normalization point (§2.12): required fields preserved (min 0, no max/defaults — Q62=A); effective on cache result+key; requested/sources on job; `composePublishedResult` on fresh + cache-hit. Test: invalid→422/no-job; cache-hit returns **current** job's requested values.
- **T-runner** `jobRunner.ts`: §2.8 success-only lifecycle before cache/`markSucceeded`; the **separate failure lifecycle** (`failure → failed job / no cache / no publish / errorCode`); race precedence (§2.11); calls `composePublishedResult` so only `PublishedSolveResultV2` reaches `scenarios.result`.
- **T-api** `openapi.yaml`: the **five schemas** (§2.6) — `SolverSuccessEnvelopeV2`/`ResultCacheEntryV2`/`PublishedSolveResultV2`/`StoredScenarioResult`/`NormalizedSolveResult`; nullable-`status` union (§2.7); async `errorCode∈{SOLVE_FAILED,TIMEOUT}`; `legacyUnverified`; typed history marker; **regen `lib/api-zod`+`lib/api-client-react` same commit** (rule #1).
- **T-zod** `resultEnvelope.ts`: the five schemas + `composePublishedResult` + legacy normalizer; §2.4 rejection; **negative test: no execution failure validates as any solver/cache/stored-v2/normalized-v2/published shape**.
- **T-norm** normalizer per §2.7.1: `toApiScenario()` (`routes/scenarios.ts:131–153`) + list/get → normalize; output exports → `409`/`LEGACY_RESULT_REQUIRES_RESOLVE`; **legacy stored-row reader retained indefinitely (Q69)**; per-row integration + mixed v1/v2 + authorization.
- **T-telemetry** per-site (§2.7.1/Q56): completed (v2) / failed (`errorCode`) / **no legacy-read event**; emission-site tests + no-leak.
- **T-compat** migrate `_envelope_compat.py` (don't discard `terminationReason`).
- **T-frontend** render by `(solutionStatus, terminationReason)`; "No incumbent" for null objective (no `?? 0`); `quality` §2.5; public failure via `errorCode` safe message.
- **T-rollout** the §2.13 R1/R2/R3 + rollback-floor plan; **R3-writer/R1-dual-reader** test (not the invalid new-writer/old-reader); transitional public `error`=derived safe message (never raw stored diagnostic); `nos-api`→`nos-studio` ordering.
- **Gate (Q35/Q41):** the composite cache version (§2.10) must land before any **v2** cache read/write — its manifest/vectors are their own approved deliverable.

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
| P0R.1 | CBC evidence spike (wrapper+temp-dir primary; direct-CBC fallback needs no-go) | **go/no-go; ON HOLD (Q58); blocks P0R.3** |
| P0R.2 | Fixture capture (approved now) + parser tests (after P0R.1) | fixtures independent |
| P0R.3 | v2 contract + 3 schemas + OpenAPI/regen + normalizer wiring + frontend + policy branch + `_envelope_compat.py` | conditional: after P0R.1 + review |
| P0R.4 | Integration tests + DEC-2026-09-21-01 correction + `e2e_journey.py` repair + both standalone scripts + full gate | conditional |
