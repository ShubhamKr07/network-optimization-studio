# SCND Scaling — Reviewed Design / Brainstorm

**Date:** 2026-09-19
**Status:** Reviewed design with second-pass findings resolved; recommended direction identified, implementation gated on production-plan benchmarks and SLO approval.
**Goal:** Handle approximately 50 concurrent classroom users, each running about 50 optimizations/hour on the heaviest live model, for bursts of up to three hours/day, at the lowest defensible compute cost.

---

## 1. Executive decision

Retain the original **split solver tier + scheduled scaling** direction, but replace the proposed implementation with **B2: a durable Postgres queue, identical horizontally scaled workers, scheduled pre-warming, and cache coalescing**.

The original design is directionally correct but was not implementation-ready because:

- it stated an all-heavy workload but sized a random model mix;
- the existing `solve_jobs` row does not contain the executable solve payload;
- queue depth and pending payloads are process-local;
- exact-cache writes are race-safe but do not prevent concurrent duplicate solves;
- the proposed Render worker fleet mixed instance plans in a way a single scaled service cannot;
- the assumed universal JADE speedup from a 1% optimality gap did not hold for a reviewed free-choice case;
- approximate or time-limited JADE results can currently be labelled `optimal`;
- scale-down, retries, stale-result publication, retention, and load-test acceptance criteria were unspecified.

Recommended starting position:

1. Keep **Proven optimal** (`gap=0`, with verified optimal termination) as the default quality mode.
2. If approximate solving is approved, expose a clearly labelled **Quick** mode rather than silently changing the global gap; allow course/instructor policy to hide or disable it.
3. Split API and solver execution after the Phase 0.5 synthetic gate, or earlier if restart-safe queued work is a product requirement.
4. Use Standard `1c-2g` workers with one CBC job per instance initially.
5. Pre-scale to measured capacity before class and drain safely afterward.
6. Add cache-at-admission and one in-flight computation per normalized input hash.
7. Evaluate Render Workflows through a bounded proof-of-concept, not from list pricing alone.

---

## 2. Workload contract

### 2.1 Given load

- **50 users × 50 submissions/hour = 2,500 submissions/hour** at peak.
- Peak duration: up to **three continuous hours/day**.
- Maximum daily submissions at that rate: **7,500**.
- At 20 class-days/month: **150,000 submissions/month**.
- Predictable class windows are the primary scheduling and cost advantage.

The phrase “2,500/hour at peak” is treated as the contracted peak. Do not multiply it by another 4–5× unless 2,500/hour is later redefined as an average. A short synchronized click burst and a sustained higher arrival rate are separate cases:

- a short burst can wait in a bounded queue;
- a sustained 4–5× rate requires 4–5× processing throughput or a relaxed completion SLO.

### 2.2 Input repetition assumption

Initial hypothesis:

- 20% byte-identical or semantically identical re-solves;
- 60% near-identical edits that are distinct optimization problems;
- 20% genuinely distinct scenarios.

If the 20% exact-cache rate is real and the cache is warm:

- `2,500 × 0.8 = 2,000` CBC solves/hour;
- approximately `120,000` real solves/month.

This is not yet a guaranteed saving. The current implementation can still duplicate identical cold-cache work when requests arrive concurrently. Guaranteed capacity must include a cold-cache case until single-flight/coalescing is implemented and measured.

### 2.3 Model set

Live models for the cohort:

| Model | Previously observed wall time, including model build |
|---|---:|
| p-median-us | ~1 s |
| p-median-brazil | ~1 s |
| transport-coal, base LP | ~1 s |
| chens-cosmetics-cn, coverage | ~3 s |
| JADE, forced-open | previously ~13 s in suite timing |

Excluded from this usage:

- transport-coal single-source binary MILP, previously ~34–37 s;
- two-echelon-gold-au.

The guaranteed sizing case is **all-JADE**, matching the goal. A random model mix may be reported as a lower-cost forecast but must not replace the guaranteed case.

---

## 3. Current architecture and corrections

### 3.1 Current path

- `POST /scenarios/:id/solve` validates the current scenario row.
- `enqueueSolveJob` inserts a `solve_jobs` status/history row.
- The complete validated `SolveInput` is stored only in the API process's `pendingJobs` map.
- An in-process array queue feeds a fixed-concurrency worker pool.
- Each job spawns a fresh `python3 solve.py` process, which starts CBC.
- Clients poll job status every 800 ms while a job is queued or running.
- `result_cache` is shared across users and keyed by model/dataset/solver/input hash.

Defaults:

- `SOLVE_WORKER_CONCURRENCY=3`;
- `SOLVE_QUEUE_DEPTH_LIMIT=30`;
- queue depth counts only the current process's waiting array.

### 3.2 Infrastructure correction

The API is not on a 256 MB service plan:

- `nos-api` currently uses Render Starter: approximately 0.5 CPU and 512 MB RAM;
- `nos-postgres` uses the `basic-256mb` Postgres plan.

The previous 256 MB API statement conflated the database and web-service plans. Concurrency 3 can still be unsafe on a 512 MB combined Node/Python/CBC process, but the baseline must be described correctly.

### 3.3 Why `solve_jobs` is not yet a durable queue

The table currently stores identifiers, hash, status, summary, error, and timestamps. It does **not** store:

- `model_id`;
- immutable validated inputs;
- dataset/solver version;
- retry/attempt state;
- worker ownership or lease expiry.

Therefore:

- a standalone worker cannot execute a row without relying on mutable scenario state;
- queued work in `pendingJobs` disappears when the API process restarts;
- a worker must not reload the scenario later, because the user may have edited it after enqueue.

Adding only `FOR UPDATE SKIP LOCKED` does not complete the split. The executable work and its recovery contract must first become durable.

---

## 4. Solver benchmark and quality findings

### 4.1 Existing solver controls

JADE already reads `gap` and `timeLimitSec` and passes them to `PULP_CBC_CMD`. The input validation and payload builder already carry the stored values. The frontend creates new JADE scenarios with `gap: 0`.

Changing the default is therefore a **product and quality-policy change**, not missing solver plumbing.

### 4.2 Review measurements

The review ran the real `solve_jade` function in fresh local Python processes. These results are directional; the exact Render plans remain the authoritative benchmark environment.

| JADE case | `gap=0` | `gap=0.01` | Observed result |
|---|---:|---:|---|
| P=2, forced-open `wh-11` and `wh-14` | ~3.5 s | ~0.7 s | Same objective; large speedup |
| P=2, free warehouse choice | ~17.3 s | ~17.0 s | Same objective/facilities; effectively no speedup |

The forced-open run also showed approximately:

- 70 MB peak RSS for the Python process;
- 55 MB peak RSS for the CBC child.

Those memory figures are not additive guarantees and were measured outside Render/Linux, but they show why Node plus three Python/CBC pairs can have little headroom on a 512 MB service.

A follow-up run instrumented the `LpProblem.solve` boundary in one persistent Python process:

| JADE case | Gap | Total `solve_jade` | Inside `prob.solve()` | Outside CBC boundary |
|---|---:|---:|---:|---:|
| P=2, forced-open `wh-11` and `wh-14` | 0 | 3.568 s | 3.277 s | 0.291 s |
| P=2, forced-open `wh-11` and `wh-14` | 0.01 | 0.631 s | 0.391 s | 0.240 s |
| P=2, free warehouse choice | 0 | 16.472 s | 16.235 s | 0.237 s |
| P=2, free warehouse choice | 0.01 | 16.076 s | 15.831 s | 0.245 s |

Module import took approximately 0.365 s in that local environment. For the measured free-choice case, about 98.5% of `solve_jade` time was inside `prob.solve()`. The earlier hypothesis that PuLP model construction dominates the ~17-second runtime is therefore rejected for this case. A persistent Python worker can remove some process/import overhead, which matters proportionally more for ~1-second models, but it is not the primary lever for the ~16-second free-choice case.

CBC log inspection further showed:

- the root LP/continuous objective was reached at about 0.81–0.82 s;
- the initial integer state had 24 unsatisfied integer variables;
- CBC then spent most of the run in root-node feasibility passes, cuts, heuristics, and simplex work;
- the first integer incumbent appeared only at about 15.89 s (`gap=0`) and 15.43 s (`gap=0.01`);
- both runs reported 12,847 iterations and zero enumerated branch-and-bound nodes, then completed almost immediately after finding the incumbent.

This explains why a 1% tolerance did not help: CBC had no incumbent on which to apply the relative-gap stopping rule until nearly the end. The next solver experiments for this shape should prioritize formulation strength, symmetry reduction, MIP starts, and carefully benchmarked CBC heuristic/cut settings. This is a finding for one representative free-choice shape, not proof that every free-choice edit behaves identically.

### 4.3 Correctness gap

JADE currently returns envelope `status: "optimal"` after every non-infeasible solve, while exposing the PuLP status only as `quality`. That is insufficient when:

- CBC stops at a requested relative gap;
- CBC reaches the time limit with an incumbent;
- CBC returns another non-optimal termination state.

Before enabling approximate solving, the result contract must include:

- truthful status, such as `optimal`, `feasible_within_gap`, `time_limited`, `infeasible`, or `error`;
- termination reason;
- requested relative gap;
- achieved gap and best bound where CBC/PuLP makes them reliably available;
- incumbent objective;
- solve time and configured deadline.

Do not tell students a result is proven-optimal merely because a feasible incumbent was returned.

### 4.4 Benchmark matrix required before changing `gap`

Build a representative scenario corpus covering:

- forced-open and free-choice JADE;
- P changes;
- demand edits;
- warehouse activation/force/inactivation;
- plant-product capability edits;
- added plants, warehouses, and customers;
- customer exclusion;
- distance overrides;
- known difficult but supported combinations.

Run each at `gap = 0`, `0.005`, `0.01`, and `0.02`, with repeated executions. Record:

- p50/p95 wall and CPU time;
- **Python/model-build/result time vs time inside `prob.solve()`, split explicitly** for every scenario family. The reviewed free-choice case is CBC-bound, but the representative corpus must show whether that generalizes.
- CBC phase data where practical: time to root relaxation, first incumbent, best bound, node/iteration counts, and termination condition. A relative gap can help only after an incumbent and bound exist.
- peak RSS for Python and CBC;
- objective delta from gap 0;
- chosen facilities and assignments;
- feasibility and termination reason;
- determinism across repeats.

Keep `e2e_accuracy.py` expectations unchanged. Add separate tests for approximate-mode status and metadata.

### 4.5 User-visible quality modes

Adopt a product-level quality-mode contract instead of changing the numeric gap silently:

- **Proven optimal** is the default and must only display that label when CBC termination proves optimality.
- **Quick** is an explicit opt-in mode, optionally controlled or disabled by an instructor/course policy.
- The UI shows the requested mode, actual termination status, runtime, incumbent objective, and gap/bound information when available.
- Quick mode uses benchmarked model/scenario policy rather than exposing an arbitrary raw gap as the primary student control.
- The UI must not promise that Quick is always faster; the reviewed free-choice case showed no meaningful improvement at `gap=0.01`.

The two measured cases do not justify saying a global default is wrong for “half” of all cases; they establish scenario dependence and the need for a broader corpus.

---

## 5. Corrected capacity math

### 5.1 Arrival rates

- Submitted peak: `2,500 / 3,600 = 0.694 jobs/s`.
- Warm-cache miss rate at 80%: `2,000 / 3,600 = 0.556 solves/s`.

Assuming approximately one CPU core per active CBC solve:

`offered_cores = solve_arrival_rate_per_second × mean_service_time_seconds`

Initial worker estimate:

`workers = ceil(offered_cores / target_utilization)`

Use 65–70% as an initial utilization target, then replace formula-only sizing with measured queue simulation and the chosen completion SLO.

### 5.2 Steady-rate starting points

| Case | Mean solve time | Offered load at 2,000 solves/hour | Initial workers at ≤70% utilization |
|---|---:|---:|---:|
| Random model mix | 1.8 s | 1.00 core | 2 |
| All-JADE, assumed tuned case | 3 s | 1.67 cores | 3–4 |
| All-JADE, previous exact case | 13 s | 7.22 cores | 11 |
| All-JADE, local free-choice observation | 17 s | 9.45 cores | 14 |

For a cold cache in which all 2,500 submissions reach CBC, multiply offered load by `1.25`.

### 5.3 Synchronized class burst illustration

If 50 jobs arrive together, ignoring startup and runtime variance:

| Configuration | Approximate time to drain all 50 |
|---|---:|
| 3-second solves, 3 workers | 51 s |
| 3-second solves, 4 workers | 39 s |
| 3-second solves, 6 workers | 27 s |
| 13-second solves, 11 workers | 65 s |
| 17-second solves, 14 workers | 68 s |

The product must choose whether p95 completion should be around 30, 60, or 90 seconds before the final peak worker count is selected.

---

## 6. Ranked design gaps

| Severity | Gap | Impact | Required response |
|---|---|---|---|
| Critical | All-heavy goal was sized using a random mix. | Under-capacity during the contracted case. | Size all-JADE separately and guarantee that case. |
| Critical | Job payload exists only in process memory. | Queued work is not restart-safe or worker-readable. | Persist immutable validated payload and versions. |
| Critical | Gap speedup was generalized from one shape. | Worker count and cost can be materially wrong. | Benchmark the real edit distribution. |
| Critical | Approximate/time-limited result can be labelled optimal. | Incorrect product claim and teaching output. | Add truthful termination/quality semantics. |
| High | Proposed scaled service mixes Standard and Pro instances. | Invalid Render topology. | Use identical instances within a worker service. |
| High | Cache has no single-flight behavior. | Cold identical requests duplicate CBC compute. | Coalesce by normalized input hash. |
| High | Queue/backpressure is process-local, limit 30. | Rejects a 50-user burst and fails under horizontal API scaling. | Use durable global admission signals. |
| High | No leases, retries, or graceful drain. | Jobs can be stranded or duplicated on deploy/scale-down. | Add at-least-once lease protocol and SIGTERM handling. |
| High | Job completion unconditionally updates the scenario result. | An older slow solve can overwrite a newer solve. | Publish through revision/latest-job compare-and-set. |
| Medium | No cache/history retention policy. | Unbounded Postgres growth and maintenance overhead. | Add pinned/dynamic classes, TTL, cleanup, and archival. |
| Medium | Polling and connection multiplication omitted. | DB load can become the next bottleneck. | Tune polling, indexes, and pool sizes. |
| Medium | No SLO or production-plan load test. | “Burst-safe” cannot be proven. | Define gates and test on Render. |

---

## 7. Recommended B2 architecture

### 7.1 Components

1. **API service**
   - authenticates and authorizes;
   - validates/prechecks scenario inputs;
   - computes the normalized solver hash;
   - serves cache hits immediately through a completed job record;
   - atomically persists an immutable job request;
   - applies global and per-user admission policy;
   - serves job status/history.

2. **Postgres durable queue**
   - stores immutable executable input snapshots;
   - coordinates claims through short transactions;
   - stores leases, attempts, completion, and history;
   - contains the shared exact result cache and single-flight record.

3. **Solver worker service**
   - polls/claims work;
   - runs one CBC solve per one-core instance initially;
   - refreshes or owns a bounded lease;
   - writes results idempotently;
   - drains on SIGTERM.

4. **Scheduled scaler**
   - pre-scales workers before class;
   - reduces capacity only after the durable queue and active leases drain;
   - records every requested and observed scaling change.

### 7.2 Durable job fields

At minimum, persist:

- `model_id`;
- immutable validated `input_snapshot` JSONB;
- normalized `inputs_hash`;
- dataset version and solver-code version/hash;
- `status`: queued/running/succeeded/failed/cancelled;
- `attempt_count` and `max_attempts`;
- `claimed_by` and `lease_expires_at`;
- optional heartbeat timestamp;
- queued/started/finished timestamps;
- execution deadline / requested solver time limit;
- failure category and bounded error detail;
- scenario revision or latest-job token;
- result summary and, if appropriate, reference to the shared cached result.

Capture the snapshot in the same logical enqueue operation as the job. Workers must never execute whatever inputs happen to be on the scenario row later.

### 7.3 Claim and recovery protocol

Worker loop:

1. Begin a short transaction.
2. Select one eligible job ordered by queue policy using `FOR UPDATE SKIP LOCKED`.
3. Mark it running, increment attempts, assign the worker, and establish a lease.
4. Commit before spawning Python/CBC.
5. Execute outside the database transaction.
6. Complete only if the worker still owns the lease.
7. Requeue an expired lease up to `max_attempts`; dead-letter or fail permanently afterward.

Never hold a row lock or transaction for the solve duration.

The current startup reaper that marks every running job failed is incompatible with multiple workers. One worker starting must not fail another worker's active jobs. Lease expiry replaces the global reaper.

### 7.4 Indexes and pooling

Add and verify with `EXPLAIN` under representative volume:

- partial claim index such as `(queued_at, id) WHERE status = 'queued'`;
- running-job lease-expiry index;
- composite user/scenario/time index matching solve-history queries;
- retention/cleanup indexes.

Explicitly configure small connection pools per worker. The current Node `pg` default can allocate ten connections per process; horizontal workers multiply that count even though a worker needs few concurrent DB operations.

### 7.5 Graceful shutdown and subprocess containment

On Render `SIGTERM`:

1. stop claiming jobs;
2. finish the current job or safely release/requeue it;
3. close Postgres and telemetry clients;
4. exit before `maxShutdownDelaySeconds`.

Set the shutdown delay to cover the supported solve deadline plus cleanup, within Render's maximum. Ensure timeout and shutdown terminate the entire Python/CBC process group, not only the immediate Python parent.

### 7.6 Scenario consistency

Job completion must use compare-and-set semantics:

- update `scenarios.result` only if the completing job is still the scenario's latest requested job, or its recorded scenario revision/hash still matches;
- retain an older successful job in history without allowing it to replace the newer scenario output.

---

## 8. Admission control and fairness

Replace local `queue.length` with durable signals:

- total queued count;
- oldest queued age;
- estimated wait using current worker count and recent service-time distribution;
- per-user queued and running jobs;
- optionally per-model queue pressure.

Recommended starting policy:

- one running job per user;
- a small bounded queued count per user;
- return the existing job for the same user/scenario/hash while it is active;
- perform exact-cache lookup before rejecting for capacity;
- reject based on estimated wait/SLO rather than an arbitrary depth of 30;
- include a meaningful `Retry-After` based on queue state.

FIFO alone can let one user monopolize the class. Use fair/round-robin claiming by user or quotas tight enough to preserve fairness.

---

## 9. Cache and compute avoidance

### 9.1 Prevent cold-cache stampedes

`onConflictDoNothing` protects the cache row but not compute. Add:

1. cache lookup during enqueue/admission;
2. one active solve-run per normalized hash;
3. multiple job/scenario subscribers to that run, or equivalent single-flight behavior;
4. a cache recheck after winning the compute claim.

This is a cheaper and more dependable first optimization than a broad parameter sweep.

### 9.2 Normalize exact keys

Hash the normalized effective solver payload rather than raw scenario JSON:

- sort arrays whose domain semantics are sets or maps;
- apply defaults before hashing;
- remove fields ignored by the selected model;
- normalize safe numeric representations where domain rules permit;
- retain model, dataset, and solver-code versions.

This converts semantically identical inputs into exact hits without treating genuinely different optimization problems as equivalent.

### 9.3 Storage and retention

A reviewed forced-open JADE result serialized to approximately 56 KB of compact JSON. If 120,000 unique results were cached each month, raw result data alone would be about 6.8 GB/month before Postgres JSONB/TOAST, index, vacuum, and backup overhead.

Use two cache classes:

- **Pinned:** known course baselines and deliberately precomputed assignment variants.
- **Dynamic:** arbitrary student results with expiry/LRU-style cleanup, `last_accessed_at`, and hit counts.

Define solve-history retention or archival separately. Precomputation remains useful only for known low-dimensional assignment axes; it cannot replace the worker path for arbitrary edits.

### 9.4 Future solver reuse experiments

After correctness and queue work:

- test CBC warm starts from a prior incumbent for near-identical inputs;
- measure whether long-lived Python workers materially reduce process/import cost, especially for the ~1-second models; the local import measurement was ~0.365 s, not a demonstrated steady 0.5–1 s saving;
- do not prioritize prebuilding invariant model components for the measured free-choice case, where only ~0.24 s was outside `prob.solve()`; reconsider it only if the wider corpus identifies build-heavy shapes;
- test formulation strengthening, symmetry reduction, MIP starts, and selected CBC heuristic/cut configurations against the same correctness corpus;
- retain process isolation if reuse introduces state leakage or reliability risk.

---

## 10. Render topology and corrected costs

### 10.1 Platform constraints

- Every instance of one scaled Render service uses the same compute plan.
- Manual instance scaling is available on all workspaces.
- CPU/memory autoscaling requires a Pro workspace and reacts to utilization, not queue age.
- Scaled service compute is prorated by active instance time.
- A worker is a long-running service; it does not automatically scale to zero.

Current published service prices used for this estimate:

| Plan | ID | CPU | RAM | Monthly price |
|---|---|---:|---:|---:|
| Starter | `0.5c-512mb` | 0.5 | 512 MB | $7 |
| Standard | `1c-2g` | 1 | 2 GB | $25 |
| Pro | `2c-4g` | 2 | 4 GB | $85 |
| Pro Plus | `4c-8g` | 4 | 8 GB | $175 |
| Pro Max | `4c-16g` | 4 | 16 GB | $225 |
| Pro Ultra | `8c-32g` | 8 | 32 GB | $450 |

Current Postgres 256 MB pricing used here is $10/month. Reconfirm all prices at implementation time.

Sources: [Render scaling](https://render.com/docs/scaling), [compute plans](https://render.com/docs/compute-plans), and [pricing](https://render.com/pricing).

### 10.2 Recommended initial topology

- `nos-api`: keep Starter if a decoupled API load test passes; otherwise use Standard.
- `nos-solver-worker`: Standard `1c-2g`, concurrency 1 per instance initially.
- one worker off-peak; scheduled peak count determined by the benchmark and SLO.
- retain `nos-postgres` only if DB load/storage testing passes.
- static site unchanged.
- use Render cron or another trusted scheduler to call the Render scale API; schedules are UTC.

Do not model one Standard base worker plus three Pro burst workers as one service. If separate services were used, each would need its own lifecycle and baseline/suspension cost model, which adds unnecessary complexity.

### 10.3 Revised monthly estimate

Assumptions:

- 730 hours/month;
- 60 peak hours/month;
- API Standard: $25/month;
- one Standard worker always present: $25/month;
- additional identical Standard workers only during peak hours;
- Postgres 256 MB: $10/month;
- scheduler minimum: approximately $1/month;
- static site free/excluded;
- workspace fee, bandwidth, logs, and taxes excluded.

Formula:

`total ≈ API + 25 × [1 + (peak_workers - 1) × 60/730] + Postgres + scheduler`

| Peak workers | Intended case | Worker cost | Approximate all-in monthly total |
|---:|---|---:|---:|
| 4 | 3-second JADE, ordinary bursts | ~$31 | **~$67** |
| 6 | 3-second JADE, lower queue latency | ~$35 | **~$71** |
| 11 | 13-second all-JADE | ~$46 | **~$82** |
| 14 | 17-second all-JADE | ~$52 | **~$88** |

If the API safely remains on its current $7 Starter plan, subtract approximately $18. If Render autoscaling is selected instead of scheduled manual scaling, include the Pro workspace fee unless already paid.

This changes the earlier conclusion: under scheduled scaling, moving from four to eleven peak Standard workers changes the estimate by only about $15/month. Gap tuning can still be a major latency and capacity lever, but it is not automatically the largest monthly cost lever. Correct decoupling, scheduled scaling, duplicate suppression, and data retention are more decisive.

This table compares worker counts **within the B2 topology**. It does not establish a `$15–60/month` difference between tune-in-place A and B2. A defensible A-to-B2 comparison requires measured A plan size, peak scaling duration, B2 baseline worker policy, workspace fees, and database/storage effects.

### 10.4 Scheduling behavior

- Pre-scale 5–10 minutes before class.
- Do not scale down at the exact class end; wait for queue and active leases to drain.
- Make scaler commands idempotent and observable.
- Keep a one-worker floor unless the product explicitly allows off-hours jobs to wait.
- Handle missed schedules, holidays, timezone/DST changes, and Render API failures.

---

## 11. Alternatives evaluated

### A. Tune in place

**Evaluation:** acceptable only as a short benchmark step, not the production strategy.

Benefits:

- least engineering work;
- can establish real per-plan CPU/memory measurements.

Problems:

- solver CPU competes with HTTP and polling;
- in-memory queue is restart-sensitive;
- vertical capacity runs 24/7 unless manually changed;
- scaling API instances does not create a coherent durable queue;
- deploy/restart behavior remains unsafe.

### B2. Durable Postgres queue + scheduled identical workers

**Evaluation:** recommended default.

Benefits:

- lowest architectural change from the existing app while becoming restart-safe;
- no additional Redis/Key Value service required at this scale;
- independent API and solver capacity;
- predictable scheduled cost;
- Postgres `SKIP LOCKED` is appropriate once payloads, leases, indexes, and retries are designed correctly.

Risks:

- more engineering than originally estimated;
- application owns queue semantics, retries, leases, fairness, and observability;
- Postgres plan and pool configuration must be load-tested.

### C. Precompute parameter sweeps

**Evaluation:** optional add-on only.

Use it for known assignment baselines or constrained low-dimensional axes. Arbitrary demand, facility, capability, node, and distance edits make the state space combinatorial. The earlier estimate of reducing real work to about 500/hour is a hypothesis, not a capacity guarantee.

Implement semantic exact normalization and single-flight first.

### D. Render Workflows

**Evaluation:** worth a bounded proof-of-concept.

Workflows offers managed queuing, per-run instances, retries, observability, and scale-to-zero execution. At 120,000 real solves/month × three CPU-seconds, the solver represents about 100 CPU-hours. Current Flex CPU pricing puts that component near $20/month, plus RAM, startup/import work, retained task state, API, database, bandwidth, and any workspace fee.

Constraints and unknowns:

- Hobby allows 50 root task triggers/minute; submitted average is already 41.7/minute and synchronized bursts can exceed it.
- Pro raises the trigger limit but adds a workspace fee unless already in use.
- each run starts a fresh environment, making Python/data import part of latency and cost;
- validate that the native runtime packages and runs CBC correctly;
- map Workflow run IDs, retries, cancellation, and idempotent completion to app job history;
- SDK/API maturity creates platform coupling.

Sources: [Render Workflows](https://render.com/docs/workflows) and [Workflow limits/pricing](https://render.com/docs/workflows-limits).

Use the same JADE corpus and burst test for B2 and Workflows. Compare p50/p95 end-to-end latency, retry behavior, operational burden, and full cost.

---

## 12. SLOs, observability, and cost controls

### 12.1 Proposed starting SLOs for approval

- p95 enqueue latency: <500 ms;
- p95 queue wait during stated peak: <30 s, or another explicit classroom threshold;
- p95 end-to-end completion: set per model and quality mode;
- enqueue rejection rate under contracted load: <1%;
- execution failure rate, excluding mathematical infeasibility: <1%;
- zero permanently stuck jobs after restart/deploy/scale-down tests;
- zero stale-job overwrites of newer scenario results.

### 12.2 Required metrics

Label by model and quality mode where applicable:

- submitted, admitted, rejected, cancelled, retried, failed, succeeded;
- durable queue depth and oldest queued age;
- queue wait and solve runtime percentiles;
- active workers and leases;
- cache hit/miss, coalesced followers, and cold duplicate solves;
- termination reason and requested/achieved gap;
- CPU, memory/OOM, worker restarts, and CBC timeouts;
- Postgres active connections, query latency, storage growth, and cleanup volume;
- cost per successful solve and projected month-end cost.

### 12.3 Cost guardrails

- explicit maximum worker count;
- per-user admission limits;
- maximum acceptable oldest-job age;
- alert on unexpected worker count outside class windows;
- alert on cache/storage growth and database connection pressure;
- monthly budget alert including workspace fee and bandwidth, not only compute.

---

## 13. Production approval gates

Before production sizing is approved:

1. Benchmark the representative scenario corpus on the exact Render plans under consideration.
2. Run 50 synchronized submissions with warm and cold caches.
3. Sustain 2,500 submissions/hour and verify the selected SLO.
4. Test the separately approved burst curve; do not conflate it with hourly peak.
5. Perform a three-hour soak or a validated accelerated equivalent.
6. Kill/restart workers during jobs and prove lease recovery and bounded retries.
7. Scale down during active jobs and prove graceful drain/recovery.
8. Submit two revisions of the same scenario with inverted completion order and prove the old result cannot overwrite the new one.
9. Submit many identical cold-cache requests and prove only one CBC computation occurs per normalized hash.
10. Measure actual Postgres bytes per job/result and exercise cleanup.
11. Verify API polling and pool connections do not exhaust the database.
12. Recalculate worker count and cost from measured p95 service time and approved SLO.

---

## 14. Phased rollout

### Phase 0 — measurement and correctness

- define the classroom completion SLO;
- build the scenario benchmark corpus;
- fix truthful solver termination/quality status;
- measure CPU/RSS on candidate Render plans;
- reproduce the `prob.solve()` boundary and CBC-phase measurements (§4.2–§4.4) on the candidate Render plans;
- measure a warm/persistent Python worker on fast models and representative JADE cases, treating it as a startup optimization unless new profiles show otherwise;
- approve the Proven-optimal/Quick product contract and the instructor/course policy for Quick mode.

### Phase 0.5 — synthetic production-plan gate (before heavy queue engineering)

B2's dominant incremental cost may be engineering rather than Render compute, so validate the capacity need before committing the full queue build. However, §10.3 does **not** establish the cost difference between A and B2, and the actual student cohort must not be used as the first failure detector.

Run a synthetic load test on the exact production plan using tune-in-place A plus the Phase 0 correctness fix. Replay the representative all-JADE distribution, 50 synchronized submissions, sustained 2,500 submissions/hour, cold/warm cache states, and a three-hour soak or validated accelerated equivalent. Test Proven optimal by default and Quick only where its policy has been approved; do not size the system from the fast forced-open case alone. Measure API latency, queue wait, solve completion, RSS/OOM behavior, failures, restarts, stale publication, and connection pressure.

Use two separate gates:

1. **Capacity gate:** proceed to the worker split when A misses the approved SLO or lacks safe headroom at contracted load. If A passes, it may support a deliberately limited pilot while measurements continue.
2. **Reliability/isolation gate:** proceed to the durable queue whenever restart-safe queued payloads, independent API availability, recoverable retries, or safe horizontal scaling are required, even if raw CPU throughput on A passes. Those are architectural benefits that a capacity-only pilot cannot prove unnecessary.

The 50×50 target remains the design contract unless the product owner explicitly reduces it. Lower observed pilot traffic can refine forecasts but does not invalidate a stated peak-capacity requirement.

### Phase 1 — durable queue

- persist immutable solve payload/version metadata;
- implement claims, leases, attempts, recovery, and indexes;
- add latest-job/scenario-revision publication guard;
- implement SIGTERM drain and process-group termination;
- configure explicit DB pools.

### Phase 2 — compute avoidance

- cache lookup before admission;
- semantic exact payload normalization;
- active-run single-flight/coalescing;
- pinned/dynamic cache retention and cleanup.

### Phase 3 — Render worker split

- deploy identical Standard workers;
- start at concurrency 1 per instance;
- pre-scale to the benchmarked class count;
- add safe drain-aware scale-down;
- keep API Starter only if the decoupled load test passes.

### Phase 4 — optimize from production evidence

- tune worker count and possibly plan size;
- evaluate gap modes, warm starts, persistent Python, and targeted precompute;
- run the Workflows proof-of-concept if still attractive;
- update costs from real utilization and cache-hit data.

---

## 15. Reviewed decision log

| # | Decision | Rationale |
|---|---|---|
| R1 | API/solver separation remains the target architecture. | Prevents CPU-bound solves from starving request handling and permits independent scaling. |
| R2 | The existing queue must become a durable payload + lease design. | Current queued inputs live only in API memory. |
| R3 | Guaranteed sizing uses all-JADE. | Matches the stated usage; random mix is a secondary forecast. |
| R4 | A universal three-second JADE runtime is not assumed. | The reviewed free-choice case did not improve materially at 1% gap. |
| R5 | Proven optimal is the default; any non-zero-gap behavior is exposed as an explicit Quick mode. | It changes the optimality guarantee, is scenario-dependent, and needs truthful result metadata; course/instructor policy may disable it. |
| R6 | One worker service uses one plan and scheduled instance counts. | Render does not mix plans within a scaled service. |
| R7 | Single-flight and semantic exact hashing precede broad precompute. | They remove guaranteed waste without approximating distinct problems. |
| R8 | Cache and solve history require retention. | Projected volume can add multiple GB/month. |
| R9 | Render Workflows gets a bounded comparison, not an assumed adoption. | Potentially lower idle cost, but rate limits, CBC packaging, latency, and maturity must be proven. |
| R10 | No production worker count until SLO and Render-hosted load tests pass. | Capacity depends on the real runtime distribution and acceptable queue delay. |
| R11 | Use a synthetic production-plan gate, not a live cohort as the first capacity test. | Contracted load and failure modes can be exercised safely before students depend on the system. |
| R12 | Treat capacity and queue reliability as separate B2 adoption gates. | Durable payloads, leases, retries, and API/solver isolation can be required even if tune-in-place passes a throughput test. |

---

## 16. Open product and operational decisions

- Is the contracted workload truly all-JADE, or is there a known model distribution?
- Is 2,500/hour the peak or the average within class?
- What p95 completion time is acceptable to students?
- Which courses/instructors enable Quick mode, and what benchmarked gap/time-limit policy should each supported scenario family use?
- Can off-hours jobs wait, or must one worker remain continuously available?
- How long must arbitrary result-cache entries and solve history be retained?
- Are class schedules fixed enough for manual scheduled scaling, including holidays and timezone changes?
- Is the workspace already on Pro, changing the incremental economics of autoscaling and Workflows limits?
- Does the team prefer owning a modest Postgres queue or accepting additional Render Workflows coupling?

Until these decisions and the production-plan tests are complete, the defensible planning range is approximately **$67–88/month** for API Standard + scheduled Standard workers + current Postgres + scheduler, excluding workspace fees and variable platform charges. The lower end assumes validated ~3-second JADE service; the upper end covers the observed 13–17-second all-JADE cases with substantially more peak workers.

---

## 17. Second-pass review addendum and disposition

Findings from an independent re-review of §§1–16, followed by measured resolution. Two consequential claims were code-verified true; the three proposed edits were accepted, narrowed, or rejected as described below and folded into the main design.

### 17.1 Verified against source (2026-09-20)

- **Infra plan (§3.2) — confirmed.** `render.yaml`: `nos-api plan: starter` (0.5c/512 MB), `nos-postgres plan: basic-256mb`. The earlier "256 MB API" statement conflated the DB and web-service plans.
- **Optimistic status label (§4.3) — confirmed.** `solve.py:1186` returns `_envelope("optimal", status_str, ...)`: the envelope `status` field is **hardcoded `"optimal"`** on every non-infeasible path, and the real CBC status (`status_str = LpStatus[prob.status]`) is passed only into `quality`. A gap-stopped or time-limited incumbent is therefore reported as proven-optimal. This blocks approximate mode until fixed and is a teaching-integrity issue, not merely cosmetic.

### 17.2 Corrections the reviewed doc makes that this addendum endorses

- The invented 4–5× burst multiplier is correctly replaced by the contracted-peak vs synchronized-burst distinction (§2.1).
- "Gap tuning is the biggest cost lever" is correctly disproven (§10.3): under scheduled scaling, 4→11 peak workers is ~$15/month, so worker count is cheap; decoupling, scheduling, single-flight, and retention dominate cost. Gap remains a latency/capacity lever, not the primary cost lever.
- "Queue already exists, just add `SKIP LOCKED`" is correctly rejected (§3.3): the executable payload lives in the API's `pendingJobs` map, not the `solve_jobs` row; the durable-queue lift is larger than first stated.

### 17.3 Review recommendations and response

1. **Root-cause the free-choice runtime — accepted and measured.** Boundary instrumentation found 16.235 s of a 16.472 s `gap=0` run, and 15.831 s of a 16.076 s `gap=0.01` run, inside `prob.solve()`. Only ~0.24 s was outside the CBC boundary; module import was ~0.365 s. CBC logs showed root relaxation by ~0.82 s but no incumbent until ~15.4–15.9 s, after extensive root-node work, with 12,847 iterations and zero enumerated nodes. The warm/prebuilt-model hypothesis is therefore rejected as the primary answer for this measured case. Warm Python remains a modest startup optimization; the next free-choice experiments are formulation strength, symmetry, MIP starts, and CBC settings (§4.2, §4.4, §9.4).

2. **Engineering cost and a pre-build gate — partially accepted and corrected.** B2 is a material engineering project, so Phase 0.5 now requires a synthetic load test on the exact production plan before the full build. The `$15–60/month` A-to-B2 delta was not established: §10.3 compares peak worker counts within B2, not A against B2. A real student cohort is not an acceptable first load test, and lower pilot usage does not erase the 50×50 contract. Capacity and reliability are now separate gates because durable payloads, leases, retries, and API isolation can justify B2 even when raw throughput passes (§10.3, §14).

3. **Make quality mode explicit — accepted with guardrails.** Proven optimal remains the default. Quick is an explicit, truthfully labelled mode that can be governed by course/instructor policy and uses benchmarked scenario-family policy instead of presenting a raw numeric gap as the primary student control (§4.5, R5). The phrase “wrong for half the cases” is removed because two samples cannot establish prevalence. The UI also cannot promise Quick is faster for every scenario.

### 17.4 Minor findings and response

- **Spawn/import overhead:** the local module import measured ~0.365 s, while model/result work outside `prob.solve()` measured ~0.24–0.29 s. This supports measuring a warm worker for fast models but does not establish a steady 0.5–1 s saving on Render. Capacity must use end-to-end service time measured on the target plan, so the illustrative drain table remains approximate.
- §9.3's 6.8 GB/month is a pre-compression upper bound (JSONB TOAST compresses); acknowledged in-line, retention still mandatory.
- All-JADE guaranteed sizing (R3) contradicts the stated random mix, but §10.3 shows it is ~$15/month insurance — cheap; keep it.

### 17.5 Net

Endorse B2 as the target direction. The document is design-ready, but production implementation and worker count remain gated by Phase 0 correctness work, the full representative benchmark corpus, the Phase 0.5 synthetic production-plan test, and SLO approval. The local timing split resolves the immediate warm-worker hypothesis; it does not replace Render-hosted benchmarks.
