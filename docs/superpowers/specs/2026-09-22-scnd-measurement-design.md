# SCND Scaling — Measurement Spec

**Date:** 2026-09-22
**Status:** Design spec for review. One of the two deferred successors named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 (the other is Scaling, `2026-09-22-scnd-scaling-design.md`).
**Branch:** `scnd-scaling`.

**Sequencing (decided 2026-09-22, review M-R1): Measurement runs AFTER Option A ships.** The round-1 spec was circular — §1.4 required running a dedicated worker and a horizontal fleet on their real Render plans, but `render.yaml` defines only `nos-api` (web, `starter`) and `nos-studio`, so two of the three candidates did not exist; creating them contradicted both §4's "no production infra is created as a committed change" and the runnable-now claim, while Scaling was itself blocked until Measurement chose the topology. Deferring behind A dissolves it: **A's durable `solve_jobs` queue is the worker seam**, so a worker prototype becomes a thin consumer of an existing durable queue rather than speculative infrastructure.

**Consequence, stated plainly:** Measurement was the only workstream with no upstream blocker, and this decision parks it. The critical path is now **A3 + A14a (authorized) → AP-1 plan approval → A0…A14b → Measurement → Scaling.** Nothing in this spec is executable until A ships.

**Goal:** Produce the *evidence* that sizes and de-risks the Scaling build — capacity ceiling, real bottleneck, per-solve cost, cache-hit reality, and the compute-topology comparison — **without a real cohort**, by driving synthetic load and instrumenting real solves.

---

## 0. Approval checkpoints — STOP and ASK (MP-1 … MP-4)

Same contract as the A plan's AP checkpoints: stop, ask verbatim, wait, record the answer in `docs/CHANGELOG-implementation.md` with date and decider. Never infer; never treat one approval as covering another.

| ID | Trigger | Question | Options |
|---|---|---|---|
| **MP-1** | Before the authoritative load run (M-R5) | "These are the exact SLO thresholds, aggregation rules and headroom limits the topology decision will be judged against: \<table\>. Ratify them as the predeclared gate?" | Ratify · Ratify with changes · Defer the run |
| **MP-2** | Before provisioning the isolated measurement environment (M-R6) | "Measurement needs an isolated Render environment — separate database, separate cache namespace, synthetic identities, analytics/alerts disabled, named teardown owner, dated cost snapshot. Approve provisioning and its teardown plan?" | Approve · Approve with a different environment · Hold |
| **MP-3** | Before the disposable worker prototype (M-R1) | "The worker prototype consumes A's durable queue: \<named image/command, queue seam, plan IDs, provisioning owner, teardown procedure\>. Authorize it as disposable, non-production scaffolding?" | Authorize · Authorize with changes · Analytical sizing only |
| **MP-4** | When both gates have verdicts (M-R2) | "Capacity gate: \<verdict\>. Reliability/isolation gate: \<verdict\>. What is built?" | Build Scaling as sized · Capacity work only · Reliability work only · Neither — record and stop |

## 1. Components

### 1.1 Solver microbenchmark (per-model, in-process)

A Python harness (`artifacts/api-server/src/solver/tests/benchmark/`) running each live model at `gap ∈ {0, 0.005, 0.01, 0.02}`. Records per run: wall + CPU time; **build-time vs inside-`prob.solve()`** split; peak RSS; objective; termination evidence.

**Statistical design (M-R4) — the round-1 `N≥30` could not support its own claims.** A sample p95 from 30 observations is roughly the 29th value: a single tail draw, with no stability. Worse, repeating one scenario measures *runtime noise*, not **how often** the JADE free-choice slow regime occurs in the scenario population — two different quantities the round-1 spec conflated.

- **Stratified corpus manifest**, published before the run: model × regime (forced-open / free-choice) × edit family (demand / capacity / force / distance). "Representative JADE corpus" and "frequency-neutral model mix" are defined *by this manifest*, not by prose.
- **≥200 independent observations per sizing cell**, or a sequential stopping rule on a predeclared confidence-interval width — whichever is declared first. Randomized run order.
- **Determinism runs are labelled separately.** Repeated runs of the *same* input quantify runtime variance and are explicitly **not** counted as independent evidence of regime frequency.
- Declare warm-up and outlier policy. Report **raw rows plus uncertainty** for p50/p95, mean service demand, slow-regime frequency, failure/rejection rates, RSS, and objective delta.
- **Re-measure at `gap=0`** the forced-open JADE regime (the spike's 0.6–3.5 s vs the parent's ~13 s claim). Teaching datasets prove optimal in <0.2 s, so expect most solves in the fast regime — which is precisely why regime *frequency* must be measured, not assumed.

### 1.2 Synthetic load harness ("mimic the cohort")

An HTTP load generator (k6 / Artillery / Node driver) against the **isolated environment of §1.5**, never production. It registers **50 real authenticated sessions** (not one shared account — auth/session cost is part of the load) and polls at the real **800 ms** cadence.

**Offered load is open-loop (M-R3).** The round-1 "target 2,500 solves/hr" never said whether the driver waits for responses. A closed-loop driver reduces offered load as latency rises, so an overloaded system can silently report a pass.

- **Sustained profile: open-loop 0.694 submissions/second for three hours** (2,500/hr), issued on schedule **independently of response time**. Report **intended vs achieved** arrival rate; a shortfall invalidates the run rather than passing it.
- **Burst profile, run separately:** an explicitly timed **50-request synchronized burst**. Not blended into the sustained rate.
- State per profile: arrival distribution, **random seeds**, warm-up and measurement windows, run duration, repetition count.
- **Outstanding-job policy:** whether a virtual student may hold more than one in-flight job; plus a **UI-faithful profile** if the client enforces one-at-a-time.
- **Retry/rejection accounting:** how retries and `429 Retry-After` responses affect offered load and success accounting — stated before the run, not derived after it.

**Cache populations, prepared and verified (M-R3).** The round-1 "contracted 20% exact-hit / 80% unique CBC miss" only reconciles with the parent 20/60/20 hypothesis if the 80% is split:

| Population | Share | Preparation + verification |
|---|---|---|
| Exact cache hit | 20% | Pre-seeded and **verified present** before the window |
| Near-identical CBC miss | 60% | Named near-dup families (demand/capacity/force/distance); distinct hashes |
| Distinct inputs | 20% | Cold-unique key construction proven to yield real CBC misses |

Plus **cold-identical burst** (50 × one hash — exposes duplicate compute; requires a verified *absence* of any prior cache entry) and an **all-JADE** run for the cold-miss guarantee.

**Captured (M-R6) —** enqueue latency, queue-wait and **end-to-end** p50/p95, **429 rate** (`QUEUE_DEPTH_LIMIT`), failure rate, instance CPU/RSS/OOM, **max in-memory queue depth + admissions-past-limit** (the TOCTOU overshoot), plus: **event-loop lag, CPU throttling, active Python/CBC process count, pool checked-out/waiting counts, query latency, lock waits, database CPU/memory/storage growth, network errors, instance restarts, and load-generator saturation.** Round-1 captured only Postgres *active connections*, which cannot distinguish pool wait from slow queries, locks, storage pressure or DB saturation — and so could not support §3's "exact bottleneck" claim.

**RSS method:** one authoritative method, declared; capture **both per-child peak RSS and aggregate instance RSS**.

Includes a **restart-mid-load** reliability probe (redeploy while jobs queued → any stuck?) and a **3-hour soak** (or a documented arrival/service-preserving equivalent — *not* a compressed-arrival shortcut).

### 1.3 Experiments (decision records)

- **MIP-start-from-cache:** seed CBC with a prior/near-identical solve's open set — does it collapse the free-choice tail *and* speed near-dups? Characterized across the named near-dup families. Confirm PuLP warm-start actually takes effect.
- **Warm/persistent Python worker:** measure the per-solve overhead (spawn + PuLP import + dataset load, ~0.365 s observed) a persistent worker removes; material for ~1 s models, not the tail.

### 1.4 Topology comparison — post-A, on A's queue seam (M-R1)

Candidates, compared on end-to-end SLO / safe CPU-RSS headroom / restart behaviour / scale-window billing / idle cost / operational complexity:

- **high-core vertical tune-in-place** — Render's service ceiling is **12 CPU** (`12c-96g` is the largest current plan; the 16/32-CPU figures belong to other product tables, not service compute). A single instance may not clear the all-JADE guarantee: it is a comparator, not an assumed pass.
- **one vertically-sized dedicated worker service** — a **disposable prototype** consuming A's durable `solve_jobs` queue (**MP-3**), not new production infrastructure.
- **horizontal fleet** — up to **100 instances per service**, every instance on the same compute plan, 1–small-N CBC per instance.

**Platform constraints that bound the comparison:** autoscaling requires a **Pro-or-higher workspace**; scaled compute is prorated by the second. **Do not use a Render preview environment to validate autoscaling** — previews run at the autoscaling *minimum* instead of exercising the production policy. Manual fixed-instance comparisons in previews remain valid when explicitly configured.

**Output:** the selected topology + worker count, derived from **measured `gap=0` p95 service time** at both the representative rate and the **guaranteed sustained 2,500 cold-miss/hr** rate.

### 1.5 Isolated environment (M-R6)

Round-1's "temporary/off-hours Render" permitted an off-hours **production** test, which can pollute real users, jobs, cache, analytics and cost evidence.

- Isolated Render environment: **separate database, separate cache namespace**, synthetic identities, analytics/alert routing disabled or isolated, no production secrets beyond minimum test credentials, **named teardown owner** (**MP-2**).
- **Pinned and recorded:** application SHA, dataset, region, exact compute plan IDs, instance count, environment variables, database plan, and load-generator location/capacity.

## 2. SLOs — ratified before the authoritative run (M-R5)

Round-1 left these "to ratify" with an approximate `~2 s` and an unnamed solve deadline, while §1.4 required them to choose the topology — so the same result could be declared a pass or a failure after the fact. **The gate is predeclared via MP-1.** Exploration may compare alternatives; topology approval uses the one ratified gate.

Ratify exactly: cache-hit, fast-miss and JADE free-choice **end-to-end thresholds**; queue-wait p95; enqueue p95; **maximum solve deadline** and permitted **timeout/no-incumbent rate**; rejection and failure rates (failure excluding infeasible); **zero permanently-stuck jobs on restart**; **minimum safe CPU and memory headroom**; whether percentiles are **per run, pooled, or per model/cache profile**; inclusion/exclusion of warm-up, setup, retries, rejected requests and failed solves; and the **pass rule across repetitions** (every repetition, or a confidence bound).

*Round-1 starting proposals, carried forward for MP-1 to ratify or change:* queue-wait p95 < 30 s · cache-hit end-to-end < 2 s · fast-model CBC miss < 10 s · JADE free-choice < 60 s · enqueue p95 < 500 ms · rejection < 1% · failure < 1%.

## 3. Two independent gates — not one stop/build decision (M-R2)

Round-1 said that if the harness holds, **"ship B and stop"**. That does not follow from a capacity pass. The queue and payload are process-local today and restart/deploy loss is a known failure mode — this spec itself requires zero permanently-stuck jobs after restart. A system can clear 2,500 submissions/hour and still fail reliability.

- **Capacity gate:** does the measured topology meet the ratified latency, rejection, resource-headroom and cost limits?
- **Reliability/isolation gate:** are queued-payload durability, restart recovery, process containment, API availability and safe ownership adequate?

A capacity pass may avoid the Scaling **capacity** build. **It never waives Option A or any other reliability work when the reliability gate fails.** Disposition is **MP-4**.

**Can conclude:** the architecture's throughput ceiling and the *exact* bottleneck (now supported by §1.2's telemetry set); whether any scaling is needed at plausible rates; sizing inputs (service time, RSS, cost); the topology winner.
**Cannot conclude:** that students *will* generate 50×50 or a 20/60/20 mix — those remain assumed inputs, and the harness tests the assumption's consequences, never its truth.

## 4. Cost model (M-R6)

**Cost per successful solve = total attributable test-window cost ÷ terminal successful solves**, with rejected, failed, timed-out and cached requests reported **separately** rather than folded in.

Report a **dated all-in model**: workspace fee, always-on API, idle/base worker, burst workers, Postgres, scheduler, storage/backups, bandwidth, and the temporary measurement infrastructure itself — with sensitivity to **cache-hit rate** and **free-choice frequency**. Prices carry the date they were captured.

## 5. Deliverables

Benchmark matrix + synthetic-load report (`docs/superpowers/metrics/`), the two experiment decision records, the topology-comparison decision, the ratified SLO gate, and the dated cost model. **No production infra is created as a committed change** — the worker prototype is disposable scaffolding under MP-3 with a named teardown owner.

The final report records: **intended versus achieved arrival rate**, raw rows, uncertainty, bottleneck evidence, per-gate verdicts, selected topology and worker count, and the dated all-in cost model.

---

## Review disposition — deep approval review (2026-09-22)

All 6 findings accepted. One product-owner sequencing decision. Verbatim review text: committed at `1faef78`.

| Finding | Disposition | Landed in |
|---|---|---|
| M-R1 topology comparison circular, not runnable now | Accepted; **decided: Measurement runs after Option A ships**, whose durable queue provides the worker seam. Prototype is disposable scaffolding under MP-3 | Header, §1.4, MP-3 |
| M-R2 capacity and reliability collapsed into one decision | Accepted; "ship B and stop" removed, replaced by two independent gates with MP-4 disposition | §3 |
| M-R3 offered-load contract not reproducible | Accepted; **open-loop 0.694/s for 3 h**, separate timed burst, seeds/windows/repetitions declared, 80% split into 60/20, retry and 429 accounting fixed in advance | §1.2 |
| M-R4 statistics cannot support p95 or regime frequency | Accepted; stratified corpus manifest, ≥200 observations per cell or a predeclared stopping rule, randomized order, determinism runs labelled separately | §1.1 |
| M-R5 SLOs not executable pass/fail gates | Accepted; exact list to ratify, round-1 values demoted to proposals, gate predeclared via **MP-1** | §2 |
| M-R6 isolation, observability and cost accounting insufficient | Accepted; isolated environment with teardown owner, pinned config, one RSS method, full telemetry set, cost definition and dated price snapshot | §1.2, §1.5, §4 |

**Platform facts from §5.3 folded into the body rather than kept as an appendix:** the 12-CPU service ceiling, 100 instances per service with a uniform plan, autoscaling requiring a Pro-or-higher workspace, per-second proration, and preview environments running at the autoscaling minimum (so unusable for autoscale validation).

## Author responses (kept for later review)

- **M-R1 — accepted; the circularity was real and structural, not a wording problem.** Verified `render.yaml` defines only `nos-api` (web, `starter`) and `nos-studio`: two of §1.4's three candidates had no existence to measure, and manufacturing them contradicted both §4 and the runnable-now claim, while Scaling waited on the very decision that required them. Of the three ways out, the product owner chose **deferring behind Option A**, which is the only one that removes the circularity at its source rather than working around it — A's durable `solve_jobs` queue *is* the worker seam, so the prototype becomes a thin consumer of existing infrastructure. **Recorded cost, since it is not free:** Measurement was the only workstream with no upstream blocker, and this parks it behind a plan currently blocked on AP-1. Only A3 and A14a remain executable today.
- **M-R2 — accepted; the inference was simply invalid.** "Harness holds → ship B and stop" treats a capacity result as evidence about reliability. The spec contradicted itself in the same breath by requiring zero permanently-stuck jobs after restart — a reliability assertion — while offering to stop on capacity grounds alone. A system can clear 2,500 submissions/hour and still lose every queued job on deploy, which is exactly today's production behaviour.
- **M-R3 — accepted; open-loop versus closed-loop is the finding that could have invalidated the whole exercise.** A closed-loop driver throttles itself as latency rises, so the system under test never sees the contracted arrival rate and reports a pass it did not earn. Everything else in this finding is the same class: unstated seeds, windows, repetitions and retry accounting let the run be interpreted after the fact. The profile arithmetic was also genuinely inconsistent — 20/80 and the parent's 20/60/20 only reconcile once the 80% is split, which round 1 never said.
- **M-R4 — accepted, and it identifies a conflation I would defend nowhere.** `N≥30` puts the sample p95 at about the 29th observation: one tail draw. Beyond sample size, the design asked one corpus to answer two different questions — how long a solve takes, and how often the slow regime occurs — and repeating a single scenario answers only the first. Determinism runs are now labelled as such and explicitly barred from counting as frequency evidence.
- **M-R5 — accepted.** An unratified SLO that is nonetheless an input to the topology decision is a gate that can be moved after seeing the result. Round-1's values are demoted to proposals and the ratification is now a named checkpoint that must clear *before* the authoritative run.
- **M-R6 — accepted.** "Temporary/off-hours Render" quietly permitted testing against production, contaminating real users, jobs, cache, analytics and the cost evidence the spec exists to produce. The telemetry point is equally sharp: §3 promised the *exact* bottleneck while §1.2 captured only Postgres active connections, which cannot separate pool wait from slow queries, locks or storage pressure. The preview-environment warning is a genuine trap — previews run at the autoscaling minimum, so a preview-based autoscale test would have measured the wrong thing while appearing to work.

**Cross-cutting note.** Against the A plan's taxonomy, this review is mostly **compression** (M-R4, M-R5, M-R6: a topic named where a decision was needed) plus one **composition** failure (M-R1: two documents each waiting on the other). The A-plan rules apply unchanged — treat any bullet listing *what to decide* rather than *the decision* as open, and check cross-document references actually resolve. Worth noting M-R1 is the same shape as A-R31's circular gate matrix: a dependency written as a guard that reads as a deadlock. That has now happened twice across two documents, so it is a pattern to check for deliberately, not a one-off.
