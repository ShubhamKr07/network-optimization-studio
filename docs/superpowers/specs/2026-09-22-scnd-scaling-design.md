# SCND Scaling — Solver-Tier + Scheduled-Autoscale Spec

**Date:** 2026-09-22
**Status:** **All review findings are closed in text; Stage 1 (architecture/spec) approval is the reviewer's to give.** Six review rounds are folded into the body below (round 1: S-R1…S-R8 + four important corrections; round 2: S-R9…S-R12 + SP-1 direction; round 3: S-R13…S-R16 + three consistency edits; round 4: S-R17…S-R20; round 5: S-R21…S-R22; round 6: S-R23). All six review texts are preserved verbatim in commits `02d105f`, `1e0f29a`, `eba7fb2`, `1064c46`, `1a5a24e` and `ad95d3b`; the per-finding record is §11. **All twenty-seven findings are accepted**; rounds 2–6 needed no divergent remedies. Round 6's stated criterion was *"after S-R23 closes, I would approve Stage 1 — architecture/spec"* — it closes here, but **the document does not declare its own approval.**

**Three approvals were being conflated, and this status line was the worst offender** — for three rounds it said SP-1 and the connection ceiling held "implementation planning," implying those two were sufficient. Round 4 split them into stages; **round 5 found that split still wrong, because Stage 1 demanded facts only Stage 2 can produce** (S-R22). Corrected:

| Stage | What it approves | Prerequisites |
|---|---|---|
| **1 — Architecture / spec** | That this design is the right shape and may proceed toward a plan. **Not** authorization to implement, and specifically not to build the selected fleet | **All design findings closed** — nothing else. SP-1 and connection capacity are recorded as **contingent decisions** (below), not gates |
| **2 — Measurement-sized implementation plan** | A `writing-plans` pass against a *known* topology | Stage 1, **plus** A complete (A4–A13 in flight), Measurement Phases 3–4 results, §1.1's outcome row selected, §10's measured values in hand — including `mean_service_sec`, which **no Measurement artifact currently emits**. **Then the contingent decision for the selected row** (branched per S-R23, §1.1a): O1/O2 **+ waiver (b)** → the recorded waiver is the authorization, no ledger needed; O1/O2 **+ hold (a)** → the isolation-required worker path, which needs the completed §3.2 ledger and live ceiling exactly as O3 does; O3/O4 → the completed ledger validated against the live ceiling |
| **3 — Real-cohort pilot** | Students on it | Stage 2 built, **plus** the applicable §5.1 gate set passing on the **final built topology** (not the prototype), MP-4, and — under O4 — §1.1's coalescing condition; under O1/O2 the SP-1 waiver |

**The two long-standing blockers are near-exclusive by outcome, which the old flat framing hid.** SP-1 fires only for O1/O2 — the outcomes with no worker tier. The connection ledger matters for O3/O4, **and also for O1/O2 if SP-1 is answered (a)**, since that branch builds a worker tier on policy grounds (§1.1a, S-R23). Neither is answerable before Measurement selects a row, and demanding both up front forced a product decision on a question that may never be asked. Each stage's evidence is independent: Stage 1 never implies Stage 2, and Stage 2 never implies Stage 3.

**A pattern worth stating rather than burying:** the admission model has now been wrong in **four consecutive rounds** — named-but-unspecified (S-R7), wrong units (S-R12), dimensionally invalid while citing a nonexistent field (S-R13), and counting nominal instead of claimable capacity while never serializing its own decision (S-R17/S-R18). Each fix introduced the next defect. It is the one part of this document that has never survived a review, and it should be read with more suspicion than the rest.
The Scaling successor named in `2026-09-20-scnd-scaling-phase0-design.md` §13.1 ("B2 — durable isolated solver tier + pilot gate"). Direction inherited from the original brainstorm `2026-09-19-scnd-scaling-design.md` (Option B: split solver tier + scheduled autoscale ≈ $70/mo).
**Branch:** `scnd-scaling`.

**Goal:** Handle the contracted **50 users × 50 solves/hr, ≤3-hr class bursts, at low cost** by moving solves off the API's request path onto a **measurement-sized solver tier** that **scales up only for the class window** and back down after — decoupled, burst-safe, and cheap because it rents burst capacity ~60 hr/month, not 24/7.

**Program state (as of 2026-09-23 — S-R1):**
- **Bundle B is executed**, not a future option. B1–B7 are on `scnd-scaling` (`f215832..a5f0c16`): the truthful `solutionStatus`/`terminationReason` contract from captured CBC evidence, the OpenAPI/Zod read-path legacy-unverified guard, the Workspace rendering, and the QA spec. Any sentence in this document that treats "ship B" as a remaining choice is stale; the remaining choice is how much of **A** and of **this spec** is justified.
- **Option A is in progress — A0–A3 and A14a/A14b have landed; A4–A13 are executing.** On `scnd-correctness-A` through `86f75dc`. A2 already ships the recurring bounded dispatcher scan, the atomic CAS claim, the owner lease (10 s heartbeat / 60 s stale threshold, DB-clock-authoritative), ownership-checked completion, two-phase boot recovery, and SIGTERM drain. **This changes what is left to specify here** — several items the predecessor ledger assigned to B2 (§13.1 rows 12.2 partial, 12.3, 12.4, 12.6) are now A's, shipped, and must be consumed rather than restated. **A6 (composite cache identity) and A7 (publication CAS) are inside the in-flight A4–A13 range**, so this document depends on them as contracts, not yet as landed code.
- **Measurement Phases 1 and 2 are complete; Phase 3 is next.** On `scnd-measurement` through `ce2c177`. Phase 1 = M1.1–M1.5 (corpus manifest, forked single-observation primitive with normalized peak RSS, randomized runner, bootstrap-CI stats, CSV report); Phase 2 = M2.1–M2.3 (`capacity.py`'s weighted mean CPU service demand + required-cores/instances mapping; `simulate.py`'s open-loop arrival trace and queue simulator). Both task sets are fully landed. **Note the commits are not in task-number order** — `[M1.6]` is the branch tip but landed *after* `[M2.3]`, so the tip's label is not a phase position and must not be read as one.
- **M1.6 is an unplanned addition** — no such task exists in the measurement plan. It adds API-schema→`solve.py` input translation "for real campaign runs," i.e. Phase 1's harness needed one more piece before it could be pointed at real work.
- **Read all of that precisely: Phases 1–2 built the instruments, not the numbers.** No benchmark results artifact exists on `scnd-measurement`; the CSVs under `docs/superpowers/metrics/` are the harness's own and unrelated. M1.6's own framing is the clearest evidence — a translation layer built *so that* campaign runs can happen is not a campaign that has happened. Every quantity this document sizes from (`cpu_N`, the knee concurrency, `mean_service_sec`, hit rate, per-solve RSS, boot-to-first-claim) is still **unmeasured**. Phase 3's load harness and Phase 4's experiments produce them. Nothing here may be read as evidence-backed yet.

**Hard dependencies (do not build ahead of these):**
- **Measurement spec** (`2026-09-22-scnd-measurement-design.md`) must have run: it supplies the **selected topology + worker count**, the measured **mean CPU service demand at the operating concurrency** (**not** p95 wall time — M-R8: queue stability depends on `arrival rate × mean CPU demand`; p95 validates the SLO, it never sizes the tier), per-solve RSS, and the cost model. Sizing here is otherwise a guess. **Measurement is itself now deferred until Option A ships** (decided 2026-09-22, review M-R1): its topology comparison needs a worker seam that only A's durable `solve_jobs` queue provides, and without that the two specs were each blocked on the other. Effective order: **A → Measurement → Scaling**.
- **Option A** (`2026-09-22-scnd-correctness-A-full-contract.md`) provides the reliability substrate this tier builds on: durable `solve_jobs` payloads (`input_snapshot`/`model_id`), boot recovery of queued rows, the atomic `queued`→`running` CAS claim, ownership-checked completion, **a minimal owner heartbeat/expiry lease** (`claim_generation`/`owner_heartbeat_at`), the fd3 protocol, process-group supervision, composite cache identity, and the staged rollout.
- **A7's publication CAS is an inherited safety guarantee, consumed not reimplemented** (added per the review's fourth important correction). The predecessor ledger assigned stale-result publication to B2 (§13.1, item 12.6); A now owns it. A1 persists `solve_jobs.enqueued_solve_input_revision` at enqueue inside the enqueue transaction, and A7's publication CAS tests a completed job's stored value against the scenario's **current** `solve_input_revision`. This spec's retry protocol (§3.1) and its worker tier **must not weaken that predicate** — in particular a requeued attempt carries the *original* `enqueued_solve_input_revision` forward unchanged, so a retry of a job whose inputs have since moved on still fails the CAS and still does not publish. Retry must never be a path that resurrects a stale result.
- **What this spec adds on top** (decided 2026-09-22, reviews A-R2/A-R17/A-R36; the claimant registry added round 2, `worker_id` dropped round 3): the **`solve_claimants` registry** and `solve_jobs.claimant_id` (§1.3), bounded `attempts` and **all automatic retry policy**, `FOR UPDATE SKIP LOCKED` polling, per-user fairness, connection-pool sizing, backpressure/admission, and readiness-on-DB-failure. **A performs no automatic retry at all** — an ambiguous crash there ends in an honest terminal failure the student retries by hand, so the first automatic retry in this system is introduced *here*, together with the attempt bound that makes it safe. Scaling **extends** A's lease rather than replacing its recovery semantics — A's reclaim predicate is already liveness-based (stale heartbeat), which is correct for any worker count, so there is no single-instance assumption left to unwind. Don't duplicate A's queue; extend it.
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
| **O1** | Existing API instance clears the guaranteed load with headroom | Nothing in this spec. A ships; B is already shipped | Measurement decision doc recording headroom + the cost of doing nothing | **Gate set G-API** (§5.1) + MP-4, **and** an SP-1 waiver — identical to O2 *(corrected per S-R19)* |
| **O2** | A larger single API instance clears it (vertical, ≤ 12 CPU plan ceiling) | Instance-plan change only. **No** worker service, **no** scheduler, **no** retry/fairness/single-flight. `api_dispatch` mode retained (§1.2) | Plan-change record + recomputed 24/7 cost vs. burst cost | **Gate set G-API** (§5.1) + MP-4, **and** an SP-1 waiver — O2 builds nothing this spec's worker gates test |
| **O3** | One dedicated worker clears it | Worker service + §1.2 cutover + §1.3 registry + §3.1 retry + §3.2 admission/fairness + §6 retention. **No** scheduler (single worker, always on), **no** single-flight (value is ~2 redundant sub-second solves at this scale — §3) | Worker-tier implementation plan | **Gate set G-WORKER** (§5.1) + MP-4 |
| **O4** | Only a horizontal fleet clears it | All of O3, **plus** the scheduled scaler (§2) and its drain contract (§2.1), **plus** single-flight **if the coalescing condition below requires it** | Worker-tier plan + scaler runbook + (conditionally) single-flight spec | **Gate set G-FLEET** (§5.1) + MP-4 + **the coalescing condition** |

**The coalescing condition (S-R14) — one rule, stated once, referenced everywhere.** Round 2 left O4 demanding an approved single-flight spec while SP-2 offered deferral as a legitimate answer; both governed the same pilot and they cannot. The rule is now evidence-conditioned rather than a preference:

> **A fleet pilot may proceed without single-flight only if the cold-identical-burst test (§5) shows the measured duplicate compute fits inside the selected topology's capacity headroom *and* its cost budget. Otherwise the single-flight successor spec must be approved and built first.**

The test already exists in §5's reliability suite; this gives its result an authority it previously lacked. §3's SP-2 and §5 both defer to this sentence rather than restating it.

### 1.1a The policy axis — what O1/O2 actually build (S-R23)

**The matrix above is keyed on *capacity* alone, and that was an incomplete model.** SP-1 is a second, independent axis — *policy* — and O1/O2 crossed with SP-1's two answers gives four cells, of which the document only ever described one. The consequence was concrete: **the option the reviewer recommends, (a) hold the isolation rule, led nowhere.** O1/O2 said "build no worker," Stage 2 said "O1/O2 need a waiver," and there is no waiver under (a) — so the preferred answer produced no topology, no ledger trigger and no applicable gate set.

This also made SP-1 quietly unanswerable. You cannot weigh "hold the rule" against "waive it" when only the waiver branch has a written consequence. Naming both is what makes the checkpoint legitimate:

| Capacity outcome | SP-1 answer | What gets built | Ledger | Gate set |
|---|---|---|---|---|
| O1 / O2 | **(b) recorded waiver** | Nothing (O1) or an instance-plan change (O2). `api_dispatch` retained | Not triggered — no worker pools | **G-API** + MP-4 + the recorded waiver |
| O1 / O2 | **(a) hold the rule** | **The isolation-required worker path:** the *minimum* dedicated worker topology — O3's build (worker service, §1.2 cutover, §1.3 registry, §3.1 retry, §3.2 admission, §6 retention), driven by **policy, not capacity** | **Required** — completed §3.2 ledger + live ceiling | **G-WORKER** + MP-4. If the built worker cannot meet the final measured SLO, escalate to **O4 / G-FLEET** |
| O3 / O4 | Never asked — the worker tier satisfies the rule by construction | Per the matrix above | Required | G-WORKER / G-FLEET |

**Under (a), capacity says a worker is unnecessary and policy says build one anyway.** That is not a contradiction to be resolved in the document — it is precisely the trade SP-1 exists to put to an accountable owner, and it is a real cost: an always-on worker tier the measured load does not require, bought to keep a reliability rule that predates A. **Stating the cost is what lets the question be answered honestly**; hiding it behind "no pilot authority from this document" made (a) look free.

No new gate set and no new mechanism: (a) reuses O3's build and G-WORKER unchanged.

**O1 and O2 carry identical authority** *(S-R19)*. Round 3 had O1 saying "no pilot authority comes from this document" while §5.1's G-API admitted O1 under an SP-1 waiver — two sources of truth for the same waived pilot. They are the same situation: a non-isolated API tier, differing only in whether a larger instance was purchased. The stricter-sounding O1 wording was not stricter, only contradictory; the waiver is what governs, and it governs both rows.

**O2 is the row §4's "bump the instance + keep 24/7" sentence belongs to** — it is a real outcome, not a contradiction of the goal, and it is the one outcome where an autoscaled fleet would be the more expensive answer.

> **SP-1 — approval checkpoint (ask at the Measurement decision point).**
> *Measurement selected outcome O1/O2 (no worker isolation). The predecessor split ledger says worker isolation is mandatory before any real cohort pilot, regardless of topology — a rule locked before A existed, when the API had no durable queue, no lease and no drain. A has since shipped all three. Do you **(a)** hold the ledger rule, or **(b)** record an explicit, owner-attributed waiver for this pilot citing A's landed reliability substrate?*
> **Each option's consequence, so the question is answerable** *(added per S-R23 — round 5 wrote only (b)'s route, which made (a) look free and left the recommended answer leading nowhere)*:
> **(a) Hold the rule** → build the minimum dedicated worker topology anyway (§1.1a): a worker service, its cutover, registry, retry, admission and retention, plus the connection ledger and live ceiling, gated by G-WORKER. **You pay for an always-on worker tier the measured load does not require**, to keep a reliability rule written before A existed. Escalates to O4/G-FLEET if one worker misses the final measured SLO.
> **(b) Waive it** → build nothing (O1) or change the instance plan (O2), gated by G-API. **You run a real cohort on a non-isolated API tier**, relying on A's shipped durable queue, lease, boot recovery and drain — which is genuinely more than the rule's author had, and still less than isolation.
> **Two options only.** A third — "run at a reduced cohort size" — was offered in round 1 and is **withdrawn as incoherent** (round 2): the rule prohibits *any* real cohort without isolation, so a smaller cohort is still a waiver, just an unrecorded one. Shrinking the blast radius is not a technical middle path; it is (b) without the accountability.
> **Reviewer's recommendation is (a)** — hold the requirement. O1/O2 remain valid capacity and cost outcomes and are fine for internal demonstrations; they simply do not authorize a real pilot without the worker tier unless an accountable owner records the waiver.
> This is a scope reversal of a locked decision; it is not mine to make.

### 1.2 Dispatcher modes and the production cutover (S-R2)

The review is right that this was absent, and the gap is concrete rather than theoretical. A2 shipped a **recurring bounded dispatcher scan inside the API process** (`artifacts/api-server/src/solver/jobRunner.ts`, 5 s interval, batch ≤ 5/tick, `SOLVE_DISPATCHER_INTERVAL_MS`). There is **no mode flag anywhere in the codebase** — I grepped `scnd-correctness-A` for one. A worker service that also claims `solve_jobs` would therefore race the API's own dispatcher from its first boot. Measurement's harness seam is disposable; this is not.

**Normative contract:**

- **`SOLVE_DISPATCH_MODE`** — required env var, no default, **four** values (three below plus `worker_standby`, defined after them):
  - `api_dispatch` — today's behaviour, A2 unchanged. The API enqueues, kicks in-process, scans, claims, solves. Valid for O1/O2 only.
  - `enqueue_only` — the API enqueues and serves polls. It **starts no dispatcher scan, registers no in-process kick, and claims nothing.** Valid for O3/O4.
  - `worker_only` — the worker service scans and claims. It **binds no HTTP listener and serves no route.** Valid for O3/O4.
- **Startup validation is fail-closed.** An unset, unrecognised, or topology-inconsistent value aborts boot with a non-zero exit — never a silent default. `worker_only` additionally asserts that no `PORT` listener is configured; `enqueue_only` asserts `activeSolverCount() === 0` is structurally true because no pump is registered, not merely observed to be zero at one instant.
- **The lost in-process kick is a real latency cost, stated rather than hidden.** In `api_dispatch`, an enqueue immediately kicks `pump()`. In `enqueue_only`, the job waits for a worker's next scan — up to `SOLVE_DISPATCHER_INTERVAL_MS` (default 5 s) added to *every* solve start, which a student experiences as a 5-second stall before the spinner starts moving. Mitigation, in preference order: (1) Postgres `LISTEN/NOTIFY` on enqueue, worker wakes immediately, scan remains the durable fallback; (2) shorten the worker scan interval and accept the added poll load, budgeted in §3.2. **(1) is the intended design**; (2) is the fallback if `NOTIFY` proves unreliable across Render's pooler.
- **A fourth mode, `worker_standby`** (added per S-R10): the worker boots, registers in §1.3's claimant registry, proves it can reach the database and run its readiness probe, and **claims nothing**. It exists because Render's manual scaling floor is one instance — see the cutover below.
- **Cutover order (production, one deploy per step, each independently revertible):**
  1. Deploy the worker service at **one instance in `worker_standby`**. *(Corrected per S-R10 — the previous "zero instances" step contradicted this document's own §4: a manually scaled Render worker cannot go below one instance, so the cutover as written could not execute. A standby instance is the honest equivalent and is strictly better, because it actually proves boot, DB reachability and no-listener before anything claims.)* The mode is asserted at boot and visible in the registry; **standby must never silently become a second dispatcher**, which is why it is a distinct enumerated mode and not a runtime flag on `worker_only`.
  2. Flip the worker to `worker_only` and redeploy. **Both** tiers now claim — safe *in the reliability sense* (A's CAS claim and lease make double-claim impossible) but not in the capacity sense. Hold it to one deploy cycle, outside a class window.
  3. Flip the API to `enqueue_only` and redeploy. Render's zero-downtime deploy means the old `api_dispatch` revision drains for up to `maxShutdownDelaySeconds` (**120 s**, set by A14a in `render.yaml`) while still owning live solves. That overlap is expected and safe; do not try to eliminate it.
  4. **Proof before declaring cutover complete** (rewritten per S-R9 — see §1.3): after the old API revision's drain window has elapsed, assert `NOT EXISTS (running job joined to a claimant registry row whose role = 'api')`.
  5. Scale workers to the measured count.
- **Rollback is the exact reverse**, and step 3's reverse (API back to `api_dispatch`) is safe at any moment for the same reason step 2 is: two claimants cannot double-claim one row.

> **SP-4 — approval checkpoint (ask before step 3).** *Cutting the API to `enqueue_only` is the irreversible-feeling step — it is reversible by redeploy, but between step 2 and step 4 there is a window where both tiers claim. Confirm the cutover window (ideally outside a class window) and that a rollback deploy is acceptable if the worker tier misbehaves.*

### 1.3 Claimant registry (S-R9)

**The finding is correct and the defect was load-bearing in two places.** §1.2's old step 4 claimed a `claim_generation` could be recognised as "stamped by an API-tier boot." It cannot: `jobRunner.ts` allocates `bootClaimGeneration` from `solve_jobs_claim_generation_seq` once per boot and stamps that integer on claimed rows. **The integer carries no role.** Nothing in the database distinguishes generation 47 allocated by an API boot from generation 48 allocated by a worker boot, so the cutover proof was an inference dressed as a query, and `worker_id` — which I had explicitly demoted to observability — could not carry the weight either.

The second half is worse and I had not seen it: **§2.1's readiness test was unsatisfiable exactly when it matters.** `observed_ready_claimants` was defined as workers that had claimed or heartbeated within a scan interval, but an idle pre-scaled worker owns no job, so it writes no `owner_heartbeat_at` and is indistinguishable from a worker that never booted. The scaler's entire purpose is to confirm capacity is ready **before** the class generates any work — the one moment the signal is guaranteed absent.

One table fixes both, and the review is right that adopting it together with §1.2's standby step is a single change:

```
solve_claimants
  claimant_id      text primary key     -- immutable, generated at boot
  role             text not null        -- 'api' | 'worker'      (CHECK)
  mode             text not null        -- the SOLVE_DISPATCH_MODE value (CHECK)
  claim_generation integer not null     -- A's per-boot sequence value
  booted_at        timestamp not null   -- DB clock
  ready_at         timestamp            -- set once the queue probe succeeds
  heartbeat_at     timestamp not null   -- DB clock, refreshed on a fixed tick
  accepting_claims boolean not null default true
                                        -- willingness, not liveness; false from
                                        --   the moment the scan stops (S-R21)
```

**The claimable-worker predicate — defined once, used everywhere** *(S-R21)*. Round 4 introduced `accepting_claims` in prose only: it never reached the schema block above, and only §3.2's admission path adopted it, while §2.1's reconciliation kept counting merely-ready workers. During a rolling worker deploy or a scale-in, old drainers stayed fresh and ready and **inflated the scaler's own capacity count** — the very confusion the field exists to prevent, left live in the control plane while the data plane was fixed.

```sql
-- claimable_worker: the ONLY definition of "a worker that can take work"
role = 'worker'
  AND mode = 'worker_only'
  AND ready_at IS NOT NULL
  AND accepting_claims
  AND heartbeat_at > now() - claimant_staleness
```

**Every control-plane count routes through this one predicate** — §3.2's `effective_slot_count`, §2.1's scaler reconciliation, and §2.2's readiness alerting. There is no second, weaker definition anywhere; that is the whole point of naming it.

**A drainer is excluded but not invisible.** It keeps heartbeating its claimant row (§2.1 step 1), so it remains a live row with `accepting_claims = false` — distinguishable from a worker that crashed, which goes stale, and from one that never booted, which has no row. Exclusion from the count and presence in the table are different facts, and operators need both.

- **Registration happens at boot, before any claim.** A claimant that cannot register cannot claim — the registry write is on the same fail-closed path as A2's boot recovery.
- **`ready_at` is set only after the claimant proves it can *use* the queue**, not merely that it started: a read of the claim index under its own pool. Booted-but-broken is therefore distinguishable from ready, which is the distinction the scaler needs.
- **`heartbeat_at` is job-independent.** It ticks whether or not the claimant owns work, which is precisely what makes an idle pre-scaled worker observable. A's `owner_heartbeat_at` stays exactly as it is — **job liveness and claimant liveness are different questions and now have different columns.** Nothing in A is modified.
- **`accepting_claims boolean not null default true`** *(added per S-R17)*. Liveness and willingness are also different questions. A draining worker is alive, ready, `worker_only` and heartbeating — and will never claim again. **It is set false in the same transition that stops the scan** (§2.1 step 1), so there is no window where the registry advertises capacity the worker has already renounced. This is the field §3.2 counts; `ready_at` alone would count drainers.
- **`solve_jobs.claimant_id` is a nullable FK to `solve_claimants.claimant_id`** *(made normative per S-R16 — round 2 said "or an equivalent durable mapping," which left the cutover proof's join without a relational contract and contradicted §3.1's schema list, which named only `worker_id`)*. Nullable because pre-registry and legacy terminal rows have no claimant and must never be fabricated one — the same Class-1 treatment A1 already applies to its own unknowable-history columns. **Written atomically inside the CAS claim transaction**, so a row is never `running` with a null claimant, and **protected from deletion while referenced** (§6). The §1.2 cutover query and the §6 retention rule both use this one field and no other.
- **Reconciliation counts distinct live worker registry rows**, not job heartbeats (§2.1).
- **Cutover proof** is the `NOT EXISTS` join in §1.2 step 4 — a real query over a real column, not an inference about integers.

This is new schema that A does not have and this spec introduces; it is listed in §9's deliverables and its retention bound in §6.

## 2. Scheduled autoscale (the cost lever)

- Render has **no native queue-depth autoscale** (utilization-based autoscale needs a Pro workspace and reacts to CPU, not queue age). Use a **scheduled scaler: a Render Cron Job** (selected in §2.2, named here too per the round-2 consistency correction — the earlier "cron/GitHub-Action (or Render cron)" left the authority open after §2.2 had closed it). It ticks on a fixed schedule, expands §2.2's calendar to UTC occurrences, and takes the **due action idempotently** — it sets a desired instance count, never increments, so a tick that fires twice or fires late converges to the same state rather than compounding.
- Keep a **1-worker floor** off-peak (handles the distinct-trickle) unless the product accepts off-hours waits.
- Handle missed schedules, holidays, DST, and Render API failures; commands idempotent + observable; alert on unexpected worker count outside class windows.
- **Cold-start note:** a scaled-up worker pays a container boot; **treat the earlier "~1–3 min" as a historical hypothesis, not a figure to plan against** (review, third important correction). The real number is a measured output — time from scale API call to first successful claim — and pre-scale lead time is derived from it, not assumed.

**Applies only to outcome O4** (§1.1). O3 runs one always-on worker and needs no scaler; O1/O2 have no worker tier to scale.

### 2.1 Scale-in safety (S-R5)

The review frames this as a TOCTOU gap in "drain queue + leases, then scale down." The framing is correct that the check is unsafe, but the fix is not a better check — **it is to stop checking**, for a reason the original text missed:

> **Render's scale API sets a desired instance count. It does not let you choose which instance dies.** So there is no such thing as "drain the instance we are about to remove" — you cannot name it. Any pre-check is therefore not merely racy, it is answering a question about the wrong instance.

Safety comes from the worker's own shutdown behaviour plus A's lease, which together make an abruptly-removed worker a *recoverable* event rather than one to be avoided:

1. **On `SIGTERM` the worker stops claiming immediately** — cancels the scan schedule, refuses new claims, **and sets its registry row's `accepting_claims = false` in that same transition** (§1.3, per S-R17, so admission stops counting slots this worker has already renounced) — and keeps heartbeating **both** its owned jobs (`owner_heartbeat_at`, so a peer does not take them over mid-solve) **and its own claimant row** (`heartbeat_at`, so it stays observably alive-but-draining rather than vanishing into the stale-claimant path).
2. It waits for owned solves to finish, bounded by `maxShutdownDelaySeconds` (range 1–300; **120 s** is what A14a set for the API and is the starting value here). Then it closes pools and exits.
3. **Anything still running at the budget is SIGKILLed by the platform.** Its lease then goes stale at A2's 60 s threshold and the job is **requeued *or terminalized* by §3.1's conditional retry protocol**, depending on whether it had attempts left — corrected per round 3, since §3.1's conditional reclaim made the flat "requeued" here wrong the moment it landed.
4. Because step 3 is bounded and attempt-limited, scale-in never loses work and never loops.

Consequences stated plainly rather than buried:
- **A solve whose wall time can exceed the shutdown budget will occasionally be killed and retried during scale-in.** At the measured teaching-dataset times (<0.2 s optimal, ~16.5 s worst free-choice) this is far inside 120 s and effectively never fires. If measurement ever shows a solve family approaching the budget, that family needs a time-limit ceiling *before* this tier ships, not a larger budget — 300 s is a platform cap, not a lever.
- **Admission during scale-in:** the API does not stop accepting. Queue depth rises, §3.2's estimated-wait admission naturally starts shedding, and the remaining workers drain it. There is no separate "draining" admission state to implement.
- **Reconciliation, not verification:** the scaler records `desired_count`, then polls until `observed_claimable_workers` equals it. **That count is `COUNT(*)` over §1.3's `claimable_worker` predicate — the same predicate admission uses, including `accepting_claims`** *(corrected per S-R21; round 4 left this clause counting merely-ready workers, so a rolling deploy's drainers inflated it)* — and *not* job heartbeats *(corrected per S-R9; the original keyed on having claimed or heartbeated a job, which an idle pre-scaled worker never does, making the test unsatisfiable at exactly the pre-class moment the scaler exists to verify)*. A mismatch past a deadline alerts; it does not retry blindly.
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
| Alerting | Missed scale-up (window started, count below desired), unexpected count outside class windows, autoscaling-enabled, reconciliation deadline. **Every "count" here is §1.3's `claimable_worker` predicate** (S-R21) — alerting on merely-ready workers would report healthy capacity built entirely from drainers |
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

> **SP-2 — approval checkpoint (ask only if Measurement selects O4, and only if the coalescing condition fires).** *The cold-identical-burst test has shown duplicate compute exceeding the selected topology's capacity headroom or cost budget, so §1.1's coalescing condition requires single-flight before a fleet pilot. Authorize its brainstorm/spec/review cycle — on the evidence that the last attempt to shortcut this cost six review rounds — or re-scope the pilot (smaller fleet, different topology) so the condition no longer fires?*
> **Narrowed per S-R14.** Round 2's version offered "accept the duplicate-compute cost and defer coalescing" as a free choice, which contradicted O4's own pilot authority. It is no longer a preference: §1.1's coalescing condition decides whether single-flight is required, and SP-2 is asked only when that condition fires. The measured waste is the authority, not the answer to this question.
- **Gap-tuning:** the original brainstorm's biggest cost lever — but the spike found teaching datasets prove optimal in <0.2 s, so gap-tuning's real payoff is likely small here; apply only if measurement shows a slow-regime tail worth cutting, as a per-scenario input (not a solver-math branch, hard rule #6).

### 3.1 Automatic retry — the protocol (S-R3)

Accepted in full. The round-1 text offered `worker_id` + `attempts` — a schema sketch presented as a policy (and `worker_id` itself is gone as of round 3; see the schema list below). The rule this introduces is genuinely new to the system: **A performs no automatic retry at all**, by deliberate decision, so everything below is a departure from A that must be justified line by line rather than assumed.

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
- `claimant_id text` — **nullable FK to `solve_claimants.claimant_id`** (§1.3), written inside the CAS claim transaction. This is the attribution the §1.2 cutover proof and §6 retention join on.
- **`worker_id` is removed** *(per S-R16)*. Round 2 proposed it for observability *and* for the §1.2 reconciliation query — but §1.3's registry took over reconciliation and cutover attribution, leaving `worker_id` with no consumer and a stale justification still attached to it. The registry carries role, mode, generation and identity; a second, weaker identity column would only invite the two to disagree. `claim_generation` remains the fencing token, unchanged from A.

**State transitions:**
- **An attempt is consumed at claim time, not at failure time.** This is the one non-obvious call and it is deliberate: a worker that dies between claiming and writing anything never records a failure, so incrementing on recorded failure leaves a crash-loop unbounded — the exact shape that strands work forever. Incrementing inside the CAS claim transaction makes the bound real regardless of how the attempt ends.
- **Lease recovery is a single *conditional* transaction, not an unconditional requeue** *(corrected per S-R11 — this was a real hole, not a wording problem)*. The earlier text consumed an attempt at claim but then requeued on lease expiry unconditionally, so a worker killed after taking its **third** permitted attempt was requeued and claimable a fourth time, or indefinitely. The stated bound was decorative. The reclaim transaction now branches:
  - `attempts >= MAX_ATTEMPTS` → **terminalize in that same transaction**, with the §3.1 exhaustion taxonomy below (`failed`, `internal_error`, `dispatch`, `SOLVE_FAILED`). Never requeue.
  - otherwise → clear the lease and requeue with a fresh `next_attempt_at`.
- **The claim predicate additionally refuses `attempts >= MAX_ATTEMPTS`** as defence in depth, so the bound holds even if a row reaches `queued` with a full attempt count by any path this document did not foresee.
- **The old owner is already fenced with no new machinery** — A2's completion predicate is `WHERE id=? AND status='running' AND claim_generation=?`, and a requeued (or terminalized) row is neither `running` nor carrying that generation, so a late completion from a zombie owner matches zero rows and is dropped exactly as A2 already drops stale completions.
- **`enqueued_solve_input_revision` is carried forward unchanged** across every retry, so A7's publication CAS still rejects a result whose scenario has moved on (see the A7 dependency note in the preamble).
- **Backoff** is computed on the **database clock**, never a worker's, and the delay is **generated in SQL** so it is both DB-clock-authoritative and genuinely random *(corrected per S-R11 — the earlier formula was labelled "full jitter" while containing no random term, which is a contradiction I wrote and did not catch)*:

  ```sql
  next_attempt_at = now() + (random() * least(base * power(2, attempts - 1), cap)) * interval '1 second'
  ```

  That is full jitter in the intended sense — uniform over `[0, capped_backoff]`, not the capped value itself — which is what actually de-synchronizes a fleet retrying the same dead worker's jobs. `base = 5 s`, `cap = 60 s` as starting values (§10). Claim predicate gains `AND (next_attempt_at IS NULL OR next_attempt_at <= now())`.
- **Exhaustion at `MAX_ATTEMPTS = 3`** (one original + two retries): terminal `failed`, `failure_reason='internal_error'`, `failure_stage='dispatch'`, `error_code='SOLVE_FAILED'`, and the same safe student-facing message A2 already uses for retryable-looking internal failures. **No dead-letter table** — A's taxonomy columns already record everything a dead-letter row would, and a second table would need its own retention, indexes and consistency story for no added information. Exhausted rows are found by `status='failed' AND attempts >= 3`.
- **Exactly-once terminal publication is unchanged and uninvented:** it is A2's ownership predicate plus A7's CAS. Retry adds no new publication path, which is the property that keeps this protocol small.

**Tests:** attempt consumed on claim then killed before any write (bound holds); **kill a worker immediately after it takes the final permitted attempt and prove zero further claims — the row terminalizes on lease expiry rather than requeuing** (the S-R11 regression, and the one test whose absence let the hole through); stale-lease requeue with the old owner attempting completion afterwards (zero rows, no publication); each non-retryable class terminal on first failure; exhaustion terminal with the correct taxonomy; a `queued` row carrying `attempts >= MAX_ATTEMPTS` is refused by the claim predicate; `next_attempt_at` honoured under a fleet (no worker claims early) and observably jittered across a batch; retry of a job whose scenario inputs changed mid-flight still fails A7's CAS.

### 3.2 Database budget, admission and fairness (S-R7)

Accepted — these were named, not specified.

**Connection ledger — maximum simultaneous, not steady-state** *(rewritten per S-R12; the earlier budget was the right idea counted wrong)*. The failure mode is real and bites before CBC capacity does. What the earlier formula omitted is everything that makes the *peak* differ from the average:

```
peak_total =
    api_generations      × api_instances    × api_pool          -- 2 during a rolling deploy
  + worker_generations   × worker_instances × worker_pool       -- 2 during a rolling deploy
  + worker_instances     × notify_sessions                      -- ONLY if LISTEN/NOTIFY is the selected
                                                                --   wake-up mode; zero under polling
  + controller                                                  -- the §2.2 cron's advisory-lock session
  + operations_reserve                                          -- migrations, psql, incident access

worker_pool     = CONCURRENCY + 2     (claim + heartbeat + one per in-flight completion)
notify_sessions = 1 per worker        (a LISTEN session is long-lived and pinned;
                                       it cannot be shared through a transaction pool)
```

Three corrections are load-bearing:
- **`LISTEN/NOTIFY` is not free, and it is the *intended* wake-up path.** I made it §1.2's preferred design and then budgeted as if it did not exist. A listening session holds a dedicated backend for the worker's lifetime — the one connection a transaction pooler cannot multiplex away. **The `notify_sessions` term is conditional on the selected wake-up mode** (corrected per round 3: §1.2 retains shortened polling as the permitted fallback, so calling it "mandated" here overstated it). Under polling the term is zero and §3.2's cadence load rises instead — **the ledger must be recomputed for whichever mode ships**, and the choice is not free in either direction.
- **Deploy overlap doubles the tiers, and this document says so elsewhere.** §1.2 step 3 states that two API generations coexist for up to 120 s; the same is true of workers on their own deploys. Peak connections happen during a deploy, not during a class.
- **The controller holds a session** for the duration of its advisory lock (§2.2).

**The ceiling is still unknown, and the review is right about the order of operations.** `render.yaml` runs `nos-postgres` on `basic-256mb`; the post-migration audit (Task 5) recorded its real ceiling as unconfirmed and it remains so. **Do not read `SHOW max_connections` until this ledger is complete** — validating a wrong ledger against a real ceiling produces a confident wrong answer, which is worse than an open question. Sequence: complete the ledger → `SHOW max_connections` on the live instance → observe `pg_stat_activity` **under a rolling deployment**, which is the only condition that exercises the overlap term → then choose. If it does not fit, the answer is a transaction pooler (noting it cannot pool the `LISTEN` sessions) or a larger plan, and that cost lands in §4.

**Claim cadence.** Each worker scans on A2's `SOLVE_DISPATCHER_INTERVAL_MS` (5 s default) with **±20 % per-worker jitter**, so N workers do not stampede the same index on the same tick. Batch size is bounded by that worker's free slots, never a fixed constant — a worker with no free slot issues no claim query at all. With `LISTEN/NOTIFY` (§1.2) the scan is the durable fallback rather than the primary path, which is what keeps poll load flat as the fleet grows.

**Indexes.** A1 already ships `IDX_solve_jobs_queued_status` on `(queued_at, id) WHERE status = 'queued'` — oldest-first, which is the claim ordering — and `IDX_solve_jobs_owner_heartbeat_running` on `(owner_heartbeat_at) WHERE status = 'running'` for stale-lease recovery. **Both are already correct for the fleet.** `next_attempt_at` is applied as a filter on the existing index rather than a new leading column: at pilot depth the not-yet-due prefix is a handful of rows, and adding a column to the leading edge would deoptimise the common case to fix a case measurement has not yet shown exists. Revisit only on measured scan cost.

**Fairness — a per-user cap, not round-robin.** The goal is "one student cannot monopolize," and a per-user in-flight cap achieves it with a predicate:

```
MAX_RUNNING_PER_USER = 1        MAX_QUEUED_PER_USER = 3
```

The claim query skips users already at their running cap; enqueue rejects past the queued cap with a clear message. This is chosen over round-robin because round-robin under `FOR UPDATE SKIP LOCKED` needs either a per-user cursor or a window function in the claim path — both add contention to the hottest query in the system to buy an ordering property the cap already delivers. **Starvation bound:** with cap `R = 1` and `W` total slots, a user's job waits behind at most `⌈U_ahead / W⌉` service times where `U_ahead` is the count of *distinct other users* queued ahead — bounded by cohort size, not by queue depth, which is the property that matters. At 50 users × 50 solves/hr (0.694 submissions/sec) one running per user is not a practical constraint.

**Admission and `Retry-After` — wall-clock units** *(rewritten per S-R12)*. This replaces the process-local `QUEUE_DEPTH_LIMIT`, which cannot see a fleet.

**The previous formula divided queued jobs by `cpu_N`, and that was wrong in a way worth naming.** `Retry-After` is a promise to a student about wall-clock time. CPU-seconds ÷ slots yields a CPU-time answer, which understates wall-clock whenever a solve blocks or contends — and the formula also ignored the work already executing in every slot, which a newly-queued job must also wait out. Both errors push the estimate the same way: **too optimistic**, producing a `Retry-After` that expires before capacity exists and invites the retry storm admission is meant to prevent.

The honest reading is that I over-applied M-R8. That correction says *size* from mean CPU demand rather than p95 wall time; it does not say CPU demand answers wall-clock questions. **Sizing and queue-wait are different questions with different units, and Measurement already separates them in code** — `capacity.py` owns `weighted_mean_service_demand`/`required_cores` (CPU-seconds, for §4), while `simulate.py` owns the queue model and its `EventSample.solver_wall_sec`, commented in the source as *"slot occupancy — NOT cpu_tree_sec."* The instrument that distinguishes these already exists and I reached for the wrong one.

**Round 3 correction (S-R13) — the round-2 formula was dimensionally invalid, and its cited source did not exist.** It computed `remaining_work_sec` as aggregate **slot-seconds**, then divided by a throughput in **jobs/sec**, which yields neither a duration nor anything else meaningful. Worse, it named `simulate.py`'s `SimResult` as the source of `effective_completion_throughput` — **that dataclass has no throughput field** (`p50_wait`, `p95_wait`, `p95_end_to_end`, `max_queue_depth`, `utilization`, `observed_stratum_mix`), and I had read it in the same turn I cited it. A wrong `Retry-After` is not a cosmetic defect: it converts a protective admission limit into the retry storm admission exists to prevent.

**One dimensional model, slot-seconds throughout:**

```
mean_service_sec      = measured mean effective WALL service time per slot-consuming job,
                        at the selected concurrency          [seconds]
effective_slot_count  = slots_per_worker × COUNT(claimable_worker)   [slots]
                        -- claimable_worker is defined once in §1.3 and is the
                        -- same predicate the scaler reconciles on (S-R21)

remaining_slot_seconds = queued_jobs × mean_service_sec       -- work not yet started
                       + busy_slots  × mean_service_sec       -- one full service per busy slot
estimated_wait_sec     = remaining_slot_seconds / effective_slot_count
```

Slot-seconds ÷ slots = seconds. The active term charges a **full** mean service time per busy slot rather than tracking each job's residual, because over-estimating a wait is the safe direction and under-estimating is precisely this finding.

- **`mean_service_sec` is a new required Measurement output**, and this document must not invent it. It is **not** currently emitted: `simulate()` already accumulates `total_solver_wall` and uses it only to derive `utilization`, so the operand is one division away from data the simulator holds — `total_solver_wall / count(events where consumes_solver_slot)`. **Phase 3 is in the pipeline now, so this is a live, small ask rather than a late one:** add the mean (and the slot-consuming count) to `SimResult`, and carry it into the Phase 4 decision record alongside the wait percentiles.
- If the alternative jobs/sec model is preferred instead, `measured_jobs_per_sec` must be added to the Measurement artifact explicitly and the numerator converted to job-equivalents. Either model is acceptable; **mixing them is what produced this finding**, so the spec commits to the slot-seconds form above and Measurement emits its operands.
- `cpu_N` keeps cost and compute sizing only (§4, §1.1), and never answers a latency question.

**Capacity means *claimable*, not provisioned (S-R17).** The round-3 formula said `workers × slots_per_worker` without saying which workers — desired, provisioned or ready — and that ambiguity was the defect. The dangerous case is scale-in: a draining worker is alive, ready, `worker_only` and heartbeating, yet has permanently stopped claiming, so counting it inflates capacity and **shortens `Retry-After` below the true wait** — the precise failure S-R13 identified, reached by a different route. **The claimant registry is the sole live-capacity authority**; §1.3's `accepting_claims` is what distinguishes willing from merely alive, and a provisioned-but-not-yet-ready worker is excluded by `ready_at IS NOT NULL` (erring toward over-estimating the wait, the safe direction).

**Zero claimable slots is an explicit outcome, not a division.** When `effective_slot_count = 0` — mid-scale-up before any worker is ready, or every worker draining — a cold miss is rejected `503` with a "temporarily unavailable" body and a fixed conservative `Retry-After`. It must never divide by zero, and it must never promise a wait that no slot can serve. Cache hits are unaffected: they consume no slot and are served normally (see the ordering rule below).

**Admission is one transaction, not an ordering (S-R18).** Round 3 said only that the cache check precedes admission — an ordering, which does not bound anything. Under this system's *designed* load, ~50 students submitting at once, every request can concurrently observe the same low queue depth, every one passes the SLO check, and every one enqueues. **The global limit then bounds nothing, and the wait it promised was never true.** This is not an edge case; it is the target workload. (The repo has a precedent: P1.1's check-then-enqueue non-atomicity was deferred as Minor at pilot scale — defensible when the check was a crude depth cap, not defensible now that admission makes a wait *promise*.)

One short Postgres transaction performs, in order: **cache eligibility → claimable-capacity snapshot → wait calculation → admission decision → `solve_jobs` insert.** Serialization is via a **locked admission state row** (`SELECT … FOR UPDATE` on a single row) rather than `SERIALIZABLE` with retry — at 0.694 submissions/sec the contention is negligible, and a lock that is obviously correct beats a retry loop that must itself be tested under the burst. The transaction holds no solver work and no external call, so it is short by construction.

- **Ordering inside the transaction is unchanged and load-bearing:** cache eligibility first, so a student whose answer already exists is never rejected for queue depth. A cache hit takes no slot and does not advance the admission counter.
- **Tests:** a concurrent cold-miss burst at the full cohort size proving the admission bound cannot overshoot through a read/insert race; partial scale-up readiness (provisioned-but-not-ready workers do not inflate capacity); an in-flight scale-in (a draining worker stops contributing slots the moment it receives `SIGTERM`, not when it exits); **a rolling worker deploy, asserting that old drainers inflate neither admission capacity nor the scaler's reconciliation count — the same assertion against both consumers of the predicate** (S-R21); and the zero-claimable-slots path returning `503` rather than dividing.
- Reject with `429` when `estimated_wait_sec` exceeds the ratified queue-wait SLO; `Retry-After = clamp(ceil(estimated_wait_sec), 5, 120)`. The fixed `Retry-After: 30` from P1.1 is replaced.
- **`cpu_N` keeps its job** — §4's cost model and §1.1's instance sizing. It simply never answers a student-facing latency question again.
- **Ordering** is now a step inside the admission transaction below, not a standalone rule — cache eligibility first, so a student whose answer already exists is never rejected for queue depth, which would be indefensible.

## 4. Cost model (to be filled from measurement)

Frame per the original brainstorm (Render per-second billing; ~20 class-days × 3 hr = 60 peak-hr/month; shared Postgres ~$7–19/mo):
`total ≈ API(always-on) + base-worker(always-on) + Σ(burst-workers × 60hr) + Postgres + scheduler`.
**`$70/mo` is a historical hypothesis, not a target** (review, third important correction) — it predates every measurement and the whole of A. The final model charges **measured provisioned-instance seconds**, which means it must include what the estimate omitted: pre-scale lead time (workers billed before the first solve arrives), drain delay after the window, the always-on one-worker floor, the scheduler's own cron cost, the Postgres plan (including any upgrade §3.2's connection budget forces), the workspace tier if autoscaling or other Pro features are ever required, and **failed scaling actions** — a scale-up that fires and is never scaled down bills 24/7 until someone notices, which is why §2.2's "unexpected count outside class windows" alert is a cost control and not just hygiene. Note also that **a manual worker service cannot scale below one instance**; an off-hours scale-to-zero would need a different runtime and its own service-level contract, and is not assumed here.

The brainstorm's Option-B estimate was ≈ **$70/mo** (API Standard + 1 base worker + ~6 burst cores × 60 hr). **Recompute from measured mean CPU service demand + the selected topology** — **not from p95 service time** (measurement review M-R8: queue stability depends on `arrival rate × mean service demand`; sizing every request as a p95 case over-provisions, while a regime beyond p95 can dominate total compute and be missed). p95 validates the SLO, it does not size the tier. **Report both cost denominators** (per successful submitted job, and per successful CBC execution) per the Measurement spec §4. Report cost-per-successful-solve, peak-window cost, idle cost, and sensitivity to cache-hit rate + free-choice frequency. If measurement shows a single vertical box clears the load, the honest answer may be **"bump the instance + keep 24/7"** at lower operational cost than an autoscaled fleet.

## 5. Two-gate pilot verification (before real cohort)

Reuse the parent design's two independent gates. **Both remain mandatory, and capacity evidence can never waive a reliability failure** — what changes per S-R15 is *which* reliability suite applies.

- **Capacity gate:** the Measurement synthetic-load harness meets the ratified SLOs at the guaranteed rate on the selected topology.
- **Reliability gate:** the applicable suite in §5.1 passes under load.

### 5.1 Gate sets are outcome-specific (S-R15)

**The defect was real and is the same class as S-R9's unsatisfiable readiness test.** Round 2's O2 row claimed authority from "both gates," while §5's reliability suite required multi-worker `SKIP LOCKED`, standby readiness, scaler-failure and worker-retry behaviours — **none of which O2 builds.** An O2 pilot could not satisfy its own stated prerequisite, so the authority was unreachable rather than strict. A gate that cannot be passed by the thing it gates is not a safeguard; it is a dead end that invites being ignored.

| Set | Applies to | Reliability suite |
|---|---|---|
| **G-API** | O1 and O2 alike — **only under a recorded SP-1 waiver, answer (b)** (S-R19). Under answer (a) those outcomes take the isolation-required worker path and are gated by **G-WORKER** instead (§1.1a, S-R23) | Option A's own API reliability proof: restart safety, owner-lease reclaim, no-orphan, boot recovery, SIGTERM drain, A7 publication CAS. Plus API capacity evidence at the guaranteed rate. **No worker, scaler or retry tests** — there is nothing to test |
| **G-WORKER** | O3, **and O1/O2 under SP-1 answer (a)** (§1.1a) | G-API, **plus** dispatcher-mode enforcement (incl. `worker_standby` never claims), the §1.3 claimant-registry cutover proof and idle-worker readiness, multi-worker claim under `SKIP LOCKED`, retry exhaustion incl. the final-attempt kill, per-user fairness/starvation, DB outage and pool exhaustion, peak connections under a rolling deployment, deletion/cancellation mid-solve |
| **G-FLEET** | O4 | G-WORKER, **plus** missed scale-up and Render API failure, active-job scale-in (§2.1), reconciliation deadline, autoscaling-enabled detection, and the **cold-identical burst** — which under O4 is not merely informative but the input to §1.1's coalescing condition |

**Single-flight is not a gate item in any set** (S-R4, unchanged): if §1.1's coalescing condition requires the successor spec and it is built, its acceptance tests join G-FLEET. Until then no gate depends on work that does not exist.

**In every set: both applicable gates plus MP-4 are required for a pilot.** G-API additionally requires the SP-1 waiver, because without it O1/O2 authorize no real cohort at all. **This is Stage 3 of the authority ladder** (preamble): passing a gate set here is not architecture approval and not plan authorization — it is the last of three independent stages, run against the final built topology.

**Authoritative rerun on the built tier (S-R8).** Measurement selects a topology on a *prototype* seam, before this spec adds retry, fairness, admission, dispatcher modes and the scaler — additions that change both capacity (every retry is a second full CPU charge; fairness caps change queue ordering) and failure behaviour. **The gates are therefore rerun on the final built topology, and it is that rerun, not Measurement's, that authorizes anything.** Measurement's run selects; this run decides.

The rerun uses **the selected outcome's gate set from §5.1** — the contents are defined there once and not restated here.

Deliver a decision doc: per-gate pass/fail, the identified bottleneck, worker count + cost recomputed from **measured mean CPU service demand** (M-R8 again — "service time" here read as wall time, the quantity §4 already excludes). **Both applicable gates (§5.1) pass *and* MP-4 approval are required for a pilot** — a capacity pass alone authorizes nothing, and a reliability failure is not waivable by capacity evidence. Under O4 the coalescing condition (§1.1) is a further prerequisite; under O1/O2 the SP-1 waiver is.

## 6. Retention, indexes and bounds

Rehomed explicitly rather than allowed to disappear (review, second important correction). The predecessor ledger assigned items 12.15 (recovery index + bounds) and the retention row to B2; this is B2's successor, so they are this spec's.

**The volume is larger than when that ledger was written.** A's Part F added `solve_jobs.result` — the **full result envelope per run**, deliberately not a join to `result_cache` so historical export stays addressable — plus `input_snapshot` per row. Every solve now stores two JSONB documents that it previously did not, and retry multiplies rows per logical solve. Growth is the thing to bound here, and it is not a rounding error on a `basic-256mb` instance.

| Class | Bound |
|---|---|
| Terminal `solve_jobs` rows | Retention window in days; `result`/`input_snapshot` nulled on expiry **before** the row is deleted, so solve *history* (G3.2, Landing's recent solves) survives longer than the heavy payloads |
| Queued rows | Bounded by §3.2's per-user queued cap × cohort size — a structural bound, not a cleanup job |
| `result_cache` | Size or age cap with an eviction policy. **A6's composite identity means a code-hash change orphans an entire generation of entries at once** — that is the eviction trigger that matters, not gradual growth |
| Exhausted/failed rows | Same retention as terminal; no separate dead-letter store (§3.1) |
| `solve_claimants` rows (§1.3) | Retained until **no job can reference them** — a row is deletable only once no `solve_jobs` row carries its `claimant_id`. Cleanup is therefore keyed to job retention above, never to a claimant's own age; deleting a live-referenced row would destroy the cutover proof's join |
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

Worker-tier implementation plan (a later `writing-plans` pass, sized by measurement) — **including the `solve_claimants` registry (§1.3), which is new schema this spec introduces and A does not have** — the scheduled-scaler + its runbook, the completed connection ledger and its live validation (§3.2, §10), the cost report, the two-gate pilot-verification doc, and — only under O4 and SP-2 — the single-flight successor spec. **Nothing here is built before Measurement runs and §1.1's outcome row is selected** — this spec is the *target*, deliberately not an executable plan until the evidence exists.

---

## 10. Open inputs and unratified values

Nothing below is an oversight; each is a value this document is not entitled to invent. Read this section before treating any number in §§2–3 as evidence.

**Contingent decisions — someone other than the author must answer, but only once Measurement makes the question relevant** *(re-framed per S-R22; these were wrongly listed as Stage-1 gates for four rounds, which made Stage 1 unsatisfiable and forced a premature product call)*. **They are mutually exclusive by outcome:**
- **SP-1 — fires only if Measurement selects O1/O2.** Does a capacity-passing API authorize a real cohort with no worker isolation? Reverses a locked ledger decision. **Two options, (a) or a recorded waiver (b); the round-2 reviewer recommends (a).** §1.1. Under O3/O4 this question never arises — the worker tier satisfies the rule by construction.
- **Postgres `max_connections` on `basic-256mb` — needed whenever a worker tier is built: O3/O4, or O1/O2 under SP-1 answer (a)** (§1.1a). Not needed under O1/O2 + waiver (b), which builds no worker pools. Genuinely unknown in-repo. The post-migration audit (Task 5) recorded it unconfirmed and it still is. **Sequenced, per S-R12:** complete §3.2's maximum-simultaneous ledger *first*, then `SHOW max_connections` on the live instance, then observe `pg_stat_activity` **under a rolling deployment** (the only condition that exercises the deploy-overlap term). Reading the ceiling before the ledger is complete validates the wrong arithmetic confidently. If it does not fit, the pooler-or-bigger-plan cost lands in §4.

**Product inputs (SP-3), not author choices:** class calendar days/windows, IANA timezone, pre-scale lead time (derives from measured boot-to-first-claim, so it is requested *after* measurement), and the §6 retention window in days.

**Measured values this document consumes but does not have.** Measurement Phases 1–2 delivered the *instruments*; no run has produced results (see the preamble). Still unmeasured and required: `cpu_N` and the knee concurrency, **`mean_service_sec`** — mean effective *wall* service time per slot-consuming job at the selected concurrency (§3.2's admission model; **not currently emitted by any Measurement artifact**, and a live Phase 3 ask since `simulate()` already holds `total_solver_wall`), per-solve RSS, cache hit rate `h`, and boot-to-first-claim (§2's pre-scale lead time).

**Starting values, not measured results.** Every number in §§2.1/3.1/3.2 — `MAX_ATTEMPTS=3`, backoff `base=5 s`/`cap=60 s`, `MAX_RUNNING_PER_USER=1`, `MAX_QUEUED_PER_USER=3`, ±20 % scan jitter, `Retry-After` clamp 5–120 s, `worker_pool = CONCURRENCY + 2`, the 120 s shutdown budget inherited from A14a — is a **starting value to be ratified against measurement**. They are stated concretely so they can be argued with, which is the opposite of the vagueness S-R7 objected to. **Do not mistake concreteness for evidence.**

**Deferred by design, not omitted:** the single-flight protocol (§3, SP-2) — open because it needs its own spec, not because it was forgotten.

---

## 11. Review record

### Round 6 — approval review, 2026-09-23

Verbatim text in commit `ad95d3b` and collapsed below. **Accepted; no divergent remedy.** One finding, and it closes a hole the previous five rounds all walked past.

| ID | Disposition | Where |
|---|---|---|
| S-R23 — SP-1 option (a) has no Stage-2 implementation route | **Accepted.** §1.1's matrix is keyed on **capacity**; SP-1 is an independent **policy** axis. O1/O2 × SP-1's two answers is four cells, and the document had written one. The consequence: **the reviewer's own recommended answer, (a) hold the rule, led nowhere** — no topology, no ledger trigger, no applicable gate set. New §1.1a routes it to the isolation-required worker path (O3's build, driven by policy not capacity), gated by G-WORKER, escalating to O4/G-FLEET if one worker misses the final SLO. No new mechanism | **§1.1a** (new), SP-1, preamble Stage 2, §5.1, §10 |

**Why five rounds missed it.** Each earlier round asked whether a clause was *correct*; none asked whether every branch of a decision the document itself poses had somewhere to go. The matrix looked complete because its four rows were exhaustive **on the axis I had drawn** — and SP-1 was a second axis I never crossed with it. A decision offered to a product owner is part of the design's control flow, not commentary on it, and it needs the same "is every path reachable" check as code.

**It also made SP-1 quietly unanswerable, which matters more than the missing route.** Only (b) had a written consequence, so (a) read as the cautious free choice. It is not free: it buys an always-on worker tier the measured load does not require. Both consequences are now attached to the question — the checkpoint was not legitimate until they were.

### Round 5 — approval review, 2026-09-23

Verbatim text in commit `1a5a24e` and collapsed below. **Both findings accepted; no divergent remedies.** Round 5 reviewed *round 4's fold* and found two closure errors in it — neither a new subsystem, both mine.

| ID | Disposition | Where |
|---|---|---|
| S-R21 — `accepting_claims` is not one normative control-plane predicate | **Accepted.** Round 4 introduced the field in prose only: it never reached §1.3's schema block, and only §3.2's admission adopted it while §2.1's reconciliation kept counting merely-ready workers. **I fixed the data plane and left the control plane broken** — during a rolling deploy or scale-in, drainers inflated the scaler's own capacity count. One named `claimable_worker` predicate now, defined once and consumed by admission, reconciliation and alerting alike | §1.3, §2.1, §2.2, §3.2 |
| S-R22 — Stage 1 required facts only Stage 2 can produce | **Accepted.** The ladder demanded SP-1 resolved and a live-validated connection ledger *before* architecture approval — but SP-1 is asked only if Measurement selects O1/O2, and the ledger needs the selected worker count. Stage 1 was unsatisfiable, or forced a premature product decision on a question that may never be asked. Both are now **contingent decisions at Stage 2**, branched by outcome | Preamble, §10 |

**Two patterns, both already named in this document and both repeated anyway:**

- **S-R21 is the propagation failure I wrote a rule against one round earlier.** §11's round-3 entry says: *"a round that changes an enumerated set, a terminal-state rule or a mandated mechanism must grep for every clause that counts, names or relies on it before the fold is committed."* I then added a new capacity predicate and did not grep for the other clause that counts claimants. Writing the rule down did not make me run it; the rule needs to be a step in the fold, not a paragraph in the record.
- **S-R22 is the third unsatisfiable gate.** S-R9's readiness test could not fire before class; S-R15's O2 gate required a suite O2 never builds; now Stage 1 required evidence only Stage 2 can produce. Same shape every time: a prerequisite written from the perspective of someone who already has the answer. **Check for it explicitly — for each gate, name who evaluates it, when, and with what in hand.**

### Round 4 — approval review, 2026-09-23

Verbatim text in commit `1064c46` and collapsed below. **All four blocking findings accepted; no divergent remedies.** Round 4 moved from contract contradictions to the **runtime boundary** — what happens when a class burst meets a fleet whose capacity is changing underneath it. Two of the four are genuine load-control defects that would have shipped.

| ID | Disposition | Where |
|---|---|---|
| S-R17 — admission counts nominal, not claimable, capacity | **Accepted.** `workers × slots_per_worker` never said *which* workers, and the registry had liveness but no willingness. A draining worker is alive, ready, `worker_only` and heartbeating while permanently done claiming — counting it inflates capacity and **shortens `Retry-After` below the true wait**, which is S-R13's harm reached by another route. New `accepting_claims`, set false in the same transition that stops the scan; zero claimable slots now returns `503` rather than dividing by zero | §1.3, §2.1, §3.2 |
| S-R18 — cache/admission/enqueue ordered but not atomic | **Accepted.** Ordering bounds nothing. At the *designed* load — ~50 students submitting at once — every request can observe the same low depth, pass, and enqueue, so the limit bounds nothing and the promised wait was never true. One short transaction (cache eligibility → capacity snapshot → wait → decision → insert) behind a locked admission row; `SERIALIZABLE`-with-retry rejected as harder to verify at 0.694 submissions/sec | §3.2 |
| S-R19 — O1 had conflicting pilot authority | **Accepted.** O1 said "no authority from this document" while G-API admitted O1 under an SP-1 waiver. O1 now matches O2 exactly — the stricter-sounding wording was not stricter, only contradictory | §1.1, §5.1 |
| S-R20 — architecture, plan and pilot authority conflated | **Accepted.** Three-stage ladder published in the preamble. **The status line had been the worst offender**, claiming for three rounds that SP-1 and the ceiling held "implementation planning" — when A completion, Measurement Phases 3–4 and a selected topology are equally prerequisite | Preamble, §5.1 |

**What changed in the nature of the findings.** Rounds 1–3 found things the document said wrongly. Round 4 found things it said correctly *in isolation* that break when the system moves — a worker draining mid-burst, fifty requests arriving in the same instant. Both S-R17 and S-R18 are invisible to any reading that holds the fleet still. That is worth recording because the remaining unreviewed surfaces (the scaler's reconciliation loop, retry under fleet churn) have the same shape.

### Round 3 — approval review, 2026-09-23

Verbatim text in commit `eba7fb2` and collapsed below. **All four blocking findings and all three consistency edits accepted; no divergent remedies.** Round 3 found no new subsystem — it found that three of round 2's own corrections had not been propagated to the clauses that depended on them, plus one contract contradiction that predated it.

| ID | Disposition | Where |
|---|---|---|
| S-R13 — admission units incompatible, source nonexistent | **Accepted.** The round-2 formula divided slot-seconds by jobs/sec, which is dimensionally meaningless, and cited a `SimResult.effective_completion_throughput` **that does not exist** — I had read the dataclass in the same turn I cited it. One model now: `remaining_slot_seconds / effective_slot_count`. Its operand `mean_service_sec` is named as a **new required Measurement output**, one division from `simulate()`'s existing `total_solver_wall` | §3.2, §10 |
| S-R14 — O4 and SP-2 made incompatible promises | **Accepted.** O4 demanded an approved single-flight spec while SP-2 offered deferral as a legitimate answer; both governed the same pilot. Replaced by one evidence-conditioned **coalescing condition** stated once in §1.1, referenced by §3 and §5 | §1.1, §3, §5 |
| S-R15 — O2's pilot authority required a suite O2 does not build | **Accepted.** Same class as S-R9: a gate unsatisfiable by the thing it gates. Three outcome-specific gate sets — **G-API / G-WORKER / G-FLEET** — preserving "both applicable gates + MP-4" | **§5.1** (new), §1.1 |
| S-R16 — claimant attribution not normative in the job schema | **Accepted.** §1.3 said "`claimant_id` or an equivalent durable mapping" while §3.1's schema list named only `worker_id`, so the cutover proof's join had no relational contract. `solve_jobs.claimant_id` is now a nullable FK written inside the CAS claim; **`worker_id` is removed** — the registry left it with no consumer and a stale justification | §1.3, §3.1, §6 |
| Consistency ×3 | **Accepted.** "three values" → four (§1.2); SIGKILL outcome now "requeued *or terminalized*" (§2.1); the `LISTEN` session term made conditional on the selected wake-up mode (§3.2) | §1.2, §2.1, §3.2 |

**All three consistency edits were propagation failures from round 2** — I changed a clause and left its dependents asserting the old behaviour. That is exactly the failure mode this program already has a rule for (*grep the old wording before committing*), written earlier in this same effort and not applied. The fix is procedural, not textual: **a round that changes an enumerated set, a terminal-state rule or a mandated mechanism must grep for every clause that counts, names or relies on it before the fold is committed.**

### Round 2 — approval review, 2026-09-23

Verbatim text in commit `1e0f29a` and collapsed below. **All four blocking findings accepted and corrected as specified — no divergent remedies this round.** Two of them (S-R9, S-R11) were live defects rather than under-specification: the cutover proof and the readiness test were both unsatisfiable as written, and the retry bound was decorative. The reviewer is also right that S-R9 and S-R10 are **one change**, and they are folded as one.

| ID | Disposition | Where |
|---|---|---|
| S-R9 — claimant identity cannot prove cutover or readiness | **Accepted.** `claim_generation` is a bare sequence integer carrying no role, so the cutover proof was an inference dressed as a query; worse, an idle pre-scaled worker writes no `owner_heartbeat_at`, making the scaler's readiness test unsatisfiable at exactly the pre-class moment it exists for. New `solve_claimants` registry with job-independent heartbeat and `ready_at`; A's own lease untouched | **§1.3** (new), §1.2 step 4, §2.1, §5, §6, §9 |
| S-R10 — zero-instance cutover conflicts with the platform floor | **Accepted.** The document contradicted itself: §1.2 step 1 deployed at zero instances, §4 states a manual worker cannot go below one. New `worker_standby` mode as a fourth enumerated value — not a runtime flag — so standby cannot silently become a second dispatcher | §1.2 |
| S-R11 — retry exhaustion bypassable on a stale lease | **Accepted.** Attempts were consumed at claim but lease recovery requeued unconditionally, so a worker killed on its final attempt was claimable again; the bound was decorative. Conditional reclaim transaction + claim predicate refusing `attempts >= MAX_ATTEMPTS` + the final-attempt-kill test. Also: the "full jitter" formula contained no random term — replaced with a SQL `random()` expression | §3.1, §5 |
| S-R12 — connection and admission models use the wrong/unfinished units | **Accepted.** Ledger rewritten as maximum-simultaneous, adding the per-worker `LISTEN` session §1.2 mandates but never budgeted, the controller session, and deploy-overlap generations. Admission re-derived from measured wall-clock completion throughput plus active residual work; `cpu_N` retained for cost/sizing only | §3.2, §10 |
| SP-1 direction | **Accepted.** Option (c) withdrawn as incoherent — a smaller cohort is still a waiver, just unrecorded. Two options; reviewer's recommendation (a) stated | §1.1, §10 |
| Ceiling sequencing | **Accepted.** Ledger completed *before* reading `SHOW max_connections`; validation under a rolling deployment | §3.2, §10 |
| §2 consistency | **Accepted.** §2 now names Render Cron Job only, with its calendar tick and idempotent due-action behaviour | §2 |

**One thing round 2 could not have known, now recorded in the preamble:** Measurement Phases 1–2 are complete, but they delivered the *instruments* (`capacity.py`, `simulate.py`, the M1 corpus/runner/stats chain) and **no results**. That matters for S-R12's remedy specifically — the required "measured effective completion throughput" has a named source (`simulate.py`'s `SimResult`, whose `EventSample.solver_wall_sec` is commented in the source as *"slot occupancy — NOT cpu_tree_sec"*), but it does not yet have a value.

### Round 1 — deep approval review, 2026-09-23

Review text preserved verbatim in commit `02d105f`; this table is the disposition, and the corrections themselves live in the sections named. **All twelve findings accepted.** Ten corrected as requested; **S-R1 and S-R4 accepted with a different remedy than the one requested**, each argued at the point of divergence (§1.1, §3) rather than in an appendix.

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

<details>
<summary>Round 2 review text (verbatim, as received — superseded by the fold above)</summary>

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

</details>

<details>
<summary>Round 3 review text (verbatim, as received — superseded by the fold above)</summary>


**Decision: REQUEST CHANGES / not approved.** Round 2's operational corrections are sound: the claimant registry, one-worker standby cutover, conditional lease recovery, and maximum-simultaneous connection ledger are the right fixes. They do not require a redesign. This review finds three remaining contract contradictions and one required schema normalization. Together they are a compact correction bundle; after they close, the only holds should be the existing evidence/authority gates.

### New blocking findings

| ID | Finding | Evidence | Required correction before approval |
|---|---|---|---|
| **S-R13 — admission uses incompatible units and a nonexistent Measurement output** | §3.2 defines `remaining_work_sec` as aggregate slot-seconds, then divides it by `effective_completion_throughput` in jobs/sec. That is not a duration. The named source is also wrong: `simulate.py`'s `SimResult` carries wait percentiles, queue depth, utilization, and mix, but no throughput field. A false `Retry-After` is especially harmful because it turns a protective admission limit into a retry storm. | §3.2's equations and `scnd-measurement: artifacts/api-server/src/solver/tests/benchmark/simulate.py` (`SimResult`). | Choose one dimensional model and make Measurement emit its operands. Recommended runtime estimator: `estimated_wait_sec = remaining_slot_seconds / effective_slot_count`, where queued work uses measured mean effective wall service time and each busy slot contributes one full mean service time conservatively. Alternatively use `(queued_jobs + active_job_equivalents) / measured_jobs_per_sec`, but add that throughput explicitly to the Measurement artifact. Retain CPU-seconds only for compute sizing/cost. |
| **S-R14 — O4 and SP-2 make incompatible single-flight promises** | O4 says a horizontal-fleet pilot requires the approved single-flight successor spec, while SP-2 says the team may accept duplicate-compute cost for a pilot and defer coalescing. Both cannot govern the same pilot. | §1.1 O4, §3 SP-2, and §5. | Make the conditional rule identical in all three locations. Recommendation: permit a fleet pilot without single-flight only when the cold-identical-burst test proves duplicate compute fits the measured capacity and cost budget; otherwise require the successor spec. Add that test/threshold to the O4 pilot authority and the final reliability/capacity decision record. |
| **S-R15 — O2's pilot authority requires a worker suite that O2 does not build** | O2 explicitly retains `api_dispatch` and builds no worker, scheduler, retry, or worker admission/fairness changes, but its pilot authority says both §5 gates pass. §5 requires worker-only behaviours such as multi-worker `SKIP LOCKED`, standby readiness, scaler failure and worker retry tests. An O2 pilot cannot satisfy its own stated prerequisite. | §1.1 O2 and §5. | Define outcome-specific versions of the two gates: O1/O2 under an explicit SP-1 waiver run API capacity evidence plus Option A's API reliability proof; O3 runs the dedicated-worker suite; O4 runs the worker/scaler suite plus the resolved S-R14 condition. Preserve the rule that both applicable gates and MP-4 are required. |
| **S-R16 — claimant attribution is required by the proof but not yet a normative job schema field** | The new cutover proof joins a running job to `solve_claimants`, and §6 retention depends on that reference. §1.3 says to store `claimant_id` "or an equivalent durable mapping," but §3.1's actual `solve_jobs` additions list only `worker_id`; its own text still says that field serves the §1.2 reconciliation query. The proof therefore has no unambiguous relational contract. | §1.3, §3.1 schema additions, §6 retention. | Specify one concrete relationship: recommended `solve_jobs.claimant_id` nullable FK to `solve_claimants.claimant_id` (nullable for pre-registry/terminal legacy rows), populated atomically in the claim transaction and protected from deletion while referenced. Keep `worker_id` only as optional observability metadata or remove it. The cutover query and retention rule must use this same named field. |

### Non-blocking consistency edits

- §1.2 says `SOLVE_DISPATCH_MODE` has **three** values immediately before defining `worker_standby` as a fourth; correct the count.
- §2.1 says a SIGKILLed job is requeued, whereas §3.1 now terminalizes it when it exhausted its final attempt. State “requeued or terminalized by the conditional retry protocol.”
- §3.2 says `LISTEN/NOTIFY` is mandated, while §1.2 retains polling as the permitted fallback. Keep the ledger conditional on the selected wake-up mode and describe the notification session as required only when that mode is enabled.

### Approval path

1. Repair S-R13's units and measurement contract before using admission as a load-control mechanism.
2. Publish one O4 single-flight rule (S-R14) and topology-specific pilot gates (S-R15).
3. Normalize the `claimant_id` schema contract (S-R16), then make the three small wording edits above.
4. Resolve SP-1 and validate the completed connection ledger against the live Postgres ceiling. Measurement and the final built-topology rerun remain mandatory evidence gates.

**Conditional approval criterion:** I would approve the document for the measurement-sized implementation-plan pass when S-R13–S-R16 close, SP-1 is resolved, and the live connection ceiling validates the completed ledger. This does not authorize a real-cohort pilot; that still requires the selected topology's applicable gates, MP-4, and the authoritative post-build rerun.

---


</details>

---

<details>
<summary>Round 4 review text (verbatim, as received — superseded by the fold above)</summary>


**Decision: REQUEST CHANGES / not approved.** The round-three fold corrected the admission formula, topology-specific gates and claimant schema. The remaining weakness is at the runtime boundary where a class burst meets changing fleet capacity: the design counts nominal workers rather than workers that can actually claim, and it does not serialize admission with enqueue. These are load-control defects, not refinements. The approval status also needs to distinguish an architecture decision from a measurement-sized plan and a pilot.

### New blocking findings

| ID | Finding | Evidence | Required correction before approval |
|---|---|---|---|
| **S-R17 — admission counts nominal rather than claimable capacity** | §3.2 computes `effective_slot_count = workers × slots_per_worker`, but the only live worker signal (§1.3/§2.1) is readiness/liveness. During scale-in, a worker receives `SIGTERM`, stops claiming immediately, but remains a fresh `worker_only` claimant while it drains; during scale-up, provisioned workers can be not-yet-ready. Both cases make nominal slots overstate available claim capacity and understate `Retry-After`. | §2.1 SIGTERM contract; §3.2 admission formula; claimant registry has no claim-acceptance lifecycle. | Add a claimant lifecycle or `accepting_claims` field. Set it false in the same transition that stops the scan on drain; only fresh, ready, `worker_only`, claim-accepting claimant rows contribute to `effective_slot_count`. With zero claimable slots, cold misses fail explicitly as temporarily unavailable rather than dividing by zero or promising a wait. Test partial scale-up readiness and an in-flight scale-in. |
| **S-R18 — cache/admission/enqueue is ordered but not atomic** | The design requires cache check before admission but does not serialize the capacity snapshot, admission decision and `solve_jobs` insert. A class-wide burst can have many requests concurrently observe the same low queue depth, all pass the SLO, then all enqueue. The global queue limit therefore does not bound the wait it promises. | §3.2 ordering statement; the 50-user simultaneous-load target. | Define one short Postgres transaction that performs cache eligibility, claimable-capacity snapshot, wait calculation, admission decision and job enqueue together. Use a locked queue-admission counter/state row (recommended at this low rate), or an equivalent serializable conditional insert with bounded retry. Add a concurrent cold-miss burst test proving the queue-wait admission bound cannot overshoot through a read/insert race. |
| **S-R19 — O1 has conflicting pilot authority** | O1 says that no pilot authority comes from this document, but G-API includes O1 under a recorded SP-1 waiver. Both cannot be the source of truth for a waived O1 pilot. | §1.1 O1 versus §5.1 G-API. | Recommended: make O1 match O2 — G-API + MP-4 + recorded SP-1 waiver. Alternatively remove O1 from G-API. State the choice consistently in the outcome matrix, gate set and final decision record. |
| **S-R20 — architecture approval, plan authorization and pilot authorization are conflated** | The status says only SP-1 and the Postgres ceiling hold implementation planning, yet the spec also requires A completion and Phase 3/4 Measurement outputs before it can select topology, worker count, mean wall service, cache mix and pre-scale lead time. The final built-topology rerun is a separate pilot gate. | Preamble hard-dependency order, §10 missing measurements, §5 authoritative rerun. | Publish a three-stage authority ladder: (1) architecture/spec approval after S-R17–S-R19 plus the stated authority facts; (2) measurement-sized implementation-plan authorization only after A completion, Measurement results, selected topology and validated connection ledger; (3) pilot authorization only after the applicable final-built-topology gates, MP-4 and O4 coalescing condition. Do not describe stage 1 as authorization to implement the selected fleet. |

### One-pass repair strategy

Use the claimant registry as the sole live-capacity authority: add claim-acceptance lifecycle, then consume its count inside a single serialized admission/enqueue transaction. This closes both S-R17 and S-R18 without another service or queue. Align O1's authority and publish the three-stage approval ladder at the same time; those close the two remaining governance contradictions.

**Conditional approval criterion:** I would approve the architecture/spec after S-R17–S-R20 close, SP-1 is resolved, and the live Postgres ceiling validates the completed ledger. A measurement-sized implementation plan and a real-cohort pilot remain separately gated as described above.

</details>

---

<details>
<summary>Round 5 review text (verbatim, as received — superseded by the fold above)</summary>


**Decision: REQUEST CHANGES / not approved.** The live-capacity and serialized-admission design from round 4 is the correct shape. Two closure errors remain: the new `accepting_claims` state is not consistently a schema/control-plane predicate, and the authority ladder asks Stage 1 to decide facts that are unavailable until Stage 2. Neither requires a new subsystem.

### New blocking findings

| ID | Finding | Evidence | Required correction before approval |
|---|---|---|---|
| **S-R21 — `accepting_claims` is not one normative control-plane predicate** | §1.3 introduces `accepting_claims` only in prose, not in the displayed `solve_claimants` schema. §3.2 uses it for admission, but §2.1 reconciliation still counts fresh ready `worker_only` rows without it. During a rolling worker deploy or scale-in, old draining workers remain fresh and can be counted as ready/capable despite having stopped claiming. | §1.3 schema, §2.1 reconciliation predicate, §3.2 claimable-capacity predicate. | Add `accepting_claims boolean NOT NULL` to the normative table. Define one named **claimable-worker** predicate: worker role, `worker_only`, `ready_at IS NOT NULL`, fresh heartbeat, and `accepting_claims=true`. Use that exact predicate for admission, scaler reconciliation, and readiness alerts. Add rolling-worker-deploy and in-flight-scale-in tests proving old drainers never inflate the count. |
| **S-R22 — Stage 1 requires facts that can only be produced after Stage 1** | The preamble says architecture/spec approval requires SP-1 and a live connection ceiling. But SP-1 is asked only if Measurement selects O1/O2, and a complete connection ledger needs the selected worker topology/count. Both are Stage-2 facts under the document's own A → Measurement → Scaling sequence. The stated Stage-1 gate is therefore impossible or forces a premature product decision. | Preamble authority ladder; §1.1 SP-1 timing; §3.2/§10 connection-ledger inputs. | Stage 1 approves the architecture when all design findings close and records SP-1/connection capacity as contingent decisions. Stage 2, after A and Measurement select topology, requires an SP-1 waiver/decision for O1/O2 or a completed ledger plus live ceiling for O3/O4 before authorizing the selected implementation plan. Stage 3 remains the applicable final-built-topology gates, MP-4, and the O4 coalescing condition. |

### Approval path

1. Make `accepting_claims` a real schema field and route every control-plane count through the single claimable-worker predicate.
2. Correct the authority ladder so contingent product/evidence decisions occur only after Measurement makes them relevant.

**Conditional approval criterion:** I would approve the architecture/spec after S-R21 and S-R22 close. A measurement-sized implementation plan and a real-cohort pilot remain separately gated by the selected outcome and its evidence.

</details>

---

<details>
<summary>Round 6 review text (verbatim, as received — superseded by the fold above)</summary>


**Decision: REQUEST CHANGES / not approved.** The round-five fold closes the claimant control-plane and approval-timing defects. One decision path remains absent: the document recommends SP-1 option (a), holding the worker-isolation rule, but does not say what gets planned when Measurement selects an API-capacity outcome. This is a missing route, not a new reliability mechanism.

### Blocking finding

| ID | Finding | Evidence | Required correction before approval |
|---|---|---|---|
| **S-R23 — SP-1 option (a) has no Stage-2 implementation route** | §1.1 says O1/O2 build no worker; Stage 2 says O1/O2 require an SP-1 waiver; yet SP-1 explicitly offers and recommends option (a), holding the isolation rule and requiring a worker tier before any real cohort. The preferred decision therefore leads to no selected topology, no connection-ledger trigger and no applicable worker gate. | Preamble Stage 2 table, §1.1 O1/O2, SP-1. | Add an explicit Stage-2 branch: **O1/O2 + waiver (b)** follows the API/G-API path; **O1/O2 + hold rule (a)** enters an *isolation-required worker* path — build and validate the minimum dedicated worker topology, complete the worker connection ledger, and apply G-WORKER. If one dedicated worker cannot meet the final measured SLO, escalate to O4/G-FLEET. O3/O4 remain unchanged. |

### Approval criterion

After S-R23 closes, I would approve **Stage 1 — architecture/spec**. Stage 2 remains conditional on Measurement and the selected O1/O2 policy branch or O3/O4 topology; Stage 3 remains conditional on the applicable final-built-topology gate set, MP-4, and O4's coalescing condition.

</details>
