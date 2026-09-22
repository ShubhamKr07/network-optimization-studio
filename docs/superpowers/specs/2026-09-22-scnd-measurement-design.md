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
