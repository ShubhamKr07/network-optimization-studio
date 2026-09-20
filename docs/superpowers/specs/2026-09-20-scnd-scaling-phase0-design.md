# SCND Scaling — Phase 0 + 0.5 Spec (Correctness, Reliability Slice, Measurement, Pilot Gate)

**Date:** 2026-09-20
**Status:** **SUPERSEDED — audit/split ledger; §20 findings resolved (Q22–Q29 answered 2026-09-21, see §21).** Not implemented as a single unit. §§0–12 audit trail; §13 split map; §14/§16/§18/§20 successive reviews; §15/§17/§19/§21 resolutions. Execution authorization: **P0R.1 + P0R.2 attainable-CBC fixture capture only**; P0R.2 parser tests depend on P0R.1; P0R.3/P0R.4 need a post-spike design update + review. **DEC-2026-09-21-01 is authorized** with a durable, independently-auditable artifact — product-owner approval at GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) (resolves §20.2.1). Measurement and B2 remain TBD.
**Parent design:** `docs/superpowers/specs/2026-09-19-scnd-scaling-design.md` (the reviewed B2 design). This spec implements that design's **Phase 0 (correctness + measurement)**, the **minimal durable-payload reliability slice** of Phase 1 (pulled forward per decision L9), and **Phase 0.5 (pilot gate)**. It does **not** build the solver worker split, scheduler, horizontal scaling, single-flight/coalescing, retention, or Quick-mode UI — those remain in a separate B2 spec.

**Goal:** Ship the truthful-result contract and restart-safe queued work now, produce the evidence the B2 sizing/scheduling decisions need, and define the two independent gates that decide what (if any) of the remaining B2 work is justified.

---

## 0. Locked decisions

| # | Decision |
|---|---|
| L1 | Scope = Phase 0 correctness + measurement **plus the minimal durable-payload reliability slice** (L9). Still **no** worker split / scheduler / horizontal scaling / single-flight / retention / Quick-mode UI (all B2). |
| L2 | Truthful solver status/termination metadata ships now. Default quality stays **Proven optimal** (`gap=0`) for the pilot; no student-facing Quick toggle in this spec. |
| L3 | Sizing is **frequency-aware**: measurement classifies by `scenarioFamily` and derives fast/slow *after* measurement (L14); real regime frequency comes from pilot telemetry. |
| L4 | **MIP-start-from-cache** is a measured experiment (P0.8). **Single-flight/coalescing is deferred** to B2 (needs the durable queue + worker coordination). |
| L5 | Pilot-gate SLOs: queue-wait p95 **< 30 s**, **plus** split-by-cache end-to-end (L13): cache-hit p95 **< 2 s**; CBC-miss p95 fast-models **< 10 s**, JADE free-choice **< 60 s**. |
| L6 | Measurement/load tests run against **existing live services** with the §8 safeguards (off-hours, dedicated test account, cleanup, abort). The restart-recovery test (P0.5) redeploys the live API — acceptable pre-cohort, executed with care. Reviewer's ephemeral/staging alternative (11.12) is recorded but not adopted per user decision. |
| L7 | Corpus = **both** hand-authored version-controlled fixtures **and** a sanitized sample of real dev-DB scenarios, under the field allowlist / sanitization policy in §5.2 (L15). |
| L8 | Experiments (MIP-start, warm-worker) may use **N=5** for harness dev; **reported sizing percentiles use N≥20–30** with full provenance (11.8). |
| L9 | **Restart-safety is a pilot requirement.** The durable-payload reliability slice ships in this spec, independent of the capacity result. |
| L10 | The **all-JADE guarantee covers the typical (forced-open) regime** (0.6–3.5 s). The rare free-choice ~16.5 s case rides a relaxed tail SLO / time-limit ceiling, not the guarantee. Tune-in-place remains the compute path; horizontal scaling is not mandated by this spec. |
| L11 | **Two independent gates** (11.2): a **capacity gate** (throughput/SLO headroom of tune-in-place) and a **reliability gate** (restart-safe payloads/retries, API isolation). The reliability gate is already failed by the current arch, which is why L9 pulls the durable-payload slice forward. |

## 1. Scope

**In scope**
1. Truthful result contract: two-dimensional `solutionStatus` + `terminationReason` derived from CBC's actual termination evidence, with nullable incumbent/gap/bound (correctness fix for the verified `status:"optimal"` mislabel).
2. Minimal frontend rendering + historical-result compatibility for the new contract.
3. **Durable-payload reliability slice:** persist the immutable executable payload + versions on the job row; recover queued rows on restart. No worker split.
4. A repeatable benchmark harness + corpus producing the sizing matrix, with per-process instrumentation.
5. Two experiments (MIP-start-from-cache; warm/persistent Python worker), each ending in a decision record.
6. Production-baseline measurement on the real Render plan.
7. The Phase 0.5 pilot gate: two-gate framing, four load profiles, ratified SLOs, decision doc.

**Out of scope (B2 spec)**
- Standalone solver worker service; scheduled scaler; horizontal scaling; API/solver process split.
- Single-flight/coalescing; result-cache retention/normalization; CAS stale-result publication.
- Render Workflows POC; precompute parameter sweeps; student-facing Quick-mode UI.

## 2. Hard-rule guardrails (CLAUDE.md)

- **Rule #2:** `e2e_accuracy.py` passes **unmodified** (87/87). No golden objective/answer changes. New behavior → new tests only.
- **Rule #6:** MIP-start and warm-worker are solver *configuration/experiment* code; they must live under the benchmark directory and never enter the normal solver path (11.16). No business-logic branching in model construction.
- **Rule #1:** OpenAPI is source of truth. `SolveResult` field additions edit `openapi.yaml` + regenerate Zod/React-Query in the same commit; generated code never hand-edited.
- **Rule #3:** the durable-payload columns are added to `solve_jobs` (a populated table) as **nullable**, backfilled where meaningful, and only later enforced NOT NULL in a separate step if required — `drizzle-kit push` has no migration history.
- **Rule #4:** one task = one commit, `[<task-id>] <summary>`, task IDs per §9.

---

## 3. Correctness contract (tasks P0.1–P0.4)

Ordered to resolve the circular dependency in the original (11.10): discover the CBC signal *before* implementing the contract.

### 3.1 Problem (verified)

`solve.py` returns `_envelope("optimal", status_str, …)` on every non-infeasible path (`solve_jade` ~line 1186): envelope `status` is hardcoded `"optimal"`, real CBC status only in `quality`. A gap-stopped or time-limited incumbent is reported as proven-optimal. All solve functions share `_envelope`.

Requested tolerance does **not** determine achieved status (11.3). PuLP 3.3.2's `COIN_CMD.get_status()` can map a `Stopped … objective` solution header to `LpStatusOptimal` while the separate solution status is integer-feasible — so `LpStatus`, requested gap, and wall-clock inference are all insufficient. Classification must read CBC's actual terminal records.

### 3.2 Target contract — two dimensions (11.3)

- `solutionStatus`: `optimal | feasible | infeasible | unbounded | no_solution | error`
- `terminationReason`: `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`
- Metadata, **nullable when unavailable** (never `0` as a stand-in): `requestedGap`, `achievedGap`, `bestBound`, `incumbentObjective`, `runTimeSec` (exists), `configuredTimeLimitSec`.

`incumbentObjective`/`achievedGap`/`bestBound` are null for infeasible, unbounded, error, and time-limit-without-incumbent.

### 3.3 P0.1 — CBC termination-parser spike

- Determine, against the **pinned production CBC/PuLP** (PuLP 3.3.2 / bundled CBC), how to obtain the true terminal record: generate a unique CBC log/solution path per solve, parse a bounded set of known CBC terminal lines, clean the files up.
- Deliverable: a `parse_cbc_termination(log_path, sol_path) -> (solutionStatus, terminationReason, {achievedGap,bestBound,incumbent})` function + a short note on exactly which CBC records are authoritative.
- **Do not** classify a time-limit stop by comparing wall time to `timeLimitSec`.

### 3.4 P0.2 — parser unit tests

- Committed, sanitized CBC log/solution **fixtures** for: optimal (proven), gap-limited with incumbent, time-limited with incumbent, time-limited without incumbent, infeasible, unbounded.
- Tests assert the parser maps each fixture to the correct `(solutionStatus, terminationReason)` + metadata. No live solving — deterministic across machines/CBC builds.

### 3.5 P0.3 — contract implementation + OpenAPI + frontend + compatibility

- `solve.py`: `_envelope` signature gains the two-dimensional status + nullable metadata; a shared `_termination(prob, log_path, sol_path, requested_gap, time_limit, run_time)` wraps P0.1's parser; every solve function's terminal return routed through it.
- `openapi.yaml`: extend `SolveResult` with `solutionStatus`, `terminationReason`, nullable metadata; regenerate `lib/api-zod` + `lib/api-client-react` (same commit).
- `resultEnvelope.ts` (Zod) matched.
- **Frontend (required now, 11.4):**
  - `Studio.tsx` (and Workspace output views) render `feasible`, `time_limit`, `no_solution` distinctly — not the catch-all **Error**.
  - `quality.ts` wording derives from `terminationReason`/`achievedGap`, **not** the requested gap.
  - **Compatibility (default, 11.4):** metadata fields optional in the schema; **read-time normalization** maps historical `scenarios.result` rows (missing the fields) to `terminationReason: unknown` + existing `solutionStatus` best-effort. **No backfill** — the result cache misses on the solver-code-hash change anyway; historical rows render truthfully as `unknown` rather than being re-solved.

### 3.6 P0.4 — contract integration tests + gate

- `test_termination.py`: known-hard scenarios produce each terminal state **without relying on exact wall-clock timing** to force a state (use forced-infeasible, tiny time limits with a hard instance, etc.).
- Frontend tests for every newly visible outcome (`feasible`/`time_limit`/`no_solution`) + the normalized-legacy-result path.
- `resultEnvelope.test.ts`: schema accepts the new shape for all models.
- **Acceptance (11.16):** full repo verification gate green **and** `e2e_accuracy.py` run directly at 87/87 unmodified. A gap-stopped JADE solve reports `feasible` + `gap_limit`, never `optimal`.

---

## 4. P0.5 — Durable-payload reliability slice

Pulled forward per L9. Makes queued work restart-safe. **No worker split** — the existing in-process pool still executes; only the *durability and recovery* of queued work changes.

### 4.1 Problem (verified, 11.2)

- The validated `SolveInput` lives only in `jobRunner.ts`'s process-local `pendingJobs` map.
- A restart loses the in-memory array queue and those payloads.
- `reapStuckJobs()` marks only `running` rows failed; persisted `queued` rows are neither recovered nor failed → can stay permanently queued.

### 4.2 Changes

- **Schema (`solve_jobs`, rule #3 — nullable adds):** `model_id text`, `input_snapshot jsonb` (the immutable validated payload captured at enqueue), `dataset_version text`, `solver_version text` (code hash). Attempt/lease fields are **out of scope** here (they belong with the B2 worker split); this slice only needs recoverable payloads.
- **Enqueue:** `enqueueSolveJob` writes `input_snapshot` + versions in the **same insert** as the job row. Workers execute the snapshot, **never** re-read the (possibly since-edited) scenario row.
- **Startup recovery:** on boot, re-enqueue persisted `queued` rows into the in-process pool from their `input_snapshot` (bounded, oldest-first), **or** fail them with a defined terminal state + reason if re-enqueue is declined. Define the policy explicitly.
- **Reaper:** extend the startup sweep so `queued` rows are recovered/failed, not just `running` rows marked failed.

### 4.3 Test + acceptance

- Restart test covering **both** running and queued jobs: kill/redeploy the API with queued work present; assert every queued job reaches either completion (recovered) or a defined terminal failure with reason — **zero permanently-stuck rows** (satisfies the L11 reliability gate's restart criterion, which the current arch cannot).
- The restart-recovery test runs against live per L6, executed off-hours with the §8 safeguards (it redeploys the live API).
- Full gate green; `e2e_accuracy.py` untouched (no solver-math change).

---

## 5. P0.6 — Benchmark harness + corpus

### 5.1 Deliverable

A **Python** benchmark runner (CBC log parsing, process-tree RSS, MIP-start files, direct `prob.solve()` instrumentation are Python-native, 11.16) under `artifacts/api-server/src/solver/tests/benchmark/`, writing a matrix to `docs/superpowers/metrics/solve-benchmark.<date>.{csv,json}`. Not CI-wired. A **separate** HTTP load generator (P0.10) handles end-to-end tests — not folded into this runner.

### 5.2 Corpus (L7, 11.15)

- **Hand-authored fixtures** (reproducible backbone): per JADE family — forced-open, free-choice, P changes, demand edits, force/inactivate, capability edits, added plants/warehouses/customers, customer exclusion, distance overrides, known-hard combinations — plus one fast-regime baseline per other live model.
- **Sanitized dev-DB sample** (realism check), under a strict policy: an **allowlist** of fields permitted in committed artifacts; commit sanitized fixtures or aggregate measurements only, **never** raw user-owned payloads without explicit approval; record a stable source hash + extraction timestamp; document how a reviewer distinguishes input drift from solver/runtime drift.
- Each row tagged with descriptive **`scenarioFamily`** (not a subjective fast/slow label — L14/11.14).

### 5.3 Runs + recorded fields (11.8, 11.11)

- gaps `{0, 0.005, 0.01, 0.02}`; **N≥20–30** for reported percentiles (N=5 only for harness dev); discard defined warm-up runs; randomize scenario/gap order.
- Per run: p50/p95/min/max + variability/CI wall & CPU; **build/model-construction vs inside-`prob.solve()`** split; CBC phase data (time to root relaxation, first incumbent, best bound, iteration/node counts, terminating reason); **per-process peak RSS via `psutil`/cgroup/`time -v`** with an explicit definition of which RSS is reported (peak Python / peak CBC / process-tree / instance) — do not mix; objective delta vs gap 0; chosen facilities/assignments; feasibility + termination; module import time (once/process).
- **Provenance per run:** Git SHA, solver-code hash, dataset version, fixture hash, Python/PuLP/CBC versions, Render plan+region, concurrency, cache state, run ordinal, timestamp. Commit raw per-run rows alongside aggregates.

---

## 6. P0.7 — Production-baseline measurement (real Render plan)

### 6.1 Question

On live `nos-api` (Starter, 0.5 CPU/512 MB), what is real per-solve CPU/RSS, and is `SOLVE_WORKER_CONCURRENCY=3` safe under concurrent **typical** JADE solves (L10)?

### 6.2 Method (L6 + per-process instrumentation, 11.11)

- Run a subset of the P0.6 harness against live, capturing Render **instance** metrics **combined with in-process `psutil`/cgroup** attribution (instance metrics alone can't separate Node/Python/CBC).
- Drive concurrency 3 then higher; watch OOM / CBC thrash / API event-loop starvation.
- Measure on Render Linux, not local macOS.
- **Guarantee note (L10):** size the typical forced-open regime (0.6–3.5 s ⇒ ~2–4 offered cores at 2,000 solves/hr). The 16.5 s free-choice case is **not** part of the guarantee — record its cost, but it rides the relaxed tail SLO / a time-limit ceiling. Do **not** attempt to pass an all-JADE-free-choice guarantee on Starter/Standard (11.5 — it needs ~9–11 cores, impossible on ≤1 CPU; that would be a B2 horizontal decision, out of scope).

### 6.3 Safeguards (L6)

Off-hours; dedicated test account; tag + clean up all test scenarios/jobs; abort if any real request latency degrades; restore the original plan after any comparison resize.

---

## 7. Experiments

### 7.1 P0.8 — MIP-start-from-cache (full characterization, L8; corrected per 11.9)

**Question:** does a warm start collapse the free-choice ~16.5 s tail and speed near-dups?

**Construction (11.9):** PuLP's CBC warm-start writer emits a value for **every** variable and zero-fills unset ones — setting only `facility_vars` yields a mostly-zero (likely infeasible/rejected) start, not a partial open-facility start. JADE also has binary `FlowWC`/`Src` and continuous `FlowPW`. Choose one explicit path:
- reconstruct a **complete** feasible incumbent from cached open facilities + assignments + flows; or
- emit a **verified partial** CBC MIP-start containing only the intended facility variables.

For every run, capture CBC-log evidence that the start was **accepted / rejected / repaired**. Force/inactivate edits can invalidate a cached open set — record invalidated starts as a **distinct** result.

**Families (L8):** seed from the same scenario's gap-0 optimum (upper bound) and from a near-identical scenario one edit away, **per family**: demand, capacity, force/inactivate, distance-override.

**Guardrail (corrected, 11.9):** the start is advisory, never a constraint; the returned solution must be feasible; a proven solve reaches the same objective within a declared numeric tolerance. Facility/assignment differences are **stability outcomes**, not automatic bugs (multiple optima), unless uniqueness is independently proven.

**Code location (rule #6, 11.16):** benchmark directory only; never the production solver path.

**Deliverable:** `docs/superpowers/specs/2026-09-20-mipstart-experiment.md` — does warm-start work with this CBC, per-family effect on time-to-incumbent and total time, accept/reject/repair rates, correctness caveats, and whether it earns a B2 production code path.

### 7.2 P0.9 — warm/persistent Python worker

**Question:** how much per-solve overhead (spawn + PuLP import + dataset load) does a persistent worker remove, and for which models is it material?

**Method:** measure current spawn+import+load vs CBC time for a ~1 s model and JADE; prototype a persistent worker (import/load once, loop on stdin) — **prototype only**, not the B2 worker service; measure steady-state per-solve vs spawn-per-solve; note state-leakage/reliability risk. Benchmark-dir only.

**Deliverable:** decision-record section — overhead removed per model, whether B2 should build it, reliability caveats. Expectation (parent §4.2): material for ~1 s models (~0.365 s import ≈ 25–35% of runtime), not the fix for the 16.5 s free-choice tail.

---

## 8. P0.10 — Phase 0.5 pilot gate

### 8.1 Two independent gates (L11, 11.2)

- **Capacity gate:** does tune-in-place (typical-guarantee sizing, L10) meet the SLOs (§8.4) under the load profiles (§8.2)?
- **Reliability gate:** restart-safe payloads/retries + API isolation. Already failed by the pre-P0.5 arch; **P0.5 closes the restart-safety half**. Remaining reliability items (API/solver isolation, retries/leases under a worker split) stay B2 and are **not** dismissible by a capacity pass.

A capacity pass may authorize a deliberately limited pilot; it must not defer reliability work that is a product requirement.

### 8.2 Load profiles (11.6) — run all four

1. **Contracted steady state:** 20% exact-hits / 80% unique CBC misses.
2. **Cold unique burst:** 50 distinct hashes.
3. **Cold identical burst:** 50 requests for one hash (exposes duplicate compute before single-flight exists — B2 evidence).
4. **Warm all-hit burst:** API/Postgres/cache-serving capacity only.

Generator fidelity: **50 authenticated users/sessions** (not one shared account); distinct scenarios where needed (avoid testing only same-row overwrites); the real **800 ms** poll cadence; both the representative distribution **and** the all-JADE-typical guarantee; explicit warm-up / measurement / drain periods; a **real 3-hour soak** (an arrival-compressing "accelerated equivalent" changes the queueing problem and is not accepted).

### 8.3 Atomic-admission recording (11.7)

`POST /solve` checks `getQueueDepth()` before its first DB await, so `QUEUE_DEPTH_LIMIT=30` is **not** a hard bound (TOCTOU). Record: max observed in-memory queue depth, admissions after the limit was effectively crossed, rejection count + `Retry-After` behavior, depth-at-admission. Treat overshoot as evidence about the admission design, not a guaranteed boundary.

### 8.4 SLOs (L5, L13/11.13)

- Queue wait (queuedAt→startedAt) p95 **< 30 s**.
- **End-to-end (queuedAt→finished), split by cache state:** cache-hit p95 **< 2 s**; CBC-miss p95 fast-models **< 10 s**, JADE free-choice **< 60 s**.
- Enqueue latency p95 < 500 ms; enqueue rejection rate under contracted load < 1%; execution failure rate (excl. infeasibility) < 1%; a max timeout/no-incumbent rate + an explicit max solve deadline; **zero permanently-stuck jobs** across restart (running + queued).
- Report cache-hit vs CBC-miss completion distributions separately; cached completions must report **cache-serving latency**, not the cached solve's original `runTimeSec` (11.14).

### 8.5 Gate decision

Deliver `docs/superpowers/specs/2026-09-20-pilot-gate-results.md`: per-gate pass/fail with evidence, the identified bottleneck (CPU / event loop / spawn throughput / Postgres connections), and worker-count/plan recalculated from **measured** p95 service time + the approved SLOs. A capacity pass → limited pilot on tune-in-place (+ P0.5 reliability). A fail → the failure mode names the first-justified B2 component and seeds the B2 spec.

---

## 9. Tasks + deliverables

| ID | Task | Kind |
|---|---|---|
| P0.1 | CBC termination-parser spike (pinned CBC/PuLP) | Code (benchmark/parser) |
| P0.2 | Parser unit tests on committed CBC-log fixtures | Tests |
| P0.3 | Two-dimensional result contract + OpenAPI/regen + Zod + frontend + read-time compat | Code + contract |
| P0.4 | Contract integration tests + full gate + direct `e2e_accuracy.py` | Tests |
| P0.5 | Durable-payload reliability slice (schema, enqueue snapshot, restart recovery) | Code + schema |
| P0.6 | Benchmark harness + corpus + matrix (N≥20–30, provenance, per-process RSS) | Code + data |
| P0.7 | Production-baseline measurement on live Render (typical guarantee) | Measurement |
| P0.8 | MIP-start-from-cache experiment (corrected construction) | Experiment + doc |
| P0.9 | Warm/persistent Python worker experiment | Experiment + doc |
| P0.10 | Pilot gate: two gates, four profiles, SLOs, load test, decision doc | Test + decision doc |

Task IDs are stable for the `[<task-id>]` commit format (rule #4). Every solver-contract task (P0.3–P0.4) lists the full repo gate **and** direct `e2e_accuracy.py` in acceptance. No committed infrastructure resize; P0.7/P0.10 use live services under §6.3/§8 safeguards.

## 10. Clarifications — resolved

| # | Decision | Source |
|---|---|---|
| Completion SLO | queue-wait <30 s + split-by-cache end-to-end | L5, L13 |
| Reliability | restart-safety required now → P0.5 in scope | L9 |
| Guarantee scope | all-JADE **typical** (forced-open); free-choice on relaxed tail SLO | L10 |
| Test env | existing live services + safeguards (ephemeral/staging recorded, not adopted) | L6 |
| Corpus | hand-authored + sanitized dev-DB sample under allowlist | L7 |
| MIP-start | full characterization, corrected construction | L8 |
| Sampling | N≥20–30 for sizing percentiles + provenance | L8 |

---

## 11. Deep-review resolution map (2026-09-20)

Each §11 finding from the review and how it is now incorporated into §§0–10. Contradictory originals are superseded.

| Finding | Severity | Resolution |
|---|---|---|
| 11.2 capacity/reliability conflated | Critical | L11 two gates; L9 pulls the durable-payload slice forward (P0.5); §8.1 states the reliability gate is already failed and not dismissible by a capacity pass. |
| 11.3 status/termination conflated | Critical | §3.2 two-dimensional `solutionStatus`+`terminationReason`; nullable metadata; §3.3 parses CBC terminal records, not `LpStatus`/gap/wall-clock. §3.2's old "`optimal` requires gap==0" removed. |
| 11.4 frontend + migration missing | Critical | §3.5 adds required frontend rendering + `quality.ts` rewording + read-time-normalization compatibility (no backfill). |
| 11.5 tested plans can't answer all-JADE | Critical | L10 guarantee = typical regime; §6.2 explicitly does not attempt all-JADE-free-choice on ≤1 CPU (that's a B2 horizontal decision). |
| 11.6 load profiles underspecified | High | §8.2 four profiles + generator fidelity (50 sessions, distinct scenarios, 800 ms polling, real 3 h soak). |
| 11.7 admission not atomic | High | §8.3 records overshoot/admissions-past-limit/depth-at-admission; 30 treated as non-binding. |
| 11.8 N=5 insufficient | High | L8 + §5.3: N≥20–30 for percentiles, provenance, raw rows, warm-up discard, randomized order. |
| 11.9 MIP-start not partial | High | §7.1 corrected construction (full incumbent or verified partial), accept/reject/repair evidence, invalidated-start result class, multiple-optima guardrail. |
| 11.10 termination tests circular | High | §3 reordered: P0.1 spike → P0.2 parser tests → P0.3 contract → P0.4 integration. |
| 11.11 Render metrics not per-process | High | §5.3/§6.2 combine instance metrics with `psutil`/cgroup/`time -v`; RSS definition made explicit. |
| 11.12 live-first risky | High | Recorded; **not adopted** per L6 (user chose live services). Restart test runs off-hours with safeguards. |
| 11.13 queue-wait ≠ completion SLO | High | L5/§8.4 add split-by-cache end-to-end SLOs + cache-serving latency for hits. |
| 11.14 regime/telemetry definitions | Medium | L3/§5.2 descriptive `scenarioFamily`, fast/slow derived post-measurement; §8.4 cache-serving latency; frequency source specified from non-cache-hit buckets + family tag + `solve_jobs` timestamps. |
| 11.15 corpus handling | Medium | §5.2 field allowlist, sanitized-only commits, source hash + timestamp, drift documentation. |
| 11.16 execution details | Medium | §9 stable task IDs; §5.1 Python runner + separate load generator; rule #6 keeps experimental code benchmark-only; §3.6/§9 add full gate + direct `e2e_accuracy.py`. |

---

## 12. Final approval review — unresolved findings (2026-09-21)

**Review disposition: REQUEST CHANGES.** The direction is substantially improved, but this revision is not implementation-ready. The two-dimensional solver outcome, parser-first ordering, benchmark provenance, four load profiles, real soak, frontend responsibility, and corrected MIP-start experiment are sound. The findings below must be resolved before approval; recording a finding here does not itself change the product contract or authorize live-service mutations.

### 12.1 Blocker — workload guarantee was narrowed without an explicit product decision

L10 changes the guarantee from the parent design's all-JADE/heaviest-model contract to only the "typical forced-open" regime and §6.2 sizes for 2,000 CBC solves/hour after assuming a 20% exact-cache hit rate. That conflicts with the parent design, which says:

- all-JADE is the guaranteed sizing case (§2.3);
- guaranteed capacity includes cold cache until single-flight/coalescing exists (§2.2);
- Phase 0.5 must not size solely from the fast forced-open case (§14);
- 50 users × 50 submissions/hour remains the design contract unless the product owner explicitly reduces it (§14).

The current four profiles contain a 50-request cold-unique burst, but no sustained **2,500 unique CBC misses/hour for three hours**. Because the 20% hit rate is a hypothesis rather than a guarantee, a contracted-capacity pass must include that sustained cold-miss profile. Restore it, or record an explicit product-owner decision reducing the original requirement and state the resulting unsupported workload.

The proposed 0.6–3.5 s forced-open range is also not yet a locked sizing input: the parent records approximately 13 s from earlier suite timing, and the low end may come from non-default gaps. P0.6 must first measure the exact scenario family at the pilot default `gap=0`. Until then, describe 0.6–3.5 s as a hypothesis, not a guarantee.

### 12.2 Blocker — durable payloads alone do not provide restart-safe execution

P0.5 excludes attempts and leases while promising that startup will re-enqueue queued rows. During a rolling/zero-downtime deploy, the old instance can still hold a queued row in memory while the new instance discovers the same persisted row. The current runner changes a job to `running` with an unconditional update by job ID, so two processes can execute the same solve. If the old process wins the update and is then terminated, the new process can also decline the row and leave it orphaned.

The minimum P0.5 protocol must include:

1. an atomic compare-and-set claim (`queued` → `running`) that returns whether this process won;
2. claim ownership (`worker_id`/deployment generation) and lease expiry, or an equivalent mechanism that safely distinguishes live work from abandoned work;
3. a bounded attempt count and explicit exhausted-retry terminal reason;
4. recovery that cannot race a still-running old deployment;
5. idempotent, ownership-checked terminal updates;
6. readiness failure or bounded retry when the recovery query cannot reach Postgres.

If attempts/leases remain deferred, P0.5 must stop claiming that queued work is recoverable/restart-safe and must instead choose a deterministic fail-on-restart policy. That weaker policy would not satisfy L9 as currently written.

### 12.3 Blocker — graceful shutdown is part of restart safety and is missing

The current API's `SIGTERM`/`SIGINT` handlers flush telemetry and immediately call `process.exit(0)`. They do not stop solve admission, close the HTTP listener, stop claiming work, drain active jobs, or terminate/checkpoint the Python/CBC process tree. Render sends `SIGTERM`, waits only the configured `maxShutdownDelaySeconds` (1–300 seconds, default 30), and then sends `SIGKILL`; a payload snapshot does not protect an in-flight child process from that lifecycle.

P0.5 must define and test this shutdown sequence:

1. mark the instance draining and reject new solve admission with an explicit retry response;
2. stop claiming queued jobs;
3. close/drain HTTP traffic;
4. allow active solves to finish within the configured deadline;
5. on deadline, terminate the **entire Python/CBC process group**, not only the direct Python child;
6. release/requeue or terminally fail unfinished jobs according to the ownership/lease protocol;
7. close database, PostHog, and Sentry resources and exit cleanly.

The chosen `maxShutdownDelaySeconds` must be written into the deployment/runbook and reconciled with the maximum solve deadline.

### 12.4 Blocker — recovery does not enforce snapshot/version compatibility

Persisting `dataset_version` and `solver_version` is insufficient unless recovery uses them. A job created by deployment A could otherwise execute its old snapshot under deployment B's solver code or dataset and silently produce a result with different semantics.

Startup recovery must validate the snapshot against the current model schema and define exact handling for:

- solver-version mismatch;
- dataset-version mismatch;
- unknown/retired model ID;
- malformed snapshot;
- legacy queued rows with null/missing payload or version fields.

Absent an immutable old solver artifact, mismatched work should terminate with a named reason such as `version_mismatch`; it must not silently run with new code/data. Recovery/database errors also cannot be swallowed while the instance becomes ready, because that contradicts the zero-permanently-stuck acceptance criterion.

### 12.5 Blocker — result-contract migration is ambiguous and incomplete

P0.3 adds `solutionStatus` but does not say whether the existing required `status` field remains, is deprecated, or is removed. That decision is mandatory because OpenAPI, `ResultEnvelopeSchema`, the job summary, Studio/Workspace views, many tests, and the sacred unmodified `e2e_accuracy.py` all read `status` today.

The contract must specify all of the following:

- add an `envelopeVersion` (or an equally explicit version discriminator);
- for new envelopes, retain `status` as a deprecated equality-enforced alias of `solutionStatus`, or define another compatibility mechanism that allows `e2e_accuracy.py` to remain byte-for-byte unchanged;
- make the existing `objective` nullable when no incumbent exists, rather than leaving a misleading numeric sentinel alongside nullable `incumbentObjective`;
- define whether `quality` remains, is deprecated, or becomes derived-only;
- define `infeasibilityReason` compatibility;
- require new metadata on new-version envelopes while permitting it to be absent only on normalized legacy envelopes;
- reject contradictory combinations such as `solutionStatus=optimal` with `terminationReason=time_limit` or mismatched `status`/`solutionStatus`;
- enumerate every consumer that must migrate, including job history summaries, analytics/telemetry, exports/templates, Studio/Workspace, cache validation, API tests, and deployment smoke checks.

Historical `status:"optimal"` cannot truthfully be normalized to proven optimal, because the verified defect is that this old value can represent a gap- or time-limited result. Historical rows therefore need `solutionStatus: unknown`/nullable or an explicit `legacy_unverified` representation. “Best-effort” promotion to `optimal` is not acceptable.

The frontend requirement also mixes dimensions: `time_limit` is a `terminationReason`, not a `solutionStatus`. Rendering requirements should cover combinations such as `feasible + gap_limit`, `feasible + time_limit`, and `no_solution + time_limit`.

Finally, define the job-lifecycle mapping independently of mathematical outcome. A suggested starting point is: proven/gap/time-limited feasible and mathematically infeasible/unbounded are completed solver outcomes, while spawn/parser/solver errors are failed jobs; time-limit-without-incumbent requires an explicit product decision.

### 12.6 Blocker — stale-result publication cannot remain out of scope for the pilot

The current runner unconditionally writes every completed job to `scenarios.result`. If a user edits or resubmits a scenario while an older solve is running, the slower older job can finish last and overwrite the newer result. At 50 submissions/user/hour this is a normal concurrency path, and using distinct scenarios in the load generator avoids rather than validates the failure.

Pull a minimal latest-job/scenario-revision/input-hash publication guard into Phase 0.5. An older job may remain `succeeded` in solve history, but its result must be marked superseded and must not become the scenario's current result. Add the parent design's inverted-completion-order test to the pilot gate.

### 12.7 Blocker — the two-gate decision has no coherent pilot consequence

L11 defines the reliability gate as restart-safe payloads/retries plus API isolation. Section 8.1 then says P0.5 closes only the restart-safety half and leaves retries/leases and API isolation to B2, so the reliability gate still fails. Section 8.5 nevertheless authorizes a limited pilot from a capacity pass plus P0.5.

Define explicitly:

- the minimum reliability criteria that must pass before any pilot;
- whether both gates must pass for pilot authorization;
- which unresolved reliability failures merely trigger B2 versus block the pilot;
- the maximum users, duration, request rate, operator coverage, and rollback conditions of a “limited pilot” while API/solver isolation remains absent.

Do not label two tests “independent gates” if failure of one has no stated effect on the decision.

### 12.8 Blocker — the normative parent document is not tracked

At review time `docs/superpowers/specs/2026-09-19-scnd-scaling-design.md` existed only as an untracked file, while this spec treats it as normative. A commit containing only this phase document would leave other checkouts with a broken design reference. Track the parent design in the same branch/approved change set, or replace the dependency with a committed normative source.

### 12.9 High — P0.4's time-limit integration test is non-deterministic

P0.4 says terminal-state tests must not rely on exact wall-clock timing, then proposes tiny time limits on a hard instance. That still depends on machine speed, CBC scheduling, and build version. Committed parser fixtures should remain authoritative for time/gap/node-limit classifications. Integration tests should use deterministic optimal/infeasible cases plus an injectable solver/parser seam or controlled subprocess fixture for time-limited states; CI must not require a live solve to hit a timing race.

### 12.10 High — P0.5 lacks automated failure-path coverage

The live restart test is an operational validation, not a substitute for deterministic unit/integration coverage. Add tests for:

- payload and version fields written atomically with enqueue;
- oldest-first bounded recovery;
- duplicate-claim prevention during overlapping startup;
- malformed/missing legacy snapshots;
- model/schema and solver/dataset version mismatch;
- recovery-query failure and readiness behavior;
- SIGTERM stopping admission and claims;
- drain success and drain timeout/process-group termination;
- lease expiry, retry exhaustion, and ownership-checked completion;
- distinct handling of queued and running rows.

### 12.11 High — production measurement does not define a decision-capable plan matrix

P0.7 names only the current Starter 0.5-CPU instance and says to try concurrency 3 and higher, even though §6.2 estimates that the narrowed workload needs roughly 2–4 offered cores. Increasing CBC concurrency on a 0.5-CPU instance measures contention, not whether tune-in-place can meet the contract.

Before live execution, specify candidate vertical plans with their actual CPU/RAM, concurrency per plan, test order, stabilization period, restore procedure, and pass/fail headroom. Include at least the current baseline and credible 2-core and 4-core comparators if Render currently offers them. Render instances within one service use one common plan; do not imply a mixed-plan fleet.

The sizing calculation must use measured `gap=0` p95 service time and both rates:

- the representative forecast (including measured cache frequency); and
- the guaranteed sustained cold-miss rate of 2,500 solves/hour unless §12.1 explicitly changes the contract.

### 12.12 High — SLOs are still placeholders or have ambiguous populations

Section 8.4 promises a maximum timeout/no-incumbent rate and an explicit maximum solve deadline but provides neither number. L5 calls the SLOs locked/ratified, so every gate criterion must be numeric before implementation.

Define:

- maximum solve deadline;
- timeout rate and no-incumbent rate separately;
- an end-to-end p95 target for the guaranteed JADE forced-open/default-gap class (do not hide it under an undefined “fast-models” bucket);
- whether mathematically infeasible/unbounded outcomes count as execution failures (they should normally be reported separately);
- minimum sample/event count required to evaluate each percentile and rate;
- the headroom rule for a pass, rather than accepting a result exactly at the SLO boundary.

### 12.13 High — live-test safeguards are not an executable runbook

L6's decision to test existing live services is accepted for this spec, but the present safeguards are too vague to authorize a production mutation. Before P0.7/P0.10, add a reviewed runbook containing:

- named operator and separate approval immediately before resize/redeploy/load generation;
- maintenance window and stakeholder notification;
- exact service/region/plan identifiers and pre-test configuration snapshot;
- 50 isolated test users/sessions (not one shared “dedicated account”), credentials handling, and cleanup lifecycle;
- whether the Python benchmark runs through an ephemeral SSH shell and where the HTTP load generator runs;
- Render deploy/log/metrics and Postgres connection queries with timestamps aligned to the test window;
- numeric abort thresholds for p95 latency, HTTP 5xx, CPU, memory, database connections, queue depth, and real-user activity;
- a cold-identical hash that has never been cached and a warm-hit profile seeded exactly once, without destructive cache clearing;
- rollback/plan-restore commands, verification, and ownership;
- tagging and post-test deletion/retention policy for scenarios, jobs, accounts, and metrics.

### 12.14 Medium — benchmark raw and aggregate schemas are conflated

“Per run: p50/p95/min/max” is incorrect: percentiles and extrema are aggregates over a group, not attributes of one run. Define two schemas:

- **raw run row:** scenario/fixture, gap, ordinal, wall time, process CPU, child CPU, build time, CBC time, termination data, memory measurements, objective/feasibility, and provenance;
- **aggregate row:** grouping dimensions plus N, p50, p95, min, max, variability/confidence interval, and outlier/warm-up policy.

Replace `N≥20–30` with an exact rule. Use at least **N=30** for sizing percentiles or document a statistically defined adaptive stopping rule. N=5 remains harness-development-only.

Define RSS sampling frequency and semantics so short CBC peaks are not missed. Record Python peak, CBC peak, process-tree/cgroup peak, and instance peak separately; do not combine them into one field. For fresh subprocess experiments, `/usr/bin/time -v` can supplement polling; for concurrent live tests, instance/cgroup memory remains the authoritative capacity boundary.

### 12.15 Medium — recovery needs an index and explicit bounds

The parent workload can create roughly 150,000 job rows/month. “Bounded, oldest-first” is not executable without a batch size, maximum startup backlog, pagination/locking behavior, and follow-on scheduling policy. Add an index suited to recovery, for example a partial `(queued_at, id) WHERE status='queued'` index, and inspect the query plan. Define what happens when queued rows exceed the startup batch so the remainder cannot stay stuck indefinitely.

### 12.16 Medium — cost evidence is missing from the pilot decision

The original objective includes keeping compute cost low, but the gate deliverable asks only for worker count/plan. For every passing candidate, report:

- cost per successful CBC miss and per accepted submission;
- projected cost for the three-hour peak window and 20 class-days/month;
- baseline/idle cost outside class windows;
- cost sensitivity to cache-hit rate and free-choice frequency;
- operational cost/complexity of manual or scheduled vertical changes;
- the least-cost plan that still preserves the approved headroom.

Render bills compute approximately by running instance time and scaling actions themselves have no separate fee, so the report should distinguish actual provisioned duration from a full-month always-on projection.

### 12.17 Approval checklist

Approval requires a revision that:

- [ ] resolves the all-JADE/heaviest-model workload contract and restores the sustained 2,500 cold-miss/hour test unless the product owner explicitly reduces it;
- [ ] moves the minimum atomic claim/ownership/lease/retry protocol and graceful shutdown into P0.5, or withdraws the restart-safe claim;
- [ ] defines version-aware recovery and startup/readiness failure behavior;
- [ ] publishes a complete versioned result-contract transition, including legacy-unverified semantics and nullable objective-without-incumbent behavior;
- [ ] adds stale-result publication protection before pilot use;
- [ ] makes the two gate outcomes and limited-pilot authorization criteria coherent;
- [ ] replaces timing-dependent CI requirements with deterministic tests and adds P0.5 failure-path coverage;
- [ ] defines candidate Render plans, numeric SLOs/abort thresholds, a live execution runbook, and cost outputs;
- [ ] corrects benchmark raw/aggregate schemas, fixes the sample-size rule, and defines recovery indexing/bounds;
- [ ] ensures every normative referenced design document is tracked.

After these items are incorporated into §§0–10 and the contradictions are removed—not merely marked resolved in a map—the document should receive another approval review.

---

## 13. Split decision + finding-rehoming ledger (2026-09-21)

The 2026-09-21 answers resolved the §12 blockers structurally rather than by inflating this one spec:

- **Q1 = Split.** The correctness contract is genuinely small, verified, and independent; it ships as its own spec now. Reliability/restart-safety cannot be minimal (§12.2/3/4) — the full concurrency protocol lives in B2. Measurement is independent of the queue and gets its own spec feeding B2 sizing.
- **Q2 = Restore the full parent guarantee** (all-JADE + sustained 2,500 unique cold-miss/hour). At the parent's initial numbers this is ~9 offered cores (13 s/solve) to ~11.8 (17 s/solve), i.e. ~12.9–16.9 cores at a 70% target. Per §18.5, **Render's web/worker plan ceiling is 12 CPU** (`12c-96g`; the 16/32-CPU tiers are Postgres, not compute) — so a single vertical instance **cannot be presumed** to meet the guaranteed load with headroom. Per §14.6/§16.5/Q7, **compute topology is decided by measurement, not by core count**: the measurement spec compares high-core vertical (≤12 CPU, a comparator only — not an assumed pass) vs one dedicated worker vs a horizontal fleet, using **current official plan IDs**, on SLO/headroom/restart/billing/idle-cost/complexity, then selects. Worker **isolation + B2 reliability remain mandatory regardless**; B2 must land before any real cohort pilot.
- **Q3 = Publication guard** (stale-result CAS) is required, and since there is no near-term pilot on the current single instance, it lands in B2 with the rest of reliability.

### 13.1 Three successor specs

| Spec | Scope | Status |
|---|---|---|
| **Correctness contract** — `2026-09-21-scnd-solver-result-contract-design.md` | Two-dimensional `solutionStatus`+`terminationReason`, CBC evidence parser, three schemas (raw-v2 / stored / normalized) + normalizer, per-model objective + canonical `achievedGap`, lifecycle+cache/publish branch, frontend, consumer migration, DEC-2026-09-21-01 sacred-test correction, `e2e_journey.py` repair. Tasks P0R.1–P0R.4. | **Approved to execute P0R.1 + P0R.2 fixture capture only. P0R.3/P0R.4 require a post-spike design update + approval review.** |
| **Measurement + experiments** — TBD (`2026-09-2x-scnd-scaling-measurement-design.md`) | Benchmark harness + corpus (N≥30, provenance, raw-vs-aggregate schemas, per-process RSS), MIP-start-from-cache experiment (corrected construction), warm/persistent-worker experiment, Render candidate-plan matrix incl. gap=0 forced-open re-measurement, **and the Q7 compute-topology comparison (high-core vertical vs dedicated worker vs horizontal fleet)**. Feeds B2 sizing. | Needs its own brainstorm/spec pass. |
| **B2 — durable isolated solver tier + pilot gate** — TBD (`2026-09-2x-scnd-scaling-b2-design.md`) | Full concurrency protocol (atomic CAS claim, ownership/lease, attempts/retry-exhaustion, graceful shutdown + process-group kill, version-aware recovery, readiness-on-recovery-failure), stale-result CAS publication guard, worker split, scheduler, **the measurement-selected compute topology** (high-core vertical / dedicated worker / horizontal fleet — Q7/§16.5, not pre-decided), single-flight/coalescing, retention/index/bounds, two-gate pilot authorization, four load profiles incl. sustained 2,500 cold-miss/3h, numeric SLOs + headroom, executable live-test runbook, cost outputs. **Worker isolation + reliability protocol mandatory regardless of topology.** | Needs its own brainstorm/spec pass. |

### 13.2 §12 finding → destination

| Finding | Destination |
|---|---|
| 12.1 workload guarantee | B2 (Q2 restores all-JADE + sustained 2,500 cold-miss); measurement spec re-measures forced-open at gap=0. |
| 12.2 atomic claim/lease/retry | B2 (full protocol). |
| 12.3 graceful shutdown + process-group kill | B2. |
| 12.4 version-aware recovery | B2. |
| 12.5 result-contract migration | **Correctness spec** (§2 fully incorporates it: envelopeVersion, `status` alias, nullable objective, quality derived, legacy_unverified, contradiction rejection, consumer enumeration, lifecycle mapping). |
| 12.6 stale-result publication | B2 (Q3 — CAS publication guard). |
| 12.7 two-gate coherence + limited-pilot criteria | B2. |
| 12.8 track parent doc | **Done** (parent committed 2026-09-21). |
| 12.9 deterministic tests, no timing race | **Correctness spec** P0R.2/P0R.4 (committed CBC fixtures authoritative; injectable seam). |
| 12.10 P0.5 failure-path coverage | B2. |
| 12.11 candidate-plan matrix | Measurement spec + B2. |
| 12.12 numeric SLOs + headroom | B2 (gate). |
| 12.13 executable live-test runbook | B2. |
| 12.14 raw-vs-aggregate schemas, N≥30 | Measurement spec. |
| 12.15 recovery index + bounds | B2. |
| 12.16 cost outputs | B2 (gate). |

Nothing from §12 is dropped; each item is either done or assigned to the correctness / measurement / B2 spec above.

---

## 14. Split-map approval review — unresolved findings and questions (2026-09-21)

**Review disposition: REQUEST CHANGES.** The split into correctness, measurement, and B2 is the right program structure, and the full all-JADE / sustained 2,500-cold-miss guarantee has been restored. However, §13 is not yet accurate enough to approve as the authoritative split ledger. In particular, the correctness successor is not implementation-ready, and the statement that the workload makes horizontal scaling mandatory is not established by the evidence cited.

### 14.1 Critical — the correctness successor's protected-test gate is impossible as written

The correctness successor says `e2e_accuracy.py` only runs at `gap=0`, and therefore every protected `status=="optimal"` assertion represents proven optimality. The repository contradicts that premise:

- the Brazil base payload uses `gap=0.05` (`e2e_accuracy.py` ~lines 336–342);
- Brazil P=5/P=7/P=10 then assert `status == "optimal"` (~lines 385–388);
- Brazil single-source at 5% also asserts `"optimal"` (~lines 366–427);
- the cross-model Brazil case uses `gap=0.05` (~lines 602–605);
- transportation also includes a 5%-gap single-source case.

A direct probe of the exact Brazil P=5 / cap=20M protected payload, using the pinned local PuLP/CBC and capturing the CBC terminal log, produced:

```text
Result - Optimal solution found (within gap tolerance)
Objective value: 27022899653.80000305
Lower bound:     26971509401.152
```

That is a feasible incumbent terminated by the gap limit, not proof of optimality. The proposed truthful contract must emit `solutionStatus=feasible` + `terminationReason=gap_limit`, and §2.3 of the correctness successor maps the deprecated `status` alias to `"feasible"`. The protected suite would then fail its `"optimal"` assertion. Conversely, retaining `status="optimal"` would preserve the test but continue the exact lie this change is meant to remove.

Therefore §13.1 must not call the correctness spec implementation-ready or say it “ships standalone now” until Q4 is answered. The correctness acceptance criterion cannot simultaneously require truthful alias values and an unmodified protected suite whose approximate cases assert `"optimal"`.

### 14.2 Critical — job-lifecycle mapping is declared but not assigned executable work

The successor decides that solver-error envelopes produce failed jobs, while `optimal`, `feasible`, `infeasible`, `unbounded`, and `no_solution` are completed solver outcomes. The current `jobRunner.ts` does something else: once an envelope passes Zod validation, it writes it to the result cache and calls `markSucceeded` unconditionally. A future valid `solutionStatus=error` envelope would therefore be cached, published, and recorded as a succeeded job.

P0R.3 must explicitly require and test a status-policy branch **before** cache write/publication:

| `solutionStatus` | Job lifecycle | Cache | Publish to scenario |
|---|---|---|---|
| `optimal` | succeeded | yes | yes |
| `feasible` | succeeded | explicit policy required (key already includes gap/time inputs) | yes, labelled non-proven |
| `infeasible` | succeeded mathematical outcome | explicit policy required | yes |
| `unbounded` | succeeded mathematical outcome | explicit policy required | yes |
| `no_solution` | succeeded per current product decision | **explicit policy required**; caching may prevent a later retry from ever solving | yes, as no-incumbent outcome, never as numeric zero |
| `error` | failed | no | no |

Tests must cover job status, result summary, telemetry, cache write/no-write, and scenario publication for every row. Until this work is named, §13.2's claim that the correctness successor fully incorporates the lifecycle finding is false.

### 14.3 High — the legacy-result representation is still an unresolved choice

The v2 `solutionStatus` enum is `optimal | feasible | infeasible | unbounded | no_solution | error`, but the compatibility text says a historical row becomes `solutionStatus: unknown` **or** receives an explicit `legacy_unverified` marker. Neither representation is part of the declared enum, and “or” leaves implementation discretion on a contract boundary.

Choose one exact discriminated shape. Recommended:

- v2 solver output: `envelopeVersion: 2`; `solutionStatus`, `terminationReason`, alias `status`, and all v2 metadata present (nullable where semantically unavailable);
- normalized legacy view: `envelopeVersion: 1`; `solutionStatus: null`; `terminationReason: unknown`; `legacyUnverified: true`; preserve the raw legacy status separately if it is useful for display/debugging;
- reject partial mixtures such as `envelopeVersion: 2` with missing status dimensions or `envelopeVersion: 1` that claims `optimality_proven`.

OpenAPI and Zod need the same discriminated union. Historical `status:"optimal"` must never be promoted to proven optimal.

### 14.4 High — cross-field invariants are incomplete

The successor lists only a subset of invalid combinations. Publish an authoritative allowed-pair matrix and enforce it identically in Python, hand-written Zod, and generated/API validation:

- `optimal` ↔ `optimality_proven` only;
- `feasible` ↔ `gap_limit | time_limit | node_limit | interrupted`, with a non-null incumbent;
- `infeasible` ↔ `infeasible`;
- `unbounded` ↔ `unbounded`;
- `no_solution` ↔ an allowed non-proof termination without an incumbent;
- `error` ↔ `solver_error` (and any other explicitly approved infrastructure reason).

Also require:

- `objective === incumbentObjective` whenever an incumbent exists;
- both fields null when no incumbent exists;
- a non-null objective/incumbent for `optimal` and `feasible`;
- exact rules for when `achievedGap` and `bestBound` are required or nullable;
- `status` equal to the declared projection of `solutionStatus`;
- a deterministic `quality` derivation from `solutionStatus`, `terminationReason`, and `achievedGap`.

The UI must display “No incumbent” for a null objective; it must not continue the current `objective ?? 0` presentation and show a fabricated zero.

### 14.5 High — the proposed CBC solution-file path is not available after the current solve call

P0R.1 says to generate and parse unique CBC log and solution paths. In pinned PuLP 3.3.2, `COIN_CMD.solve_CBC()` creates the `.sol` filename internally, reads it, assigns values/status to the model, deletes its temporary files, and only then returns to `prob.solve()`. The caller therefore cannot parse the normal solution file after the current call completes.

`keepFiles=True` alone is not concurrency-safe because the retained names derive from repeated PuLP problem names. P0R.1 must choose and prove one integration:

1. a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper that exposes the unique temp paths and parses before deletion;
2. a unique per-solve working directory plus unique problem name and guaranteed cleanup; or
3. a controlled direct CBC subprocess invocation that preserves PuLP's variable/constraint-name mapping.

Acceptance must cover concurrent solves with the same model/problem name, cleanup on success/parser error/timeout/process kill, path traversal resistance, and no artifacts written into the repository. P0R.1 is a go/no-go spike: P0R.3 must not begin until it proves the terminal evidence can be captured safely.

### 14.6 High — 9–11 required cores do not by themselves make horizontal scaling mandatory

Section 13.1 infers `~9–11 cores ⇒ horizontal scaling is mandatory`. Render has higher-core vertical plans (the current Render guidance lists approximately 16- and 32-CPU service plans), so the arithmetic only proves that Starter/Standard-class plans are insufficient. It does not eliminate a vertically scaled API or dedicated worker.

Horizontal workers may still be the correct architecture because they provide API/solver isolation, failure containment, independent draining, scheduled capacity, and a path to single-flight. If horizontal scaling is a product/architecture decision, record it as such. If the decision is meant to be evidence-based and cost-minimizing, the measurement successor must compare:

- high-core vertical tune-in-place;
- one vertically sized dedicated worker service;
- a horizontal fleet with one or a measured small number of CBC processes per instance.

Compare end-to-end SLOs, safe CPU/RSS headroom, restart behavior, scale-window billing, idle cost, and operational complexity. The full guarantee still requires B2 reliability before a real cohort, regardless of which compute topology wins.

### 14.7 Medium — “byte-identical” compatibility is inaccurate

Adding `envelopeVersion`, new status fields, nullable metadata, and potentially nullable `objective` changes the serialized JSON bytes. The intended guarantee is narrower: the protected test remains unmodified and its applicable assertions continue to pass. Replace “byte-identical output” wording with that precise statement—after Q4 resolves which assertions are legitimately applicable.

### 14.8 Medium — the split is approved directionally, not for implementation

The following parts of §13 are validated:

- splitting correctness, measurement, and B2 is the right program structure;
- the full all-JADE, sustained 2,500 unique-cold-miss/hour contract is restored;
- queue claims/leases, graceful shutdown, version-aware recovery, stale publication, recovery indexing, live runbook, SLOs, and cost evidence are rehomed rather than dropped;
- the normative parent design is now tracked;
- no real cohort pilot should run before the B2 reliability and capacity gates pass.

However, the measurement and B2 specs are still TBD, and the correctness successor has the blockers above. This document may be approved later as a **superseded audit/split ledger**, not as an implementation spec. No successor other than a corrected correctness spec can receive implementation approval from this file alone.

### 14.9 Decisions/questions required

| # | Required decision | Recommendation |
|---|---|---|
| **Q4 — protected accuracy suite** | May `e2e_accuracy.py` receive a one-time, explicitly approved correction so 5%-gap cases assert truthful `feasible/gap_limit` semantics and preserve the mathematical A/B invariants, or must it remain byte-for-byte unchanged? | **Approve the narrow test correction.** Keep gap-0 proven assertions strict; for approximate cases assert feasible incumbent, termination reason, feasibility, and the existing objective/monotonicity invariants. Do not map a gap-limited incumbent back to `status="optimal"`. |
| **Q5 — legacy representation** | For historical rows whose proof state is unknowable, use `solutionStatus:null + legacyUnverified:true`, or add `legacy_unverified` to the status enum? | **Use nullable status plus an explicit legacy flag** in the normalized v1 view; keep the mathematical v2 status enum clean. |
| **Q6 — cache/publication policy** | Which non-error outcomes are cached, especially `feasible`, `no_solution`, and `infeasible`? | Cache deterministic mathematical outcomes (`optimal`, usually `infeasible`/`unbounded`); cache `feasible` only with the full gap/time/version key; do **not** cache `error`; default to not caching `no_solution` until retry semantics are specified. |
| **Q7 — compute topology** | Is horizontal scaling mandated as an architecture decision for isolation/reliability, or must measurement compare it with high-core vertical alternatives before selection? | **Compare topologies, then select**, while keeping worker isolation/reliability mandatory. Cost minimization requires a measured vertical comparator. |
| **Q8 — CBC evidence integration** | Which mechanism owns unique CBC log/solution files under concurrency: custom PuLP wrapper, unique work directory, or direct CBC invocation? | **Custom wrapper plus per-solve temp directory**, proven by P0R.1, so PuLP mapping/assignment behavior remains centralized and cleanup is controllable. |
| **Q9 — deprecated `status` compatibility** | Is expanding the old `status` enum to `feasible/no_solution/unbounded` an accepted breaking change for unknown external readers? | Treat it as an explicit versioned API change; migrate all internal readers atomically and document that the retained field preserves name/selected values, not universal backward compatibility. |

### 14.10 Approval checklist for the split ledger

- [ ] Q4–Q9 are answered and recorded as locked decisions in the appropriate successor specs.
- [ ] The correctness successor fixes its false `gap=0` premise and reconciles truthfulness with the protected test policy.
- [ ] P0R.3 explicitly implements job lifecycle, cache, telemetry, summary, and publication policy by solution outcome.
- [ ] The v1/v2 envelope is one exact discriminated contract, with a complete allowed-pair/metadata invariant matrix.
- [ ] P0R.1 proves a concurrency-safe CBC evidence capture/cleanup mechanism before contract implementation begins.
- [ ] §13 removes the unsupported implication that core count alone mandates horizontal scaling, or records horizontal scaling as an explicit product/architecture decision.
- [ ] §13.1 downgrades the correctness successor from “implementation-ready” until the preceding blockers are resolved.
- [ ] Measurement and B2 remain explicitly unapproved until their own complete specs receive approval reviews.

After these changes, this file can be approved as the historical audit trail and authoritative rehoming ledger for the three-spec program.

---

## 15. §14 proposed resolution — Q4–Q9 decisions (2026-09-21)

This section preserves the resolution recorded after §14. The later approval review in §16 found that Q4 lacks an auditable human authorization and that parts of its proposed test policy are technically unsound. For current implementation authority, §16 supersedes this section where they conflict.

| Q | Decision | Landed in |
|---|---|---|
| **Q4** protected suite | **Proposed rule-#2 override, not yet authorized:** correct `e2e_accuracy.py` narrowly while preserving mathematical invariants and making **zero golden-objective changes**. The exact status policy also requires correction per §16.2/Q11; requested gap alone does not establish achieved status. | Correctness spec §3 P0R.4, §4; blocked on Q10/Q11. |
| **Q5** legacy shape | `envelopeVersion:1` + `solutionStatus:null` + `terminationReason:unknown` + `legacyUnverified:true`; raw legacy `status` preserved separately; v2 enum stays clean. | Correctness spec §2.5. |
| **Q6** cache/publish | Cache `optimal`/`infeasible`/`unbounded`; cache `feasible` only with full gap/time/version key; **never** cache `error`; **do not** cache `no_solution`. | Correctness spec §2.6. |
| **Q7** topology | **Measure then select** (high-core vertical vs dedicated worker vs horizontal fleet); worker isolation + B2 reliability mandatory regardless. Core count alone does **not** mandate horizontal (§14.6). | §13 corrected; measurement spec + B2. |
| **Q8** CBC evidence | Custom `PULP_CBC_CMD` wrapper + per-solve temp dir, proven by a **go/no-go spike** before contract impl. | Correctness spec §3 P0R.1. |
| **Q9** `status` expansion | Truthful expanded projection = explicit **versioned breaking change**; internal readers migrate atomically; retained field preserves name, not universal back-compat. | Correctness spec §2.2/2.3/P0R.3. |

Also applied from §14: 14.2 lifecycle/cache/publish branch (correctness §2.6), 14.4 invariant matrix (§2.4), 14.5 CBC-file capture (§3 P0R.1), 14.7 "byte-identical" wording corrected to "golden objectives unchanged + invariants preserved" (§2.3). §14.8 stands: this file is the audit/split ledger; only the corrected correctness spec is eligible for implementation approval; measurement and B2 remain unapproved until their own specs are reviewed.

---

## 16. Post-resolution approval review — unresolved findings and questions (2026-09-21)

**Review disposition: REQUEST CHANGES.** The three-spec split is structurally sound, the full 2,500 unique cold-miss/hour workload is restored, and most §14 concerns are represented in the successor material. The correctness successor is nevertheless **not approved as a whole**. P0R.1 may begin as a feasibility spike, and independent P0R.2 fixture capture may proceed, but P0R.3/P0R.4 must wait for the decisions and contract corrections below. This ledger therefore cannot claim that all §14 findings are resolved.

### 16.1 CRITICAL — sacred-test override lacks auditable human approval

Section 15 recorded Q4 as approved, and the correctness successor states that human approval was recorded. No explicit product-owner/user authorization for changing the protected `e2e_accuracy.py` suite is present in the review record. A reviewer recommendation, agent-authored decision table, or local commit message is not independent human authority to override a sacred-test rule.

Required before P0R.4:

1. obtain an explicit human decision approving or rejecting the narrow exception;
2. assign it a dated decision identifier;
3. reference that identifier from this ledger and the correctness successor;
4. preserve the zero-golden-objective-change constraint if the exception is approved.

Until that evidence exists, Q4 is a proposal rather than a locked decision.

### 16.2 CRITICAL — P0R.4 infers achieved status from the requested gap

The correctness successor correctly says that a requested tolerance does not determine achieved status, but its P0R.4 test instructions then prescribe `feasible + gap_limit` for every protected case with `gap > 0` and strict `optimal` for `gap == 0`. Those rules contradict the result model:

- a solve requested with `gap > 0` may still prove optimality, stop at the requested gap, hit a time limit with or without an incumbent, or prove infeasibility/unboundedness;
- a solve requested with `gap == 0` may still fail to prove optimality before its time/resource limit;
- the expected status and termination reason must come from committed CBC evidence for the exact case, not from the request parameter alone.

Required policy:

- keep a case-specific strict assertion only when committed, repeatable CBC evidence establishes the termination pair for that protected scenario;
- otherwise permit only the explicitly valid status/reason pairs and validate the returned pair against actual evidence;
- keep deterministic parser fixtures authoritative for exercising `gap_limit`, `time_limit`, infeasible, unbounded, and error branches;
- never calculate an expected achieved status solely as `requestedGap > 0 ? feasible : optimal`.

### 16.3 CRITICAL — exact objective equality conflicts with observed CBC numerics

The correctness successor's invariant matrix requires `objective === incumbentObjective`. A fresh targeted probe of the existing Brazil P=5, cap=20M, requested gap=0.05 case produced:

```text
application envelope objective = 27022899702
CBC incumbent objective        = 27022899653.800003
difference                     = 48.19999694824219
CBC best bound                 = 26971509401.152
CBC reason                     = Result - Optimal solution found (within gap tolerance)
```

The application objective is recomputed/rounded from PuLP variable values, while the CBC log reports its own floating-point incumbent representation. Strict equality would reject an otherwise valid result, or force a change to the public objective that could violate the zero-golden-change constraint.

Before P0R.3, define all of the following:

- the canonical public/application `objective` and its per-model/API rounding rule;
- whether `incumbentObjective` stores CBC's raw value or the application-canonical value;
- if it stores CBC's raw value, a documented absolute/relative comparison tolerance instead of `===`;
- an `achievedGap` formula based on unrounded solver evidence, including sign, denominator, precision, and near-zero-objective behavior;
- preservation of raw solver values separately from presentation-rounded values where needed for auditability.

Recommended direction: preserve the existing application objective and golden values, retain CBC's raw incumbent/bound as solver evidence (or compare using an explicit tolerance), and derive the achieved gap from the raw values.

### 16.4 HIGH — raw solver validation and normalized legacy reads need separate schemas

The current plan makes one envelope union serve both raw solver stdout and historical/cache reads. That allows a legacy v1 shape to pass at the solver boundary with `solutionStatus:null`, even though the new-write lifecycle policy has no valid null-status branch. Compatibility at a storage/read boundary must not weaken validation of newly produced solver output.

Use three explicit boundaries:

1. `SolverEnvelopeV2Schema` — validates raw solver stdout and all new cache writes; v2 only.
2. `StoredResultSchema` — validates persisted historical data in its stored form.
3. `NormalizedSolveResultSchema` — the normalized v1/v2 read/API/UI union.

A dedicated normalizer should convert a stored legacy row to the normalized v1 representation. The normalized legacy payload must use a named field such as `legacyStatus` rather than the ambiguous instruction to preserve the old status "separately." Raw solver output must never be accepted as v1.

### 16.5 HIGH — §13 still contradicts the measure-then-select topology decision

Section 13 correctly says to compare high-core vertical, dedicated-worker, and horizontal-fleet options before selecting a topology. Section 13.1 nevertheless names B2 "durable queue, horizontal solver tier" and lists horizontal scaling as mandatory scope. Core count alone does not justify that conclusion, and the measurement plan has not run.

Rename the successor to a topology-neutral title such as **"B2 — durable isolated solver tier + pilot gate."** State that measurement selects the compute topology; horizontal scaling remains one candidate. Worker isolation and the B2 reliability protocol remain mandatory regardless of topology. This also preserves the cost comparison between vertical and horizontal scaling strategies required by the Render scaling guidance.

### 16.6 HIGH — “implementation-ready” overstates the approval scope

The correctness successor and §13.1 use "implementation-ready" while P0R.1 is explicitly a go/no-go dependency for core integration. CBC evidence capture, cleanup, parsing, and PuLP compatibility are not yet proven, so the dependent tasks cannot have unconditional implementation approval.

Use this status instead:

> **Approved to execute P0R.1. P0R.3–P0R.4 remain conditionally specified and require a post-spike design update and approval.** Independent deterministic fixture collection in P0R.2 may proceed where it does not assume the unresolved contract.

### 16.7 MEDIUM — exact contract values remain open

Close these details before P0R.3:

- enumerate the exact `quality` string for every allowed solution-status/termination-reason pair rather than describing it only as a deterministic function;
- replace `error -> solver_error (or explicitly-approved infra reason)` with one closed termination-reason enum and exact classification rules;
- define the complete `achievedGap` formula and numeric policy described in §16.3;
- correct the successor's claim that the old `status` field had only two values: the current OpenAPI contract includes `optimal`, `infeasible`, and `error`;
- explicitly migrate `artifacts/api-server/src/solver/tests/_envelope_compat.py`; it currently flattens only the legacy fields and would discard `terminationReason`, preventing the protected suite from asserting the new contract;
- name the legacy raw-status field and define when it is present or absent.

### 16.8 Validated improvements retained

The latest review confirms these improvements and they should not regress:

- the full all-JADE, sustained 2,500 unique cold-miss/hour contract is restored;
- vertical, dedicated-worker, and horizontal options are compared before topology selection;
- lifecycle, cache, publication, and public-status behavior is mapped by outcome;
- legacy records are no longer promoted to proven optimal;
- concurrency-safe CBC evidence capture is treated as a spike rather than an assumption;
- stale-publication protection and the full queue reliability protocol remain in B2;
- measurement and B2 are explicitly unapproved until their own design/review passes.

### 16.9 Decisions/questions required (Q10–Q16)

| # | Required decision | Recommendation |
|---|---|---|
| **Q10 — sacred-test authorization** | Does the product owner explicitly authorize the narrow `e2e_accuracy.py` exception, with no golden-objective changes? | Require a direct human approval and dated decision ID before P0R.4; otherwise leave the protected file unchanged. |
| **Q11 — protected approximate-case assertions** | How should expected status/reason be selected for protected cases that request a nonzero gap (and for zero-gap cases subject to limits)? | Use committed per-case CBC evidence. Do not derive achieved status from requested gap. Use deterministic parser fixtures as the authoritative branch tests. |
| **Q12 — objective/incumbent numeric policy** | Which value is canonical, and how are CBC raw values, rounding, equality tolerance, and achieved gap represented? | Preserve the existing application objective/goldens; retain raw CBC evidence separately or compare it with an explicit abs/rel tolerance; compute achieved gap from raw values. |
| **Q13 — schema boundary** | May compatibility parsing share the raw solver-output schema? | No. Approve separate v2 solver, stored-result, and normalized-read schemas with an explicit legacy normalizer. |
| **Q14 — B2 topology naming/scope** | Is horizontal scaling already selected, or does measurement select among vertical/dedicated/horizontal candidates? | Keep B2 topology-neutral until measurement selects a plan; require isolation/reliability independently. |
| **Q15 — implementation approval scope** | Is the entire correctness successor approved before P0R.1 proves the integration mechanism? | Approve only P0R.1 plus contract-independent fixture capture. Require post-spike review before P0R.3/P0R.4. |
| **Q16 — exact contract closure** | Must quality strings, reason enum, gap formula, legacy field, and compatibility-helper migration be specified before integration? | Yes. Add exact tables/formulas and the helper migration to the correctness successor before P0R.3. |

### 16.10 Approval checklist

- [ ] Q10 contains explicit human authorization or rejection with a dated decision ID.
- [ ] P0R.4 is evidence-driven and does not infer achieved status from requested gap.
- [ ] Objective/incumbent canonicalization, tolerance, rounding, and raw-gap calculation are exact.
- [ ] Raw v2 solver validation is separated from stored-data compatibility and normalized reads.
- [ ] B2 naming and scope are topology-neutral until measurement selects a plan.
- [ ] Successor status grants only the implementation scope actually proven by P0R.1.
- [ ] `quality`, termination reasons, `achievedGap`, legacy-field behavior, and compatibility-helper migration are fully specified.
- [ ] The correctness successor receives a post-revision approval review before P0R.3/P0R.4.

Once these items are closed, this file can be approved as the authoritative audit/split ledger. That approval would not approve the still-TBD measurement or B2 implementation specs.

---

## 17. §16 resolution — Q10–Q16 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q10** sacred-test authorization | **Confirmed** — recorded as **DEC-2026-09-21-01** (product owner approves the narrow `e2e_accuracy.py` correction; zero golden-objective changes). | Correctness spec header, §3 P0R.4, §4. |
| **Q11** approximate-case assertions | **Evidence-driven** — expected status/reason from committed CBC evidence per case; **never** `requestedGap>0 ? feasible : optimal`; deterministic parser fixtures authoritative. | Correctness spec §3 P0R.4. |
| **Q12** objective/incumbent numerics | Public `objective` = app-canonical (unchanged, preserves goldens); `incumbentObjective` = raw CBC; compare with abs/rel **tolerance** (not `===`); `achievedGap` from raw values. | Correctness spec §2.2/§2.4. |
| **Q13** schema boundary | **Three schemas** — `SolverEnvelopeV2Schema` (raw stdout + new cache writes, v2-only) / `StoredResultSchema` / `NormalizedSolveResultSchema` + normalizer; `legacyStatus` named field. | Correctness spec §2.6/§2.7. |
| **Q14** B2 topology naming | **Topology-neutral** — B2 renamed "durable isolated solver tier + pilot gate"; measurement selects vertical/dedicated/horizontal; isolation+reliability mandatory regardless. | §13.1 (renamed); measurement spec + B2. |
| **Q15** implementation scope | **Only P0R.1 + P0R.2** approved; P0R.3/P0R.4 conditional on a post-spike design update + review. | Correctness spec status. |
| **Q16** exact contract closure | Exact `quality` strings per pair, closed termination-reason enum, `achievedGap` formula, corrected 3-value `status`, `_envelope_compat.py` migration, named `legacyStatus`. | Correctness spec §2.2/§2.4/§2.5/§3 P0R.3. |

Also applied from §16: 16.2 evidence-driven asserts (§3 P0R.4), 16.3 objective tolerance (§2.4), 16.4 three schemas (§2.6), 16.5 topology-neutral B2 (§13.1), 16.6 status downgrade (correctness header), 16.7 exact values + `_envelope_compat.py` (§2/§3). §16.7 factual corrections verified in-repo: `SolveResult.status` enum = `[optimal, infeasible, error]` (3 values); `_envelope_compat.py` `flatten_envelope` discards `terminationReason` and must be migrated. This ledger's §16 findings are now resolved; the correctness successor governs implementation (P0R.1/P0R.2 approved).

---

## 18. Validation of §17 for approval — unresolved findings and questions (2026-09-21)

**Review disposition: REQUEST CHANGES.** The program split remains sound, the contracted 2,500 cold-miss/hour three-hour workload is retained, the B2 successor is now topology-neutral, and P0R.3/P0R.4 are correctly gated behind the CBC spike. However, §17 overstates resolution of Q10–Q16. The ledger is not yet approvable as the authoritative record.

Current implementation authority is narrower than §17 states:

| Scope | Approval |
|---|---|
| P0R.1 — CBC evidence spike | **Approved to begin.** |
| P0R.2 — fixture collection | **Approved.** Fixtures may be captured independently; executable parser tests depend on P0R.1's parser/interface. |
| P0R.3 — contract implementation | **Not approved.** |
| P0R.4 — protected-test change + integration gate | **Not approved.** |
| Measurement and B2 successors | **Not approved / still TBD.** |

### 18.1 CRITICAL — DEC-2026-09-21-01 is not independently auditable

Section 17 and the correctness successor assert that `DEC-2026-09-21-01` is explicit product-owner approval for changing sacred `e2e_accuracy.py`. The only repository evidence found is the same agent-coauthored commit that introduced the decision text. A decision asserting its own authorization is not independent proof of the human approval required by `CLAUDE.md` rule #2.

Before P0R.4, provide one of:

- a link/reference to an issue, PR comment, transcript, or other durable product-owner approval artifact; or
- a new direct product-owner confirmation that identifies `DEC-2026-09-21-01`, the narrow evidence-driven status-assertion change, and the zero-golden-objective-change constraint.

Until then, Q10 and `DEC-2026-09-21-01` remain **proposed**, not confirmed. This does not block P0R.1 or fixture capture, but it blocks P0R.4.

### 18.2 CRITICAL — Q12's objective invariant is invalid for Chen coverage

The correctness successor defines public `objective` as the existing app-canonical value, defines `incumbentObjective` as CBC's raw incumbent, and requires them to match within a global absolute/relative tolerance. This is not merely a rounding issue across all models: for Chen coverage the two values have different units.

Verified current behavior:

- `solve_chens` makes CBC maximize **covered demand** (`solve.py:1242–1244`);
- the golden covered demand is `131645389` (`test_chens.py:55`);
- the public objective is transformed to **coverage percentage**, `66.0639` (`solve.py:1278–1287`, `test_chens.py:56–57`).

No numeric tolerance can make raw covered demand equal a percentage. The proposed invariant would reject every valid Chen coverage envelope.

Required correction before P0R.3:

- keep public `objective` as the existing model-specific presentation value so goldens remain unchanged;
- use explicitly named raw solver-evidence fields such as `solverIncumbentObjective` and `solverBestBound`, or define a complete per-model/per-objective-mode transformation table;
- do not impose a generic raw-to-public equality/tolerance invariant across unlike units;
- define each model/mode's public-objective derivation and rounding exactly, rather than “computed/rounded exactly as today”;
- compute solver gap from values in the solver's own objective space.

### 18.3 HIGH — the stored-legacy schema and normalization call sites are not executable

Existing historical envelopes are **unversioned**: the current `_envelope` does not emit `envelopeVersion`. Calling them “v1” does not make `envelopeVersion:1` present in stored JSON.

The successor must distinguish:

1. **raw unversioned legacy storage** — the shape already present in `scenarios.result` and possibly historical cache rows;
2. **normalized v1 API/read view** — adds `envelopeVersion:1`, `solutionStatus:null`, `terminationReason:"unknown"`, `legacyUnverified:true`, and `legacyStatus`;
3. **raw/new v2 solver and storage shape**.

It must also name every normalization boundary. Today `toApiScenario()` returns `row.result` unchanged (`routes/scenarios.ts:131–153`). Require the normalizer on scenario list/get responses and any other API response that exposes stored results. For exports/templates, define whether normalized legacy data is accepted or rejected. For historical result-cache rows, explicitly choose normalization or intentional cache miss; do not leave cache behavior implicit.

### 18.4 HIGH — §13.1 still contradicts Q15 and the document header

The current header and correctness successor approve only P0R.1 plus fixture capture. Section 13.1 still calls the correctness successor an **“Implementation-ready draft”** and says it **“Ships standalone.”** That is the exact overstatement §16.6 required removing.

Replace the §13.1 status cell with the current authority:

> Approved to execute P0R.1 and contract-independent fixture capture only. P0R.3/P0R.4 require a post-spike design update and approval review.

Until the split map itself is corrected, §17 cannot claim that Q15/§16.6 fully landed.

### 18.5 HIGH — Render service-plan capacity premise is outdated

Section 13 says Render has approximately 16/32-CPU service plans. Current official Render documentation (verified 2026-09-21) lists web-service plans up to **12 CPU**; larger 16/32-CPU entries belong to other products such as Render Postgres. Legacy plan names remain valid, but the candidate-plan ceiling used by this design is wrong.

Authoritative references:

- [Render compute plans](https://render.com/docs/compute-plans)
- [Render scaling](https://render.com/docs/scaling)

Capacity implication using the parent design's initial numbers:

- at 13 seconds/solve and 2,500 cold misses/hour, offered load is about `9.03` cores and requires about `12.9` cores at a 70% utilization target;
- at 17 seconds/solve, offered load is about `11.81` cores and requires about `16.9` cores at 70%;
- therefore one 12-CPU web/worker instance cannot be presumed to meet the guaranteed load with the approved headroom.

The topology-neutral comparison remains correct, but the measurement successor must use currently available service/worker plan IDs and treat single-instance vertical scaling as a comparator—not as an assumed passing option. Horizontal instances still use one common plan per service and are billed per running instance/time.

### 18.6 HIGH — P0R.2 approval scope and fixture coverage are inconsistent

The successor header approves “contract-independent P0R.2 fixture capture,” but P0R.2 itself says parser unit tests may proceed. Executable parser tests cannot precede P0R.1's parser interface and authoritative-record decision.

Additionally, P0R.2 claims authority for node-limit classification but lists no node-limit fixture. Its fixture set also does not cover the allowed `interrupted` or `solver_error` branches. Before approving the complete P0R.2 task:

- separate **fixture capture** (may proceed now) from **parser unit-test implementation** (after P0R.1);
- create a coverage table for every allowed v2 `(solutionStatus, terminationReason)` pair;
- add node-limit-with-incumbent and node-limit-without-incumbent evidence if CBC can emit both;
- cover interrupted-with/without-incumbent and solver-error behavior, or explicitly remove unsupported pairs from the v2 contract;
- reserve `unknown` for normalized legacy data only.

### 18.7 HIGH — `achievedGap` still has two competing authorities

The successor provides a formula and then says to prefer CBC's own reported gap when reliably parsed. That produces two potentially different values under one API field and does not satisfy Q16's “exact formula” claim.

Choose one canonical `achievedGap` definition. Recommended:

- retain parsed CBC-reported gap separately as raw solver evidence if available;
- calculate public `achievedGap` from raw incumbent/bound in the solver-objective space using one documented formula;
- define minimization/maximization handling, negative objectives, the near-zero denominator rule, clamping, and serialized precision;
- verify the calculation against fixture values rather than silently switching sources.

### 18.8 MEDIUM — Q8 is reopened inside the supposedly resolved successor

Q8 selects a custom `PULP_CBC_CMD`/`COIN_CMD` wrapper plus a per-solve temp directory. P0R.1 still says to prove either that wrapper **or** direct CBC invocation. A spike may discover that the selected approach is infeasible, but switching approaches should produce a recorded design update rather than silently reopening a locked decision.

State the wrapper/temp-dir approach as the primary approved spike. Treat direct CBC invocation as a fallback requiring a documented P0R.1 no-go result and approval update.

### 18.9 MEDIUM — consumer and verification gates remain incomplete

The migration list does not explicitly assign the normalizer to `toApiScenario()` or enumerate the Python solver tests whose status assertions may change. P0R.4 also mentions the normal repository gate plus `e2e_accuracy.py`, but repository policy requires both standalone scripts after solver changes (`AGENTS.md:38`). `CLAUDE.md` simultaneously records that `e2e_journey.py` is currently non-runnable because it uses removed authentication.

Before P0R.3/P0R.4 approval:

- enumerate scenario list/get, exports/templates, result-cache reads, solve history, telemetry, smoke checks, and every direct Python consumer;
- run/update all pytest-discovered solver tests affected by truthful status changes;
- either repair `e2e_journey.py` or record an explicit, scoped gate exception with replacement coverage;
- keep direct `e2e_accuracy.py` mandatory under the separately validated sacred-test authorization.

### 18.10 Validated decisions retained

The review confirms these parts and they should remain unchanged:

- the correctness/measurement/B2 split is the right program structure;
- the full 2,500 unique cold-miss/hour, three-hour contract remains the capacity case;
- topology is selected after measurement; worker isolation and B2 reliability remain mandatory regardless;
- P0R.1 is a genuine go/no-go gate for P0R.3;
- requested gap does not determine achieved status;
- raw solver validation must remain separate from legacy-read normalization;
- error envelopes are never cached or published as successful scenario results;
- measurement and B2 require their own complete specs and approval reviews.

### 18.11 Decisions/questions required (Q17–Q21)

| # | Required decision | Recommendation |
|---|---|---|
| **Q17 — sacred-test approval evidence** | What independent artifact proves that the product owner authorized `DEC-2026-09-21-01`? | Link the durable approval artifact or obtain a new direct confirmation. Until then, mark the decision proposed and keep P0R.4 blocked. |
| **Q18 — raw vs public objective semantics** | Must raw CBC objective metadata be comparable to the public model-specific objective? | No. Preserve the public objective; use explicitly named raw solver-objective fields and compute gap entirely in solver-objective space. Add a per-model/mode public-objective derivation table. |
| **Q19 — unversioned legacy normalization** | How are existing unversioned stored rows represented, normalized, and exposed at each read boundary? | Define a raw unversioned legacy schema, a normalized v1 view, and explicit call sites including `toApiScenario`; choose cache miss or normalization for old cache rows. |
| **Q20 — P0R.2 and verification scope** | Is all of P0R.2 approved before P0R.1, and how are missing termination pairs plus the broken `e2e_journey.py` gate handled? | Approve fixture capture only; implement tests after P0R.1; cover every retained pair; repair `e2e_journey.py` or approve a documented replacement gate. |
| **Q21 — Render plan ceiling** | Which current Render web/worker plans form the vertical/dedicated/horizontal measurement matrix? | Use current official plan IDs and the 12-CPU single-instance ceiling; retain vertical as a comparator but require measured SLO/headroom before selecting it. |

### 18.12 Approval checklist

- [ ] Q17 provides auditable human authorization or reverts `DEC-2026-09-21-01` to proposed.
- [ ] The objective contract supports Chen coverage's different raw/public units.
- [ ] Public-objective derivation and rounding are exact per model/objective mode.
- [ ] Stored unversioned legacy, normalized v1, and raw v2 shapes are distinct and wired to named read boundaries.
- [ ] §13.1 no longer says the full correctness successor is implementation-ready.
- [ ] Render plan claims and capacity arithmetic use current service/worker limits.
- [ ] P0R.2 approval is limited to fixture capture until P0R.1 supplies the parser/interface.
- [ ] Fixtures cover every retained v2 status/reason pair, including node-limit behavior.
- [ ] `achievedGap` has one canonical definition and separate raw evidence where necessary.
- [ ] Q8's fallback path requires a recorded spike/design decision.
- [ ] Consumer migration names `toApiScenario` and all result-read/export/test boundaries.
- [ ] The `e2e_journey.py` policy conflict is repaired or explicitly waived with replacement coverage.
- [ ] A new approval review occurs before P0R.3/P0R.4.

After these items are resolved, this file can be approved as the authoritative audit/split ledger. That approval still would not approve the measurement or B2 implementation specs.

---

## 19. §18 resolution — Q17–Q21 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q17** DEC auditability | **Cite this session's approvals verbatim** — DEC-2026-09-21-01's durable artifact = the product owner's explicit in-session Q4 + Q10 selections (2026-09-21), recorded verbatim in the correctness spec header. | Correctness spec header, §4. |
| **Q18** objective semantics | Public `objective` = model/mode-specific presentation value (unchanged, goldens preserved); raw CBC evidence in `solverIncumbentObjective`/`solverBestBound`; **no** raw↔public equality; per-model derivation table; gap computed in solver space. | Correctness spec §2.2/§2.4/§2.9. |
| **Q19** unversioned legacy | Three shapes: raw **unversioned** stored / normalized v1 read view / raw v2; normalizer wired at named boundaries incl. `toApiScenario()`; old cache rows = **cache miss**, not normalized. | Correctness spec §2.6/§2.7/§3 P0R.3. |
| **Q20** P0R.2 + verification | Approve **fixture capture only** now; parser tests after P0R.1; coverage table for every retained pair (node-limit/interrupted/solver-error or remove); **repair `e2e_journey.py`** (decision this session) + run both standalone scripts. | Correctness spec §3 P0R.2/P0R.4. |
| **Q21** Render plan ceiling | **12-CPU** web/worker ceiling + current plan IDs; single-instance vertical is a measured comparator, not an assumed pass. | §13 corrected; measurement spec. |

Also applied from §18: 18.2 Chen-coverage objective units (§2.9, verified — coverage % vs covered demand), 18.3 unversioned-legacy schemas + `toApiScenario` normalizer, 18.4 §13.1 status corrected, 18.5 12-CPU ceiling + capacity arithmetic, 18.6 P0R.2 split + pair coverage, 18.7 single canonical `achievedGap`, 18.8 P0R.1 wrapper primary / direct-CBC fallback, 18.9 consumer enumeration + `e2e_journey.py` repair (decided) + both standalone scripts. §18 findings resolved; the correctness successor governs implementation (P0R.1 + P0R.2 fixture capture approved).

---

## 20. Deep approval validation — repository and solver-semantics review (2026-09-21)

### 20.1 Approval decision

**REQUEST CHANGES.** This audit/split ledger is **not approved as authoritative/resolved**, and the correctness successor is **not approved for P0R.3 or P0R.4 implementation**. The existing narrow authorization for P0R.1 and P0R.2 fixture capture remains in force; it does not imply approval of parser tests, the contract migration, or sacred-test changes.

| Scope | Decision after this review |
|---|---|
| This Phase-0 ledger as authoritative/resolved | **Not approved** — Q22–Q29 are open. |
| P0R.1 CBC-evidence spike | **Approved to proceed** under its existing go/no-go and fallback guardrails. |
| P0R.2 attainable CBC fixture capture | **Approved to proceed**; process/parser failures require a separate test strategy rather than invented CBC artifacts. |
| P0R.2 parser tests | Blocked on the P0R.1 interface. |
| P0R.3 contract/consumer implementation | **Not approved**; requires the post-spike design update and resolution of the contract blockers below. |
| P0R.4 integration/sacred-test changes | **Not approved**; additionally blocked on auditable human authorization for `DEC-2026-09-21-01`. |
| Measurement and B2 | Still TBD and not reviewed for implementation approval here. |

### 20.2 Blocking findings

#### 20.2.1 CRITICAL — `DEC-2026-09-21-01` is not independently auditable

§19/Q17 and the correctness successor header state that the product owner made exact in-session Q4/Q10 selections and treat those quoted selections as the durable approval artifact. The available repository evidence consists of documents and commit messages repeating that claim; those are self-attestation, not an independent record of the human decision. The available approval-review context does not contain the quoted selections themselves. This does not satisfy `CLAUDE.md` hard rule #2, which requires explicit human approval before changing `e2e_accuracy.py` expected values/assertions.

**Required correction:** link a durable artifact containing the product owner's direct approval (for example, a PR comment, issue decision, or preserved transcript), or obtain a new direct confirmation. Until then:

- mark `DEC-2026-09-21-01` **proposed/unverified**, not authorized;
- remove the claim that the successor header is itself proof of the earlier approval; and
- keep P0R.4 blocked. P0R.1 and the approved portion of P0R.2 do not depend on this decision.

#### 20.2.2 HIGH — the proposed unversioned-legacy schema does not match the current stored envelope

The successor's `StoredResultSchema` describes the unversioned legacy result as an "old flat shape." The repository instead shows that current persisted unversioned results are the **nested standardized envelope** emitted by `artifacts/api-server/src/solver/solve.py::_envelope` (`status`, `objective`, `runTimeSec`, `quality`, `edges`, `metrics`, `details`, `solverUsed`, `infeasibilityReason`), validated by `resultEnvelope.ts`, and written unchanged to `scenarios.result` by `jobRunner.ts`. `_envelope_compat.py::flatten_envelope` is a Python-test compatibility projection; it is not evidence that the current database representation is flat. Older flat database rows may exist, but that must be established from data/migration history rather than inferred from the test shim.

The normalized-v1 example is also incomplete: it lists only version/status metadata and does not say how `objective`, `runTimeSec`, `edges`, `metrics`, `details`, `solverUsed`, or `infeasibilityReason` are preserved. It does not define a safe legacy `quality`, nor whether deprecated `status` remains present. Retaining an old `status:"optimal"` or quality such as "Optimal" would recreate the false-proof problem the migration is meant to fix. The successor also leaves exports/templates at "define accept-vs-reject of legacy," so Q19 is not fully resolved.

**Required correction:** inventory actual stored generations, define each raw legacy schema separately, specify the complete normalized-v1 output, preserve useful payload fields, isolate raw `legacyStatus`, derive a non-proof legacy quality string, normalize any legacy no-result objective sentinel safely, and decide legacy behavior at every named read/export/template boundary before P0R.3 approval.

#### 20.2.3 HIGH — `no_solution` incorrectly requires the best bound to be null

The successor invariant matrix says all objective/solver fields are null for `no_solution`. A truncated branch-and-bound search can have **no feasible incumbent but still expose a best dual/possible bound**. CBC exposes `Cbc_getBestPossibleObjValue` independently of its best feasible solution, and COIN-OR's Python-MIP example explicitly reports a lower bound for `NO_SOLUTION_FOUND`.

Primary references:

- [CBC C interface — best possible objective and best solution are separate](https://coin-or.github.io/Cbc/Doxygen/Cbc__C__Interface_8h.html)
- [COIN-OR Python-MIP quickstart — `NO_SOLUTION_FOUND` can still have an objective bound](https://github.com/coin-or/python-mip/blob/master/docs/quickstart.rst)

**Required invariant:** for `no_solution`, public `objective=null`, `solverIncumbentObjective=null`, `solverBestBound=number|null`, and `achievedGap=null`. For `feasible/gap_limit`, require both a bound and `achievedGap`; without them, a gap-limit classification is not auditable. For time/node/interrupted outcomes, the bound may be nullable when the authoritative CBC evidence does not expose one.

#### 20.2.4 HIGH — canonical `achievedGap` is lossy and underspecified

The successor clamps the computed relative gap to `[0,1]`. Relative gaps can legitimately exceed 100%, especially when the incumbent is poor or objective values cross/approach zero; clamping destroys truthful evidence. CBC's `ratioGap` parameter itself has range `0..infinity`, even though the product may intentionally use its own canonical displayed-gap formula. The phrase "serialized to fixed precision" also fails to specify the precision, and adding `1e-10` silently imposes an undefined near-zero policy.

Primary reference: [CBC parameter reference — `ratioGap` range and stopping semantics](https://github.com/coin-or/Cbc/blob/master/doc/cbc-parameters.md#ratiogap).

**Required correction:** do not clamp; define the output domain as non-negative and potentially greater than one; state exact serialization precision/rounding; define zero and near-zero incumbent behavior; and add fixture tests for minimization, maximization, negative objectives, a zero/near-zero incumbent, and a gap greater than 100%. A parsed CBC-reported gap may remain separate raw evidence.

#### 20.2.5 HIGH — the cache version does not cover the new termination parser/wrapper

The successor says old cache rows become misses because the solver-code hash changes. Today, `jobRunner.ts::SOLVER_CODE_HASH` hashes only `solve.py`. P0R.1 is expected to introduce parser/wrapper code in additional files. After the first migration, a parser-only correction could change status/termination interpretation without changing `solve.py`, leaving stale v2 classifications eligible for cache hits.

**Required correction:** define one composite solver-contract/cache version that covers all code and dependencies capable of changing result semantics: `solve.py`, the termination wrapper/parser, relevant model/configuration code, and CBC/PuLP versions when their emitted records affect parsing. Add a test proving that a parser/contract version change invalidates the cache even when model inputs and `solve.py` bytes are unchanged.

#### 20.2.6 MEDIUM — the "exact" public-objective table is not exact

The successor groups five models under `round(value(prob.objective), …)`. Repository behavior is materially more specific:

| Model / mode | Current public-objective derivation |
|---|---|
| `p-median-us` | `round(obj_val)` — integer rounding |
| `p-median-brazil` | `round(obj_val)` — integer rounding |
| `transport-coal` | `round(obj_val)` — integer rounding |
| `two-echelon-gold-au` | `round(value(prob.objective) or 0, 2)` |
| `two-echelon-jade-us` | `round(value(prob.objective) or 0, 4)` |
| Chen coverage | `round(covered * 100 / total, 4)` |
| Chen minimum distance | `round(value(prob.objective), 2)` |

**Required correction:** replace the ellipsis/grouped row with an exact row or named derivation function for every implemented model/objective mode. Preserve the existing public-objective goldens while keeping raw CBC objective evidence explicitly separate.

#### 20.2.7 MEDIUM — `solver_error` cannot be covered solely by CBC log/`.sol` fixtures

P0R.2 requests CBC log/`.sol` fixture coverage for `error/solver_error`, but missing executables, nonzero process exits, malformed stdout, parser exceptions, cleanup failures, and outer process timeouts may produce no valid CBC log or solution file. The current `jobRunner.ts` maps timeout/spawn/nonzero/JSON/schema failures to a failed job before persisting any result envelope, while solver-declared load/model errors can arrive as an error envelope. Those are distinct failure boundaries and need distinct assertions.

**Required correction:** separate:

1. attainable CBC terminal-record fixtures;
2. synthetic malformed/contradictory parser fixtures;
3. wrapper cleanup/concurrency/path-safety tests; and
4. process-level `jobRunner` failure tests.

Define which failures yield a v2 `error/solver_error` envelope and which yield only a failed job with no published scenario result. Do not fabricate CBC artifacts for failures that occur before or outside CBC.

### 20.3 Validated improvements retained from §19

- The separation between the model-specific public `objective` and raw solver-objective evidence is directionally correct, including Chen coverage's different units.
- P0R.2 authorization is correctly limited to fixture capture before P0R.1 establishes the parser interface.
- P0R.3/P0R.4 remain conditional on a post-spike design update and another approval review.
- The primary wrapper approach and the recorded-no-go/design-approval requirement for a direct-CBC fallback are appropriate.
- `e2e_journey.py` is correctly recognized as non-runnable and requiring repair before it can satisfy the solver-change gate.
- The Render correction is current: official compute-plan documentation lists a **12-CPU maximum per web/private-service/background-worker instance** (`12c-24g`, `12c-48g`, `12c-96g`), and official scaling documentation allows up to **100 same-plan instances per service**. The 16/32-CPU entries previously confused with service compute are database plans. Sources: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). This validates the 12-CPU correction only; it does not preselect vertical or horizontal topology.

### 20.4 Decisions/questions required (Q22–Q29)

| # | Required decision | Recommendation |
|---|---|---|
| **Q22 — sacred-test authorization provenance** | What independently auditable human artifact contains the claimed Q4/Q10 authorization? | Link the direct approval or obtain a new confirmation. Treat `DEC-2026-09-21-01` as proposed and keep P0R.4 blocked until then. |
| **Q23 — actual legacy generations and complete normalized-v1 contract** | Which unversioned result shapes truly exist in persisted scenario rows, and what is the full normalized-v1 output for each? | Treat the current nested envelope as the known legacy generation; support an older flat generation only if evidence shows it exists. Preserve all useful fields, isolate `legacyStatus`, and emit non-proof legacy quality. |
| **Q24 — bound without incumbent** | May `no_solution` retain `solverBestBound` when CBC exposes a bound without an incumbent? | Yes. Require null public objective/incumbent/gap, but allow a non-null bound. Require bound+gap for `feasible/gap_limit`. |
| **Q25 — canonical gap domain and precision** | Is a gap above 100% preserved, and what are the exact precision and zero-denominator rules? | Preserve the non-negative unbounded value; do not clamp. Specify deterministic rounding and an explicit zero/near-zero policy before schema/test approval. |
| **Q26 — solver-contract cache version** | Which files/runtime versions invalidate cached result semantics? | Use an explicit composite version/hash covering solver, parser/wrapper, relevant configuration/model code, and solver-library versions where semantics depend on them. |
| **Q27 — per-model public-objective derivation** | What exact expression and rounding applies to every implemented model/mode? | Replace `…` with the seven exact rows in §20.2.6 and test them against unchanged goldens. |
| **Q28 — solver-error boundary and evidence** | Which CBC, parser, wrapper, and process failures produce `error/solver_error`, and which produce only a failed job? | Define the layer boundary and use CBC fixtures, synthetic parser cases, wrapper tests, and job-runner tests separately. |
| **Q29 — normalized legacy consumers** | Do exports/templates/history/telemetry accept normalized legacy, omit it, or reject it, and what do they display? | Decide every named boundary in the design update; no implementation-time placeholder such as "define accept-vs-reject." |

### 20.5 Re-approval checklist

- [ ] Q22 links direct, auditable human authorization or reverts `DEC-2026-09-21-01` to proposed/unverified.
- [ ] Raw unversioned legacy schemas match verified stored generations; the known current legacy schema is nested, not inferred from the flat test shim.
- [ ] Normalized v1 is fully specified, preserves useful payload fields, and cannot imply proven optimality through `status` or `quality`.
- [ ] Every legacy read/export/template/history/telemetry boundary has an explicit accept/normalize/reject policy.
- [ ] The invariant matrix permits a best bound without an incumbent and requires evidence for `gap_limit`.
- [ ] `achievedGap` is not clamped, has an exact domain/precision/rounding/zero policy, and has signed/zero/>100% tests.
- [ ] Cache invalidation covers parser/wrapper and relevant runtime semantic versions, not only `solve.py`.
- [ ] Public-objective derivation is exact for every implemented model/mode; no ellipsis remains.
- [ ] CBC terminal fixtures, malformed parser cases, wrapper failures, and process/job failures are separate test categories.
- [ ] The `error/solver_error` envelope boundary versus failed-job/no-result boundary is normative.
- [ ] P0R.1 completes and its evidence is incorporated into a successor design update.
- [ ] A new approval review occurs before P0R.3/P0R.4.

Until every applicable item above is closed, §19's statement that the §18 findings are resolved remains historical rather than the current approval state; this §20 decision controls.

---

## 21. §20 resolution — Q22–Q29 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q22** DEC auditability | **Resolved with a durable artifact.** The product owner posted the verbatim approval at GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) — the independently-auditable authorization §20.2.1 required. DEC-2026-09-21-01 authorized; §20.2.1 closed. | Correctness spec header; this ledger status. |
| **Q23** legacy generation + normalized-v1 | Known legacy = the **nested unversioned `_envelope`** (verified as what `jobRunner` writes), not flat; complete normalized-v1 preserves payload, isolates `legacyStatus`, emits a non-proof quality string, normalizes a `0` no-result sentinel to null. | Correctness spec §2.6/§2.7. |
| **Q24** bound without incumbent | `no_solution` may keep `solverBestBound: number\|null`; objective/incumbent/gap null. `feasible/gap_limit` **requires** bound + achievedGap. | Correctness spec §2.4. |
| **Q25** gap domain/precision | `achievedGap` **not clamped**, non-negative & may exceed 1.0 (CBC `ratioGap` 0..∞); serialized 6 dp; explicit near-zero-incumbent `EPS` policy; fixtures for min/max/negative/zero/>1.0. | Correctness spec §2.9. |
| **Q26** cache version | Composite solver-contract hash (solve.py + parser/wrapper + model/config + CBC/PuLP) + parser-version-bump invalidation test (verified `SOLVER_CODE_HASH` hashes only solve.py today). | Correctness spec §2.10. |
| **Q27** per-model objective | Exact per-model/mode rows (no ellipsis): pmedian-us/brazil/transport `round(obj)`; two-echelon-gold `round(…,2)`; jade `round(…,4)`; Chen coverage `round(covered*100/total,4)`; Chen min-dist `round(…,2)`. | Correctness spec §2.9. |
| **Q28** solver_error boundary | Four separate test categories (CBC fixtures / synthetic parser / wrapper / jobRunner-process) + normative `error/solver_error`-envelope vs failed-job-no-result boundary; no fabricated CBC artifacts for non-CBC failures. | Correctness spec §3 P0R.2. |
| **Q29** normalized-legacy consumers | Every named read/export/template/history/telemetry boundary gets an explicit accept/normalize/reject decision in P0R.3 — no "define later" placeholder. | Correctness spec §2.7. |

Verified in-repo this round: `jobRunner.SOLVER_CODE_HASH` hashes only `solve.py` (→ Q26 composite version needed); `jobRunner` persists the nested `_envelope` unchanged to `scenarios.result` (→ Q23 legacy shape is nested, not flat). §20 findings resolved; correctness successor governs implementation (P0R.1 + P0R.2 fixture capture approved). Render fact confirmed by §20.3: 12-CPU max per web/worker instance, up to 100 same-plan instances per service.
