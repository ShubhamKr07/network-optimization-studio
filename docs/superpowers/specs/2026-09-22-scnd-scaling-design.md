# SCND Scaling — Solver-Tier + Scheduled-Autoscale Spec

**Date:** 2026-09-22
**Status:** **REQUEST CHANGES — not approved for implementation planning.** The deep approval review of 2026-09-23 (S-R1…S-R8 + four important corrections) is folded into the body below; the review text itself is preserved verbatim in commit `02d105f`, and the per-finding record is §11. Every finding is accepted and corrected in text, but **two blockers are not closable by writing** and hold the status: **SP-1** (may a capacity-passing API authorize a real cohort with no worker isolation — a reversal of a locked decision) and the **unconfirmed Postgres connection ceiling** (§3.2, §10). Approval follows those answers, not this document.
The Scaling successor named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 ("B2 — durable isolated solver tier + pilot gate"). Direction inherited from the original brainstorm `2026-09-19-scnd-scaling-design.md` (Option B: split solver tier + scheduled autoscale ≈ $70/mo).
**Branch:** `scnd-scaling`.

**Goal:** Handle the contracted **50 users × 50 solves/hr, ≤3-hr class bursts, at low cost** by moving solves off the API's request path onto a **measurement-sized solver tier** that **scales up only for the class window** and back down after — decoupled, burst-safe, and cheap because it rents burst capacity ~60 hr/month, not 24/7.

**Program state (as of 2026-09-23 — S-R1):**
- **Bundle B is executed**, not a future option. B1–B7 are on `scnd-scaling` (`f215832..a5f0c16`): the truthful `solutionStatus`/`terminationReason` contract from captured CBC evidence, the OpenAPI/Zod read-path legacy-unverified guard, the Workspace rendering, and the QA spec. Any sentence in this document that treats "ship B" as a remaining choice is stale; the remaining choice is how much of **A** and of **this spec** is justified.
- **Option A is in progress**, not pending. A0, A1, A2, A3, A14a, A14b have landed on `scnd-correctness-A`. A2 in particular already ships the recurring bounded dispatcher scan, the atomic CAS claim, the owner lease (10 s heartbeat / 60 s stale threshold, DB-clock-authoritative), ownership-checked completion, two-phase boot recovery, and SIGTERM drain. **This changes what is left to specify here** — several items the predecessor ledger assigned to B2 (§13.1 rows 12.2 partial, 12.3, 12.4, 12.6) are now A's, shipped, and must be consumed rather than restated.
- **Measurement is in the pipeline**, gated behind A per M-R1. Its plan (`plans/2026-09-22-scnd-measurement-plan.md`) is written and approved through MP-4; nothing in it executes until A ships.

**Hard dependencies (do not build ahead of these):**
- **Measurement spec** (`2026-09-22-scnd-measurement-design.md`) must have run: it supplies the **selected topology + worker count**, the measured **mean CPU service demand at the operating concurrency** (**not** p95 wall time — M-R8: queue stability depends on `arrival rate × mean CPU demand`; p95 validates the SLO, it never sizes the tier), per-solve RSS, and the cost model. Sizing here is otherwise a guess. **Measurement is itself now deferred until Option A ships** (decided 2026-09-22, review M-R1): its topology comparison needs a worker seam that only A's durable `solve_jobs` queue provides, and without that the two specs were each blocked on the other. Effective order: **A → Measurement → Scaling**.
- **Option A** (`2026-09-22-scnd-correctness-A-full-contract.md`) provides the reliability substrate this tier builds on: durable `solve_jobs` payloads (`input_snapshot`/`model_id`), boot recovery of queued rows, the atomic `queued`→`running` CAS claim, ownership-checked completion, **a minimal owner heartbeat/expiry lease** (`claim_generation`/`owner_heartbeat_at`), the fd3 protocol, process-group supervision, composite cache identity, and the staged rollout.
- **A7's publication CAS is an inherited safety guarantee, consumed not reimplemented** (added per the review's fourth important correction). The predecessor ledger assigned stale-result publication to B2 (§13.1, item 12.6); A now owns it. A1 persists `solve_jobs.enqueued_solve_input_revision` at enqueue inside the enqueue transaction, and A7's publication CAS tests a completed job's stored value against the scenario's **current** `solve_input_revision`. This spec's retry protocol (§3.1) and its worker tier **must not weaken that predicate** — in particular a requeued attempt carries the *original* `enqueued_solve_input_revision` forward unchanged, so a retry of a job whose inputs have since moved on still fails the CAS and still does not publish. Retry must never be a path that resurrects a stale result.
- **What this spec adds on top** (decided 2026-09-22, reviews A-R2/A-R17/A-R36): `worker_id`, bounded `attempts` and **all automatic retry policy**, `FOR UPDATE SKIP LOCKED` polling, per-user fairness, connection-pool sizing, backpressure/admission, and readiness-on-DB-failure. **A performs no automatic retry at all** — an ambiguous crash there ends in an honest terminal failure the student retries by hand, so the first automatic retry in this system is introduced *here*, together with the attempt bound that makes it safe. Scaling **extends** A's lease rather than replacing its recovery semantics — A's reclaim predicate is already liveness-based (stale heartbeat), which is correct for any worker count, so there is no single-instance assumption left to unwind. Don't duplicate A's queue; extend it.
- **Why A already owns a lease.** Render web-service deploys are **zero-downtime unless a persistent disk is attached** (`render.yaml` attaches none); health checks only decide when the new revision becomes eligible for traffic. Render starts healthy new instances, switches traffic, then drains old ones within `maxShutdownDelaySeconds` (range 1–300, default 30; A14 sets it explicitly). So two process generations overlap on every deploy even at one instance, and a configuration assertion can never establish that a prior owner is dead. A therefore had to ship liveness evidence regardless of this spec, and that primitive is the one this tier's multi-worker claim builds on. *(Corrected per review A-R28 — the earlier wording wrongly attributed the overlap to `healthCheckPath`.)*
- **Cohort/load gate:** justified only once measurement (or a real cohort) shows capacity/cost pressure at plausible rates. The outcome is **not binary** — see the outcome matrix in §1.1, which replaces the old "this spec is not built — ship B (+ A) and stop" sentence (S-R1).

---

## 1. Architecture

- **API service** (unchanged role): authenticates, validates, enqueues to the durable `solve_jobs` queue (A), serves polls. No solving on the request path.
- **Solver worker tier** (new): pulls jobs from A's durable `solve_jobs` queue via `FOR UPDATE SKIP LOCKED` under **this spec's** lease/attempt protocol (extending A's CAS claim), runs `solve.py` under A's process-group supervision, writes results through A's composite-versioned cache.
- **Compute topology = measurement-selected** (§1.4 of the Measurement spec): high-core vertical (≤12 CPU), one dedicated worker, or a horizontal fleet (≤100 same-plan instances). **This spec does not pre-decide it** — it consumes the measurement decision.
- **Scheduled scaler:** scales the worker tier up **before** the class window and down **after the queue + active leases drain** — the primary cost lever (pay burst ~60 hr/month, not 730).

### 1.1 Measurement-outcome matrix (S-R1)

The contradiction the review found is real and was mine: the goal sentence assumes a worker tier, §4 contemplates a permanently enlarged vertical service, and the cohort/load gate said "not built." Those are three different outcomes stated as if they were one. They are separated here, and each row names its required artifact and what it authorizes.

The predecessor split ledger (`2026-09-20-scnd-scaling-phase0-design.md` §13.1, Q2) says: *"Worker isolation + B2 reliability remain mandatory regardless of topology; B2 must land before any real cohort pilot."* **That rule is not superseded here** — a deliberate divergence from S-R1's requested correction, which was to "explicitly supersede the predecessor rule if a passing API permits no worker-tier build." Read precisely, the rule binds the **real-cohort pilot**, not every build, so rows O1–O2 below are compatible with it *as long as they do not authorize a real cohort* and no supersession is needed to publish this matrix. That leaves exactly one live conflict — whether a cohort may run on a capacity-passing API with no isolation. It is a reversal of a decision locked **before A existed**, when the API had no durable queue, no lease and no drain; A has since shipped all three, which is new evidence but not a mandate. It is escalated as **SP-1** rather than resolved by the author who would benefit from resolving it.

| # | Measurement outcome | What gets built | Required artifact | Pilot authority |
|---|---|---|---|---|
| **O1** | Existing API instance clears the guaranteed load with headroom | Nothing in this spec. A ships; B is already shipped | Measurement decision doc recording headroom + the cost of doing nothing | **None from this document.** A real cohort pilot on a non-isolated API tier contradicts the ledger's "isolation mandatory" rule → **SP-1** |
| **O2** | A larger single API instance clears it (vertical, ≤ 12 CPU plan ceiling) | Instance-plan change only. **No** worker service, **no** scheduler, **no** retry/fairness/single-flight. `api_dispatch` mode retained (§1.2) | Plan-change record + recomputed 24/7 cost vs. burst cost | Bounded pilot on both gates (§5); SP-1 still applies to the isolation rule |
| **O3** | One dedicated worker clears it | Worker service + §1.2 cutover + §3.1 retry + §3.2 admission/fairness + §6 retention. **No** scheduler (single worker, always on), **no** single-flight (value is ~2 redundant sub-second solves at this scale — §3) | Worker-tier implementation plan | Bounded pilot on both gates + MP-4 |
| **O4** | Only a horizontal fleet clears it | All of O3, **plus** the scheduled scaler (§2) and its drain contract (§2.1), **plus** fleet-wide single-flight as its own approved spec (§3, **SP-2**) | Worker-tier plan + scaler runbook + single-flight spec | Bounded pilot on both gates + MP-4, **and** single-flight spec approved |

**O2 is the row §4's "bump the instance + keep 24/7" sentence belongs to** — it is a real outcome, not a contradiction of the goal, and it is the one outcome where an autoscaled fleet would be the more expensive answer.

> **SP-1 — approval checkpoint (ask at the Measurement decision point).**
> *Measurement selected outcome O1/O2 (no worker isolation). The predecessor split ledger says worker isolation is mandatory before any real cohort pilot, regardless of topology — a rule locked before A existed, when the API had no durable queue, no lease and no drain. A has since shipped all three. Do you (a) hold the ledger rule and require a worker tier before any real cohort even though capacity does not demand one, (b) waive it for this pilot on the record, citing A's landed reliability substrate, or (c) run the pilot at a reduced cohort size as a middle path?*
> This is a scope reversal of a locked decision; it is not mine to make.

### 1.2 Dispatcher modes and the production cutover (S-R2)

The review is right that this was absent, and the gap is concrete rather than theoretical. A2 shipped a **recurring bounded dispatcher scan inside the API process** (`artifacts/api-server/src/solver/jobRunner.ts`, 5 s interval, batch ≤ 5/tick, `SOLVE_DISPATCHER_INTERVAL_MS`). There is **no mode flag anywhere in the codebase** — I grepped `scnd-correctness-A` for one. A worker service that also claims `solve_jobs` would therefore race the API's own dispatcher from its first boot. Measurement's harness seam is disposable; this is not.

**Normative contract:**

- **`SOLVE_DISPATCH_MODE`** — required env var, no default, three values:
  - `api_dispatch` — today's behaviour, A2 unchanged. The API enqueues, kicks in-process, scans, claims, solves. Valid for O1/O2 only.
  - `enqueue_only` — the API enqueues and serves polls. It **starts no dispatcher scan, registers no in-process kick, and claims nothing.** Valid for O3/O4.
  - `worker_only` — the worker service scans and claims. It **binds no HTTP listener and serves no route.** Valid for O3/O4.
- **Startup validation is fail-closed.** An unset, unrecognised, or topology-inconsistent value aborts boot with a non-zero exit — never a silent default. `worker_only` additionally asserts that no `PORT` listener is configured; `enqueue_only` asserts `activeSolverCount() === 0` is structurally true because no pump is registered, not merely observed to be zero at one instant.
- **The lost in-process kick is a real latency cost, stated rather than hidden.** In `api_dispatch`, an enqueue immediately kicks `pump()`. In `enqueue_only`, the job waits for a worker's next scan — up to `SOLVE_DISPATCHER_INTERVAL_MS` (default 5 s) added to *every* solve start, which a student experiences as a 5-second stall before the spinner starts moving. Mitigation, in preference order: (1) Postgres `LISTEN/NOTIFY` on enqueue, worker wakes immediately, scan remains the durable fallback; (2) shorten the worker scan interval and accept the added poll load, budgeted in §3.2. **(1) is the intended design**; (2) is the fallback if `NOTIFY` proves unreliable across Render's pooler.
- **Cutover order (production, one deploy per step, each independently revertible):**
  1. Deploy the worker service at **zero instances** in `worker_only`. Nothing changes.
  2. Scale workers to 1. **Both** tiers now claim — this is the only unsafe window, and it is safe *in the reliability sense* (A's CAS claim and lease make double-claim impossible) but not in the capacity sense. Hold it to one deploy cycle.
  3. Flip the API to `enqueue_only` and redeploy. Render's zero-downtime deploy means the old `api_dispatch` revision drains for up to `maxShutdownDelaySeconds` (**120 s**, set by A14a in `render.yaml`) while still owning live solves. That overlap is expected and safe; do not try to eliminate it.
  4. **Pre-run proof before declaring cutover complete:** after the old API revision's drain window has fully elapsed, assert that zero `solve_jobs` rows in `running` carry a `claim_generation` stamped by an API-tier boot. A's `claim_generation` comes from a Postgres sequence read once per process boot, so generations are per-owner and this is a direct query, not an inference.
  5. Scale workers to the measured count.
- **Rollback is the exact reverse**, and step 3's reverse (API back to `api_dispatch`) is safe at any moment for the same reason step 2 is: two claimants cannot double-claim one row.

> **SP-4 — approval checkpoint (ask before step 3).** *Cutting the API to `enqueue_only` is the irreversible-feeling step — it is reversible by redeploy, but between step 2 and step 4 there is a window where both tiers claim. Confirm the cutover window (ideally outside a class window) and that a rollback deploy is acceptable if the worker tier misbehaves.*

## 2. Scheduled autoscale (the cost lever)

- Render has **no native queue-depth autoscale** (utilization-based autoscale needs a Pro workspace and reacts to CPU, not queue age). Use a **scheduled scaler**: a cron/GitHub-Action (or Render cron) calling the Render API to set the worker instance count — **UTC schedule**, pre-scale 5–10 min before class, scale down only after drain proof.
- Keep a **1-worker floor** off-peak (handles the distinct-trickle) unless the product accepts off-hours waits.
- Handle missed schedules, holidays, DST, and Render API failures; commands idempotent + observable; alert on unexpected worker count outside class windows.
- **Cold-start note:** a scaled-up worker pays a container boot; **treat the earlier "~1–3 min" as a historical hypothesis, not a figure to plan against** (review, third important correction). The real number is a measured output — time from scale API call to first successful claim — and pre-scale lead time is derived from it, not assumed.

**Applies only to outcome O4** (§1.1). O3 runs one always-on worker and needs no scaler; O1/O2 have no worker tier to scale.

### 2.1 Scale-in safety (S-R5)

The review frames this as a TOCTOU gap in "drain queue + leases, then scale down." The framing is correct that the check is unsafe, but the fix is not a better check — **it is to stop checking**, for a reason the original text missed:

> **Render's scale API sets a desired instance count. It does not let you choose which instance dies.** So there is no such thing as "drain the instance we are about to remove" — you cannot name it. Any pre-check is therefore not merely racy, it is answering a question about the wrong instance.

Safety comes from the worker's own shutdown behaviour plus A's lease, which together make an abruptly-removed worker a *recoverable* event rather than one to be avoided:

1. **On `SIGTERM` the worker stops claiming immediately** — cancels the scan schedule, refuses new claims — and keeps heartbeating the jobs it already owns, so a peer does not take them over mid-solve.
2. It waits for owned solves to finish, bounded by `maxShutdownDelaySeconds` (range 1–300; **120 s** is what A14a set for the API and is the starting value here). Then it closes pools and exits.
3. **Anything still running at the budget is SIGKILLed by the platform.** Its lease then goes stale at A2's 60 s threshold and the job is requeued by the retry protocol (§3.1), consuming one attempt.
4. Because step 3 is bounded and attempt-limited, scale-in never loses work and never loops.

Consequences stated plainly rather than buried:
- **A solve whose wall time can exceed the shutdown budget will occasionally be killed and retried during scale-in.** At the measured teaching-dataset times (<0.2 s optimal, ~16.5 s worst free-choice) this is far inside 120 s and effectively never fires. If measurement ever shows a solve family approaching the budget, that family needs a time-limit ceiling *before* this tier ships, not a larger budget — 300 s is a platform cap, not a lever.
- **Admission during scale-in:** the API does not stop accepting. Queue depth rises, §3.2's estimated-wait admission naturally starts shedding, and the remaining workers drain it. There is no separate "draining" admission state to implement.
- **Reconciliation, not verification:** the scaler records `desired_count`, then polls until `observed_ready_claimants` (workers that have successfully claimed or heartbeated within one scan interval) equals it. A mismatch past a deadline alerts; it does not retry blindly.
- **Native autoscaling must be asserted OFF.** Render ignores manual instance counts when its own autoscaling is enabled, which would silently defeat the entire cost lever. The scaler asserts this on every run and fails loudly if it finds autoscaling on.
- **Render's scale API is asynchronous.** The call returning 200 means accepted, not applied. Treat 429/5xx as retryable with backoff; treat a successful call as a request, and let reconciliation decide truth.

**Tests:** enqueue at the drain boundary (job submitted in the same second a worker receives SIGTERM lands and completes), scale-in with an active job (killed at budget → requeued → completed by a survivor, exactly one publication), and autoscaling-enabled detection.

### 2.2 Scheduler contract (S-R6)

**One controller: a Render Cron Job** calling the Render API. Reasons, not preference:
- **GitHub Actions `schedule` is disqualified on timing.** Its cron triggers are queued and routinely delayed by 10–20+ minutes under load. A contract whose whole point is "pre-scale 5–10 minutes before class" cannot be built on a trigger with a longer error bar than the lead time it is scheduling.
- A Render cron runs in the same workspace, uses the same credential path, and is declarable in `render.yaml` alongside everything else it controls.
- Its own reliability is *not* assumed: the scaler is idempotent (sets a desired count, never increments), and correctness is established by §2.1's reconciliation, not by the cron having fired.

| Element | Contract |
|---|---|
| Source calendar | A committed file, `docs/ops/scnd-class-calendar.yaml` — the single authority. Holiday changes are a PR to it, reviewed like code |
| Timezone | An explicit IANA zone in that file (e.g. `America/New_York`), **never a fixed UTC offset** — the point is that DST is handled by the zone database, not by hand |
| Occurrences | The scaler expands the calendar to concrete UTC instants at run time, so a DST transition inside a term shifts the UTC firing automatically |
| Idempotency / overlap | An advisory lock in Postgres (`pg_try_advisory_lock`) for the scaler's lifetime; a second overlapping run exits 0 without acting |
| Credentials | A Render API key in the cron job's env, scoped to the worker service. Not in the repo, not in the calendar file |
| Retry | Bounded retry with backoff on 429/5xx; exhaustion alerts and leaves the previous desired count in place |
| Verification | §2.1 reconciliation — observed ready claimants must reach the desired count before the run reports success |
| Alerting | Missed scale-up (window started, count below desired), unexpected count outside class windows, autoscaling-enabled, reconciliation deadline |
| Manual override | A desired-count override field in the calendar with an expiry; the scaler honours it and alerts while it is active, so an override cannot be forgotten silently |

> **SP-3 — required input, not an approval.** The class calendar's timezone, the term's class days and window times, and the pre-scale lead time are **product inputs this document cannot invent.** They are requested at the point the scaler is planned. The lead time specifically derives from the measured boot-to-first-claim time (§2), so it is requested *after* measurement, not before.

## 3. Backpressure, single-flight, gap-tuning

- **Backpressure:** admission by durable queue signals (total queued, oldest-queued age, estimated wait, per-user in-flight) — replace the current process-local `QUEUE_DEPTH_LIMIT`; reject on estimated-wait/SLO with a meaningful `Retry-After`; fair/round-robin per user so one student can't monopolize.
- **Single-flight — wholly owned here (moved back from A, 2026-09-22, review A-R53).** It was briefly Option A's task A10. Across six approval rounds it produced **12 of that plan's 56 findings at a rising rate** — culminating in four CRITICALs in one round: three incompatible generation authorities, an ordering model provably incompatible with its own cursor invariant, a uniqueness exclusion that abandoned its own exactly-one-solve acceptance, and a deletion protocol FK actions cannot implement. It was removed from A rather than declared fixed.
  **This spec owns the whole protocol:** the active-run record on A6's composite hash, winner election, subscriber attachment and sealing, durable outcome, resumable fan-out, deletion/cancellation, and stale-owner takeover — built on **this spec's** multi-worker lease, which fleet-wide coalescing needs regardless.
  **Design constraints inherited from A's rounds, do not rediscover them:** election must use `ON CONFLICT` (an unhandled unique violation aborts the transaction); uniqueness scope must be an **immutable** key, never the mutable lease owner; the fan-out cursor must order by an explicit sequence, **not** `job_id`, if the winner is not processed in id order; the durable outcome must be persisted **before** fan-out, because `no_solution` is deliberately never cached and so the cache cannot serve as the recovery source; subscribers must be structurally unclaimable by the dispatcher; and `ON DELETE` actions cannot substitute for an explicit deletion transaction. See the A plan's A10 removal record and rounds 2–6 of its review record.
  **Sizing note:** at A's current `CONCURRENCY=3` a 50-student stampede costs about **two** redundant sub-second solves, because the first completion populates the cache for the queued remainder. Single-flight's value scales with worker count — which is precisely why it belongs here and not in the correctness contract.
  **Status corrected per S-R4.** The review is right that this is an outline, and right that it was nonetheless listed as a reliability-gate requirement in §5. That asymmetry was the actual defect and it is fixed: **single-flight is removed from the gate until its own spec is approved**, and it is scoped to outcome O4 only (§1.1), because at O3's single worker the sizing note above shows the value is roughly two sub-second solves — not worth a distributed coalescing protocol.
  **It gets its own spec pass, not a section here — a deliberate divergence from S-R4's requested remedy**, which was to add a normative single-flight sub-spec to *this* document. The finding's own evidence argues against that remedy: writing this protocol inline is precisely what produced 12 of the A plan's 56 findings across six rounds, ending in four CRITICALs in one round — three incompatible generation authorities, an ordering model incompatible with its own cursor invariant, a uniqueness exclusion abandoning its own acceptance criterion, and a deletion protocol FK actions cannot implement. That was not carelessness; it is a genuinely hard protocol that needs its own brainstorm → spec → review cycle, exactly as A and Measurement each got. Folding it back into a section of *this* document would repeat the failure with the same author, the same reviewers and less space. What was actually defective is the asymmetry the review identified in the same breath — gating on an outline — and that is fixed directly. **If the protocol is wanted inline instead, say so and it gets written; the expectation is that it fails the same way.** The deliverable is therefore a named successor spec (`specs/2026-09-2x-scnd-single-flight-design.md`) carrying the inherited constraints above as its starting contract, and it must define: the immutable uniqueness key, winner election via `ON CONFLICT`, subscriber attachment and sealing, the explicitly-sequenced fan-out cursor, outcome persisted **before** fan-out, stale-owner takeover on this spec's lease, cancellation/deletion as an explicit transaction, its interaction with §3.1's retry, and acceptance tests proving exactly one CBC execution and exactly-once terminalization per cold identical burst.

> **SP-2 — approval checkpoint (ask only if Measurement selects O4).** *A horizontal fleet makes duplicate solves worth eliminating, so single-flight becomes real work — its own brainstorm/spec/review cycle before any implementation, on the evidence that the last attempt to shortcut this cost six review rounds. Authorize that spec pass, or accept the duplicate-compute cost for the pilot and defer coalescing until the measured waste justifies it?* Either answer is defensible; the measured cold-identical-burst waste from Measurement's load profile is the evidence that should decide it.
- **Gap-tuning:** the original brainstorm's biggest cost lever — but the spike found teaching datasets prove optimal in <0.2 s, so gap-tuning's real payoff is likely small here; apply only if measurement shows a slow-regime tail worth cutting, as a per-scenario input (not a solver-math branch, hard rule #6).

### 3.1 Automatic retry — the protocol (S-R3)

Accepted in full. `worker_id` + `attempts` were a schema sketch presented as a policy. The rule this introduces is genuinely new to the system: **A performs no automatic retry at all**, by deliberate decision, so everything below is a departure from A that must be justified line by line rather than assumed.

**Why retry exists here at all, and only here.** With one in-process dispatcher, a crashed owner *is* the process serving the student, so there is nobody left to retry on their behalf and an honest terminal failure is correct. With a worker fleet, a worker can vanish — scale-in (§2.1), a Render deploy, a node failure — while the API and the student's poll loop are perfectly healthy. Failing that student's solve because a *different* machine died is not honesty, it is a leak of infrastructure into the classroom. That, and only that, is what retry covers.

**Retryability is keyed to A's existing taxonomy, not a new one.** A1 already ships `failure_reason ∈ {internal_error, solver_error, data_error}` and `failure_stage ∈ {timeout, spawn, protocol, exit, dataset_load, dispatch, input_parse, solve_exception, cbc_parse, validate}` as CHECK-constrained columns. Retry classification reads those:

| Class | Cases | Retry? | Why |
|---|---|---|---|
| **Infrastructure** | Lease expiry with no recorded outcome; `internal_error` at stage `spawn` or `dispatch` | **Yes** | The solve never ran, or ran and its result was lost with its owner. Nothing about the *input* is implicated |
| **Deterministic input** | `data_error` / stage `validate` (A2's recovery-contract-identity mismatch), `input_parse` | **No** | A2 already makes this terminal on the first claim. Retrying re-runs the same validation on the same snapshot for the same answer. **Do not weaken A2 here** |
| **Deterministic solver** | `solver_error` at `solve_exception` / `cbc_parse` / `exit` | **No** | Same input, same code hash, same CBC — a retry buys an identical failure at full CPU cost. This is the case where retry looks kind and is merely expensive |
| **Timeout** | stage `timeout` | **No** | The solve was given its budget and used it. Retrying grants a second full budget for the same work and is the single worst thing to do to a queue under load |
| **Protocol** | stage `protocol` (malformed fd3) | **No** | Indicates a code/version defect, not a transient. Retrying hides it |

So retry covers **lost work, never rejected work.** That keeps A's "an ambiguous crash ends in an honest terminal failure" promise intact for every class where the failure is actually about the job.

**Schema additions to `solve_jobs`** (nullable adds, hard rule #3's two-step protocol does not apply):
- `attempts integer` — consumed attempts.
- `next_attempt_at timestamp` — DB-clock earliest re-claim.
- `worker_id text` — the claiming worker's identity, for observability and for the reconciliation query in §1.2 step 4. **Not** an authority: `claim_generation` remains the fencing token.

**State transitions:**
- **An attempt is consumed at claim time, not at failure time.** This is the one non-obvious call and it is deliberate: a worker that dies between claiming and writing anything never records a failure, so incrementing on recorded failure leaves a crash-loop unbounded — the exact shape that strands work forever. Incrementing inside the CAS claim transaction makes the bound real regardless of how the attempt ends.
- **Requeue on lease expiry:** the reclaim transaction sets `status='queued'`, clears `claim_generation`/`claimed_at`/`owner_heartbeat_at`, and stamps `next_attempt_at = now() + backoff`. **The old owner is already fenced with no new machinery** — A2's completion predicate is `WHERE id=? AND status='running' AND claim_generation=?`, and a requeued row is neither `running` nor carrying that generation, so a late completion from a zombie owner matches zero rows and is dropped exactly as A2 already drops stale completions.
- **`enqueued_solve_input_revision` is carried forward unchanged** across every retry, so A7's publication CAS still rejects a result whose scenario has moved on (see the A7 dependency note in the preamble).
- **Backoff** is computed on the **database clock**, never a worker's: `next_attempt_at = now() + min(base × 2^(attempts−1), cap)` with full jitter. `base = 5 s`, `cap = 60 s` as starting values. Claim predicate gains `AND (next_attempt_at IS NULL OR next_attempt_at <= now())`.
- **Exhaustion at `MAX_ATTEMPTS = 3`** (one original + two retries): terminal `failed`, `failure_reason='internal_error'`, `failure_stage='dispatch'`, `error_code='SOLVE_FAILED'`, and the same safe student-facing message A2 already uses for retryable-looking internal failures. **No dead-letter table** — A's taxonomy columns already record everything a dead-letter row would, and a second table would need its own retention, indexes and consistency story for no added information. Exhausted rows are found by `status='failed' AND attempts >= 3`.
- **Exactly-once terminal publication is unchanged and uninvented:** it is A2's ownership predicate plus A7's CAS. Retry adds no new publication path, which is the property that keeps this protocol small.

**Tests:** attempt consumed on claim then killed before any write (bound holds); stale-lease requeue with the old owner attempting completion afterwards (zero rows, no publication); each non-retryable class terminal on first failure; exhaustion terminal with the correct taxonomy; `next_attempt_at` honoured under a fleet (no worker claims early); retry of a job whose scenario inputs changed mid-flight still fails A7's CAS.

### 3.2 Database budget, admission and fairness (S-R7)

Accepted — these were named, not specified.

**Connection budget.** The failure mode the review names is real and is the one that bites first: at fleet scale, Postgres connections are exhausted well before CBC capacity is.

```
total = api_instances × api_pool  +  worker_instances × worker_pool  +  reserve
worker_pool = CONCURRENCY + 2      (claim + heartbeat + one per in-flight completion)
reserve     ≥ 5                    (migrations, psql, the scaler's advisory lock)
```

**The ceiling this must fit under is genuinely unknown in-repo and is not guessed here.** `render.yaml` runs `nos-postgres` on `basic-256mb`; the post-migration audit (Task 5) recorded that this plan's real connection ceiling was never confirmed, and that is still true. It is a **required input to the worker-tier plan**, obtained from the live instance (`SHOW max_connections`), not from documentation and not from me. If the budget does not fit, the answer is a connection pooler or a larger DB plan — and that cost belongs in §4's model, which is exactly the kind of cost an unexamined fleet plan hides.

**Claim cadence.** Each worker scans on A2's `SOLVE_DISPATCHER_INTERVAL_MS` (5 s default) with **±20 % per-worker jitter**, so N workers do not stampede the same index on the same tick. Batch size is bounded by that worker's free slots, never a fixed constant — a worker with no free slot issues no claim query at all. With `LISTEN/NOTIFY` (§1.2) the scan is the durable fallback rather than the primary path, which is what keeps poll load flat as the fleet grows.

**Indexes.** A1 already ships `IDX_solve_jobs_queued_status` on `(queued_at, id) WHERE status = 'queued'` — oldest-first, which is the claim ordering — and `IDX_solve_jobs_owner_heartbeat_running` on `(owner_heartbeat_at) WHERE status = 'running'` for stale-lease recovery. **Both are already correct for the fleet.** `next_attempt_at` is applied as a filter on the existing index rather than a new leading column: at pilot depth the not-yet-due prefix is a handful of rows, and adding a column to the leading edge would deoptimise the common case to fix a case measurement has not yet shown exists. Revisit only on measured scan cost.

**Fairness — a per-user cap, not round-robin.** The goal is "one student cannot monopolize," and a per-user in-flight cap achieves it with a predicate:

```
MAX_RUNNING_PER_USER = 1        MAX_QUEUED_PER_USER = 3
```

The claim query skips users already at their running cap; enqueue rejects past the queued cap with a clear message. This is chosen over round-robin because round-robin under `FOR UPDATE SKIP LOCKED` needs either a per-user cursor or a window function in the claim path — both add contention to the hottest query in the system to buy an ordering property the cap already delivers. **Starvation bound:** with cap `R = 1` and `W` total slots, a user's job waits behind at most `⌈U_ahead / W⌉` service times where `U_ahead` is the count of *distinct other users* queued ahead — bounded by cohort size, not by queue depth, which is the property that matters. At 50 users × 50 solves/hr (0.694 submissions/sec) one running per user is not a practical constraint.

**Admission and `Retry-After`.** This replaces the process-local `QUEUE_DEPTH_LIMIT`, which cannot see a fleet:

```
estimated_wait_sec = queued_depth × cpu_N / (workers × slots_per_worker)
```

where `cpu_N` is Measurement's **mean CPU service demand at the knee concurrency N** — the same quantity §4 sizes from, not p95 (M-R8). Reject with `429` when `estimated_wait_sec` exceeds the ratified queue-wait SLO; `Retry-After = clamp(ceil(estimated_wait_sec), 5, 120)`. The existing fixed `Retry-After: 30` from P1.1 is replaced. **Ordering:** the cache check precedes admission, so a request that will be served from cache is never rejected for queue depth — rejecting a student whose answer already exists would be indefensible.

## 4. Cost model (to be filled from measurement)

Frame per the original brainstorm (Render per-second billing; ~20 class-days × 3 hr = 60 peak-hr/month; shared Postgres ~$7–19/mo):
`total ≈ API(always-on) + base-worker(always-on) + Σ(burst-workers × 60hr) + Postgres + scheduler`.
**`$70/mo` is a historical hypothesis, not a target** (review, third important correction) — it predates every measurement and the whole of A. The final model charges **measured provisioned-instance seconds**, which means it must include what the estimate omitted: pre-scale lead time (workers billed before the first solve arrives), drain delay after the window, the always-on one-worker floor, the scheduler's own cron cost, the Postgres plan (including any upgrade §3.2's connection budget forces), the workspace tier if autoscaling or other Pro features are ever required, and **failed scaling actions** — a scale-up that fires and is never scaled down bills 24/7 until someone notices, which is why §2.2's "unexpected count outside class windows" alert is a cost control and not just hygiene. Note also that **a manual worker service cannot scale below one instance**; an off-hours scale-to-zero would need a different runtime and its own service-level contract, and is not assumed here.

The brainstorm's Option-B estimate was ≈ **$70/mo** (API Standard + 1 base worker + ~6 burst cores × 60 hr). **Recompute from measured mean CPU service demand + the selected topology** — **not from p95 service time** (measurement review M-R8: queue stability depends on `arrival rate × mean service demand`; sizing every request as a p95 case over-provisions, while a regime beyond p95 can dominate total compute and be missed). p95 validates the SLO, it does not size the tier. **Report both cost denominators** (per successful submitted job, and per successful CBC execution) per the Measurement spec §4. Report cost-per-successful-solve, peak-window cost, idle cost, and sensitivity to cache-hit rate + free-choice frequency. If measurement shows a single vertical box clears the load, the honest answer may be **"bump the instance + keep 24/7"** at lower operational cost than an autoscaled fleet.

## 5. Two-gate pilot verification (before real cohort)

Reuse the parent design's two independent gates:
- **Capacity gate:** the Measurement synthetic-load harness meets the ratified SLOs at the guaranteed rate on the selected topology.
- **Reliability gate:** A's restart-safety, owner-lease reclaim and no-orphan proof pass under load, **plus** this spec's own additions — multi-worker claim under `SKIP LOCKED` (no worker reaps a live worker's job at any worker count), bounded attempts/retry exhaustion, and per-user fairness. **Fleet-wide single-flight is no longer a gate item** (S-R4): it was listed as a requirement while being only an outline, and it is now scoped to O4 behind its own spec and SP-2. If that spec is approved and built, its acceptance tests join this gate; until then the gate does not depend on work that does not exist.

**Authoritative rerun on the built tier (S-R8).** Measurement selects a topology on a *prototype* seam, before this spec adds retry, fairness, admission, dispatcher modes and the scaler — additions that change both capacity (every retry is a second full CPU charge; fairness caps change queue ordering) and failure behaviour. **The gates are therefore rerun on the final built topology, and it is that rerun, not Measurement's, that authorizes anything.** Measurement's run selects; this run decides.

The reliability suite for that rerun must include: dispatcher-mode enforcement (an `enqueue_only` API provably claims nothing; a misconfigured mode fails boot), DB outage and pool exhaustion, retry exhaustion, a missed scale-up and a Render API failure, active-job scale-in (§2.1), fairness/starvation at the cap, cold-identical burst (measuring duplicate-compute waste — the evidence SP-2 needs), and deletion/cancellation of a scenario mid-solve.

Deliver a decision doc: per-gate pass/fail, the identified bottleneck, worker count + cost recomputed from **measured mean CPU service demand** (M-R8 again — "service time" here read as wall time, the quantity §4 already excludes). **Both gates pass *and* MP-4 approval are required for a pilot** — a capacity pass alone authorizes nothing, and a reliability failure is not waivable by capacity evidence.

## 6. Retention, indexes and bounds

Rehomed explicitly rather than allowed to disappear (review, second important correction). The predecessor ledger assigned items 12.15 (recovery index + bounds) and the retention row to B2; this is B2's successor, so they are this spec's.

**The volume is larger than when that ledger was written.** A's Part F added `solve_jobs.result` — the **full result envelope per run**, deliberately not a join to `result_cache` so historical export stays addressable — plus `input_snapshot` per row. Every solve now stores two JSONB documents that it previously did not, and retry multiplies rows per logical solve. Growth is the thing to bound here, and it is not a rounding error on a `basic-256mb` instance.

| Class | Bound |
|---|---|
| Terminal `solve_jobs` rows | Retention window in days; `result`/`input_snapshot` nulled on expiry **before** the row is deleted, so solve *history* (G3.2, Landing's recent solves) survives longer than the heavy payloads |
| Queued rows | Bounded by §3.2's per-user queued cap × cohort size — a structural bound, not a cleanup job |
| `result_cache` | Size or age cap with an eviction policy. **A6's composite identity means a code-hash change orphans an entire generation of entries at once** — that is the eviction trigger that matters, not gradual growth |
| Exhausted/failed rows | Same retention as terminal; no separate dead-letter store (§3.1) |
| Active-run / subscriber rows | Owned by the single-flight spec if it is ever built (§3); named here so the dependency is not lost |
| Cleanup concurrency | Batched deletes under a statement timeout, off-peak, holding no lock that blocks the claim path |

The retention window in days is a **product input**, not a number to invent — it trades student-visible solve history against storage cost, and is requested with SP-3's calendar inputs.

## 7. Explicitly out of scope / deferred

- Splitting the dispatcher into a *separate service process* beyond the worker tier — only if evidence shows the API's own event loop is the bottleneck (parent P1.1 rule; none observed).
- Render Workflows as an alternative runtime — a bounded POC option (parent §11.D), not the baseline.
- Multi-region / read-replica DB scaling — not warranted at pilot scale.
- Off-hours scale-to-zero — needs a different runtime (§4).

## 8. Worker readiness and failure semantics

The review is right that "readiness-on-DB-failure" implied an HTTP check a **Render background worker cannot have** — it has no inbound URL and no health-check path. Worker semantics instead:

- **Boot DB failure → exit non-zero.** Render restarts with its own backoff. This mirrors A2's API behaviour, which already fails boot closed when its first recovery scan cannot reach the DB; a worker that boots "successfully" but claims nothing is worse than one that is visibly restarting.
- **Running DB failure → suspend claiming, keep trying to heartbeat.** Owned jobs continue; the lease is what protects them, and if the heartbeat cannot be written the job is cancelled rather than silently left running (A2's existing rule — a zero-row or erroring heartbeat cancels the process group, never merely suppresses publication).
- **Self-terminate after N consecutive failed scans**, so a wedged worker is replaced by the platform instead of sitting idle inside a billed instance.
- **Observability replaces readiness:** liveness is `owner_heartbeat_at` freshness in the database and the §2.1 reconciliation count. Those are observable from outside the worker, which an HTTP check on a URL-less service would not be.

## 9. Deliverables

Worker-tier implementation plan (a later `writing-plans` pass, sized by measurement), the scheduled-scaler + its runbook, the cost report, the two-gate pilot-verification doc, and — only under O4 and SP-2 — the single-flight successor spec. **Nothing here is built before Measurement runs and §1.1's outcome row is selected** — this spec is the *target*, deliberately not an executable plan until the evidence exists.

---

## 10. Open inputs and unratified values

Nothing below is an oversight; each is a value this document is not entitled to invent. Read this section before treating any number in §§2–3 as evidence.

**Blocking — someone other than the author must answer:**
- **SP-1** — does a capacity-passing API authorize a real cohort with no worker isolation? Reverses a locked ledger decision (§1.1).
- **Postgres `max_connections` on `basic-256mb`** — genuinely unknown in-repo. The post-migration audit (Task 5) recorded it unconfirmed and it still is. Read from the live instance (`SHOW max_connections`); §3.2's budget cannot be checked without it, and if it does not fit, the pooler-or-bigger-plan cost lands in §4.

**Product inputs (SP-3), not author choices:** class calendar days/windows, IANA timezone, pre-scale lead time (derives from measured boot-to-first-claim, so it is requested *after* measurement), and the §6 retention window in days.

**Starting values, not measured results.** Every number in §§2.1/3.1/3.2 — `MAX_ATTEMPTS=3`, backoff `base=5 s`/`cap=60 s`, `MAX_RUNNING_PER_USER=1`, `MAX_QUEUED_PER_USER=3`, ±20 % scan jitter, `Retry-After` clamp 5–120 s, the 120 s shutdown budget inherited from A14a — is a **starting value to be ratified against measurement**. They are stated concretely so they can be argued with, which is the opposite of the vagueness S-R7 objected to. **Do not mistake concreteness for evidence.**

**Deferred by design, not omitted:** the single-flight protocol (§3, SP-2) — open because it needs its own spec, not because it was forgotten.

---

## 11. Review record

Round 1 — deep approval review, 2026-09-23. Review text preserved verbatim in commit `02d105f`; this table is the disposition, and the corrections themselves live in the sections named. **All twelve findings accepted.** Ten corrected as requested; **S-R1 and S-R4 accepted with a different remedy than the one requested**, each argued at the point of divergence (§1.1, §3) rather than in an appendix.

The review's central judgement — that this was a direction, not yet a contract for the distributed coordination it introduces — was correct. S-R2, S-R3 and S-R7 named gaps left as nouns. Two findings were also overtaken by program state the review could not have had: **B is executed** and **A is in progress** (see the preamble), so every code and schema claim in the fold is cited from `scnd-correctness-A`, not from a plan.

| ID | Disposition | Where |
|---|---|---|
| S-R1 — topology/build contradictory | **Accepted, different remedy.** Four-row outcome matrix; predecessor rule **narrowed, not superseded**; "ship B (+ A)" replaced with real program state | Preamble, §1.1, **SP-1** |
| S-R2 — dispatch cutover absent | **Accepted.** Three mutually exclusive modes, fail-closed validation, five-step cutover, queryable zero-API-claimant proof; lost-kick latency stated with its mitigation | §1.2, **SP-4** |
| S-R3 — retry not a protocol | **Accepted.** Full protocol keyed to A1's existing failure taxonomy; attempt consumed at claim; old-owner fencing shown to need no new machinery | §3.1 |
| S-R4 — single-flight an outline | **Accepted, different remedy.** Removed from the reliability gate and scoped to O4; promoted to its own successor spec rather than written inline | §3, §5, **SP-2** |
| S-R5 — scale-in race-unsafe | **Accepted, stronger conclusion.** Render picks the victim instance, so the pre-check is unfixable and is dropped; safety moves to worker SIGTERM + A's lease + bounded attempts | §2.1 |
| S-R6 — scheduler contract incomplete | **Accepted.** Render Cron Job selected on a timing argument; calendar/locking/credential/reconciliation/override contract | §2.2, **SP-3** |
| S-R7 — DB/admission/fairness only named | **Accepted.** Connection budget, pool sizing, jittered cadence, index analysis, per-user cap with starvation bound, exact wait/`Retry-After` | §3.2, §10 |
| S-R8 — gates validate the prototype | **Accepted.** Authoritative post-build rerun on the final topology; named reliability suite; both gates **and** MP-4 required | §5 |
| Readiness-on-DB-failure | **Accepted.** Background workers have no inbound URL; boot/run/self-terminate semantics with DB-side observability | §8 |
| Retention/index/bounds | **Accepted.** Rehomed explicitly, with A Part F's `result` + `input_snapshot` growth noted as larger than the ledger assumed | §6 |
| Cost evidence-driven | **Accepted.** `$70/mo` and the 1–3 min boot demoted to hypotheses; omitted charges enumerated | §2, §4 |
| A7 provenance | **Accepted.** Consumed-not-reimplemented, with the retry-specific consequence spelled out | Preamble, §3.1 |

**Re-approval checklist (reviewer's, with author status):**

- [x] Outcome matrix reconciles no-build / vertical / dedicated-worker / fleet with the predecessor ledger — §1.1; **SP-1 open for the one genuine conflict**
- [x] Production worker-mode cutover prevents concurrent claiming — §1.2
- [x] Retry/lease/fencing/exhaustion semantics deterministic and tested — §3.1
- [ ] Single-flight schema/state machine/cancellation protocol — **open by design**: removed from the gate, promoted to its own spec (§3, SP-2)
- [x] Safe drain/reconciliation; native autoscaling cannot override — §2.1, §2.2
- [x] Calendar/controller, database budget, admission, fairness executable — §2.2, §3.2; **connection ceiling is a named required input** (§10)
- [x] Final built topology, not its prototype, carries authoritative evidence — §5
- [x] Retention/bounds and A7 publication-CAS provenance explicit — §6, preamble

---

<details>
<summary>Round 1 review text (verbatim, as received — superseded by the fold above)</summary>

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

</details>

---

## 12. Round 2 approval review — 2026-09-23

**Decision: REQUEST CHANGES / not approved.** The folded design now closes the original S-R1…S-R8 review in substance and preserves the right architecture: durable Postgres work, isolated compute when selected, scheduled manual capacity, and independent capacity/reliability evidence. The remaining work is not a restart. It is one coherent operational correction bundle, plus two external decisions. No end-user best/worst-load scenarios are included here.

### New blocking findings

| ID | Finding | Evidence | Required correction before approval |
|---|---|---|---|
| **S-R9 — claimant identity cannot prove cutover or readiness** | §1.2 step 4 says a `claim_generation` is "stamped by an API-tier boot," but A's generation is only a sequence number allocated once per boot; it carries no durable API/worker role. `worker_id` is proposed only as observability and cannot establish the stated proof. Separately, an idle pre-scaled worker owns no job and therefore has no `owner_heartbeat_at`; it can never satisfy §2.1's `observed_ready_claimants` test before the class begins. | `scnd-correctness-A: artifacts/api-server/src/solver/jobRunner.ts` allocates `bootClaimGeneration` from `solve_jobs_claim_generation_seq`; claimed rows store generation but no tier identity. §1.2.4, §2.1, §8 depend on a role/readiness signal that does not exist. | Add one durable **claimant registry**. Each boot registers immutable `claimant_id`, role (`api`/`worker`), mode, `claim_generation`, boot time, and a DB-backed readiness heartbeat after it has proved it can use the queue. Store `claimant_id` on a claimed job (or preserve a durable equivalent mapping). Reconcile distinct live worker registry rows, not job heartbeats; prove cutover with `NOT EXISTS` running job joined to an API claimant. Retain registry rows until no job can reference them. |
| **S-R10 — zero-instance cutover conflicts with the platform floor** | §1.2 deploys a `worker_only` service at zero instances, yet §4 correctly states that a manually scaled Render worker cannot scale below one instance. The initial cutover cannot execute as written. | §1.2.1 vs. §4; Render manual scaling has a one-instance minimum. | Replace step 1 with a one-worker, no-claim **standby** state (strictly configured and observable), used only to prove boot/DB readiness/no listener. Then enable claiming and immediately flip the API to `enqueue_only` outside a class window. The short dual-claim interval remains safe through the existing atomic claim; standby must not silently become a second dispatcher. |
| **S-R11 — retry exhaustion is bypassable on a stale lease** | Attempts are consumed at claim, but lease recovery always requeues. A worker killed after claiming its third allowed attempt can be requeued and either claimed a fourth time or loop, contradicting the claimed bound. The printed "full jitter" formula also has no random term. | §3.1 says attempt at claim (§162), unconditional requeue (§163), and terminal exhaustion at three (§166). | Make lease recovery a single conditional transaction: if `attempts >= MAX_ATTEMPTS`, terminalize with the stated internal/dispatch taxonomy; otherwise clear the lease and requeue with an explicitly DB-generated jittered delay. Make the claim predicate refuse `attempts >= MAX_ATTEMPTS` as defence in depth. Add a test that kills a worker after the final permitted claim and proves zero further claims. |
| **S-R12 — connection and admission models use the wrong/unfinished units** | The budget omits a long-lived `LISTEN/NOTIFY` session per worker when the intended wake-up path is used, the cron/controller connection, and overlapping process generations during deploy/drain. The `Retry-After` formula divides queued jobs by mean CPU seconds; CPU demand is appropriate for cost/sizing but not a student's wall-clock queue wait, and it omits work already active in all slots. | §1.2 intends `LISTEN/NOTIFY`; §3.2 counts only API pools, worker pools, and a generic reserve, then derives wait from `cpu_N`. | Build and ratify a maximum-simultaneous connection ledger: API and worker generations during overlap, transaction pools, dedicated notification sessions (if enabled), cron/controller, migrations/operations, and a fixed reserve. Validate it against live `SHOW max_connections` and observed `pg_stat_activity` under a rolling deployment. Derive admission/`Retry-After` from measured effective completion throughput (or effective wall service time) at the selected concurrency and queued-plus-active remaining work; keep CPU demand for cost and compute sizing only. |

### External decisions that still hold approval

- **SP-1 must choose (a) or an explicitly recorded waiver (b).** The proposed reduced-cohort option (c) is not a technical middle path: the predecessor rule prohibits *any* real cohort without isolation. My recommendation is **(a)** — retain the locked worker-isolation requirement for every real cohort. O1/O2 may still be valid capacity/cost outcomes or internal demonstrations, but do not authorize a real pilot without the worker tier unless an accountable owner records the waiver.
- **Record the live Postgres ceiling only after S-R12 defines the complete ledger.** Run `SHOW max_connections`, calculate the allowed worker ceiling including deployment overlap and notification mode, and choose a pooler or database upgrade if it does not fit. A guessed ceiling or generic reserve is not an approval substitute.

### Small consistency correction

§2 still says "a cron/GitHub-Action (or Render cron)" although §2.2 has selected Render Cron Job. Make §2 name Render Cron Job only, with its calendar-expansion tick and idempotent due-action behaviour. This is not independently blocking once S-R9–S-R12 are corrected.

### Approval path

1. Adopt the claimant registry and standby cutover as one change; this simultaneously closes cutover attribution, idle-worker readiness, and the Render one-worker-floor conflict.
2. Correct the retry exhaustion branch and its final-attempt test.
3. Replace the connection and queue-wait models with measured, like-for-like operational units; then capture the live database ceiling.
4. Resolve SP-1 on the record. If Measurement selects O4, separately approve the existing single-flight successor spec before enabling coalescing.

**Conditional approval criterion:** I would approve this document for its measurement-sized implementation-plan pass after S-R9–S-R12 close, SP-1 is resolved, and the live connection ceiling validates the completed ledger. The required post-build capacity and reliability rerun remains the only authority for a real-cohort pilot.
