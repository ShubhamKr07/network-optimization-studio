# SCND Scaling — Phase 0 + 0.5 Spec (Correctness, Reliability Slice, Measurement, Pilot Gate)

**Date:** 2026-09-20
**Status:** **SUPERSEDED — audit/split ledger; §30 findings resolved (Q58–Q64 answered 2026-09-22, see §31). P0R.1 HOLD.** §28 received the §29 response, but the deep re-review found unresolved authority, schema/persistence, failure, limit, protocol, and rollout contradictions. **P0R.1 remains on HOLD / not authorized to start**; P0R.2 attainable-CBC fixture capture retains evidence-only approval; P0R.3/P0R.4 require P0R.1 evidence, a post-spike design update, and another approval review. §§0–12 are the original audit trail; §13 is the split map; §14–§30 record successive reviews/resolutions, with §30 controlling. **DEC-2026-09-21-01 remains authorized only for its narrow evidence-driven status/termination assertion correction** at GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19); it authorizes no solver behavioral change. Measurement and B2 remain TBD.
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

---

## 22. Deep approval validation — post-§21 consistency and runtime review (2026-09-21)

### 22.1 Approval decision

**REQUEST CHANGES.** §21 correctly closes several §20 findings, including the sacred-test authorization, known legacy shape, no-incumbent bound rule, exact public-objective table, and separation of fixture/test categories. It does **not** close every finding it claims to close. This ledger is therefore not approved as authoritative/resolved, and P0R.3/P0R.4 remain unapproved pending the P0R.1 evidence, a design update, and another approval review.

| Scope | Decision after this review |
|---|---|
| This Phase-0 ledger as authoritative/resolved | **Not approved** — Q30–Q36 remain open. |
| `DEC-2026-09-21-01` | **Authorized and auditable** — GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) contains the product owner's exact narrow approval. |
| P0R.1 CBC-evidence spike | **Approved to proceed**; its acceptance must include Q31's no-orphan-process proof. |
| P0R.2 attainable CBC fixture capture | **Approved to proceed**. |
| P0R.2 parser tests | Blocked on the P0R.1 interface. |
| P0R.3 contract/consumer implementation | **Not approved**; Q30 and Q32–Q35 require normative design decisions. |
| P0R.4 integration/sacred-test changes | **Not approved for execution yet**; DEC authorization exists, but the task remains conditional on P0R.1, the design update, and re-review. |
| Measurement and B2 | Still TBD and not reviewed for implementation approval here. |

### 22.2 Blocking findings

#### 22.2.1 HIGH — Q29 is deferred, not resolved

§21/Q29 claims that every named legacy consumer gets an explicit accept/normalize/reject decision and that no "define later" placeholder remains. The successor does the opposite:

- §2.7 says each decision **will be made in P0R.3**, rather than stating the decision; and
- P0R.3 still says `exports/templates (define accept-vs-reject of legacy)`.

This matters in the current repository: scenario list/get return `row.result` directly; output exports validate `scenario.result` against `ResultEnvelopeSchema` before deriving rows; solve history reads a separate, historically drifting `resultSummary`; telemetry and smoke checks have different data paths. One policy cannot be inferred safely for all of them.

**Required correction:** add a normative boundary table before P0R.3 approval. At minimum, decide:

| Boundary | Required explicit decision |
|---|---|
| Scenario list/get and `toApiScenario()` | Accept stored legacy → normalize v1, or reject; specify API result. |
| Output exports (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`) | Normalize and accept only when preserved payload is sufficient, or reject with a defined status/error. |
| Input/template exports | State whether result-contract version is irrelevant; do not group these implicitly with output exports. |
| Solve history | Define legacy `resultSummary` handling separately from `scenarios.result`. |
| Telemetry | Define whether legacy reads are tagged, omitted, or normalized; new-solve telemetry remains v2. |
| Smoke checks/tests | State which schema each boundary validates and the expected legacy behavior. |
| Result cache | Retain the already-decided cache miss/re-solve behavior for unversioned rows. |

Until that table exists, Q29 is open and §21 must not call all §20 findings resolved.

#### 22.2.2 HIGH — timeout kills can leave the CBC descendant running

P0R.1 introduces a Python wrapper that launches CBC, while current `jobRunner.ts::runSolverProcess` launches `python3` and, on outer timeout, sends `SIGKILL` only to that Python child. Killing a process does not reliably kill its descendants; Node's own documentation explicitly notes that child processes of child processes are not terminated when their parent is killed on Linux: [Node `child_process` documentation](https://nodejs.org/api/child_process.html#subprocesskillsignal).

The existing P0R.1 acceptance requires temporary-path cleanup on timeout/kill, but it does not explicitly require that the CBC grandchild is gone. A surviving CBC process can consume CPU after the job is marked failed, violating cost, concurrency, and capacity assumptions. Python `finally`/temporary-directory cleanup is also not available after `SIGKILL`.

**Required correction:** add an explicit P0R.1 acceptance test that records the Python and CBC PIDs, triggers the outer timeout/cancellation path, and proves within a bounded interval that:

- no CBC descendant survives;
- the result is published at most once and the job is failed once;
- the unique temporary directory is removed or reclaimed by a deterministic parent/janitor path; and
- repeated timeouts do not accumulate processes or artifacts.

The design must choose process-group/tree termination, a parent-owned wrapper/process handle, or an equivalent proven mechanism. If correctness Phase 0 cannot supply this, P0R.3 deployment must be blocked until B2's process-group termination lands.

#### 22.2.3 HIGH — `solver_error` still conflates CBC termination with data/model/internal failures

The successor's Q28 boundary maps `solve.py`-declared load/model errors to `error/solver_error`. Current `solve.py` emits the same legacy error envelope for missing/corrupt datasets, unknown `modelType`, and a catch-all exception around the entire dispatcher. Those failures are not CBC solver termination evidence. Treating all of them as `solver_error` undermines the contract's stated truthfulness goal and obscures operational diagnosis.

**Required correction:** choose one normative taxonomy before P0R.3. Recommended:

- `solver_error`: CBC started and failed/abandoned/numerically errored;
- `data_error`: required dataset/configuration could not be loaded or validated;
- `model_error`: dispatch/model construction failed before CBC started;
- `internal_error`: unexpected application exception; and
- process/spawn/outer-timeout/JSON/schema failures: failed job with no published solver result, as already specified.

If the product intentionally retains one generic reason, rename it from `solver_error` to an honest pipeline-wide term and document that it is not CBC termination evidence. Tests must cover every retained reason and the failed-job/no-result boundary.

#### 22.2.4 MEDIUM — the legacy zero-sentinel rule can erase a valid zero objective

The successor says a legacy no-result `objective:0` sentinel normalizes to null, but it does not define how the normalizer distinguishes the sentinel from a legitimate solved objective of zero. Several current input schemas permit zero demand, so zero is not intrinsically proof of no incumbent.

**Required correction:** make normalization status/evidence-aware. A safe minimum rule is:

- legacy `status:"infeasible"|"error"` → `objective:null` regardless of stored zero;
- legacy successful/`optimal` row → preserve numeric zero because the old row cannot prove that it was merely a sentinel; and
- malformed or contradictory legacy rows → reject or normalize through an explicitly tested conservative rule.

Do not use `objective === 0` alone as the discriminator.

#### 22.2.5 MEDIUM — the canonical gap policy specifies two different denominator rules

The successor gives the formula `abs(I-B)/(abs(I)+EPS)` but calls `EPS` a denominator **floor**. These are not equivalent: a floor is `max(abs(I), EPS)`, while adding epsilon biases every nonzero denominator and produces materially different results near zero. The phrase "serialized to 6 decimal places" is also ambiguous for JSON numbers, which do not preserve trailing-zero formatting.

**Required correction:** choose one exact policy and use it consistently in prose, implementation, schemas, and fixtures. Recommended options are:

1. numeric `round(abs(I-B)/max(abs(I), EPS), 6)` with display formatting handled separately; or
2. `0` when `I==B==0`, otherwise `null` for a zero incumbent if the product considers relative gap undefined, while retaining raw values/absolute difference as evidence.

State whether the API field is a JSON number rounded to at most six fractional digits or a string with exactly six decimal places. Keep presentation formatting out of the evidence field unless a string is deliberately chosen.

#### 22.2.6 MEDIUM — the composite cache version is directionally correct but not deterministic enough to implement

The successor now requires hashing `solve.py`, parser/wrapper modules, relevant model/config code, and CBC/PuLP versions. It does not define the exact manifest, ordering/encoding, how the CBC binary/build is identified, behavior when an input is missing/unreadable, or an explicit contract-version escape hatch. Different implementations could therefore produce unstable keys or omit a semantic dependency while claiming compliance.

**Required correction:** the post-spike design update must define:

- an explicit sorted manifest of files or a build-generated artifact manifest;
- byte-delimited hashing with paths and contents included unambiguously;
- the pinned PuLP version and an authoritative CBC binary version/build identifier;
- fail-closed startup behavior if a required hash input/version cannot be read;
- an explicit `SOLVER_CONTRACT_VERSION` constant for semantic changes not represented by file bytes; and
- tests proving changes to the parser, wrapper, dependency/build identifier, and contract constant each invalidate the cache while identical artifacts remain stable.

Q26 is therefore **directionally resolved**, not implementation-ready.

#### 22.2.7 LOW — one guardrail still cites superseded approval provenance

The correctness successor header correctly cites GitHub issue #19, but its hard-rule guardrail still says `e2e_accuracy.py` was authorized by in-session Q4/Q10 selections. That is stale and reintroduces the provenance ambiguity §20/Q22 resolved.

**Required correction:** make every DEC reference point to GitHub issue #19 and state the same narrow scope: evidence-driven status/termination assertion changes with zero golden-objective changes. Also update the successor's header statement that it incorporates only Q4–Q21 if Q22–Q29 are intended to be normative inputs.

### 22.3 Validated improvements

- GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) is a valid, direct product-owner authorization for `DEC-2026-09-21-01`; the former approval-provenance blocker is closed.
- The known stored legacy generation is correctly identified as the nested unversioned envelope rather than the Python test shim's flat projection.
- The invariant matrix correctly permits `solverBestBound` without an incumbent and requires bound+gap for `feasible/gap_limit`.
- The public-objective table now states exact derivations for each implemented model/mode.
- P0R.2 correctly separates attainable CBC terminal fixtures, malformed parser cases, wrapper tests, and process-level job-runner failures.
- The primary P0R.1 wrapper and recorded-no-go/design-approval requirement for the direct-CBC fallback remain appropriate.
- Current Render documentation still supports the recorded platform facts: web/private-service/background-worker plans top out at 12 CPU per instance, scaled instances use the same plan, and a service can scale to at most 100 instances. Sources: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). This validates the platform constraints only; topology still requires measurement.

### 22.4 Decisions/questions required (Q30–Q36)

| # | Required decision | Recommendation |
|---|---|---|
| **Q30 — legacy consumer boundary matrix** | What does each scenario read, output/input export, solve-history, telemetry, smoke-test, and cache boundary do with normalized legacy? | Record an explicit accept/normalize/reject result for each boundary now; do not defer with "define in P0R.3." |
| **Q31 — CBC descendant termination** | How does the outer timeout/cancellation kill the Python wrapper and every CBC descendant and reclaim temp artifacts? | Make no-surviving-CBC/process-tree cleanup a P0R.1 go/no-go acceptance test; otherwise block P0R.3 until B2. |
| **Q32 — truthful error taxonomy** | Are dataset/model/internal failures really `solver_error`, or do they receive separate reasons/failed-job treatment? | Use distinct `data_error`, `model_error`, `internal_error`, and genuine `solver_error`, or rename the generic reason honestly. |
| **Q33 — legacy zero objective** | When is stored legacy `objective:0` a no-result sentinel versus a legitimate objective? | Never infer from zero alone; use legacy status/evidence, preserve zero on legacy successful rows, and test contradictions. |
| **Q34 — gap denominator and serialization** | Is the denominator `abs(I)+EPS` or `max(abs(I),EPS)`, and is six-decimal handling numeric rounding or string formatting? | Choose one formula; keep `achievedGap` numeric and round deterministically, with display formatting separate. |
| **Q35 — deterministic solver-contract hash** | What exact artifacts, ordering, dependency/build identifiers, failure policy, and manual version constant define the cache version? | Specify a sorted manifest, unambiguous byte framing, CBC/PuLP identifiers, fail-closed startup, `SOLVER_CONTRACT_VERSION`, and invalidation/stability tests. |
| **Q36 — DEC citation consistency** | Which artifact is normative everywhere for sacred-test authorization? | Cite GitHub issue #19 in the header, guardrails, P0R.4, and commit guidance; remove stale in-session Q4/Q10 provenance. |

### 22.5 Re-approval checklist

- [ ] §21 no longer claims Q29 resolved while the successor defers its decisions.
- [ ] Every legacy consumer boundary has a normative accept/normalize/reject behavior and test expectation.
- [ ] P0R.1 proves no CBC descendant or temporary artifact survives timeout/cancellation.
- [ ] The error taxonomy distinguishes genuine CBC solver errors from data/model/internal and outer-process failures, or uses an honestly named generic category.
- [ ] Legacy objective-zero normalization is status/evidence-aware and preserves legitimate zero objectives.
- [ ] `achievedGap` has one exact denominator formula and unambiguous numeric/string serialization semantics.
- [ ] The solver-contract/cache hash has an exact deterministic manifest, dependency/build identifiers, failure behavior, manual semantic version, and tests.
- [ ] Every DEC reference cites GitHub issue #19 consistently and preserves its narrow scope.
- [ ] P0R.1 evidence is incorporated into a successor design update.
- [ ] A new approval review occurs before P0R.3/P0R.4.

Until every applicable item above is closed, §21's statement that all §20 findings are resolved remains historical rather than the current approval state; this §22 decision controls.

---

## 23. §22 resolution — Q30–Q36 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q30** legacy-consumer matrix | Normative boundary table (no "define later"): scenario read/`toApiScenario`→normalize; **output exports→reject legacy with a "re-solve to export" error**; input/template exports→unaffected; solve-history→separate, tagged; telemetry→legacy tagged, new=v2; smoke→schema-per-boundary; cache→miss. | Correctness spec §2.7.1. |
| **Q31** CBC descendant kill | **P0R.1 wrapper owns bounded process-group kill**; a no-orphan go/no-go acceptance test (records PIDs, triggers timeout, proves no surviving CBC + reclaimed temp + publish-once). Full graceful-drain stays B2. | Correctness spec §3 P0R.1. |
| **Q32** error taxonomy | **Distinct reasons** — `terminationReason` gains `data_error`/`model_error`/`internal_error` beside genuine `solver_error`; operator/telemetry/Sentry-facing; students see a coarse quality string only; spawn/timeout/JSON/schema = failed-job-no-result. | Correctness spec §2.1/§2.4. |
| **Q33** legacy zero objective | Status/evidence-aware: legacy infeasible/error→null; legacy success→**preserve numeric zero**; malformed→conservative tested rule. Never `===0` alone. | Correctness spec §2.7. |
| **Q34** gap denominator/serialization | `round(abs(I-B)/max(abs(I),EPS),6)` — explicit **floor**, not `+EPS`; numeric field, display separate; `I==B==0`→0. | Correctness spec §2.9. |
| **Q35** deterministic cache hash | Post-spike design-update deliverable: sorted manifest + byte-framed hashing + pinned PuLP/CBC build IDs + fail-closed + `SOLVER_CONTRACT_VERSION` + invalidation/stability tests. | Correctness spec §2.10. |
| **Q36** DEC citation | Every DEC reference cites GitHub issue #19 (header, §4 guardrail, P0R.4, commit); stale in-session Q4/Q10 provenance removed; header note updated to Q4–Q36. | Correctness spec header/§4. |

§22 findings resolved; correctness successor governs implementation (P0R.1 + P0R.2 fixture capture approved). §22.2.7/Q36 (stale guardrail provenance) fixed. Q29's "define later" placeholder replaced by the §2.7.1 normative table (closes §22.2.1).

---

## 24. Deep approval validation — post-§23 consistency and contract review (2026-09-21)

### 24.1 Approval decision

**Decision: NOT APPROVED as a fully resolved implementation contract.** The successor design incorporates several sound §22 decisions, but its normative task list still contradicts those decisions, the timeout design does not assign process-tree cleanup to an actor that is guaranteed to survive, and multiple public-contract details remain unspecified. The existing narrow authorization is unchanged.

| Scope | Decision | Reason |
|---|---|---|
| Ledger claim that all findings are resolved | **NOT APPROVED** | Q37–Q42 below remain open; §23 is a historical resolution record, not the current approval state. |
| P0R.1 wrapper/parser spike | **APPROVED TO PROCEED** | It is needed to obtain real CBC evidence and resolve the process-control and parser unknowns. Its output must satisfy Q38 before later phases. |
| P0R.2 attainable-CBC fixture capture | **APPROVED TO PROCEED** | Capturing attainable terminal cases is evidence gathering and is within the existing narrow scope. |
| P0R.2 parser tests beyond attainable fixture capture | **BLOCKED ON P0R.1** | Expected mappings must be derived from the accepted wrapper/parser contract and captured evidence. |
| P0R.3 and P0R.4 | **NOT APPROVED** | Require the post-spike design update, closure of Q37–Q42, and another approval review. |
| `DEC-2026-09-21-01` | **AUTHORIZED** | GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) is durable, direct product-owner authorization with the recorded narrow scope. |
| Measurement plan and B2 topology | **TBD / NOT APPROVED** | Current Render limits validate platform bounds, not the required topology, concurrency, or cost model. |

### 24.2 Findings requiring correction

#### 24.2.1 HIGH — the successor's P0R.2 and P0R.3 tasks contradict its own resolved contract

The successor's normative contract distinguishes `data_error`, `model_error`, `internal_error`, and genuine `solver_error`, but P0R.2 still directs load/model failures to `error/solver_error`. Its §2.7.1 boundary table now makes an explicit legacy decision for each consumer, while P0R.3 still says output exports/templates must "define accept-vs-reject of legacy." A task implementer following the execution section can therefore reintroduce the exact Q30/Q32 defects that §23 says are closed.

**Required correction:** rewrite P0R.2 to reference the canonical taxonomy and invariant table in successor §§2.1/2.4, including separate fixtures for each failure class. Rewrite P0R.3 to implement and test the already-selected §2.7.1 behavior; do not leave the decision open. Add a consistency check that every work-package acceptance criterion points to, rather than restates differently, the normative contract.

#### 24.2.2 HIGH — process-group ownership is not technically coherent across the outer timeout

The successor says the Python wrapper launches CBC in its own process group and "owns" bounded termination, but also correctly notes that the current Node runner sends `SIGKILL` only to Python and that `SIGKILL` bypasses Python cleanup. Once Node kills the wrapper, that wrapper cannot kill CBC or reclaim its temporary directory. The current runner knows only the Python PID and resolves after killing it; merely asserting a no-orphan acceptance test does not specify a mechanism capable of passing it.

**Required correction:** choose and document one viable ownership protocol before P0R.1 is accepted:

1. Node creates or tracks a process group containing Python and CBC, sends bounded TERM/KILL to that entire group, waits for exit, and owns final temp cleanup; or
2. Python reports the CBC process-group ID and temp path to Node through a defined control channel, so Node can perform the same fallback cleanup; or
3. Python enforces an internal deadline strictly earlier than the outer Node deadline, with sufficient cleanup budget, while Node remains an explicitly specified janitor fallback for crashes and forced kills.

The design must define process-group creation, PID/PGID handoff, timeout ordering, TERM-to-KILL grace periods, wait/reap behavior, cancellation equivalence, temp ownership, platform assumptions, and the actor that publishes the final result exactly once. The acceptance test must record Python and CBC identifiers, force timeout/cancellation, prove neither process survives, prove temp reclamation, prove once-only completion, and repeat the case to detect leaks. Node's documented child-process behavior does not guarantee that killing a child kills its descendants; see [Node.js `subprocess.kill()`](https://nodejs.org/api/child_process.html#subprocesskillsignal).

#### 24.2.3 HIGH — an allegedly operator-only taxonomy is exposed by the public result contract

The successor adds the detailed failure reasons to public `terminationReason` and returns that result through normalized/OpenAPI responses. Hiding the value in the current UI does not make it operator-only: API clients can observe it. The single student-facing quality string `"Solver error"` is also inaccurate for bad data, unsupported/invalid model construction, and internal application failures. The exact `(status, terminationReason) -> quality` table lists only `error/solver_error`, omitting the other newly legal error pairs. Finally, the design removes diagnostic misuse of `infeasibilityReason` without defining a sanitized replacement for operator diagnostics.

**Required correction:** choose one of these coherent contracts:

- keep public `terminationReason` limited to stable, user-appropriate solve outcomes and put `failureReason` plus sanitized `errorDetail` in an internal/operator record; or
- explicitly make the expanded taxonomy public, document compatibility and sanitization rules, use a truthful coarse user message such as `"Solve failed"`, and enumerate exact quality strings for every legal pair.

In either case, define where diagnostic detail lives, prohibit secrets/paths/raw solver output in public fields, specify Sentry/telemetry mappings, and add schema and negative-leakage tests.

#### 24.2.4 MEDIUM — the legacy boundary matrix selects policies but not implementable API contracts

The direction of Q30 is now explicit, but several boundary behaviors remain too vague for interoperable implementation: output-export rejection has no HTTP status or stable error code; solve-history's "tagged unverified" result has no named field or OpenAPI schema change; telemetry has no exact event/property; and the smoke requirement does not enumerate the endpoints/call sites that must be exercised.

**Required correction:** define, at minimum:

- the export rejection response, recommended as HTTP `409` with stable code `LEGACY_RESULT_REQUIRES_RESOLVE` and a non-sensitive message;
- a typed response field such as `legacyUnverified: boolean`, including whether it is always emitted and how new rows are represented;
- the exact telemetry event/property name, allowed values, cardinality constraints, and prohibition on payload/result contents;
- the complete scenario-read, history, output-export, input/template-export, and cache call-site inventory; and
- unit/integration tests for every row of the boundary matrix, including authorization behavior and mixed legacy/v2 collections.

#### 24.2.5 MEDIUM — Q35 defines a future gate, not a resolved cache-key algorithm

Successor §2.10 correctly lists the properties the post-spike design must supply, but it still defers the actual artifact manifest, byte framing, authoritative CBC build identity, and final algorithm. That is acceptable during P0R.1 evidence gathering, but it is not an implementation-ready resolution and must not be represented as one.

**Required correction:** mark Q35 explicitly **open as a mandatory P0R.3 gate**. The post-spike update must contain the exact sorted manifest or generated manifest format, canonical path encoding and byte framing, pinned PuLP identity, authoritative CBC binary/build digest or identifier, fail-closed startup behavior, `SOLVER_CONTRACT_VERSION`, example hash vectors, and stability/invalidation tests. No cache read/write may ship until that update is reviewed and approved.

#### 24.2.6 MEDIUM — requested solver-limit metadata lacks a field-level contract

The successor lists `requestedGap` and `configuredTimeLimitSec` but does not define their types, required/nullable status, finiteness/range constraints, source-of-truth mapping, or behavior for `no_solution` and `error` results. It also does not require proof that the values included in the result and cache identity are the values actually supplied to CBC.

**Required correction:** define both fields in the canonical schema and OpenAPI contract, including:

- exact JSON types and units, requiredness/nullability, finite-number checks, and allowed ranges;
- exact mapping from request fields (`gap`, `timeLimitSec`) after defaults, clamping, and normalization;
- whether they are present on every terminal result, including `no_solution` and `error`;
- invariants tying normalized values to CBC arguments, logs/telemetry, stored results, and cache keys; and
- tests for defaults, boundaries, invalid numbers, retries, and cache separation when either effective limit changes.

### 24.3 Validated improvements

- Q30 now chooses a direction for every named legacy consumer boundary instead of deferring the policy wholesale.
- Legacy objective normalization is status/evidence-aware and preserves a legitimate numeric zero on successful rows.
- The achieved-gap formula and JSON representation are internally consistent: `round(abs(I-B)/max(abs(I), EPS), 6)`, numeric serialization, and separate presentation formatting.
- GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) remains valid durable authorization for the narrowly scoped sacred-test change.
- P0R.1 includes a valuable no-orphan, temp-reclamation, once-only, repeated-timeout acceptance test; the missing item is a coherent mechanism and ownership protocol.
- Current Render documentation still supports the recorded hard platform bounds: eligible service plans top out at 12 CPU per instance and a service can scale to at most 100 same-plan instances. Sources: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). These limits do not by themselves validate the proposed worker count, runtime, queue policy, or cost.

### 24.4 Decisions/questions required (Q37–Q42)

| # | Required decision | Recommendation |
|---|---|---|
| **Q37 — task/contract consistency** | Will P0R.2 and P0R.3 implement the already-selected canonical taxonomy and legacy matrix, or are those decisions being reopened? | Do not reopen them implicitly. Replace the stale task text with references to successor §§2.1/2.4/§2.7.1 and acceptance tests for those exact rules. |
| **Q38 — process-tree owner and protocol** | Which surviving actor owns Python+CBC termination, reaping, temp cleanup, and once-only publication when the outer timeout fires? | Select one complete Node/group, PGID-handoff, or inner-deadline-plus-janitor protocol and document its timing and failure cases before accepting P0R.1. |
| **Q39 — public versus internal failure taxonomy** | Are `data_error`, `model_error`, and `internal_error` stable public API values, and where does sanitized diagnostic detail live? | Prefer a stable public outcome plus an internal `failureReason`/`errorDetail`; otherwise explicitly version and fully specify the public taxonomy and use truthful user copy. |
| **Q40 — concrete legacy boundary API** | What exact response fields, status/error code, telemetry dimensions, endpoint inventory, and tests implement each §2.7.1 boundary? | Define HTTP `409` + `LEGACY_RESULT_REQUIRES_RESOLVE`, a typed legacy-verification marker, bounded telemetry properties, and per-boundary integration tests. |
| **Q41 — cache hash readiness** | Is Q35 considered resolved now, or an open prerequisite for P0R.3? | Record it as an open mandatory P0R.3 gate until the exact manifest, framing, identities, vectors, failure behavior, and tests are approved. |
| **Q42 — effective solver-limit metadata** | What are the complete contracts for `requestedGap` and `configuredTimeLimitSec`, and how are they proven equal to CBC configuration and cache identity? | Make both typed, validated, effective-value fields with explicit terminal-state behavior and end-to-end invariant tests. |

### 24.5 Re-approval checklist

- [ ] Successor P0R.2 no longer maps load/model/internal failures to generic `solver_error` contrary to the canonical taxonomy.
- [ ] Successor P0R.3 implements the selected legacy matrix rather than asking implementers to decide accept versus reject.
- [ ] One process-tree ownership protocol is specified end to end and the P0R.1 no-orphan test demonstrates that protocol under timeout, cancellation, crash, and repeated execution.
- [ ] Public versus internal termination/failure fields, exact quality strings, diagnostic location, sanitization, and compatibility rules are complete and schema-tested.
- [ ] Every legacy boundary has an endpoint/call-site inventory, typed response behavior, stable export error contract, bounded telemetry tag, and integration test.
- [ ] Q35 is visibly open until the deterministic cache algorithm and test vectors are approved; cache use remains gated.
- [ ] `requestedGap` and `configuredTimeLimitSec` have complete schema, range, effective-value, CBC-argument, persistence, telemetry, and cache-key invariants.
- [ ] The post-spike design incorporates actual CBC evidence and closes Q37–Q42.
- [ ] A new approval review authorizes P0R.3/P0R.4 before their implementation begins.

Until every applicable item above is closed, §23's statement that the §22 findings are resolved is historical rather than the current approval state; this §24 decision controls.

---

## 25. §24 resolution — Q37–Q42 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q37** task/contract consistency | P0R.2/P0R.3 stale text rewritten to **reference** the canonical §2.1/§2.4/§2.7.1 (not restate/reopen): error boundary points to §2.11; legacy boundaries implement §2.7.1, not "define later". | Correctness spec §3 P0R.2/P0R.3. |
| **Q38** process-tree owner | **Node owns the process group** (the surviving actor): `jobRunner` spawns Python detached as PG leader, tracks PGID, TERM→KILL the whole group on timeout/cancel, reaps, owns temp cleanup, publishes once. No-orphan go/no-go test incl. forced-kill/crash case. Bounded group-kill; full drain still B2. | Correctness spec §3 P0R.1. |
| **Q39** public vs internal failure | **Public coarse + internal `failureReason`.** Public envelope = `error`/`solver_error`/`"Solve failed"` only; granular `data_error`/`model_error`/`internal_error`/`solver_error` + sanitized `errorDetail` live in the internal `solve_jobs`/telemetry/Sentry record; negative-leakage tests. (Refines Q32: distinct reasons kept, but internal.) | Correctness spec §2.1/§2.4/§2.5/§2.11. |
| **Q40** concrete legacy API | Export reject = **HTTP 409 + `LEGACY_RESULT_REQUIRES_RESOLVE`**; typed `legacyUnverified: boolean`; bounded telemetry `resultContract: v2\|legacy`; full call-site inventory + per-row integration tests. | Correctness spec §2.7.1. |
| **Q41** cache-hash readiness | Q35 marked **explicitly OPEN as a mandatory P0R.3 gate**; no cache read/write ships until the deterministic manifest + test vectors are approved. | Correctness spec §2.10. |
| **Q42** solver-limit metadata | `requestedGap`/`configuredTimeLimitSec` = typed, validated **effective-value** fields (post defaults/clamping = actual CBC args); present on every terminal incl. `no_solution`/`error`; tied to the cache key; boundary/invalid/retry tests. | Correctness spec §2.12. |

§24 findings resolved; correctness successor governs implementation (P0R.1 + P0R.2 fixture capture approved). Q39 refines Q32 (granular reasons retained but moved off the public contract into an internal record — closes the §24.2.3 leakage). Q38 supersedes §22's "wrapper owns kill" with a surviving-parent (Node) process-group owner.

---

## 26. Deep approval validation — post-§25 executable-contract review (2026-09-21)

### 26.1 Approval decision

**Decision: NOT APPROVED as a fully resolved implementation contract.** The §25 decisions improve the intended architecture, but several of them lack the transport, schema, migration, transition, and platform details needed to implement them without reopening product/security decisions. The existing narrow authorization is retained: P0R.1 may start as an evidence spike and P0R.2 may capture attainable CBC fixtures; neither authorizes P0R.3/P0R.4 or production promotion.

| Scope | Decision | Reason |
|---|---|---|
| Ledger claim that §24 is fully resolved | **NOT APPROVED** | Q43–Q49 below remain open; §25 records decisions but does not make all of them executable. |
| P0R.1 evidence spike | **APPROVED TO START; GO/NO-GO NOT YET ACCEPTED** | The spike is the correct way to obtain CBC/process evidence, but Q46 and its no-orphan acceptance test must be resolved before passing the gate. |
| P0R.2 attainable-CBC fixture capture | **APPROVED** | Evidence capture is within the existing narrow scope. |
| P0R.2 parser tests | **BLOCKED ON ACCEPTED P0R.1 EVIDENCE/INTERFACE** | Parser expectations must follow the accepted wrapper/record authority. |
| P0R.3 and P0R.4 | **NOT APPROVED** | Require the post-spike update, exact schemas/migrations/transitions, closure of Q43–Q49, and another approval review. |
| `DEC-2026-09-21-01` | **AUTHORIZED** | GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) remains open and retains the exact narrow product-owner approval wording. |
| Measurement plan and B2 topology | **TBD / NOT APPROVED** | Platform limits are validated, but topology, concurrency, queueing, runtime, and cost still require measurements. |

### 26.2 Findings requiring correction

#### 26.2.1 HIGH — the internal failure record has no safe transport, persistence migration, or public-job boundary

Successor §2.11 requires granular `failureReason` and sanitized `errorDetail` on the internal `solve_jobs` row while prohibiting them from the public result. The current `solve_jobs` schema has only `error`; the public solve-job endpoint returns that field directly. Current `markFailed(...)` inputs include raw spawn errors, Python stderr, and solver stdout fragments, so simply reusing `error` would violate the promised negative-leakage boundary. P0R.3 does not assign a database schema/migration or a public job-error contract.

There is also no defined channel by which Python can tell Node `data_error` versus `model_error` versus `internal_error` after the public solver envelope has deliberately collapsed every failure to `error/solver_error/"Solve failed"`. Node cannot persist a distinction it never receives.

**Required correction:** define an end-to-end private failure protocol before P0R.3 approval:

- a runner-private process message/schema that carries the public result separately from internal failure metadata, or another explicitly bounded private channel;
- exact Python→Node mappings for every internal reason and for pre-spawn/outer-timeout/nonzero-exit/JSON/schema failures;
- a `solve_jobs` migration and Drizzle schema ownership for `failure_reason` and sanitized `error_detail` (or an explicitly justified alternative);
- the fate of the existing public `SolveJob.error` field — remove it, or restrict it to a stable code/coarse safe message that is never the operator diagnostic;
- one sanitization function with byte/character bound, allow/deny policy, and tests against paths, secrets, stdout/stderr, payload fragments, and schema dumps; and
- negative-leakage tests across scenario reads, solve-job polling, history, exports, logs, telemetry, and Sentry.

#### 26.2.2 HIGH — normalized legacy v1 is still not a complete or discriminated schema

Successor §2.7 calls the normalized-v1 output complete, sets `solutionStatus:null`, and says the raw legacy status must not be re-exposed as truthful `status`, but it never defines the normalized row's deprecated `status` field. Existing API `SolveResult.status` is required, and v2 requires it to equal the projection of `solutionStatus`. An implementer must therefore guess whether v1 omits `status`, makes it null, emits `unknown`, adds `legacy_unverified`, or incorrectly copies the historical value.

The successor also does not give legacy-v1 behavior for `requestedGap`/`configuredTimeLimitSec`, while §2.12 requires those fields on every terminal result, or reconcile §2.2's field list with §2.7.1's rule that `legacyUnverified` is always emitted and is `false` for v2.

**Required correction:** write the exact version-discriminated schemas, not only prose:

- v2: `envelopeVersion:2`, non-null truthful statuses, `legacyUnverified:false`, and the complete required/nullable field set;
- normalized v1: `envelopeVersion:1`, `solutionStatus:null`, `terminationReason:"unknown"`, `legacyUnverified:true`, the chosen non-truth-claiming `status` representation, `legacyStatus`, and explicit absent/null behavior for all v2-only evidence/limit fields; and
- stored legacy: its own raw shape, never accepted by the raw-solver schema.

Update OpenAPI and consumer compatibility rules to match the selected v1 `status` representation and test mixed v1/v2 collections.

#### 26.2.3 HIGH — Q42 still does not define an executable solver-limit policy

Successor §2.12 says the fields are effective values after defaults/clamping, but defines no defaults, maximums, or clamping rules. It gives only `requestedGap >= 0` and `configuredTimeLimitSec > 0`. Current request validators require both fields, impose only lower bounds, and do not clamp them. This leaves unbounded requested runtimes as a compute-cost risk and makes the phrase "after defaults/clamping" non-normative.

The name `requestedGap` also conflicts with the claim that it stores the post-clamp effective value. P0R.3's task list does not explicitly add either field to `_envelope`, the schemas, OpenAPI, the effective-value normalizer, or the cache-key construction.

**Required correction:** decide and document:

- exact request defaults, minimums, maximums, and reject-versus-clamp behavior per field;
- whether the product preserves both the original request and effective configuration (`requestedGap` plus `configuredGap`) or stores only a truthfully named effective value;
- the single normalization point before CBC invocation and cache-key construction;
- behavior for validation failures that never start a solver versus terminal solver errors; and
- explicit P0R.3 tasks/tests proving the effective values in CBC arguments, result, job evidence, telemetry, and cache identity are identical.

#### 26.2.4 HIGH — Node process-group ownership still lacks temp-path handoff and precise platform/reaping semantics

The direction in Q38 is sound: on POSIX, Node can spawn detached Python as a new process-group/session leader and signal the group. But the successor simultaneously says Python's wrapper creates a unique per-solve temp directory and Node owns final cleanup. Node cannot remove an unknown path after Python is killed unless it creates the directory or receives the path through a trusted channel.

The wording that Node "reaps" Python+CBC is also too broad: Node directly waits/reaps its Python child; it can signal and prove death of CBC descendants, but it is not their parent after orphaning and does not directly reap them. Negative-PGID group signaling is POSIX-specific and must not silently become a Windows implementation assumption.

**Required correction:** choose one exact temp protocol, preferably Node `mkdtemp` → validated absolute path passed to Python → Python constrained to that directory → Node idempotently removes it after direct-child close and group-death verification. Specify:

- production and CI platform assumptions, and explicit unsupported/fail-fast or alternate Windows behavior;
- PGID derivation, group `TERM`/grace/`KILL`, ESRCH/race handling, direct-child close wait, group-existence probe, cleanup order, and cleanup-failure disposition;
- how cancellation and outer timeout share one once-only state machine; and
- no-orphan tests on the production OS, including a killed Python parent with CBC alive and holding inherited descriptors.

Node's documented guarantee is only that `detached:true` makes the child a process-group/session leader on **non-Windows** platforms: [Node.js child-process documentation](https://nodejs.org/api/child_process.html#optionsdetached).

#### 26.2.5 MEDIUM — the Q35 cache gate conflicts with the already-shipping cache and the approved-spike transition

Successor §2.10 says no cache read/write ships until the deterministic composite hash is approved, but the application already performs cache lookup and write-through using a hash that covers only `solve.py`. P0R.1 can add wrapper/parser files that the current hash does not include. The design does not say whether the approved spike is evidence-only and forbidden from deployment, whether cache is disabled during the transition, or whether the composite version must land before any spike code can be promoted.

**Required correction:** select an explicit transition:

1. P0R.1/P0R.2 artifacts are evidence-only and cannot be deployed or merged into a release path before approved P0R.3;
2. all result-cache reads/writes are feature-flagged off until the composite version lands; or
3. a minimal fail-closed composite version lands before any wrapper/parser code can deploy, with the full reviewed manifest still gating v2 cache use.

Define behavior for existing unversioned cache rows, rollback between old/new releases, and mixed rolling instances so no old instance can write an entry a new instance mistakes for v2.

#### 26.2.6 MEDIUM — Q40 telemetry and history tagging still have competing names and incomplete schemas

The legacy matrix says telemetry is tagged `legacyUnverified`; the concrete clause says `resultContract: "v2" | "legacy"`. It refers to `solve-completed`, while the current event is named `"scenario solve completed"` and uses snake-case properties. Solve-history `resultSummary` remains an opaque object with no exact verification marker contract. Q40 therefore selected a direction but did not establish the exact event/schema it required.

**Required correction:** specify:

- the exact existing-or-new telemetry event string and exact bounded property name/value spelling;
- cache-hit, fresh-v2, normalized-legacy-read, and failed-job emission rules without payload contents;
- the typed `resultSummary` v1/v2 marker and OpenAPI changes, including whether `legacyUnverified` is always emitted; and
- tests that protect event/property cardinality and prevent objectives, inputs, results, paths, or diagnostics from leaking into telemetry.

#### 26.2.7 LOW — the successor's approval provenance is stale after §25

The correctness successor header still says it incorporates reviews through §22 and decisions Q4–Q36 even though §25 claims Q37–Q42 are normative. This makes it unclear whether the newest decisions actually govern implementation.

**Required correction:** update the successor header to cite §24 and Q37–Q42, list Q35/Q41 and Q43–Q49 as open gates where applicable, and keep the narrow execution authorization visibly distinct from full implementation approval.

### 26.3 Validated improvements and external facts

- Q37 corrected the stale P0R.2/P0R.3 task language so the canonical taxonomy and legacy matrix are not implicitly reopened.
- The public coarse failure message `"Solve failed"` and internal granular taxonomy are directionally sound; Q43 concerns the missing safe transport/storage/public boundary, not that product decision.
- Q35/Q41 is now honestly identified as open rather than implementation-ready.
- The process-group owner is now the surviving Node parent, which is directionally correct; Q46 supplies the remaining temp/platform/state-machine requirements.
- GitHub issue [#19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19) remains open with the exact narrow product-owner authorization; DEC-2026-09-21-01 remains valid.
- Current Render documentation confirms the applicable hard bounds: web/private/background-worker plans top out at **12 CPU per instance**, and a service can scale to at most **100 same-plan instances**. Sources: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). The older 16/32-CPU service table in the local scaling-skill reference is stale; those are not the current web/private/background-worker ceiling. These facts validate platform limits only, not worker count, autoscaling policy, throughput, or cost.

### 26.4 Decisions/questions required (Q43–Q49)

| # | Required decision | Recommendation |
|---|---|---|
| **Q43 — private failure path** | How does granular failure metadata travel Python→Node, where is it persisted, and what safe information remains in the public solve-job response? | Define a runner-private message, add the DB migration/typed internal columns, and replace public raw `error` with a stable coarse code/message plus negative-leakage tests. |
| **Q44 — normalized-v1 discriminator** | What exact value/presence does deprecated `status` have on normalized legacy, and what happens to every v2-only field? | Publish explicit v1/v2 discriminated schemas; never copy legacy `optimal` into truthful `status`. |
| **Q45 — limit normalization and ceilings** | What defaults, upper bounds, rejection/clamping rules, and requested-versus-effective names govern gap and time limit? | Normalize once before CBC/cache; retain separate requested/effective fields if clamping, and impose a product-approved maximum time limit. |
| **Q46 — process/temp/platform protocol** | Who creates and communicates the temp path, what exactly does Node wait/reap/probe, and which OS behavior is supported? | Have Node create/pass/clean the directory, document POSIX production/CI semantics, and test group death + direct-child close + idempotent cleanup. |
| **Q47 — cache transition** | Can P0R.1 code deploy while the current solve.py-only cache key remains active? | No: mark it evidence-only or disable/version the cache before promotion; define mixed-version and rollback behavior. |
| **Q48 — telemetry/history exact contract** | Which exact event/property and history field identify v2 versus legacy? | Use one bounded naming scheme consistent with current telemetry conventions and add a typed history summary plus no-payload tests. |
| **Q49 — normative provenance** | Does the successor formally incorporate §24/Q37–Q42 and expose the new open gates? | Update its header/status so the implementation authority and remaining blockers are unambiguous. |

### 26.5 Re-approval checklist

- [ ] A runner-private failure message carries granular reason/detail without adding them to the public envelope.
- [ ] `solve_jobs` migration/schema and public solve-job error behavior are defined; existing raw `error` leakage is removed and tested.
- [ ] Exact version-discriminated raw-v2, stored-result, normalized-v2, and normalized-v1 schemas define every required/nullable/absent field, including legacy `status`.
- [ ] Gap/time-limit defaults, ceilings, normalization, names, terminal behavior, CBC arguments, telemetry, persistence, and cache-key equality are fully specified and assigned to P0R.3.
- [ ] Node/Python temp-path ownership and the POSIX process-group state machine are implementable and pass the production-OS no-orphan suite.
- [ ] P0R.1/P0R.2 deployment policy and cache transition prevent wrapper/parser changes from using the solve.py-only cache identity.
- [ ] Telemetry and solve-history use one exact, typed, bounded legacy/v2 marker with negative-leakage tests.
- [ ] The successor header incorporates §24/Q37–Q42 and explicitly carries forward Q35/Q41 and Q43–Q49 as open gates.
- [ ] P0R.1 evidence and all attainable/unattainable CBC pairs are recorded in the post-spike update.
- [ ] A new approval review closes Q43–Q49 and authorizes P0R.3/P0R.4 before implementation begins.

Until every applicable item above is closed, §25's statement that the §24 findings are resolved is historical rather than the current approval state; this §26 decision controls.

---

## 27. §26 resolution — Q43–Q49 decisions (2026-09-21)

| Q | Decision | Landed in |
|---|---|---|
| **Q43** private failure transport | Runner-private message carries public result separate from `{failureReason, errorDetail}`; Node maps every failure path; `solve_jobs` gains nullable `failure_reason`/`error_detail` (Drizzle); public `SolveJob.error` replaced by a stable coarse code+safe message; one `sanitizeErrorDetail` + negative-leakage tests across all read surfaces. | Correctness spec §2.11. |
| **Q44** v1/v2 discriminator | Exact discriminated schemas; deprecated `status` made **nullable** — v1 `status:null` (legacy value only in `legacyStatus`, never copied to truthful `status`); all v2-only fields null on v1; stored-legacy never accepted by the v2 solver schema. | Correctness spec §2.7. |
| **Q45** limit ceilings | `timeLimitSec` default 60 / **max 60, clamp** / min 1; `gap` default 0 / max 1.0 clamp; **requested + configured (effective) pairs** both recorded; single normalization point before CBC + cache key. | Correctness spec §2.12. |
| **Q46** process/temp protocol | Node `mkdtemp`s + passes validated path + idempotently cleans; spawns Python `detached` PG leader (POSIX only), signals negative-PGID TERM→KILL, reaps Python child + probes CBC group death (ESRCH/race); one once-only state machine; Linux prod/CI, Windows fail-fast; prod-OS no-orphan test incl. killed-parent/CBC-alive. | Correctness spec §3 P0R.1. |
| **Q47** cache transition | P0R.1/P0R.2 **evidence-only** (not deployed); `solve.py`-only hash unchanged until composite version lands with P0R.3; mixed-rolling/rollback defined so no old instance writes a v2-mistakable entry. | Correctness spec §2.10. |
| **Q48** telemetry/history | Existing event `"scenario solve completed"` + bounded snake_case `result_contract: v2\|legacy` (no payload contents); typed `resultSummary` `legacyUnverified` marker (OpenAPI); cardinality + no-leak tests. | Correctness spec §2.7.1. |
| **Q49** provenance | Successor header updated to §14–§24 / Q4–Q42 + open gates (Q35/Q41, Q43–Q49); execution authority kept distinct from implementation approval. | Correctness spec header. |

**User direction (2026-09-21):** keep refining the contract before executing the spike. §26 findings folded into the successor; genuinely evidence-gated exactness (Q35 CBC build identity, Q46 real reap timing, parser records) still finalizes in the **post-spike design update**. §26 resolved.

---

## 28. Deep approval validation — post-§27 behavioral, cache, and rollout review (2026-09-21)

### 28.1 Approval decision

**Decision: NOT APPROVED. P0R.1 is on HOLD.** The §27 resolution improves schema and process direction, but it introduces an unauthorized 60-second behavioral cap, makes requested metadata incompatible with effective-only cache identity, leaves the private failure protocol and public error API underspecified, and does not define a safe rolling deployment for the breaking v2 contract. The explicit user direction to refine before executing the spike controls over the older "approved to execute" wording.

| Scope | Decision | Reason |
|---|---|---|
| Ledger claim that §26 is fully resolved | **NOT APPROVED** | Q50–Q57 remain open; multiple §27 decisions are internally inconsistent or not assigned to a work package. |
| P0R.1 evidence spike | **HOLD — NOT AUTHORIZED TO START** | Latest user direction requires contract refinement first; Q50–Q57 include non-evidence product/rollout decisions. |
| P0R.2 attainable-CBC fixture capture | **APPROVED AS EVIDENCE-ONLY** | Prior narrow approval remains; fixtures must not alter/deploy solver behavior. |
| P0R.2 parser tests | **BLOCKED ON ACCEPTED P0R.1 EVIDENCE/INTERFACE** | Parser expectations depend on the accepted authoritative records/interface. |
| P0R.3 and P0R.4 | **NOT APPROVED** | Require closure of Q50–Q57, P0R.1 evidence, a post-spike update, and a new approval review. |
| `DEC-2026-09-21-01` | **AUTHORIZED, SCOPE UNCHANGED** | Allows evidence-driven status/termination assertion correction only, with zero golden-objective changes. |
| Measurement plan and B2 topology | **TBD / NOT APPROVED** | Platform ceilings remain valid, but capacity and cost topology remain measurement-gated. |

### 28.2 Findings requiring correction

#### 28.2.1 CRITICAL — the 60-second clamp changes existing solver behavior without authorization

Successor §2.12 changes `timeLimitSec` to default 60 / maximum 60 / clamp above. The shipped application defaults every Workspace model to 120 seconds, UI fallbacks use 120, protected `e2e_accuracy.py` cases use 120 and 180, and all six manifests currently require the supplied value with no maximum. Clamping those cases to 60 is not merely result metadata: it changes the CBC stopping condition and can change termination classification, incumbent quality, and potentially golden objectives.

`DEC-2026-09-21-01` authorizes evidence-driven status/termination assertion changes with **zero golden-objective changes**. It does not authorize shortening solve duration. The phrase `gap default 0 (proven)` also contradicts the central rule that a requested gap does not prove the achieved outcome; a zero requested gap can still end at a time/node/interruption limit.

**Required correction:** preserve current effective time limits during P0R unless the product owner explicitly approves a behavioral ceiling backed by benchmark/CBC evidence. If a ceiling is desired, record its rationale, affected existing scenarios/tests/UI/manifests, migration behavior, objective/status evidence, and separate authorization. Replace "0 (proven)" with "0 (requests zero relative-gap tolerance); outcome remains evidence-derived."

#### 28.2.2 HIGH — effective-only cache identity cannot safely return requested-value metadata

Successor §2.12 requires every terminal envelope to contain original requested and effective configured pairs, while the cache key uses only effective values. With clamping, requests such as 61 and 300 seconds both configure to 60 and share a cache key. An immutable cached envelope created by the first request would then return the wrong `requestedTimeLimitSec` to the second. The same defect applies to clamped gap values.

The default case is also undefined: if a field is omitted, "as submitted" implies missing/null, while §2.12 requires all four fields to be numeric and always emitted.

**Required correction:** separate request audit metadata from the cacheable computation artifact. Recommended contract:

- job/request record owns original requested values (nullable when omitted, or explicitly records `source: default|request`);
- cacheable solver result owns configured/effective values and evidence only;
- cache key remains based on effective computation identity; and
- API composition attaches the current job's requested values after cache lookup.

The alternative is including requested values in the key, which is correct but needlessly fragments equivalent compute results. Whichever policy is chosen, specify retries and cache-hit reconstruction tests.

#### 28.2.3 HIGH — the private failure protocol and public failure API remain non-executable

Successor §2.11 calls the channel "defined" but does not define the transport (extra fd, stdout wrapper, file, or other), framing, exact schema, maximum size, ordering, partial-message behavior, or what happens when public and private halves disagree. It also says Node maps every failure path, but the four-value internal enum does not represent spawn failure, outer timeout, nonzero exit, invalid JSON, schema rejection, cleanup failure, or restart interruption.

The public `SolveJob.error` replacement is described only as "code + safe message" without field names, stable code enum, status-by-code mapping, or backward compatibility. Finally, sanitizing arbitrary raw exception/stdout/stderr text cannot reliably prove that unknown secrets were removed.

**Required correction:** define an exact bounded `SolverProcessMessage` schema and transport; a complete internal job-failure taxonomy or `failureReason` + `failureStage`; a fixed public `errorCode` enum and safe-message table; mismatch/partial/oversize handling; and allowlisted structured diagnostics generated at failure sites. Raw stdout, stderr, payloads, paths, and arbitrary exception text must never flow through a generic sanitizer into public storage. Define Sentry as an operator sink with sanitized structured detail, not as a public leakage surface.

#### 28.2.4 HIGH — the P0R.3 work package does not implement the §27 decisions

Successor P0R.3 still omits named tasks for the `solve_jobs` schema push, private process-message validation, granular failure persistence, public solve-job error replacement, four requested/configured limit fields, one-point limit normalization, typed history summaries, telemetry changes, and leakage tests. Its `solve.py` task also omits the §2.12 fields. The general §2.2 field list remains stale, listing only `requestedGap` and `configuredTimeLimitSec` rather than both requested/configured pairs.

An implementer following §3 can therefore complete every listed task without implementing Q43/Q45/Q48 while still claiming P0R.3 complete.

**Required correction:** rewrite P0R.3 so every Q43–Q48 decision has an explicit file/change, owner/seam, acceptance test, schema/codegen step, database push step, and rollback requirement. Reference canonical clauses rather than copying divergent field subsets. Update §2.2 to the complete contract.

#### 28.2.5 HIGH — "atomic consumer migration" is not a viable Render rollout or rollback plan

P0R.3 changes the persisted result version, expands/makes nullable public status, replaces the public job-error shape, adds database columns, regenerates clients, and changes frontend rendering. The API and static Studio are separate Render services and do not deploy atomically. API deployments can also overlap old and new instances. Q47 protects cache keys only; it does not stop an old API instance from writing an unversioned scenario result during rollout, an old frontend from reading v2, or a rolled-back API from encountering v2 rows.

**Required correction:** define an additive, staged release:

1. push nullable DB columns and deploy readers/API schemas that accept v1 and v2 while continuing to write v1;
2. deploy a frontend compatible with both contracts and an additive public job-error transition;
3. after old API instances have drained and compatibility smoke tests pass, enable v2 writes behind a server-side flag;
4. preserve dual-read/rollback compatibility for a defined window before removing deprecated fields.

Specify schema-push ownership/timing, feature-flag default, drain/health evidence, old-writer/new-reader and new-writer/old-reader tests, rollback behavior for v2 scenario/cache rows, and deploy ordering between `nos-api` and `nos-studio`.

#### 28.2.6 HIGH — the normative approval state contradicts the recorded user direction

The ledger header says P0R.1 is authorized; §27 says to keep refining before executing it; the successor says Q43–Q49 are open until the post-spike update; and §27 simultaneously declares §26 resolved. These statements cannot all control. Several Q43–Q49 items are product/schema/rollout decisions that do not require CBC evidence and should not be deferred past the spike merely because some Q35/Q46 details are evidence-gated.

**Required correction:** make the latest user direction authoritative: mark P0R.1 **HOLD / not authorized to start** until Q50–Q57 are resolved. Separate:

- decisions that must close before the spike (limits, cache metadata, message/API schema, work-package ownership, rollout, authority state, telemetry lifecycle); from
- evidence that can close only after the spike (actual CBC records, authoritative build identity, measured TERM/KILL/reap timing).

Do not label a review resolved while its successor header explicitly carries the same questions as open.

#### 28.2.7 MEDIUM — telemetry rules do not match when legacy, success, and failure events occur

`"scenario solve completed"` is emitted for a fresh solve or cache hit. A legacy result is encountered during scenario/history reads, not during a new solve; legacy cache rows are mandated cache misses. Therefore `result_contract:"legacy"` has no coherent path on the completed event. The clause also mentions failed-job emission rules even though failures use `"scenario solve failed"`. Its new prohibition on objective contents conflicts with the current completed event, which emits `objective`.

**Required correction:** define telemetry separately:

- fresh/cache-hit `scenario solve completed` — necessarily v2 after cutover, with its exact allowed properties;
- `scenario solve failed` — internal bounded failure tags only, with no result-contract claim unless defined; and
- normalized legacy reads — either no telemetry, or a separate explicitly justified/read-sampled event to avoid high-cardinality/noisy read tracking.

State whether the existing objective property is removed, why, and which dashboards/analytics migrate. Add tests to every actual emission site rather than one abstract matrix row.

#### 28.2.8 MEDIUM — public `error` results are unreachable under the selected lifecycle

The target contract calls `solutionStatus:error` + `terminationReason:solver_error` + `quality:"Solve failed"` a public result, but §2.8 requires every error to mark the job failed, skip cache, and **not publish** a scenario result. Public clients therefore observe a failed `SolveJob`, not an error-shaped `Scenario.result`. Keeping an unreachable error branch in the public result union invites frontend and OpenAPI behavior that can never occur.

**Required correction:** choose one authority. Recommended: retain error outcomes in the runner-private/raw solver message for validation and internal classification, remove them from the public published scenario-result union, and make the public job-error code/message the only failure surface. If an error result must be public, define exactly where it is published and reconcile that with §2.8.

### 28.3 Validated improvements and external facts

- Q44 now makes normalized legacy explicit with `status:null`, `legacyStatus` isolated, and v2-only evidence fields null.
- Q46's Node-owned `mkdtemp`, POSIX process-group ownership, direct-child wait, group-death probe, and Linux no-orphan acceptance direction are implementable; measured timing remains evidence-gated.
- Q47 correctly prevents P0R.1/P0R.2 artifacts from entering a release under the old solve.py-only cache identity.
- The durable DEC artifact remains narrowly valid; this review does not reopen its authorized status/termination-only scope.
- Current Render documentation still confirms **12 CPU** as the eligible web/private/background-worker ceiling and **100 same-plan instances per service**. Sources: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). These limits do not validate the proposed 60-second product cap or any worker-count/cost conclusion.

### 28.4 Decisions/questions required (Q50–Q57)

| # | Required decision | Recommendation |
|---|---|---|
| **Q50 — solver-limit compatibility** | Is the 60-second default/cap authorized despite shipped 120/180-second behavior and protected cases? | Preserve existing limits until benchmark evidence and explicit product authorization support a change; never call requested gap 0 "proven." |
| **Q51 — requested metadata vs cache** | How can an effective-key cache return request-specific audit values? | Keep requested values on the job/request and effective evidence in the cache; compose on read. |
| **Q52 — failure message/API** | What exact private transport/schema, complete failure taxonomy, public code/message shape, and diagnostic policy apply? | Define a bounded runner message, structured allowlisted diagnostics, complete Node/Python mappings, and stable public code enum. |
| **Q53 — P0R.3 ownership** | Which task implements each Q43–Q48 contract and DB/API/frontend seam? | Rewrite P0R.3 with explicit files, schema push, codegen, tests, rollout and rollback acceptance. |
| **Q54 — staged deployment** | How do separately deployed API/Studio and overlapping API instances safely cross the breaking v1→v2 boundary? | Reader-first, frontend-compatible, feature-flagged writer cutover, compatibility window, then cleanup. |
| **Q55 — execution authority** | Does the older P0R.1 approval or the later refine-before-spike direction control? | Latest user direction controls: P0R.1 remains on HOLD until this review closes. |
| **Q56 — telemetry lifecycle** | Which real event receives which result-contract/failure marker, and what happens to the current objective property? | Specify completed, failed, and optional legacy-read telemetry independently at their actual emission sites. |
| **Q57 — public error reachability** | Is an error envelope a public scenario result or only a runner-private outcome? | Keep it runner-private and expose failure through the safe public job error unless a real publish path is deliberately selected. |

### 28.5 Re-approval checklist

- [ ] The 60-second behavior change is removed or separately authorized with CBC/benchmark evidence and protected-objective proof.
- [ ] Requested gap 0 is described as a request, never proof of achieved optimality.
- [ ] Request-specific limit metadata is separated from or safely reconciled with effective-value cache identity.
- [ ] Exact private runner-message framing/schema and all Python/Node failure mappings are defined and bounded.
- [ ] Public job-error fields and stable code/message mappings are exact, additive during rollout, and negative-leakage tested.
- [ ] P0R.3 explicitly owns every §2.7/§2.10/§2.11/§2.12 schema, DB, API, codegen, frontend, telemetry, rollout, and rollback change.
- [ ] A staged reader-first / writer-flag rollout works across API overlap, independent Studio deployment, rollback, legacy rows, and v2 rows.
- [ ] Ledger and successor agree that P0R.1 is on HOLD until the latest user direction is satisfied.
- [ ] Completed, failed, and optional legacy-read telemetry contracts map to real emission sites and migrate existing objective analytics deliberately.
- [ ] Public scenario-result and public job-failure schemas contain no unreachable/contradictory error branch.
- [ ] A new approval review closes Q50–Q57 before P0R.1 begins.

Until every applicable item above is closed, §27's statement that §26 is resolved is historical rather than the current approval state; this §28 decision controls.

---

## 29. §28 resolution — Q50–Q57 (2026-09-21, complete; Q50=A)

| Q | Decision | State |
|---|---|---|
| **Q50** 60s cap | **A — revert the ceiling (product owner, 2026-09-21).** NO clamp/behavioral change: existing per-model limits stand; the new fields only *record* actual values; any cost-ceiling is a separate benchmark-backed decision + its own authorization. Keeps DEC-01 scope clean. | §2.12 finalized. |
| **Q51** requested vs cache | **Resolved.** Requested values on the job/request record (nullable + `source`); effective on the cacheable result + cache key; API composes requested onto the response after cache lookup (a cache hit never returns a stale requested value). | §2.12. |
| **Q52** failure message/API | Exact bounded `SolverProcessMessage` (transport/framing/size/mismatch/partial) + `failureStage` + allowlisted **structured** diagnostics (not raw-text sanitize) + stable public `errorCode` enum. | Adopted; folds into §2.11 + P0R.3. |
| **Q53** P0R.3 ownership | **Done** — P0R.3 rewritten with a named task/seam/test per decision (T-solve…T-rollout); §2.2 field list fixed. | Applied. |
| **Q54** staged deployment | Reader-first → both-compatible frontend → feature-flagged v2 writer → compat window → cleanup; rollback for v2 rows; `nos-api`/`nos-studio` deploy ordering. | Adopted; new §2.13 in consolidated pass. |
| **Q55** execution authority | **P0R.1 HOLD** — latest user direction controls over the older "authorized" wording. | **Applied** (status line). |
| **Q56** telemetry lifecycle | Separate `scenario solve completed` (v2 post-cutover) / `scenario solve failed` (bounded internal tags) / optional legacy-read telemetry, each at its real emission site; decide fate of the current `objective` property. | Adopted; folds into §2.7.1. |
| **Q57** public error reachability | **Applied** — `error` is runner-private; excluded from the published `NormalizedSolveResult` union; public failure = job `errorCode`. | **Applied** (§2.4/§2.8). |

**Consolidated pass complete (Q50=A, 2026-09-21):** §2.12 finalized (no clamp; requested-on-job / effective-on-cache, composed on read — Q51); §2.11 gained the exact `SolverProcessMessage` (fd3/NDJSON/1MB) + `failureStage` + public `errorCode` enum + allowlisted structured diagnostics (Q52); §2.13 staged reader-first/flag/rollback rollout added (Q54); §2.7.1 telemetry split per real emission site, `objective` property retained, no legacy-read event (Q56); P0R.3 rewritten with a named task/seam/test per decision (T-solve…T-rollout) + §2.2 field list fixed (Q53). §28 fully resolved.

---

## 30. Deep approval review after §29 consolidation (2026-09-21)

### 30.1 Decision and approval scope

**Decision: REQUEST CHANGES / NOT APPROVED. P0R.1 remains on HOLD.** The §29 consolidation is materially better, but the ledger and correctness successor do not yet form one unambiguous, executable contract. The controlling execution status conflicts across the two documents; request-specific limit metadata has neither a complete persistence model nor a distinct post-cache response schema; the error/failure contract still has mutually incompatible public/private branches; the promised public-error mapping cannot be reconstructed from the proposed stored fields; the no-behavior-change limit decision still introduces new behavior; and §2.13 remains a rollout checklist rather than a safe rollback protocol.

| Scope | Approval decision | Reason |
|---|---|---|
| This ledger as resolved/authoritative | **NOT APPROVED** | §29 and the successor retain contradictory and stale normative state. |
| P0R.1 CBC-evidence spike | **HOLD — NOT AUTHORIZED TO START** | The ledger says HOLD while the executable successor says approved; Q58–Q64 below must be resolved before authority can be lifted. |
| P0R.2 attainable-CBC fixture capture | **APPROVED, EVIDENCE-ONLY** | Existing narrow approval remains; captured artifacts must not change or deploy solver behavior. |
| P0R.2 parser tests | **BLOCKED** | Depend on the accepted P0R.1 parser/interface and authoritative CBC records. |
| P0R.3 / P0R.4 | **NOT APPROVED** | Q35/Q41 remain intentionally open, and the schema/persistence/error/rollout contracts below are incomplete. |
| DEC-2026-09-21-01 | **VALIDATED FOR ITS NARROW SCOPE** | GitHub issue #19 contains the exact evidence-driven status/termination authorization and zero-golden-objective restriction claimed here. |
| Measurement / B2 topology and cost | **TBD / NOT APPROVED** | Render ceilings are platform bounds, not throughput or cost evidence; sizing remains benchmark-gated. |

### 30.2 Blocking findings

#### 30.2.1 CRITICAL — there is still no single controlling execution authority

This ledger's header and Q55 say **P0R.1 is on HOLD / not authorized to start**. The correctness successor's header, P0R.1 heading, and summary still say **approved to execute**. The successor header also carries Q43–Q49 as open until the post-spike update even though §29 says the Q50–Q57 consolidation folded those contracts in. Within §29 itself, the heading still says `partial: Q50 open`, and the Q53 row still says `Pending consolidated post-Q50 pass`, while the concluding paragraph says Q50 and Q53 are complete.

Historical review sections may retain their historical decisions, but every current-status surface must identify one controlling state. An implementer cannot be expected to infer that a superseded ledger header overrides an explicitly executable successor task.

**Required correction:**

1. Make the correctness-successor header, P0R.1 heading, and summary say **HOLD / not authorized to start**.
2. Replace its stale Q43–Q49 open-gate wording with the actual current gates.
3. Correct §29's heading and Q53 state.
4. If the hold is later lifted, record that as a new explicit approval decision after Q58–Q64 close; do not silently reinterpret the old approval wording.

#### 30.2.2 HIGH — requested-limit composition has no implementable schema or persistence path

Successor §2.2/§2.12 says requested values live on the job/request record, configured values live in the cacheable result/key, and the API composes requested values onto the response after cache lookup. That separation is correct in principle, but the rest of the design cannot implement it:

- current `solve_jobs` has only `inputs_hash`, `result_summary`, and `error` beyond lifecycle fields; no requested-limit values or source fields exist;
- T-db adds only `failure_reason` and `error_detail`;
- T-solve emits only `configuredGap` and `configuredTimeLimitSec`;
- `SolverEnvelopeV2Schema` is defined as both raw solver output and every new cache write;
- normalized v2 is described as v2 "as-is" while §2.7 requires requested fields in its complete field set; and
- no distinct typed post-cache/published-result schema or scenario-persistence composition step exists.

A single `source: default|request` is also insufficient: gap may be omitted/defaulted while time is explicitly requested, or vice versa. The source must be per field.

**Required correction:** define exact job columns or one exact typed JSON structure for `requestedGap`, `requestedGapSource`, `requestedTimeLimitSec`, and `requestedTimeLimitSource`; write them atomically at enqueue so later scenario edits cannot change their meaning. Define separate schemas for the cacheable solver result and the request-specific published/stored scenario result, plus the exact composition point used on both fresh solves and cache hits. Add retry/restart/cache-hit tests proving the values survive process loss and never come from a different request.

#### 30.2.3 HIGH — the public/private error model still describes incompatible branches

The successor simultaneously says:

- `solutionStatus:error`, `terminationReason:solver_error`, and `"Solve failed"` are public;
- `error` is runner-private and excluded from published `NormalizedSolveResult`;
- `SolverEnvelopeV2` contains an `error` row;
- `SolverProcessMessage` has a separate `{ failureReason, failureStage, errorDetail }` failure branch; and
- every error fails the job and is never cached or published.

The private message's envelope-or-failure invariant is not meaningful if an error may be represented either as an error envelope or as the failure branch. Lines that still call the error envelope public also directly contradict Q57.

**Required correction:** recommended: make the envelope branch success/mathematical-outcome-only (`optimal|feasible|infeasible|unbounded|no_solution`) and represent every execution failure through the private failure branch. Remove `error` from public, normalized, stored-scenario, and cacheable unions. If an internal error envelope must remain, give it a distinct internal schema/name and define exactly why it is not the failure branch; remove every claim that it is public.

#### 30.2.4 HIGH — the stable public `errorCode` cannot be derived after persistence

Successor §2.11 promises a fixed mapping table but does not provide it. The internal `failureReason` enum has no timeout member, while the public enum contains `TIMEOUT`. T-db persists only `failure_reason` and `error_detail`, not the derived `error_code`; after restart, a timeout cannot be reconstructed losslessly if it was stored as generic `internal_error`. `failureStage` is transported but is not persisted. `INPUT_INVALID` also has no ordinary job-producing path because scenario input validation currently returns HTTP 422 before enqueue.

The additive rollout says `errorCode` coexists with legacy `error` for one window, whereas §2.11/T-db say the old public field is replaced. The safe-message field name and storage/derivation authority are therefore still ambiguous.

**Required correction:** provide an exhaustive table covering every Python reason and Node class: pre-spawn, outer timeout, cancellation, nonzero exit, protocol absent/partial/oversize/invalid, schema rejection, serialization failure, cleanup failure, and unexpected exception. Persist `error_code` or a lossless internal class from which it is deterministically derived. Decide whether `INPUT_INVALID` remains synchronous 422/no job (recommended) or define the exceptional asynchronous path. Specify the transition response exactly: field names, nullability, legacy `error` behavior, fixed safe message per code, and cleanup release.

#### 30.2.5 HIGH — Q50=A still contains unauthorized behavior changes

Section 2.12 says there is no clamp/ceiling and no behavioral change, but it introduces `gap max 1.0`. Current validators and solver manifests require `gap` and enforce only a minimum of zero; values above 1.0 are not currently rejected by that contract. A new maximum is therefore a behavioral change.

The same section describes omitted values and per-model defaults, but current request validators and every manifest require both `gap` and `timeLimitSec`; the UI's 120-second initial value is not a backend omission/default contract. Its test rule `invalid/non-finite → failed job` also conflicts with the current HTTP 422 before enqueue behavior.

**Required correction:** for a true Q50=A implementation, preserve the current required fields and existing accepted ranges, making each source `request`. Alternatively, separately authorize optional/default behavior and/or a maximum, then enumerate the validator, manifest, scenario create/update, enqueue, hashing, persistence, HTTP, and protected-test changes. Validation rejected before enqueue should remain 422/no job unless a deliberate API change is approved.

#### 30.2.6 HIGH — §2.13 is a rollout TODO, and its old-reader safety assertion is false

Section 2.13 ends with "Specify schema-push ownership/timing..."; those are unresolved requirements, not an executable plan. It does not define the releases, flag name/owner, public response behavior during the reader-first stage, drain proof, compatibility-window duration/exit criteria, schema rollback rule, or minimum rollback version.

The claim that `envelopeVersion` guarantees an old instance never mistakes v2 for v1 is not true of the current implementation. The current Zod result object is not strict: unknown keys, including `envelopeVersion` and new evidence fields, are stripped, so a v2 `optimal`/`infeasible`/`error` object with the old required fields can validate as the old shape. An already-deployed old binary cannot be made discriminator-aware retroactively. A composite cache key helps isolate cache generations but does not by itself protect `scenarios.result`, rolling writers, or rollback to a pre-dual-reader binary.

**Required correction:** define named releases and an irreversible rollout floor:

1. nullable schema push + internal dual readers while public responses remain old-client-compatible;
2. deploy a frontend that treats all new fields as optional and works against the old API;
3. deploy/verify the dual-reader API and additive job-error fields;
4. drain every pre-dual-reader API instance, prove this from Render deploy/health evidence, then enable the default-off v2 writer flag;
5. allow rollback only to the dual-reader release after the first v2 write;
6. disable the writer before rollback and define treatment of existing v2 scenario/cache rows; and
7. remove deprecated fields only after a named compatibility window and observed client/version criteria.

Use explicit legacy/v2 discrimination in the new readers; do not claim the discriminator protects an old binary.

#### 30.2.7 MEDIUM — the private fd3 protocol is not yet fully bounded

`fd 3 + NDJSON + one message + max 1 MB` improves the design but still leaves implementation-significant choices: whether the limit is bytes or characters; whether exactly one newline-terminated JSON object is required; handling of extra non-empty lines or trailing bytes; bounded incremental reading rather than buffer-then-check; child/process-group disposition on overflow; EOF/partial-write classification; and precise `stdio`/fd setup.

The design bounds fd3 but not stdout/stderr. The current runner accumulates both strings without a ceiling, so moving the contract to fd3 does not by itself remove the memory-risk path. fd3 must also be close-on-exec/not inherited by CBC so a descendant cannot keep the transport open after Python exits.

**Required correction:** define the byte-level grammar and maximum (prefer an explicit byte count), incremental overflow behavior, extra-message rejection, EOF rule, descriptor inheritance, and bounded stdout/stderr capture/discard policy. Test oversize, multiple messages, missing newline/EOF, inherited-descriptor behavior, and process-group cleanup.

#### 30.2.8 MEDIUM — telemetry and Sentry clauses retain stale contradictions

The §2.7.1 boundary matrix still says legacy reads are tagged in telemetry, while its concrete Q56 rule says normalized legacy reads emit no telemetry. Only the latter matches the actual lifecycle and should remain.

The leakage paragraph lists Sentry among surfaces on which `failureReason`/`errorDetail` must not appear, but the next line explicitly sends the bounded reason as a tag and sanitized detail as the Sentry message. Sentry is not a public response; the current wording makes the intended test impossible to interpret.

**Required correction:** update the stale matrix row to `no telemetry`. Define the exact Sentry allowlist and distinguish public-response leakage tests from operator-observability tests. Sentry tests should prohibit raw payloads, secrets, paths, stdout/stderr, and arbitrary exception text while permitting only the explicitly approved bounded tags/message.

#### 30.2.9 MEDIUM — Q35/Q41 remain a deliberate implementation blocker

The deterministic composite solver/cache identity is correctly left open, but this means P0R.3 cannot receive approval yet even if the other contracts are repaired. The post-spike update must still provide the exact sorted artifact manifest, path/content byte framing, dependency/build identities, semantic contract constant, example hash vectors, startup failure behavior, and invalidation/stability tests.

This is not a defect in the evidence-spike approach; it is a reason the document cannot describe the whole correctness migration as approved or implementation-ready.

### 30.3 Validated improvements and external/platform facts

- Q50 correctly removes the unauthorized 60-second time-limit ceiling; §30.2.5 concerns the remaining `gap max 1.0` and omission/default inconsistencies, not that decision.
- Q51's separation of request-specific metadata from effective cache identity is the right direction; §30.2.2 supplies the missing persistence/schema boundary.
- Q56's completed/failed/no-legacy-read event split matches the real emission sites, except for the stale matrix row.
- The rewritten P0R.3 work package is substantially clearer and assigns the major seams; the missing exact schemas/migrations/mappings keep it conditional.
- Node's documented POSIX behavior supports the selected premise that `detached:true` makes the child a new process-group/session leader: [Node `child_process` documentation](https://nodejs.org/api/child_process.html#optionsdetached). P0R.1 must still prove TERM→KILL, direct-child wait, group-death probing, descriptor closure, and temp cleanup on the production OS.
- DEC-2026-09-21-01 remains independently auditable and valid only for its stated evidence-driven status/termination assertion corrections with zero golden-objective changes: [GitHub issue #19](https://github.com/ShubhamKr07/network-optimization-studio/issues/19).
- Current Render documentation supports the cited ceiling of 12 CPU for web/private/background-worker compute and up to 100 same-plan instances per service: [Render compute plans](https://render.com/docs/compute-plans), [Render service scaling](https://render.com/docs/scaling). Render bills each same-plan instance; those platform ceilings do not establish solver concurrency, worker count, SLO attainment, or minimum cost. Those remain measurement decisions.

### 30.4 Decisions/questions required (Q58–Q64)

| # | Required decision | Recommendation |
|---|---|---|
| **Q58 — controlling authority** | Which current document/status controls P0R.1 execution? | Apply the latest direction consistently: HOLD everywhere until a new approval closes this review. |
| **Q59 — cache vs published schema** | What exact schemas persist effective cache data and request-specific published data, and where are they composed? | Separate cacheable solver result from published/stored scenario result; persist per-field requested values/sources on the job and compose before scenario publication. |
| **Q60 — error/failure authority** | Does an execution failure use an error envelope or the private failure branch? | Use the failure branch only; remove `error` from public/cacheable/published result unions. |
| **Q61 — durable public error mapping** | What exhaustive internal/Node mapping produces `errorCode`, and what is persisted? | Publish the full table and persist `error_code` or a lossless source class; keep pre-enqueue validation as 422/no job. |
| **Q62 — limit compatibility** | Does Q50=A preserve today's required fields/ranges, or authorize optional/default/max-gap behavior? | Preserve current behavior now; treat any optional/default/maximum change as separately authorized product work. |
| **Q63 — rollout and rollback floor** | What exact releases, flag, evidence, compatibility window, and minimum rollback version apply? | Reader/additive-client first, drain old instances, flag writes, and never roll back below the dual-reader release after v2 data exists. |
| **Q64 — bounded diagnostics protocol** | What byte grammar, stream bounds, descriptor rules, and Sentry allowlist govern failures? | Specify all fd3/stdout/stderr limits and closure rules; separate public leakage assertions from approved operator diagnostics. |

### 30.5 Re-approval checklist

- [ ] Ledger and successor expose one current authority state; P0R.1 is HOLD until a new approval explicitly lifts it.
- [ ] §29 heading/table and successor open-gate list no longer carry stale Q50/Q53/Q43–Q49 state.
- [ ] Per-field requested values and sources have exact nullable types, job persistence, enqueue/retry semantics, and database-push ownership.
- [ ] Cacheable solver result and request-specific published/stored result are distinct typed schemas with one exact composition point.
- [ ] The public/cacheable result union has no contradictory or unreachable `error` branch.
- [ ] An exhaustive Python/Node failure-to-public-code table exists, and the persisted record reconstructs the same `errorCode` after restart.
- [ ] `INPUT_INVALID`, synchronous 422 validation, cleanup failure, timeout, cancellation, and protocol failure each have exactly one lifecycle.
- [ ] Q50=A introduces no new gap ceiling or omission/default behavior unless separately authorized.
- [ ] The rollout defines named releases, flag default/owner, public compatibility, drain evidence, rollback floor, v2-row handling, compatibility-window exit, and deprecated-field cleanup.
- [ ] New readers explicitly discriminate stored legacy/v2; no safety claim depends on a pre-v2 binary rejecting unknown fields.
- [ ] fd3 framing/byte limit/EOF/overflow/multiple-message/descriptor rules and stdout/stderr bounds are exact and tested.
- [ ] Telemetry matrix and concrete event rules agree; Sentry has an explicit structured allowlist and negative raw-data leakage tests.
- [ ] Q35/Q41's deterministic composite cache manifest, framing, identities, vectors, and fail-closed tests are approved before P0R.3 cache use.
- [ ] P0R.1 receives a new explicit approval only after every applicable pre-spike item above is closed.

Until then, §29's statement that §28 is fully resolved is historical rather than sufficient implementation approval; this §30 decision controls.

---

## 31. §30 resolution — Q58–Q64 decisions (2026-09-22)

| Q | Decision | Landed in |
|---|---|---|
| **Q58** controlling authority | **HOLD everywhere.** Successor status/P0R.1 heading/summary set to HOLD; §29 heading fixed ("complete; Q50=A") + Q53 row → Done; stale Q43–Q49 open-gate list replaced with the real gate (Q35/Q41). Lifting the hold = a new explicit approval after Q58–Q64. | Successor header/§3/§5; this ledger §29. |
| **Q59** cache vs published schema | Per-field job columns `requestedGap`/`requestedGapSource`/`requestedTimeLimitSec`/`requestedTimeLimitSource` (atomic at enqueue); cacheable-result schema (effective only) distinct from published/stored scenario-result schema; one composition point on fresh + cache-hit. | Successor §2.12. |
| **Q60** error/failure authority | **A — failure-branch-only.** Solver envelope = success/math outcomes only (`optimal\|feasible\|infeasible\|unbounded\|no_solution`); `error` removed from public/cacheable/normalized/stored unions + `solutionStatus` enum; all failures via the private failure branch → failed job + public `errorCode`. | Successor §2.1/§2.4/§2.5/§2.11. |
| **Q61** durable errorCode | Exhaustive `failureReason`+Node-class → `errorCode` table; internal enum gains `timeout`/`interrupted`; persist `error_code`+`failure_stage` (not just reason) so `TIMEOUT` reconstructs after restart; `INPUT_INVALID` stays synchronous 422/no-job. | Successor §2.11. |
| **Q62** limit compatibility | **A — preserve current exactly.** Both fields required, existing ranges (min 0, **no** new gap max, no defaults), invalid → 422/no-job; new fields only record actuals (`source=request`, `configured==requested`). No behavioral change; any max/default is separate authorized work. | Successor §2.12. |
| **Q63** rollout/rollback floor | Named releases R1(schema+dual-reader)/R2(frontend)/R3(flagged writer); **new readers explicitly discriminate legacy/v2** (the `envelopeVersion`-protects-old-binary claim was FALSE — Zod strips unknowns); rollback floor = never below R1 after any v2 write, disable writer before rollback. | Successor §2.13. |
| **Q64** bounded diagnostics | fd3 exact bytes (one newline-terminated JSON, 1,048,576-byte cap, incremental abort, extra-line/EOF/partial → internal_error, **close-on-exec** so CBC can't inherit); bounded stdout/stderr capture; Sentry = operator allowlist, distinct from public-leakage tests. | Successor §2.11. |

§30 fully resolved. **P0R.1 remains on HOLD** — a new explicit approval lifts it once the post-spike design update closes Q35/Q41. The correctness successor and this ledger now carry one controlling state (HOLD).
