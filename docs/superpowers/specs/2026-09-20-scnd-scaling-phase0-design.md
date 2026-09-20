# SCND Scaling — Phase 0 + 0.5 Spec (Correctness, Reliability Slice, Measurement, Pilot Gate)

**Date:** 2026-09-20
**Status:** **SUPERSEDED — split into focused specs (2026-09-21, see §13).** This document is no longer implemented as a single unit. The §12 approval review proved that "restart-safe queued work" cannot be a minimal slice (it requires the full concurrency protocol = the B2 queue) and that the workload guarantee must stay all-JADE/cold-miss (⇒ horizontal scaling mandatory). Per the 2026-09-21 decisions (Q1=Split, Q2=Restore-full-guarantee, Q3=publication-guard→B2), the scope is redistributed across three specs. §§0–12 are retained as the audit trail (proposed design + two review rounds); §13 is the authoritative split map and finding-rehoming ledger.
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
- **Q2 = Restore the full parent guarantee** (all-JADE + sustained 2,500 unique cold-miss/hour). Sizing then needs ~9–11 cores ⇒ **horizontal scaling is mandatory** ⇒ B2 must land before any real cohort pilot. Tune-in-place is no longer a candidate for the guarantee.
- **Q3 = Publication guard** (stale-result CAS) is required, and since there is no near-term pilot on the current single instance, it lands in B2 with the rest of reliability.

### 13.1 Three successor specs

| Spec | Scope | Status |
|---|---|---|
| **Correctness contract** — `2026-09-21-scnd-solver-result-contract-design.md` | Two-dimensional `solutionStatus`+`terminationReason`, CBC parser, versioned envelope, `status` alias (rule #2), frontend + read-time legacy compat, consumer migration. Tasks P0R.1–P0R.4. | Implementation-ready draft; ships standalone now. |
| **Measurement + experiments** — TBD (`2026-09-2x-scnd-scaling-measurement-design.md`) | Benchmark harness + corpus (N≥30, provenance, raw-vs-aggregate schemas, per-process RSS), MIP-start-from-cache experiment (corrected construction), warm/persistent-worker experiment, Render candidate-plan matrix incl. gap=0 forced-open re-measurement. Feeds B2 sizing. | Needs its own brainstorm/spec pass. |
| **B2 — durable queue, horizontal solver tier, pilot gate** — TBD (`2026-09-2x-scnd-scaling-b2-design.md`) | Full concurrency protocol (atomic CAS claim, ownership/lease, attempts/retry-exhaustion, graceful shutdown + process-group kill, version-aware recovery, readiness-on-recovery-failure), stale-result CAS publication guard, worker split, scheduler, **horizontal scaling** (Q2), single-flight/coalescing, retention/index/bounds, two-gate pilot authorization, four load profiles incl. sustained 2,500 cold-miss/3h, numeric SLOs + headroom, executable live-test runbook, cost outputs. | Needs its own brainstorm/spec pass (now a large, coherent unit). |

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
