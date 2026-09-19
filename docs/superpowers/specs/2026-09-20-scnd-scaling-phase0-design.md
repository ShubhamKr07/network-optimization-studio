# SCND Scaling — Phase 0 + 0.5 Spec (Measurement, Correctness, Pilot Gate)

**Date:** 2026-09-20
**Status:** Spec for review.
**Parent design:** `docs/superpowers/specs/2026-09-19-scnd-scaling-design.md` (the reviewed B2 design). This spec implements only that design's **Phase 0 (measurement + correctness)** and **Phase 0.5 (pilot gate)**. It builds no durable queue, no worker split, no scheduler, no compute-avoidance. Those follow in a separate B2 spec, gated on this spec's evidence.

**Goal:** Produce the measurements and correctness fixes that let the B2 sizing/scheduling decisions be made from evidence instead of assumption, and define the gate that must pass before the heavy B2 build is justified.

---

## 0. Locked decisions (from brainstorm 2026-09-20)

| # | Decision |
|---|---|
| L1 | This spec = Phase 0 + 0.5 only. No durable queue / worker split / scheduler / compute-avoidance. |
| L2 | Truthful solver status/termination metadata ships now. Default quality stays **Proven optimal** (`gap=0`) for the pilot. No student-facing Quick toggle in this spec. |
| L3 | Sizing is **frequency-aware**: Phase 0 classifies + times scenario regimes (fast vs slow); real regime frequency comes from pilot telemetry, not guessed now. |
| L4 | **MIP-start-from-cache** is a measured Phase 0 solver experiment. **Single-flight/coalescing is deferred** to the B2 spec (needs the durable queue). |
| L5 | Ratified pilot-gate SLO: **p95 queue wait < 30 s** during stated peak. |
| L6 | Tasks 5 & 6 run against the **existing live services** (real Render Linux numbers), with the safeguards in §7.2/§8.2 (off-hours, dedicated test account, cleanup, abort plan). Low real-user risk pre-cohort. |
| L7 | Benchmark corpus = **both** hand-authored version-controlled fixtures (coverage/reproducibility) **and** a sample of real dev-DB scenarios (realism). |
| L8 | MIP-start experiment = **full characterization now** across the near-dup families (demand/capacity/force/distance edits), not just a rough spot-check. |

## 1. Scope

**In scope**
1. Truthful result-status/termination contract across all solve functions (correctness fix for the verified `status:"optimal"` mislabel).
2. A repeatable **benchmark harness** + representative scenario corpus, producing the measurement matrix the B2 sizing needs.
3. Three **experiments**, each ending in a decision record: (a) gap sensitivity per scenario family, (b) MIP-start-from-cache, (c) warm/persistent Python worker overhead.
4. A **production-baseline measurement** on the real Render Starter plan (per-solve CPU/RSS, concurrency-3 safety on 512 MB).
5. The **Phase 0.5 pilot gate**: a synthetic load test + explicit pass criteria that must be met before the B2 spec is written/built.

**Out of scope (explicitly deferred to the B2 spec)**
- Durable `solve_jobs` payload/lease/retry schema; `FOR UPDATE SKIP LOCKED` claim loop.
- Standalone solver worker service; scheduled scaler; API/solver split.
- Single-flight/coalescing; result-cache retention/normalization; CAS stale-result publication.
- Render Workflows POC; precompute parameter sweeps; student-facing Quick mode UI.

## 2. Hard-rule guardrails (from CLAUDE.md)

- **Rule #2:** `e2e_accuracy.py` must pass **unmodified**. The status-contract change must not alter any golden objective/answer. New behavior is covered by **new** tests, never by editing `e2e_accuracy.py`'s expectations.
- **Rule #6:** solver business rules stay data-driven. MIP-start is a solver *configuration/warm-start* input, not a new if/else rule path — it must not branch model construction on business logic.
- **Rule #1:** OpenAPI is the source of truth. Any `SolveResult` field addition edits `openapi.yaml` + regenerates Zod/React-Query in the same commit; generated code is never hand-edited.
- **Rule #4:** one task = one commit, `[<task-id>] <summary>`.

---

## 3. Task 1 — Truthful solver status/termination contract

### 3.1 Problem (verified)

`solve.py` returns `_envelope("optimal", status_str, …)` on every non-infeasible path (e.g. `solve_jade` at line ~1186); the envelope `status` is hardcoded `"optimal"` and the real CBC status (`LpStatus[prob.status]`) is only carried in `quality`. A gap-stopped or time-limited incumbent is reported as proven-optimal. All model solve functions share `_envelope` and the same pattern.

### 3.2 Target contract

Envelope `status` must reflect true termination. Allowed values:

- `optimal` — CBC proved optimality (`LpStatus == "Optimal"` **and** requested `gap == 0` **and** not time-limited).
- `feasible_within_gap` — stopped at the requested relative gap with an incumbent.
- `time_limited` — hit the time limit with an incumbent (not proven optimal).
- `infeasible` — as today.
- `error` — solver crash / unparseable (wrapper already degrades to this; unchanged).

Add termination metadata to the envelope (names to finalize in the OpenAPI edit):

- `terminationReason` (string)
- `requestedGap` (number)
- `achievedGap` (number|null — only when CBC/PuLP exposes it reliably)
- `bestBound` (number|null)
- `incumbentObjective` (number — the objective already reported)
- `solveTimeSec` (already present as `runTimeSec`)
- `configuredTimeLimitSec` (number)

### 3.3 Determination logic (proposed; validate against CBC output in Task 2)

Because the reviewed free-choice run showed CBC can finish with `LpStatus == "Optimal"` even when a gap was requested (it proved optimality anyway), status must be derived from *both* PuLP status and the actual stopping condition, not from the requested gap alone:

- `LpStatus == "Optimal"` → `optimal` **only if** the solve was not truncated by the time limit; otherwise `time_limited`.
- `LpStatus == "Optimal"` but a non-zero gap was requested and CBC stopped on the gap (incumbent ≠ proven-optimal) → `feasible_within_gap`. **Task 2 must confirm how PULP_CBC_CMD/CBC signals "stopped on gap" vs "proved optimal at gap 0"**, since PuLP collapses several CBC states into `LpStatus`. If CBC does not reliably distinguish them via PuLP, parse the CBC log/solution file for the terminating reason and record the method in the decision record.

### 3.4 Files

- Modify: `artifacts/api-server/src/solver/solve.py` — `_envelope` signature + every solve function's terminal return; a shared helper `_termination(prob, requested_gap, time_limit, run_time)` returning `(status, metadata)`.
- Modify: `lib/api-spec/openapi.yaml` — extend `SolveResult` with the metadata fields; regenerate `lib/api-zod` + `lib/api-client-react` (same commit).
- Modify: `artifacts/api-server/src/solver/resultEnvelope.ts` (Zod) to match.
- Test: `artifacts/api-server/src/solver/tests/test_termination.py` (new) — proven-optimal at gap 0, feasible-within-gap, time-limited, infeasible each produce the correct `status` + metadata. Uses small/forced fixtures so it is fast and deterministic.
- Test: `artifacts/api-server/src/__tests__/resultEnvelope.test.ts` — schema accepts the new fields for all models.
- **Untouched:** `e2e_accuracy.py` (rule #2). Frontend consumes the new fields read-only later; Proven-only means the UI still shows the existing label for `optimal` — no new UI in this spec.

### 3.5 Acceptance

- All existing solver pytest + api-server tests green; `e2e_accuracy.py` 87/87 unmodified.
- New `test_termination.py` proves each status value is emitted for the right termination condition.
- A gap-stopped JADE solve now reports `feasible_within_gap`, never `optimal`.

---

## 4. Task 2 — Benchmark harness + scenario corpus

### 4.1 Deliverable

A repeatable script (`scripts/src/harness/solve-benchmark.ts` invoking the real solver, or a Python harness under `artifacts/api-server/src/solver/tests/benchmark/`) that runs a fixed corpus and writes a CSV/JSON matrix to `docs/superpowers/metrics/solve-benchmark.<date>.{csv,json}`. Not wired to CI; run on demand and (later) on the real Render plan.

### 4.2 Corpus

Two sources combined (L7):

- **Hand-authored fixtures** (version-controlled, deterministic) per the parent §4.4, at minimum covering, for JADE: forced-open, free-choice, P changes, demand edits, warehouse force/inactivate, plant-product capability edits, added plants/warehouses/customers, customer exclusion, distance overrides, and known-hard combinations. Include one representative scenario for each other live model (p-median-us, p-median-brazil, transport-coal base LP, chens-cosmetics-cn) as fast-regime baselines. These are the reproducible backbone.
- **A sample of real dev-DB scenarios** (realism check) — pulled read-only, hashed/anonymized as needed, to confirm the hand-authored corpus's timing distribution matches real inputs. Not required to be reproducible; used to validate the fixtures aren't unrepresentative.

Each scenario (both sources) is tagged with a **regime label** (`fast` | `slow`) so the matrix supports L3's frequency-aware sizing once pilot telemetry supplies real frequencies.

### 4.3 Runs and recorded fields

Run each scenario at `gap ∈ {0, 0.005, 0.01, 0.02}`, **N=5 repeats** (record determinism/variance). For each run record:

- p50/p95 wall and CPU time;
- **build/model-construction time vs time inside `prob.solve()`**, split explicitly;
- CBC phase data where practical: time to root relaxation, time to first incumbent, best bound, iteration count, enumerated node count, terminating reason;
- peak RSS for the Python process and the CBC child;
- objective delta from the `gap=0` run;
- chosen facilities/assignments (to confirm equal-objective across gaps);
- feasibility + termination reason;
- module import time (measured once per process).

### 4.4 Acceptance

- Matrix produced for the full corpus, committed under `docs/superpowers/metrics/`.
- The build-vs-solve split and CBC-phase columns are populated for every JADE family (confirms whether the reviewed free-choice CBC-bound result generalizes).
- Regime labels present on every row.

---

## 5. Task 3 — Experiment: MIP-start-from-cache

### 5.1 Question

Does seeding CBC with a prior/near-identical solve's open-facility set as a warm start (a) collapse the free-choice ~16s tail (incumbent at t=0 instead of ~15.9s), and (b) speed near-identical edits (the 60% near-dup load)?

### 5.2 Method

- Use `solve_jade`'s existing model; supply a MIP start via PuLP's warm-start mechanism (`prob.solve(PULP_CBC_CMD(..., warmStart=True))` after setting `varValue` on the integer vars, or the CBC `mipstart` file if PuLP's path proves unreliable — **determine which actually works with the installed CBC and record it**).
- Seed set 1: the `gap=0` optimal open set of the same scenario (upper bound on benefit).
- Seed set 2: the optimal open set of a *near-identical* scenario — **characterized fully (L8) across each near-dup family**: one demand edit, one capacity edit, one force/inactivate change, and one distance-override edit away. Record per family how much a stale-but-close prior open set still helps (or hurts) time-to-incumbent, since real near-dups vary by which field was tweaked.
- Compare against the no-warm-start baseline from Task 2: total time, time to first incumbent, objective, correctness of the final answer.

### 5.3 Guardrail

MIP-start must not change the optimum (rule #6 — it's a starting point, not a constraint). Verify the warm-started solve returns the same objective/facilities as the cold solve for every test case; a warm start that changes the answer is a bug, not a speedup.

### 5.4 Deliverable

Decision record `docs/superpowers/specs/2026-09-20-mipstart-experiment.md`: does warm-start work with this CBC, its measured effect on the tail and on near-dups, whether it's worth a production code path in the B2 spec, and any correctness caveats.

---

## 6. Task 4 — Experiment: warm/persistent Python worker

### 6.1 Question

How much per-solve overhead (process spawn + PuLP import + dataset load) does a persistent Python worker remove, and for which models is it material?

### 6.2 Method

- Measure current per-solve overhead: `spawn python3` + import + module-level dataset loads, vs the CBC solve time, for a fast model (~1s) and JADE.
- Prototype a persistent worker (import + load once, loop reading jobs on stdin) — **prototype only, not the production worker service** (that's B2). Measure steady-state per-solve time vs the spawn-per-solve baseline.
- Note any state-leakage/reliability risk from process reuse.

### 6.3 Deliverable

Decision record section (may live in the same experiment doc): overhead removed per model, whether a persistent worker is worth building in B2, and reliability caveats. Expectation from the parent doc: material for ~1s models (~0.365s import is 25–35% of runtime), not the fix for the 16s free-choice tail.

---

## 7. Task 5 — Production-baseline measurement (real Render plan)

### 7.1 Question

On the actual `nos-api` Starter plan (0.5 CPU / 512 MB), what is the real per-solve CPU/RSS, and is `SOLVE_WORKER_CONCURRENCY=3` safe (OOM/thrash) under concurrent JADE solves?

### 7.2 Method

- Run the Task 2 harness (subset) against the **existing live services** (L6) on the current Starter plan, and against a temporarily-resized Standard `1c-2g` for comparison, capturing CPU/RSS from Render metrics.
- Drive concurrent solves (3, then higher) and watch for OOM / CBC thrash / event-loop starvation of the API.
- Record on Linux (Render), not just local macOS, since the parent's RSS figures were off-Render.

**Live-services safeguards (L6):** run **off-hours** (no real cohort exists yet, so real-user impact is near-zero, but treat it as if it could); use a **dedicated test account**; tag and **clean up** all test scenarios/jobs afterward; be ready to **abort** if API latency for any real request degrades. If a plan resize is used for comparison, restore the original plan after.

### 7.3 Deliverable

A row in the benchmark matrix + a short note: safe concurrency on 512 MB, and whether the API must move to Standard before any load test.

---

## 8. Task 6 — Phase 0.5 pilot gate definition + synthetic load test

### 8.1 Purpose

The 50×50 load is an unproven hypothesis and the B2 build is expensive. This task defines — and runs, on the current (undivided) architecture — the load test and pass criteria that determine whether the B2 durable-queue build is justified, per the parent's Phase 0.5 gate and the repo's P1.1 "don't split without bottleneck evidence" rule.

### 8.2 Synthetic load test (current architecture)

Against the **existing live services** (L6), correctly sized per Task 5, under the same off-hours / test-account / cleanup / abort safeguards as §7.2:

- **Steady:** sustain 2,500 submissions/hour for a bounded window (or a validated accelerated equivalent), warm cache.
- **Burst:** 50 synchronized submissions, warm and cold cache.
- Mix: run once frequency-neutral (random over live models) and once all-JADE (the guaranteed case).
- Capture: enqueue latency, queue wait, end-to-end completion p50/p95, rejection rate (the current 429 at `QUEUE_DEPTH_LIMIT=30`), failures, and **where the bottleneck actually is** (CPU / event loop / spawn throughput / Postgres connections).

### 8.3 Pass criteria (ratified, L5)

- p95 enqueue latency < 500 ms.
- **p95 queue wait during stated peak < 30 s.**
- Enqueue rejection rate under contracted load < 1%.
- Execution failure rate (excluding infeasibility) < 1%.
- No permanently stuck jobs after restart.

### 8.4 Gate decision

Deliver `docs/superpowers/specs/2026-09-20-pilot-gate-results.md` stating: did the current architecture meet the criteria? **If it did**, the pilot can run as-is (tune-in-place: gap for forced-open, correct concurrency, warm-worker if Task 4 justifies) and the B2 build is deferred until real cohort load proves a bottleneck. **If it did not**, the failure mode identifies exactly which B2 component is justified first (e.g. restart-safety, API/solver decoupling, admission control), and the B2 spec is written against that evidence.

---

## 9. Deliverables summary

| Task | Output | Kind |
|---|---|---|
| 1 | Truthful status/termination contract | Code (solve.py, OpenAPI+regen, Zod, tests) |
| 2 | Benchmark harness + committed measurement matrix | Code + data |
| 3 | MIP-start-from-cache decision record | Experiment + doc |
| 4 | Persistent-worker overhead decision record | Experiment + doc |
| 5 | Production-baseline measurement on Render | Measurement + note |
| 6 | Pilot-gate definition, synthetic load test, gate results | Test + decision doc |

No infrastructure is created or resized as a committed change by this spec; Task 5/6 may use temporary deployed environments for measurement.

## 10. Clarifications — resolved

All four Phase-0 clarifications are decided (see L5–L8 in §0):

1. **Completion SLO** → p95 queue wait < 30 s (§8.3).
2. **Load-test environment** → existing live services, with §7.2/§8.2 safeguards.
3. **Benchmark corpus** → both hand-authored fixtures and a real dev-DB sample (§4.2).
4. **MIP-start depth** → full characterization across near-dup families (§5.2).
