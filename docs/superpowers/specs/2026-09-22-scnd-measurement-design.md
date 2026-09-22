# SCND Scaling — Measurement Spec

**Date:** 2026-09-22
**Status:** Design spec for review. One of the two deferred successors named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 (the other is Scaling, `2026-09-22-scnd-scaling-design.md`).
**Branch:** `scnd-scaling`.

**Goal:** Produce the *evidence* that sizes and de-risks the Scaling build — capacity ceiling, real bottleneck, per-solve cost, cache-hit reality, and the compute-topology comparison — **without a real cohort**, by driving synthetic load and instrumenting real solves. Feeds the Scaling spec.

**Honest scope boundary:** measurement answers **capacity/reliability/cost at a given input rate+mix** ("does the arch survive X solves/hr, where does it break, what does a solve cost"). It does **NOT** validate demand — the 50×50 rate and 20/60/20 cache split are *inputs you choose*, not findings. Ground those inputs with an instructor estimate; then test a *range* so the answer is bounded, not a single guessed point.

---

## 1. Components

### 1.1 Solver microbenchmark (per-model, in-process)
A Python harness (`artifacts/api-server/src/solver/tests/benchmark/`) running each live model at `gap ∈ {0, 0.005, 0.01, 0.02}`, **N≥30** reps (raw rows + aggregates separately). Records, per run: wall + CPU time; **build-time vs inside-`prob.solve()`** split; CBC phase data (root-LP, first-incumbent, node/iteration counts, terminating reason via B1's `cbc_termination`); **per-process peak RSS** (`psutil`/cgroup/`/usr/bin/time -v` — define which); objective delta vs gap 0; determinism. Provenance per row (SHA, solver hash, dataset/fixture version, PuLP/CBC version, plan/region, cache state, ordinal, timestamp). Output → `docs/superpowers/metrics/solve-benchmark.<date>.{csv,json}`.
- **Re-measure at `gap=0`** the forced-open JADE regime (the spike's 0.6–3.5 s vs the parent's ~13 s claim); record the *frequency* of the slow free-choice regime, not just its time. Note: teaching datasets prove optimal in <0.2 s — expect most solves in the fast regime.

### 1.2 Synthetic load harness ("mimic the cohort")
An HTTP load generator (k6 / Artillery / Node driver) against a deployed environment (temporary/off-hours Render for real 512 MB-Linux numbers; local first for shakeout). It:
- registers **50 real authenticated sessions** (not one shared account — auth/session cost is part of the load),
- drives `POST /scenarios/:id/solve` to a target **2,500 solves/hr** (and multiples for burst), polls at the real **800 ms** cadence,
- uses a **programmable input mix** so the cache-hit ratio is a knob, run across profiles: **contracted** (20% exact-hit / 80% unique CBC miss), **cold-unique burst** (50 distinct hashes), **cold-identical burst** (50 × one hash — exposes duplicate compute before single-flight), **warm all-hit**,
- and both a **frequency-neutral model mix** and an **all-JADE** run.
- Captures: enqueue latency, queue-wait + **end-to-end** p50/p95, **429 rate** (`QUEUE_DEPTH_LIMIT`), failure rate, instance CPU/RSS/OOM, **Postgres active connections**, and **max in-memory queue depth + admissions-past-limit** (the TOCTOU overshoot).
- Includes a **restart-mid-load** reliability probe (redeploy while jobs queued → any stuck?) and a **3-hour soak** (or a documented arrival/service-preserving equivalent — *not* a compressed-arrival shortcut).

### 1.3 Experiments (decision records)
- **MIP-start-from-cache:** seed CBC with a prior/near-identical solve's open set — does it collapse the free-choice tail *and* speed near-dups? Full characterization across near-dup families (demand/capacity/force/distance). Confirm PuLP-warm-start actually works with the pinned CBC; correctness = feasible + same objective within tolerance (multiple optima ≠ bug). → `docs/superpowers/specs/2026-09-2x-mipstart-experiment.md`.
- **Warm/persistent Python worker:** measure the per-solve overhead (spawn + PuLP import + dataset load, ~0.365 s observed) a persistent worker removes; material for ~1 s models, not the tail.

### 1.4 Topology comparison (the sizing decision — §16.5/Q7)
Run the same JADE corpus + burst against each candidate on its **real Render plan**, compare end-to-end SLO / safe CPU-RSS headroom / restart behavior / scale-window billing / idle cost / operational complexity:
- **high-core vertical tune-in-place** (≤ **12 CPU** ceiling — Render web/worker max is `12c-96g`, NOT 16/32 which are Postgres; so a single instance may not clear the all-JADE guarantee — it's a comparator, not an assumed pass),
- **one vertically-sized dedicated worker service**,
- **horizontal fleet** (≤ **100 same-plan instances/service**), 1–small-N CBC per instance.
Output: the selected topology + worker count, derived from **measured `gap=0` p95 service time** at both the representative rate and the **guaranteed sustained 2,500 cold-miss/hr** rate.

## 2. SLOs to ratify (feed the pilot gate)
Queue-wait p95 < 30 s; **end-to-end split by cache state** (cache-hit < ~2 s; CBC-miss: fast models < 10 s, JADE free-choice < 60 s); enqueue p95 < 500 ms; rejection < 1%; failure (excl. infeasible) < 1%; zero permanently-stuck jobs on restart; a max solve deadline + timeout/no-incumbent rate. Report **cost per successful solve**, projected 3-hr-window + 20-class-day/month cost, and idle cost.

## 3. What it can / cannot conclude
**Can:** the current arch's throughput ceiling + exact bottleneck (CPU / event-loop / spawn / PG connections); whether *any* scaling is needed at plausible rates; the sizing inputs (per-solve service time, RSS, cost) for the Scaling build; topology winner.
**Cannot:** that students *will* generate 50×50 or a 20/60/20 mix — those remain assumed inputs. If the harness holds at plausible rates → **ship B and stop**; if it bends → the failure mode names the first Scaling lever.

## 4. Deliverables
Benchmark matrix + synthetic-load report (`docs/superpowers/metrics/`), the two experiment decision records, the topology-comparison decision, ratified SLOs. **No production infra is created as a committed change** (temporary/off-hours envs only). This spec is runnable **now** (no real cohort needed) and is the concrete de-risking step before Scaling.

---

## 5. Deep approval review (2026-09-22)

### 5.1 Decision

**REQUEST CHANGES — NOT APPROVED AS AN EXECUTABLE MEASUREMENT SPEC.**

The direction is sound: the sustained 2,500-submission/hour contract, a separate 50-request synchronized burst, the all-JADE cold-miss guarantee, cache-state separation, restart probe, three-hour soak, and cost-per-successful-solve objective are the right decision inputs. The following six gaps can still produce a false capacity pass, an unrepeatable topology decision, or an incomplete cost comparison. They must close before execution is approved.

### 5.2 Blocking findings

#### M-R1 — the topology comparison is circular and is not runnable now

Section 1.4 requires running a dedicated worker and a horizontal fleet on their real Render plans, but the Scaling successor is explicitly blocked until Measurement selects the topology and worker count. The repository currently defines only the inline `nos-api` solver service. Therefore the dedicated-worker and fleet candidates do not exist to measure, while §4 simultaneously claims this spec is runnable now and creates no committed production infrastructure.

**Required resolution:** define one non-circular sequence and the artifacts allowed at each step:

1. local harness shakeout;
2. post-Option-A tune-in-place baseline on the exact current Render plan;
3. analytical candidate sizing from measured service demand;
4. an explicitly authorized, disposable worker prototype with a named image/command, queue seam, plan IDs, provisioning owner, and teardown procedure; and
5. a full load gate on the selected topology.

Alternatively, make Measurement select only a provisional topology analytically and move empirical worker/fleet comparison to a post-build pilot gate. In either case, distinguish benchmark scaffolding from production Scaling implementation and state what may be committed.

#### M-R2 — capacity and reliability are incorrectly collapsed into one stop/build decision

Section 3 says that if the harness holds at plausible rates the program should “ship B and stop.” That does not follow from a capacity pass. The current queue and payload are process-local, and restart/deploy loss is already a known failure mode; this spec itself requires zero permanently stuck jobs after restart. A system can clear 2,500 submissions/hour and still fail the independent reliability/isolation gate.

**Required resolution:** produce two independent decisions:

- **Capacity gate:** whether the measured topology meets the ratified latency, rejection, resource-headroom, and cost limits.
- **Reliability/isolation gate:** whether queued payload durability, restart recovery, process containment, API availability, and safe ownership are adequate.

A capacity pass may avoid the Scaling capacity build. It must not waive Option A or any other reliability work when the reliability gate fails. Replace “ship B and stop” with this two-gate disposition.

#### M-R3 — the offered-load contract is not reproducible

“Target 2,500 solves/hr” does not say whether the driver is open-loop or waits for responses. A closed-loop driver can reduce offered load as latency rises and falsely report that an overloaded system passed. The document also leaves arrival distribution, outstanding-job behavior, cache priming/reset, near-duplicate construction, warm-up, run duration, seeds, and repetition count open.

**Required resolution:** define the sustained contract as an **open-loop 0.694 submissions/second for three hours**, independent of response time, and report achieved as well as intended arrival rate. Separately run an explicitly timed 50-request synchronized burst. State:

- whether a virtual student may have more than one outstanding job, plus an additional UI-faithful profile if the client enforces one-at-a-time behavior;
- exact arrival distributions, random seeds, warm-up and measurement windows, and repetitions;
- exact cache preparation and verification for 20% exact hits, 60% near-identical CBC misses, and 20% distinct inputs;
- cold-unique key construction that really produces 2,500 CBC misses/hour;
- cold-identical preparation that guarantees no prior cache entry; and
- how retries and `429 Retry-After` responses affect offered load and success accounting.

The 20/80 contracted profile is consistent with the parent 20/60/20 hypothesis only if the 80% unique-CBC portion is explicitly split into the 60% near-identical and 20% distinct populations.

#### M-R4 — the statistical design cannot support the claimed p95 or slow-regime frequency

`N≥30` makes a sample p95 approximately the second-largest observation and gives an unstable tail estimate. Repeating one scenario measures runtime noise, not how frequently the JADE free-choice slow regime occurs in the scenario population. “Frequency-neutral model mix” and the representative JADE corpus are also undefined.

**Required resolution:** publish a stratified corpus manifest covering model, forced-open/free-choice regime, and the named demand/capacity/force/distance edit families. Use either a materially larger fixed sample (approximately 200 or more independent observations per sizing cell) or a sequential stopping rule based on a predeclared confidence-interval width. Randomize run order; define warm-ups and outlier policy; and report raw data plus uncertainty for p50/p95, mean service demand, slow-regime frequency, failure/rejection rates, RSS, and objective delta. Repeated runs of the same input may quantify determinism and runtime variance, but must not be counted as independent evidence of regime frequency.

#### M-R5 — the SLOs are not yet executable pass/fail gates

Section 2 is explicitly “to ratify,” uses an approximate `~2 s`, and leaves the maximum solve deadline and timeout/no-incumbent threshold unnamed. Yet §1.4 requires these SLOs to choose the topology. Without exact thresholds and aggregation rules, the same result can be declared either a pass or a failure after the run.

**Required resolution:** ratify before the authoritative load run:

- exact cache-hit, fast-miss, and JADE free-choice end-to-end thresholds;
- the maximum solve deadline and permitted timeout/no-incumbent rate;
- whether percentiles are per run, pooled, or computed per model/cache profile;
- inclusion/exclusion of warm-up, setup, retries, rejected requests, and failed solves;
- the minimum safe CPU and memory headroom; and
- the pass rule across repeated runs, including whether every repetition or a confidence bound must meet the threshold.

The load report may compare alternative SLOs during exploration, but topology approval requires one predeclared gate.

#### M-R6 — environment isolation, observability, and cost accounting are insufficient for the promised conclusion

“Temporary/off-hours Render” permits an off-hours production test, which can pollute real users, jobs, cache, analytics, and cost evidence. Capturing only Postgres active connections cannot distinguish pool wait, slow queries, locks, storage pressure, or database saturation, and does not support the claim that Measurement identifies the **exact** bottleneck. Peak RSS is also left as an implementation choice, and the cost output has no dated price snapshot or allocation rule.

**Required resolution:**

- use an isolated Render environment with a separate database and cache namespace, synthetic identities, analytics/alert routing disabled or isolated, no production secrets beyond the minimum test credentials, and a named teardown owner;
- pin the application SHA, dataset, region, exact compute plan IDs, instance count, environment variables, database plan, and load-generator location/capacity;
- select one authoritative RSS method and capture both per-child peak RSS and aggregate instance RSS;
- add event-loop lag, CPU throttling, active Python/CBC process count, pool checked-out/waiting counts, query latency, lock waits, database CPU/memory/storage growth, network errors, instance restarts, and load-generator saturation;
- define cost per successful solve as total attributable test-window cost divided by terminal successful solves, while reporting rejected, failed, timed-out, and cached requests separately; and
- report a dated all-in model containing workspace fee, always-on API, idle/base worker, burst workers, Postgres, scheduler, storage/backups, bandwidth, and temporary measurement infrastructure, with sensitivity to cache-hit rate and free-choice frequency.

Do not use a Render preview environment to validate autoscaling behavior: preview environments use the autoscaling minimum rather than exercising the production autoscaling policy. Manual fixed-instance comparisons remain valid when explicitly configured.

### 5.3 Platform facts independently validated

- The stated **12-CPU** ceiling for web services/private services/background workers is correct; `12c-96g` is the largest current service plan. The old 16/32-CPU values belong to other product tables, not service compute. See [Render compute plans](https://render.com/docs/compute-plans) and [current pricing](https://render.com/pricing).
- Render allows up to **100 instances per service**, every instance of a service uses the same compute plan, autoscaling requires a Pro-or-higher workspace, and scaled compute is prorated by the second. See [Render scaling](https://render.com/docs/scaling).
- Preview resources are billed like other resources; if autoscaling is configured, a preview uses the minimum instance count. See [Render preview environments](https://render.com/docs/preview-environments).

### 5.4 Re-approval checklist

- [ ] The measurement phases remove the Measurement↔Scaling circular dependency and name permitted disposable scaffolding.
- [ ] Capacity and reliability/isolation produce separate pass/fail decisions.
- [ ] The sustained test is open-loop at 0.694 submissions/s for three hours; the synchronized burst is a separate profile.
- [ ] Cache/input populations, arrival schedule, seeds, warm-up, repetitions, and retry accounting are deterministic and published.
- [ ] The corpus and sample-size/confidence rule support p95 and slow-regime-frequency claims.
- [ ] Exact SLOs, resource headroom, solve deadline, and repeated-run pass rule are ratified before the authoritative run.
- [ ] The isolated environment, telemetry set, price snapshot, cost allocation, and teardown procedure are defined.
- [ ] The final report records intended versus achieved arrival rate, raw rows, uncertainty, bottleneck evidence, per-gate verdicts, selected topology/worker count, and the dated all-in cost model.

Closing these items should make the spec approvable without expanding its product scope.
