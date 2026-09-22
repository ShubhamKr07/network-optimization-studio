# SCND Scaling — Solver-Tier + Scheduled-Autoscale Spec

**Date:** 2026-09-22
**Status:** Design spec for review. The Scaling successor named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 ("B2 — durable isolated solver tier + pilot gate"). Direction inherited from the original brainstorm `2026-09-19-scnd-scaling-design.md` (Option B: split solver tier + scheduled autoscale ≈ $70/mo).
**Branch:** `scnd-scaling`.

**Goal:** Handle the contracted **50 users × 50 solves/hr, ≤3-hr class bursts, at low cost** by moving solves off the API's request path onto a **measurement-sized solver tier** that **scales up only for the class window** and back down after — decoupled, burst-safe, and cheap because it rents burst capacity ~60 hr/month, not 24/7.

**Hard dependencies (do not build ahead of these):**
- **Measurement spec** (`2026-09-22-scnd-measurement-design.md`) must have run: it supplies the **selected topology + worker count**, the measured `gap=0` p95 service time, per-solve RSS, and the cost model. Sizing here is otherwise a guess.
- **Option A** (`2026-09-22-scnd-correctness-A-full-contract.md`) provides the reliability substrate this tier builds on: durable `solve_jobs` payloads (`input_snapshot`/`model_id`), boot recovery of queued rows, the atomic `queued`→`running` CAS claim, ownership-checked completion, **a minimal owner heartbeat/expiry lease** (`claim_generation`/`owner_heartbeat_at`), the fd3 protocol, process-group supervision, composite cache identity, and the staged rollout.
- **What this spec adds on top** (decided 2026-09-22, reviews A-R2/A-R17/A-R36): `worker_id`, bounded `attempts` and **all automatic retry policy**, `FOR UPDATE SKIP LOCKED` polling, per-user fairness, connection-pool sizing, backpressure/admission, and readiness-on-DB-failure. **A performs no automatic retry at all** — an ambiguous crash there ends in an honest terminal failure the student retries by hand, so the first automatic retry in this system is introduced *here*, together with the attempt bound that makes it safe. Scaling **extends** A's lease rather than replacing its recovery semantics — A's reclaim predicate is already liveness-based (stale heartbeat), which is correct for any worker count, so there is no single-instance assumption left to unwind. Don't duplicate A's queue; extend it.
- **Why A already owns a lease.** Render web-service deploys are **zero-downtime unless a persistent disk is attached** (`render.yaml` attaches none); health checks only decide when the new revision becomes eligible for traffic. Render starts healthy new instances, switches traffic, then drains old ones within `maxShutdownDelaySeconds` (range 1–300, default 30; A14 sets it explicitly). So two process generations overlap on every deploy even at one instance, and a configuration assertion can never establish that a prior owner is dead. A therefore had to ship liveness evidence regardless of this spec, and that primitive is the one this tier's multi-worker claim builds on. *(Corrected per review A-R28 — the earlier wording wrongly attributed the overlap to `healthCheckPath`.)*
- **Cohort/load gate:** justified only once measurement (or a real cohort) shows capacity/cost pressure at plausible rates. If the current single instance clears the load in measurement, **this spec is not built** — ship B (+ A if reliability warrants) and stop.

---

## 1. Architecture

- **API service** (unchanged role): authenticates, validates, enqueues to the durable `solve_jobs` queue (A), serves polls. No solving on the request path.
- **Solver worker tier** (new): pulls jobs from A's durable `solve_jobs` queue via `FOR UPDATE SKIP LOCKED` under **this spec's** lease/attempt protocol (extending A's CAS claim), runs `solve.py` under A's process-group supervision, writes results through A's composite-versioned cache.
- **Compute topology = measurement-selected** (§1.4 of the Measurement spec): high-core vertical (≤12 CPU), one dedicated worker, or a horizontal fleet (≤100 same-plan instances). **This spec does not pre-decide it** — it consumes the measurement decision.
- **Scheduled scaler:** scales the worker tier up **before** the class window and down **after the queue + active leases drain** — the primary cost lever (pay burst ~60 hr/month, not 730).

## 2. Scheduled autoscale (the cost lever)

- Render has **no native queue-depth autoscale** (utilization-based autoscale needs a Pro workspace and reacts to CPU, not queue age). Use a **scheduled scaler**: a cron/GitHub-Action (or Render cron) calling the Render API to set the worker instance count — **UTC schedule**, pre-scale 5–10 min before class, scale down only after drain proof.
- Keep a **1-worker floor** off-peak (handles the distinct-trickle) unless the product accepts off-hours waits.
- Handle missed schedules, holidays, DST, and Render API failures; commands idempotent + observable; alert on unexpected worker count outside class windows.
- **Cold-start note:** a scaled-up worker pays a container boot (~1–3 min); pre-scale accordingly so the first class solves aren't delayed.

## 3. Backpressure, single-flight, gap-tuning

- **Backpressure:** admission by durable queue signals (total queued, oldest-queued age, estimated wait, per-user in-flight) — replace the current process-local `QUEUE_DEPTH_LIMIT`; reject on estimated-wait/SLO with a meaningful `Retry-After`; fair/round-robin per user so one student can't monopolize.
- **Single-flight — cross-instance half only.** A10 already ships single-flight **within one instance** (active-run record on A6's composite hash, winner election, subscriber attachment, stale-owner recovery via `claim_generation`). What A explicitly does not do is coordinate across instances: with a second worker, each solves independently. This spec extends A10's active-run record with the lease protocol so the class-start stampede fix (50 students on the assigned baseline = 1 solve, not 50) holds fleet-wide.
- **Gap-tuning:** the original brainstorm's biggest cost lever — but the spike found teaching datasets prove optimal in <0.2 s, so gap-tuning's real payoff is likely small here; apply only if measurement shows a slow-regime tail worth cutting, as a per-scenario input (not a solver-math branch, hard rule #6).

## 4. Cost model (to be filled from measurement)

Frame per the original brainstorm (Render per-second billing; ~20 class-days × 3 hr = 60 peak-hr/month; shared Postgres ~$7–19/mo):
`total ≈ API(always-on) + base-worker(always-on) + Σ(burst-workers × 60hr) + Postgres + scheduler`.
The brainstorm's Option-B estimate was ≈ **$70/mo** (API Standard + 1 base worker + ~6 burst cores × 60 hr). **Recompute from measured p95 service time + the selected topology.** Report cost-per-successful-solve, peak-window cost, idle cost, and sensitivity to cache-hit rate + free-choice frequency. If measurement shows a single vertical box clears the load, the honest answer may be **"bump the instance + keep 24/7"** at lower operational cost than an autoscaled fleet.

## 5. Two-gate pilot verification (before real cohort)

Reuse the parent design's two independent gates:
- **Capacity gate:** the Measurement synthetic-load harness meets the ratified SLOs at the guaranteed rate on the selected topology.
- **Reliability gate:** A's restart-safety, owner-lease reclaim, no-orphan proof and instance-scoped single-flight pass under load, **plus** this spec's own additions — multi-worker claim under `SKIP LOCKED` (no worker reaps a live worker's job at any worker count), bounded attempts/retry exhaustion, per-user fairness, and fleet-wide single-flight once A10's unique key drops `claim_generation`.
Deliver a decision doc: per-gate pass/fail, the identified bottleneck, worker count + cost recomputed from measured service time. A capacity pass authorizes a bounded pilot; reliability failures block it.

## 6. Explicitly out of scope / deferred

- Splitting the dispatcher into a *separate service process* beyond the worker tier — only if evidence shows the API's own event loop is the bottleneck (parent P1.1 rule; none observed).
- Render Workflows as an alternative runtime — a bounded POC option (parent §11.D), not the baseline.
- Multi-region / read-replica DB scaling — not warranted at pilot scale.

## 7. Deliverables

Worker-tier implementation plan (a later `writing-plans` pass, sized by measurement), the scheduled-scaler + its runbook, the cost report, the two-gate pilot-verification doc. **Nothing here is built before Measurement runs and the cohort/load gate is cleared** — this spec is the *target*, deliberately not an executable plan until the evidence exists.
