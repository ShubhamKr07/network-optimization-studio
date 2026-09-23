# SCND Scaling — Solver-Tier + Scheduled-Autoscale Spec

**Date:** 2026-09-22
**Status:** Design spec for review. The Scaling successor named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 ("B2 — durable isolated solver tier + pilot gate"). Direction inherited from the original brainstorm `2026-09-19-scnd-scaling-design.md` (Option B: split solver tier + scheduled autoscale ≈ $70/mo).
**Branch:** `scnd-scaling`.

**Goal:** Handle the contracted **50 users × 50 solves/hr, ≤3-hr class bursts, at low cost** by moving solves off the API's request path onto a **measurement-sized solver tier** that **scales up only for the class window** and back down after — decoupled, burst-safe, and cheap because it rents burst capacity ~60 hr/month, not 24/7.

**Hard dependencies (do not build ahead of these):**
- **Measurement spec** (`2026-09-22-scnd-measurement-design.md`) must have run: it supplies the **selected topology + worker count**, the measured **mean CPU service demand at the operating concurrency** (**not** p95 wall time — M-R8: queue stability depends on `arrival rate × mean CPU demand`; p95 validates the SLO, it never sizes the tier), per-solve RSS, and the cost model. Sizing here is otherwise a guess. **Measurement is itself now deferred until Option A ships** (decided 2026-09-22, review M-R1): its topology comparison needs a worker seam that only A's durable `solve_jobs` queue provides, and without that the two specs were each blocked on the other. Effective order: **A → Measurement → Scaling**.
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
- **Single-flight — wholly owned here (moved back from A, 2026-09-22, review A-R53).** It was briefly Option A's task A10. Across six approval rounds it produced **12 of that plan's 56 findings at a rising rate** — culminating in four CRITICALs in one round: three incompatible generation authorities, an ordering model provably incompatible with its own cursor invariant, a uniqueness exclusion that abandoned its own exactly-one-solve acceptance, and a deletion protocol FK actions cannot implement. It was removed from A rather than declared fixed.
  **This spec owns the whole protocol:** the active-run record on A6's composite hash, winner election, subscriber attachment and sealing, durable outcome, resumable fan-out, deletion/cancellation, and stale-owner takeover — built on **this spec's** multi-worker lease, which fleet-wide coalescing needs regardless.
  **Design constraints inherited from A's rounds, do not rediscover them:** election must use `ON CONFLICT` (an unhandled unique violation aborts the transaction); uniqueness scope must be an **immutable** key, never the mutable lease owner; the fan-out cursor must order by an explicit sequence, **not** `job_id`, if the winner is not processed in id order; the durable outcome must be persisted **before** fan-out, because `no_solution` is deliberately never cached and so the cache cannot serve as the recovery source; subscribers must be structurally unclaimable by the dispatcher; and `ON DELETE` actions cannot substitute for an explicit deletion transaction. See the A plan's A10 removal record and rounds 2–6 of its review record.
  **Sizing note:** at A's current `CONCURRENCY=3` a 50-student stampede costs about **two** redundant sub-second solves, because the first completion populates the cache for the queued remainder. Single-flight's value scales with worker count — which is precisely why it belongs here and not in the correctness contract.
- **Gap-tuning:** the original brainstorm's biggest cost lever — but the spike found teaching datasets prove optimal in <0.2 s, so gap-tuning's real payoff is likely small here; apply only if measurement shows a slow-regime tail worth cutting, as a per-scenario input (not a solver-math branch, hard rule #6).

## 4. Cost model (to be filled from measurement)

Frame per the original brainstorm (Render per-second billing; ~20 class-days × 3 hr = 60 peak-hr/month; shared Postgres ~$7–19/mo):
`total ≈ API(always-on) + base-worker(always-on) + Σ(burst-workers × 60hr) + Postgres + scheduler`.
The brainstorm's Option-B estimate was ≈ **$70/mo** (API Standard + 1 base worker + ~6 burst cores × 60 hr). **Recompute from measured mean CPU service demand + the selected topology** — **not from p95 service time** (measurement review M-R8: queue stability depends on `arrival rate × mean service demand`; sizing every request as a p95 case over-provisions, while a regime beyond p95 can dominate total compute and be missed). p95 validates the SLO, it does not size the tier. **Report both cost denominators** (per successful submitted job, and per successful CBC execution) per the Measurement spec §4. Report cost-per-successful-solve, peak-window cost, idle cost, and sensitivity to cache-hit rate + free-choice frequency. If measurement shows a single vertical box clears the load, the honest answer may be **"bump the instance + keep 24/7"** at lower operational cost than an autoscaled fleet.

## 5. Two-gate pilot verification (before real cohort)

Reuse the parent design's two independent gates:
- **Capacity gate:** the Measurement synthetic-load harness meets the ratified SLOs at the guaranteed rate on the selected topology.
- **Reliability gate:** A's restart-safety, owner-lease reclaim and no-orphan proof pass under load, **plus** this spec's own additions — multi-worker claim under `SKIP LOCKED` (no worker reaps a live worker's job at any worker count), bounded attempts/retry exhaustion, per-user fairness, and **fleet-wide single-flight**, whose full protocol is this spec's to build (§3).
Deliver a decision doc: per-gate pass/fail, the identified bottleneck, worker count + cost recomputed from **measured mean CPU service demand** (M-R8 again — "service time" here read as wall time, the quantity §4 already excludes). A capacity pass authorizes a bounded pilot; reliability failures block it.

## 6. Explicitly out of scope / deferred

- Splitting the dispatcher into a *separate service process* beyond the worker tier — only if evidence shows the API's own event loop is the bottleneck (parent P1.1 rule; none observed).
- Render Workflows as an alternative runtime — a bounded POC option (parent §11.D), not the baseline.
- Multi-region / read-replica DB scaling — not warranted at pilot scale.

## 7. Deliverables

Worker-tier implementation plan (a later `writing-plans` pass, sized by measurement), the scheduled-scaler + its runbook, the cost report, the two-gate pilot-verification doc. **Nothing here is built before Measurement runs and the cohort/load gate is cleared** — this spec is the *target*, deliberately not an executable plan until the evidence exists.

---

## Review disposition — deep approval review (2026-09-23)

**Decision: REQUEST CHANGES / not approved for implementation planning.** The direction is sound: measurement-led sizing, durable Postgres work, isolated solver compute, scheduled capacity and separate capacity/reliability gates are the right shape. The document is not yet a sufficient contract for the new distributed coordination and production transition it introduces. The findings below deliberately exclude end-user best/worst-case experience scenarios; they concern only the design and its approval conditions.

### Validated direction

- Size from measured mean CPU service demand and validate the SLO with observed tail latency; do not size from p95 wall time.
- Keep the API off the solver request path for a worker topology; use A's durable queue and ownership fencing rather than creating another queue.
- Use identical plans within a horizontally scaled service, with the selected topology and worker count determined by Measurement.
- Treat scheduled **manual** scaling, not reactive queue-depth autoscaling, as the primary cost control. Render supports manual scaling from 1 to 100 instances; its native autoscaling is a separate feature and requires a Pro-or-higher workspace. [Render scaling](https://render.com/docs/scaling)
- Preserve two independent gates: capacity evidence cannot waive a reliability failure.

### Blocking findings

| ID | Finding | Required correction before approval |
|---|---|---|
| **S-R1 — topology/build outcome is contradictory** | The goal requires a solver tier, §1 allows high-core tune-in-place, §4 allows a permanently enlarged vertical service, while the cohort/load gate says Scaling is not built if the current instance passes. The predecessor split ledger says worker isolation/reliability are mandatory regardless of topology. | Publish one Measurement-outcome matrix: existing API/no Scaling, vertical API, dedicated worker, or fleet; name the required artifact and pilot authority for each. Explicitly supersede the predecessor rule if a passing API permits no worker-tier build. Replace the undefined “ship B (+ A)” phrasing. |
| **S-R2 — API-to-worker dispatch cutover is absent** | A retains a recurring API dispatcher. A worker service that also claims `solve_jobs` races it unless the API is made enqueue/poll-only. The disposable Measurement seam is not a production rollout contract. | Define mutually exclusive `api_dispatch` and `worker_only` modes, strict startup validation, production cutover/rollback order, and a pre-run proof that API active-solver count is zero for worker topologies. |
| **S-R3 — automatic retry is not a protocol yet** | `worker_id` and bounded `attempts` do not decide when an attempt is consumed, which failures retry, how a stale lease requeues, or how an old owner is prevented from publishing. Scaling changes A's deliberate “terminal failure, no automatic retry” rule. | Specify schema and state transitions for retryable/non-retryable failure classes, attempt increment, database-clock backoff/jitter, `next_attempt_at`, lease expiry, `claim_generation` fencing, recovery-identity mismatch, exhaustion/dead-letter outcome, and exactly-once terminal publication. |
| **S-R4 — single-flight is still an outline** | The document correctly lists constraints from A10's removal, but does not define the active-run/subscriber schema, state machine, transaction boundaries, cancellation/deletion, retry interaction, or acceptance invariants. It nevertheless makes fleet-wide single-flight a reliability-gate requirement. | Add a normative single-flight sub-spec (or approved section): immutable key, winner election, subscriber attachment/sealing, ordered durable fan-out, persisted outcome before fan-out, takeover, cancellation/deletion, and tests proving exactly one CBC execution and exactly-once terminalization. |
| **S-R5 — scale-in is race-unsafe and Render control is underspecified** | “Drain queue + leases, then scale down” has a TOCTOU gap: a job can arrive or be claimed after the check. The Render scale API is asynchronous, and manual instance counts are ignored when native autoscaling is enabled. | Define desired-capacity/draining state; admission and claim behavior during scale-in; worker `SIGTERM` drain/cancel behavior; reconciliation of requested, observed and ready claimant count; autoscaling-disabled assertion; API retry/429 handling; and tests for enqueue-at-drain-boundary and active-job scale-in. Workers must stop claiming, finish or safely interrupt work, close pools and exit within their configured shutdown budget. [Render graceful shutdown](https://render.com/docs/deploys) |
| **S-R6 — scheduler/calendar contract is incomplete** | “cron/GitHub Action (or Render cron)”, UTC, DST and holidays leave the authority, locking, failure recovery and human override unspecified. | Select one controller; define the source calendar and IANA timezone, generated UTC occurrences, idempotency/overlap lock, credentials, retry/backoff, observed-count verification, alerting, manual override and holiday changes. |
| **S-R7 — database, admission and fairness are only named** | At fleet scale, polling and connection multiplication can exhaust Postgres before CBC capacity is exhausted. “Fair/round-robin” and “estimated wait” have no executable semantics. | Define the global connection budget (`API + workers × pool + reserve`), pool sizes, claim batch/poll cadence with jitter, supporting indexes, fairness algorithm/starvation bound, per-user queued/running caps, atomic cache/admission ordering, and the exact wait/`Retry-After` calculation. |
| **S-R8 — the gates validate the prototype, not clearly the shipped tier** | Measurement selects a topology before Scaling adds retries, fairness, single-flight, production dispatcher modes and the scaler. Those additions can change both capacity and failure behavior. | Require an authoritative post-build rerun on the final topology. The reliability suite must include dispatcher-mode enforcement, DB outage/pool exhaustion, retry exhaustion, missed scale-up/API failure, active-job scale-in, fairness/starvation, cold-identical coalescing, and deletion/cancellation during fan-out. State unambiguously that **both** gates plus MP-4 approval are required for a pilot. |

### Important corrections (not new platform scope)

- **Readiness-on-DB-failure needs worker semantics.** Render background workers have no inbound URL, so define startup failure, claim suspension, heartbeat observability and self-termination/backoff instead of implying an HTTP readiness check. [Render background workers](https://render.com/docs/background-workers)
- **Restore or explicitly rehome the predecessor's retention/index/bounds contract.** Cover queued/terminal jobs, active-run and subscriber rows, result cache, dead-letter rows, cleanup concurrency and storage growth. The predecessor assigned these to B2; they cannot disappear from its successor.
- **Cost remains evidence-driven.** Treat `$70/month` and the 1–3 minute boot estimate as historical hypotheses. The final model must charge measured provisioned-instance seconds, including pre-scale, drain delay, the one-worker floor, scheduler/workspace/database costs and failed scaling actions. A manual worker service cannot scale below one instance; an off-hours scale-to-zero option would need its own runtime and service-level contract.
- **Name A7 as an inherited safety dependency.** The predecessor originally assigned stale-result publication to B2, but A now owns the scenario latest-job/input-revision publication CAS. This spec should say it consumes that A7 guarantee and must not reimplement or weaken it.

### Re-approval checklist

- [ ] One outcome matrix reconciles no-build, vertical, dedicated-worker and fleet decisions with the predecessor ledger.
- [ ] Production worker-mode cutover prevents the API and worker tier from claiming concurrently.
- [ ] Retry/lease/fencing/exhaustion semantics are deterministic and tested.
- [ ] Single-flight has an approved schema, state machine and failure/cancellation protocol.
- [ ] Scheduled manual scaling has a safe drain/reconciliation contract and native autoscaling cannot override it.
- [ ] Calendar/controller, database budget, admission and fairness are executable contracts.
- [ ] The final built topology, not only its prototype, passes authoritative capacity and reliability evidence.
- [ ] Retention/bounds and A7 publication-CAS provenance are explicit.

When those items close, this design can proceed to its measurement-sized implementation-plan pass. No final instance count, plan ID, SLO value or price is requested here; those remain Measurement outputs.
