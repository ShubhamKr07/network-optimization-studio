# SCND Correctness — Full Contract (Option A) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit that passes the applicable full verification gate. Design source: `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (§§2–3; decisions Q4–Q72) **and** `docs/superpowers/specs/2026-09-20-scnd-scaling-phase0-design.md` §34 (decisions Q73–Q84, controlling). This plan turns that contract into executable tasks. **Runs AFTER Option B ships.**

**Status: BLOCKED for full execution — one task is authorized.** Three deep approval reviews (2026-09-22, rounds 1–3) returned REQUEST CHANGES; all 30 findings are folded below (disposition records + author responses at the end). Approval of *this* revision is still required and is not granted by the fold.

**Authorized now:** task **A3**, as the preparatory slice §34 permits — fd3 protocol, process-group supervision, temp-dir ownership, the terminal state machine, and the Linux no-orphan proof. It has no dependency on A0/A1/A2, and `v2_write` stays disabled throughout. **Nothing else executes until the entry gates close.**

**A3 is NOT "entirely private" — that round-2 claim was false and is withdrawn (review A-R25).** A3 carries exactly one authorized public behavior change: a solver **error envelope becomes a failed job**. Today `resultEnvelope.ts:60` accepts `status:"error"` and `jobRunner.ts:416-417` then calls **both** `writeThroughCache(...)` and `markSucceeded(...)`, so a dataset/dispatch failure is currently **cached under the inputs hash**, published to `scenarios.result`, and reported as `"scenario solve completed"`. That cached failure is returned for every later identical solve without re-running. A3 ends it: failed job, no scenario result, no cache write, `"scenario solve failed"` telemetry. **Authorized by the product owner on 2026-09-22.** Everything else in A3 stays behind the transitional adapter in A3.C; no canonical v2 scenario or cache row is written.

**Goal:** Make the async solve path *reliable and truthful under concurrency*: durable payloads, restart-safe queue recovery with owner liveness, safe process supervision, exhaustive failure taxonomy, versioned result cache, and a safe v1→v2 rollout — the reliability layer B deliberately deferred.

## Entry gates (all must close before any task other than A3 executes)

- **G-Q73 — close Q73–Q84.** §34.4 of the Phase-0 ledger is controlling and **did not pass**: §34 line 2281 states *"Until Q73–Q84 and this checklist close, neither P0R.3 nor P0R.4 is approved for execution."* Each of Q73–Q84 is mapped to an owning task below; closure means a written decision in that task, not a citation.
- **G-baseline — post-B representation inventory + canonical-source consistency pass (A0).** No rollout task executes before A0 lands.
- **G-cache — composite identity design artifact (Q35/Q41/Q75).** §2.10 of the contract design states Q35 is an **open mandatory gate**. A one-time deployed banner check is *evidence about one deployment*, not a per-instance identity — P0R.1 found the CBC build differs by architecture (`2.10.3` x64 vs `2.10.10` Linux arm64), so the identity must be **runtime-derived on each instance**. A6 does not start until this artifact exists and is **separately reviewed and approved**.
- **G-review — new consolidated approval review of this revision.** The round-1 assumption that §34 had passed was false and is removed.
- **Cohort gate:** A is justified only once a real (or synthetic-load-proven) cohort shows reliability pain. Do not execute speculatively. **Exception:** the A1+A2 recovery slice fixes a defect that is live in production today (see A2) and is not cohort-gated.

## Global constraints

- Hard rules #1 (OpenAPI+regen one commit), #2 (`e2e_accuracy.py` — B already applied the DEC correction; A must not change goldens), #3 (nullable-add + drizzle push), #4 (one task = one commit), #6 (no solver-math branches).
- **Schema authority (Q83, decided):** OpenAPI owns **public** request/response shapes. Server-owned Zod owns **private** validation — fd3 messages, cache values, raw stored rows — unless a documented one-way generator is introduced. Private failure and cache shapes are **not** exposed through OpenAPI merely to reuse generation. Every boundary where a private value becomes a public value carries an equivalence test.
- **Scope boundary with Scaling (decided 2026-09-22, revised after reviews A-R17/A-R28):** A owns durable payloads, **recurring durable dispatch**, the CAS claim, **and a minimal owner heartbeat/expiry lease** — the last is not optional. **Corrected platform wording (A-R28):** overlap is not caused by `healthCheckPath`. Render web-service deploys are **zero-downtime unless a persistent disk is attached** (`render.yaml` attaches none); health checks only decide when the new revision becomes *eligible* to take traffic. Render starts healthy new instances, switches traffic, then drains old ones, bounded by `maxShutdownDelaySeconds` (range **1–300**, default **30**). So two process generations overlap on every deploy even at one instance, and no configuration assertion can establish that a prior owner is dead. Multi-worker coordination — `worker_id`, bounded `attempts`/retry policy, `FOR UPDATE SKIP LOCKED` polling, fairness, connection-pool sizing, backpressure/admission, readiness-on-DB-failure — belongs to `2026-09-22-scnd-scaling-design.md`, sized by Measurement. Scaling **extends** A's lease; it does not replace A's recovery semantics.

---

## Task A3 — fd3 protocol + Node process-group supervisor (§2.11; Q52/Q64/Q71/Q74/Q77/Q78; review A-R10, A-R11, A-R12, A-R18, A-R23) — **AUTHORIZED PREPARATORY SLICE**

**Files:** `artifacts/api-server/src/solver/solve.py`; `artifacts/api-server/src/solver/cbc_termination.py`; `artifacts/api-server/src/solver/jobRunner.ts`; `artifacts/api-server/src/solver/solverProcessMessage.ts` (new, private Zod).

Executes **first** and independently: no dependency on A0/A1/A2. Producer and reader ship in **one commit** — splitting them leaves an intermediate deployable state where Python writes fd3 while the Node runner still reads stdout's last line (`jobRunner.ts:163`), a broken runtime and a failing gate between commits (hard rule #4). The dual-output-flag alternative is rejected: transitional protocol code costs more than the atomic commit. This is the one task that intentionally spans more than a file pair.

### A3.C — transitional compatibility contract (review A-R25)

The round-2 "entirely private" claim is withdrawn. A3's exact pre-A4/A5/A7 behavior:

- [ ] **Success compatibility — down-conversion, not migration.** The fd3 payload is `SolverSuccessEnvelopeV2`; a named `toLegacyStoredResult(envelopeV2)` converts it to the **existing post-B stored/cache/public representation** before any write. Enumerate fields **retained** (`status`, `objective`, `runTimeSec`, `quality`, `edges`, `metrics`, `details`, `solverUsed`, `infeasibilityReason`, plus B's `solutionStatus`/`terminationReason`/`achievedGap`/`solverIncumbentObjective`/`solverBestBound`) and **dropped** (every v2-only limit/version field). Output is validated by the **existing** `ResultEnvelopeSchema`, not the v2 schema. **No v2 cache entry is written**; the cache keeps its current `SOLVER_CODE_HASH` key until A6.
- [ ] **Failure compatibility — the one authorized public change.** An error-shaped envelope becomes a **failed job**: no scenario result, **no cache write**, `"scenario solve failed"` telemetry. Until A5 ships `errorCode`/`errorMessage`, the public surface is a **temporary fixed safe message** written to the existing `solve_jobs.error` column — derived from A3.T, never a raw diagnostic. Test old-client behavior against a failed job (a client expecting the old error-envelope result must degrade visibly, not crash).
- [ ] **Terminal-table staging.** A3.T's `Public`, `Cache`, and `Publish` columns are written per the *final* contract; the **Stage** column states which task activates each: A3 applies classification + the failure branch, **A5** activates the public `errorCode`/`errorMessage` serializer, **A7** activates the outcome-specific cache/publish policy. A3 must not implement A5's or A7's columns early.
- [ ] **Proof obligation:** a test asserts that after A3, **zero** canonical v2 scenario rows and **zero** v2 cache rows exist, and that `v2_write` remains disabled.

- [ ] **Private schema, defined here — not deferred to A4.** `solverProcessMessage.ts` owns the server-side Zod for `SolverProcessMessage` **and** the `SolverSuccessEnvelopeV2` payload it transports, per the schema-authority constraint. A4 later adds the *public* shapes and reuses this private one; it does not redefine it.
- [ ] **Python side:** emit on **fd 3** exactly one newline-terminated JSON object, `{envelope | failure}` (success-envelope **xor** failure), ≤1 MiB read incrementally with abort-at-cap; set fd 3 close-on-exec **before** spawning CBC. Failure = `{failureReason, failureStage, errorDetail}` with structured allowlisted detail — never raw stdout/exception/paths. Map every current `_load_error_envelope`/error exit to the failure branch with the correct `failureReason`/`failureStage` per §2.11's enums. stdout/stderr separately capped at ≤64 KiB each.
- [ ] **Node side:** spawn Python **detached** (process-group leader); read fd 3; on outer timeout/cancel send TERM→(grace)→KILL to the **whole group**; wait/reap the direct child and probe group death on a bounded interval. **Node owns** the per-solve temp dir (mkdtemp → pass the validated path in → verified idempotent removal after group death); Q77's validated-directory parameter is the exact seam.
- [ ] Implement the normative terminal table below; every row ID gets a deterministic test.
- [ ] **Containment acceptance:** Linux/POSIX-only startup fail-fast; stated TERM grace duration and probe interval; CBC log and `.sol` maximum on-disk sizes with bounded incremental reads; visible internal recording of cleanup failure; defined cancellation sources (SIGTERM/deploy, internal cancel, public cancel if one exists); repeated timeout/cancel/crash runs with no process, descriptor or artifact accumulation.
- [ ] **Go/no-go no-orphan proof on Linux (Q74):** record Python+CBC PIDs/PGID; force timeout and forced-kill including killed-parent/CBC-alive; prove no survivor, temp reclaimed, publish-once, repeated-timeout leak-free. Per Q74 this proof gates **R3/`v2_write`**, not the start of this task.
- [ ] Commit: `[A3] fd3 SolverProcessMessage + Node process-group supervisor + terminal state machine + no-orphan proof`.

### A3.T — normative terminal table (Q78; review A-R23)

Dimensions: **T** outer timeout fired · **C** cancellation fired · **X** process exit (`0` / `≠0` / open) · **M** fd3 message (`VS` valid-success · `VF` valid-failure · `missing` · `partial` · `oversize` · `invalid` · `both` · `neither`) · **K** cleanup outcome. Precedence is evaluated **once**: `T > C > (X × M)`. Cleanup never changes classification. Tests reference row IDs.

**Column activation (A-R25.3).** The table states the **final** contract. Per column: **Terminal** is activated by **A3**. **Public** is activated by **A5** — until then A3 writes the temporary safe message of A3.C into `solve_jobs.error`. **Cache**/**Publish** are activated by **A7** (and, for v2 keying, A6) — until then A3 applies only the A3.C rule that *no failed row is ever cached or published*, while successes continue through the existing post-B cache/publish path unchanged.

| ID | T | C | X | M | K | Terminal | Public | Cache | Publish | Diagnostic |
|---|---|---|---|---|---|---|---|---|---|---|
| TT-1 | Y | any | any | any | any | `timeout` | `TIMEOUT` | no | no | `failureStage=timeout`; late events dropped per TT-13 |
| TT-2 | N | Y | any | any | any | `interrupted` | `SOLVE_FAILED` / "Solve interrupted" | no | no | cancellation source recorded |
| TT-3 | N | N | 0 | VS | ok | success | — | **per A7 outcome policy** | **yes** | — |
| TT-4 | N | N | 0 | VS | fail | success | — | per A7 | **yes** | cleanup failure recorded internal-only; never double-publishes |
| TT-5 | N | N | 0 | VF | any | failed | mapped from `failureReason` | no | no | a valid failure wins **over** exit zero |
| TT-6 | N | N | 0 | missing | any | failed | `SOLVE_FAILED` | no | no | `internal_error`/`protocol` |
| TT-7 | N | N | 0 | partial \| oversize \| invalid | any | failed | `SOLVE_FAILED` | no | no | `internal_error`/`protocol` |
| TT-8 | N | N | 0 | both \| neither | any | failed | `SOLVE_FAILED` | no | no | `internal_error`/`protocol` |
| TT-9 | N | N | ≠0 | VS | any | failed | `SOLVE_FAILED` | no | no | a success message with nonzero exit **never** publishes; `internal_error`/`exit` |
| TT-10 | N | N | ≠0 | VF | any | failed | mapped from `failureReason` | no | no | message classifies |
| TT-11 | N | N | ≠0 | missing \| partial \| oversize \| invalid \| both \| neither | any | failed | `SOLVE_FAILED` | no | no | `solver_error`/`exit` |
| TT-12 | N | N | open | any | — | **not terminal** | — | — | — | wait for exit or timeout; never decide on a message alone |
| TT-13 | — | — | late | late | — | unchanged | unchanged | no | no | a message or exit arriving after any terminal row is **dropped** and recorded internal-only |
| TT-14 | N | N | no process | — | any | failed | `SOLVE_FAILED` | no | no | spawn failure; `internal_error`/`spawn` |

## Task A0 — post-B baseline inventory + canonical-source consistency pass (Q73/Q76/Q81; review A-R4, A-R9, A-R19)

**Files:** this plan; `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (header/status line, "Out of scope" line, §2.13, P0R.1/P0R.2/P0R.3/P0R.4 headings and bodies, §5 summary table).

**Part 1 — post-B representation inventory (A-R4).** §2.13 was written before the A/B split and assumes R1's writer emits v1. Post-B that is false: B introduces a third representation — truthful `solutionStatus`/`terminationReason` with **no** `envelopeVersion` and no five-schema contract.

- [ ] Inventory and name all five: (1) historical unversioned legacy rows; (2) B's truthful-but-unversioned rows; (3) canonical A v2 published results; (4) existing v1 cache entries; (5) composite-versioned v2 cache entries.
- [ ] Publish the **release-state matrix** — for R1/R2/R3/rollback/cleanup, state: stored-result reader, writer, public serializer, cache reader, cache writer, frontend behavior, flag state, deploy ordering, drain evidence, compatibility evidence, and treatment of already-written rows.
- [ ] **Decided baseline:** R1 = a **three-way** stored-result reader (legacy / B-unversioned / v2) that continues **B-format** writes. R2 = a client compatible with both B and A v2. R3 = versioned writes only after drain proof.
- [ ] **Q80 decided:** the permanent failed-job API is **`errorCode` + a permanent `errorMessage`** (server-owned safe message derived from §2.11's table). `errorMessage` is not transitional; only the *old raw* `SolveJob.error` alias is removed at cleanup.

**Part 2 — canonical-source consistency pass (A-R19).** The design source currently directs an implementer with two incompatible contracts. Fix **all** of these in one pass, so exactly one state remains:

- [ ] Header/status statement vs §5 summary table `:253`, which still reads *"go/no-go; ON HOLD (Q58); blocks P0R.3"* against the header's *"P0R.1 EXECUTED — GO; P0R.2 DONE"*.
- [ ] P0R.1 and P0R.2 headings; P0R.2's category-by-category completion status (parser/fixture/Python-wrapper complete; **jobRunner process-level portion open**, owned by A3/A13).
- [ ] **The stale public error-envelope paragraph at `:217`** — *"an error envelope is always public `solutionStatus:error` + `terminationReason:solver_error`"* — contradicts §2.11 `:139` (*"no error envelope"*, Q60=A) and §2.8. Replace with: failed job + `errorCode`/`errorMessage`, **no result publication**, no error envelope anywhere.
- [ ] §5 summary table's stale **"3 schemas"** → five, with the §2.6 names.
- [ ] P0R.3/P0R.4 headings and authorization state per the controlling §34.
- [ ] **The "Out of scope (other specs)" line**, which still routes *"durable queue / restart / … / single-flight"* to **B2**. That contradicts this plan's A2 (restart recovery) and A10 (single-flight) — a contradiction introduced by the round-1 fold. Reroute to A, leaving worker split / scheduler / topology / retention with Scaling.
- [ ] §2.13's superseded-in-part banner is already in place; reconcile its body with Part 1's matrix.
- [ ] Commit: `[A0] post-B representation inventory, release-state matrix, canonical-source consistency pass`.

## Task A1 — `solve_jobs` durable schema (§2.11/§2.12; Q59/Q61/Q68/Q79/Q84; review A-R2, A-R6, A-R17, A-R21)

**Files:** `lib/db/src/schema/solve_jobs.ts`; schema sync via `drizzle-kit push`; `artifacts/api-server/src/solver/jobRunner.ts` (enqueue writes).

All columns **nullable** on add (hard rule #3); historical rows stay null forever (§32.2.4) — never backfilled, never fabricated.

- [ ] **Failure columns:** `failure_reason`, `failure_stage`, `error_code` (checked varchar; TypeScript enums are the authority, DB check mirrors the allowed set), `error_detail` (text). The **2,048-byte** bound (§2.11) is enforced **before persistence** in application code **and** mirrored by a nullable-safe DB check written as **`octet_length(error_detail) <= 2048`** — not a character-count function, since Postgres `length()` counts characters and would silently admit ~4× the budget on multibyte diagnostics.
- [ ] **Requested-limit columns (Q79):** `requested_gap` **`double precision`**, `requested_time_limit_sec` **`integer`**, `requested_gap_source` and `requested_time_limit_source` **checked varchar pinned to the literal `'request'`** for this contract version. §2.12 is explicit — *"`source` is always `request`"* — so the earlier `request|default` enum is **removed**; introducing a `default` value requires separately authorized product work that adds a real default.
- [ ] **Durable payload columns:** `model_id`, and an immutable validated `input_snapshot` (jsonb) written at enqueue. This is what makes a queued row executable after process loss; without it the row is unrecoverable.
- [ ] **Ownership + liveness columns (A-R17, A-R21):** `claim_generation`, `claimed_at`, `owner_heartbeat_at`. **`claim_generation` authority is a Postgres sequence** (`nextval`) read once at boot — durable and monotonic across boot and crash by construction. A random UUID is an ownership *token*, not a monotonic generation, and is not used for ordering. **Deliberately excluded and owned by Scaling:** `worker_id`, bounded `attempts`, retry policy.
- [ ] **Indexes owned here, not in A2 (A-R26):** partial index on **`(queued_at, id) WHERE status = 'queued'`** — ordered, because A2's recurring dispatcher scan claims oldest-first and a bare `(status)` partial index cannot serve that ordering; index on `(owner_heartbeat_at) WHERE status = 'running'` for stale-lease recovery; the existing history-read indexes are preserved.
- [ ] `enqueueSolveJob` writes payload + requested values/sources **atomically at enqueue**, in the same insert.
- [ ] Tests: enqueue atomicity; historical-null tolerance on every read path; `input_snapshot` rejects a payload failing `SolveInput` validation; source columns reject any value but `'request'`; **multibyte diagnostic truncation** and the `octet_length` constraint; generation values are strictly increasing across simulated boots.
- [ ] Commit: `[A1] solve_jobs durable payload, ownership/liveness, failure and requested-limit columns`.

## Task A2 — durable queue, restart recovery, owner lease (review A-R2, A-R17, A-R21; Q84)

**Files:** `jobRunner.ts`; `artifacts/api-server/src/index.ts` (boot ordering + SIGTERM drain).

**The live defect this fixes — present in production today, on every deploy.** `render.yaml:8` sets `healthCheckPath`, so Render runs zero-downtime rolling deploys: the new instance boots and must pass its health check while the old instance is **still serving and still solving**. `index.ts:26` calls `reapStuckJobs()` *before* `app.listen`, and `reapStuckJobs` (`jobRunner.ts:230`) marks **every** `running` row failed on the premise that *"any `solve_jobs` row left in `running` status from a prior process is, by definition, no longer running"* (`:225-227`). During a rolling deploy that premise is false: the booting instance fails the live instance's in-flight solves. Meanwhile `index.ts:41`'s SIGTERM handler flushes PostHog/Sentry and calls `process.exit(0)` immediately — **no drain** — so the old instance's solves die mid-flight and their CBC children are orphaned. Separately, `pendingJobs` (`jobRunner.ts:90`) is process-local and the reaper never touches `queued` rows, so with `CONCURRENCY=3`/`QUEUE_DEPTH_LIMIT=30` up to 30 rows are orphaned `queued` forever while `Workspace.tsx:2753` polls them every 800 ms with no cap — an endless spinner. The in-process outer timeout (`jobRunner.ts:357`) cannot save them: that `setTimeout` dies with its process.

- [ ] **Recurring durable dispatch, not a one-time boot scan (A-R26).** A boot-only scan strands work: during a zero-downtime deploy the **old** process keeps accepting requests and enqueuing rows *after* the new process finishes its scan, and when SIGTERM lands its process-local `pendingJobs` (`jobRunner.ts:90`) vanishes — those rows stay `queued` in Postgres with nobody looking. A durable row does not make the dispatcher durable. **Decided mechanism:** a **recurring bounded dispatcher scan** on a fixed interval, claiming oldest-first via the CAS below, bounded by free worker slots. Scaling later optimizes it with `FOR UPDATE SKIP LOCKED`; the recurring scan is the robust baseline. In-process enqueue still kicks the pump directly — the scan is the safety net, not the primary path.
- [ ] **Ordering and starvation:** strict `(queued_at, id)` oldest-first, matching A1's index. No priority classes in A; per-user fairness is Scaling's. State that a persistently failing job cannot block the queue head, because a claim moves it out of `queued` before execution.
- [ ] **Exactly-once publication, at-least-once execution.** These are different guarantees and the plan states both: after an ambiguous crash a solve **may be re-executed** (it is pure with respect to the inputs snapshot), but **terminal publication is exactly-once**, enforced by the ownership predicate below. Do not claim exactly-once execution.
- [ ] **Owner lease — exact values (A-R27).** Heartbeat interval **10 s**; stale threshold **60 s** (safety factor **6×**); **clock authority is the database** (`now()` on both write and comparison — never the app clock, which can skew between generations). Takeover predicate: `UPDATE solve_jobs SET … WHERE id = ? AND status = 'running' AND owner_heartbeat_at < now() - interval '60 seconds' RETURNING` — atomic, so two scanners cannot both take over. **A reclaimed stale `running` row is terminally failed, not requeued**: re-execution is safe but auto-retry is not, because bounded `attempts` live in Scaling and an unbounded retry loop is worse than an honest failure. The student retries explicitly.
- [ ] **Heartbeat failure and drain (A-R27).** If a heartbeat refresh fails because Postgres is unavailable, the owner **fails closed**: it stops treating itself as owner and must not publish; the row is reclaimed by lease expiry. **Drain corrected — the round-2 wording was unsafe:** the draining process **keeps renewing the heartbeat while it still owns and runs the job**, and stops **only** after (a) the terminal update commits, (b) child termination is verified by A3's supervisor, or (c) an explicit atomic ownership release. Stopping renewal at SIGTERM would let the incoming generation declare a live solve stale and reclaim it. An explicit release is what makes the handoff visible to the replacement process's recurring scan.
- [ ] **Boot recovery** is the first iteration of the recurring scan, plus a one-time pass over historical rows. Runs before the server accepts traffic; if it cannot reach Postgres, boot **fails closed**.
- [ ] Atomic `queued`→`running` **CAS claim** (`UPDATE … WHERE id = ? AND status = 'queued' RETURNING`), stamping `claim_generation`, `claimed_at`, `owner_heartbeat_at` from `now()`.
- [ ] **Exact ownership-checked terminal predicate:** `WHERE id = ? AND status = 'running' AND claim_generation = ?`. A **zero-row result is a dropped stale completion** — recorded internal-only, never retried, never published.
- [ ] **Historical non-terminal rows (A-R21).** Rows predating A1 have null `input_snapshot`/`model_id` and are unrecoverable by construction. Deterministic treatment: move them once to a terminal `failed` state under the safe public error contract (`SOLVE_FAILED` + safe message). Never spin on them, never fabricate an input to re-run them.
- [ ] **SIGTERM drain** (replaces today's immediate `process.exit(0)` at `index.ts:41`): stop admitting, stop claiming, stop the recurring scan, keep heartbeating owned jobs, let in-flight solves finish or be terminated by A3's supervisor, release ownership, flush telemetry, exit inside the budget A14 defines.
- [ ] Tests: **two simultaneously alive process generations** — the new generation must not fail or steal the old generation's live job; **a row enqueued by the old generation after the new generation's first scan is still picked up**; pending queued rows survive SIGTERM reaching the old process; false-stale prevention under a slow-but-alive owner; genuine owner death reaches one deterministic terminal outcome; DB outage during heartbeat fails closed; an old owner's late completion is dropped by the zero-row predicate; SIGTERM arriving immediately before and immediately after a heartbeat renewal; boot with DB unreachable fails closed; historical null-snapshot rows terminate once.
- [ ] Commit: `[A2] durable queue: owner lease, boot recovery, CAS claim, ownership-checked completion, SIGTERM drain`.

## Task A4 — five schemas + OpenAPI + Zod + normalizer + composition (§2.6/§2.7; Q65/Q83; review A-R8)

**Files:** `lib/api-spec/openapi.yaml` (+regen `lib/api-zod`/`lib/api-client-react` same commit); `resultEnvelope.ts`; `routes/scenarios.ts`.

- [ ] `SolverSuccessEnvelopeV2` / `ResultCacheEntryV2` / `PublishedSolveResultV2` / `StoredScenarioResult` / `NormalizedSolveResult`, split by authority: OpenAPI owns `PublishedSolveResultV2` and `NormalizedSolveResult`; server Zod owns the fd3 envelope (**already defined in A3** — adopt, do not redefine), the cache entry, and the raw stored shape.
- [ ] `composePublishedResult(cacheableResult, job)` — the single composition point, applied on **both** fresh-solve and cache-hit paths, attaching the **current** job's requested values so a cache hit never returns another request's values.
- [ ] Legacy normalizer per §2.7, including the status/evidence-aware `objective` rule (a legitimate stored `0` is preserved; `===0` alone is never the test).
- [ ] Assert only the published shape reaches `scenarios.result`/public APIs; §2.4 invariant rejection, including that no failure validates as any result shape; equivalence tests at each private→public boundary.
- [ ] Commit: `[A4] five result schemas + composePublishedResult + legacy normalizer`.

## Task A5 — public `errorCode` + permanent `errorMessage` (§2.11; Q61/Q80; review A-R9, A-R24)

**Files:** `lib/api-spec/openapi.yaml`(+regen); `artifacts/api-server/src/solver/jobRunner.ts`; `artifacts/api-server/src/routes/scenarios.ts` (the solve-job polling endpoint); `artifacts/api-server/src/routes/solveHistory.ts`.

- [ ] Exhaustive `failureReason`/Node-class → `errorCode ∈ {SOLVE_FAILED, TIMEOUT}` table per §2.11 and the A3.T terminal table, with fixed safe messages (interruption → `SOLVE_FAILED` / "Solve interrupted"). `INPUT_INVALID` stays a synchronous 422 with no job.
- [ ] Permanent public shape (A0's decision): `errorCode` **plus** server-owned `errorMessage`. The raw stored `solve_jobs.error` diagnostic is never surfaced; historical failed rows read as a conservative `SOLVE_FAILED` + safe message. Move A3's interim `solve_jobs.error` writes onto the typed columns from A1.
- [ ] Negative-leakage tests across job polling, history, exports, logs and public telemetry: no `failureReason`/`failureStage`/`errorDetail`/path/secret/stdout in any public response.
- [ ] Commit: `[A5] public errorCode + permanent errorMessage + leakage tests`.

## Task A6 — composite cache identity + v2 cache (§2.10; Q35/Q41/Q75; review A-R5) — **needs G-cache**

**Files:** `jobRunner.ts` cache path; a version-manifest module.

G-cache's artifact must define, and be approved on, all of: the exhaustive sorted manifest of exact paths/artifacts; canonical path normalization, encoding, ordering, length framing, hash algorithm and output format; the exact `SOLVER_CONTRACT_VERSION` value and owner; the exact PuLP identity; a **runtime-derived** identity for the CBC executable each instance actually runs (banner/build id, binary digest, or both — stated); complete worked hash vectors with expected digests; fail-closed startup behavior and operator recovery; stability and per-component invalidation tests; and the behavior of existing unversioned cache rows, mixed instances and rollback.

- [ ] Implement exactly that artifact. `SOLVER_CODE_HASH` (today: `solve.py` only) is replaced.
- [ ] v2 cache read/write keyed on it; a parser or contract-version bump invalidates even with `solve.py` unchanged; unversioned rows are a cache miss.
- [ ] Commit: `[A6] composite solver-contract cache identity + v2 cache`.

## Task A7 — outcome-specific cache/publication lifecycle + atomic publication (§2.8; Q84; review A-R13, A-R14, A-R22)

**Files:** `jobRunner.ts` (`markSucceeded` and the branch preceding it).

**Runs after A6.** A7's `feasible` rule caches *"only under the complete effective-limit/version key,"* which does not exist until A6 lands. If A7 must land first for scheduling reasons, every v2 cache path in it stays disabled and untested-as-live until A6 is present and verified.

- [ ] Explicit outcome branch before every cache write and `markSucceeded`, per §2.8: `optimal`/`infeasible`/`unbounded` → succeeded, cache, publish · `feasible` → succeeded, cache **only** under the complete effective-limit/version key, publish with the truthful label · `no_solution` → succeeded, **no cache**, publish the no-incumbent result · execution failure → failed job, no cache, no scenario publication. Permission to cache/publish is granted only by A3.T rows TT-3/TT-4.
- [ ] **Preserve the existing atomic publication.** `jobRunner.ts:302` already updates the job result/summary and the scenario result/run pointer in one transaction; require that this stays **one** transaction, extended with A2's ownership predicate, and emit completion telemetry **only after commit**.
- [ ] Tests: every solution and failure outcome against cache and publication; fresh and cache-hit composition; transaction failure/rollback; a stale or older job's completion never overwrites a newer result.
- [ ] Commit: `[A7] outcome-specific cache/publish lifecycle + atomic publication guard`.

## Task A8 — backend result consumers + compatibility shims (§2.7.1; Q83; review A-R7)

**Files:** `artifacts/api-server/src/routes/solveHistory.ts`; `artifacts/api-server/src/routes/scenarios.ts` export paths; `artifacts/api-server/src/solver/tests/_envelope_compat.py`.

- [ ] `solveHistory.ts`: `resultSummary` gains the typed `legacyUnverified` marker; legacy summaries read as-is, tagged unverified, never promoted to proven. Exact field placement and semantics per §2.7.1 (Q83).
- [ ] Output exports (`assignments`/`openWarehouses`/`costSummary`/`serviceStats`/`flows`) reject a legacy-unverified result with **HTTP 409** + stable code **`LEGACY_RESULT_REQUIRES_RESOLVE`**. Input/template exports are unaffected (no result read).
- [ ] Mixed-collection handling: historical-legacy, B-unversioned and v2 rows in one response; history values for v2 success, legacy success, failure, and missing/malformed summaries.
- [ ] `_envelope_compat.py` is a **test shim** under `tests/`, not a production consumer — update it so fixtures do not silently discard the new evidence fields, and keep it out of the production-consumer inventory.
- [ ] Assert a legacy/unverified result is never rendered or exported as proven optimal.
- [ ] Commit: `[A8] backend result consumers: history marker, 409 export guard, mixed collections`.

## Task A9 — frontend consumers (§2.7/§2.7.1; review A-R7)

**Files:** `artifacts/studio/src/lib/quality.ts`; Studio/Workspace result and failure views; RTL tests.

A changes visible status values, nullable-objective handling, failure presentation and legacy badges beyond what B4 shipped; A previously had **no** frontend task at all.

- [ ] Render the nullable-`status` union: normalized-legacy rows (`status: null`, `legacyUnverified: true`) show a neutral unverified badge and never "Proven optimal"; `legacyStatus` is displayed as history, never as the truthful status.
- [ ] Failure rendering consumes `errorCode` + `errorMessage` (A5), not the raw diagnostic; the 409 export rejection surfaces a resolve prompt, not a generic error.
- [ ] All generated-client consumers of the nullable/expanded `status` compile and render; mixed v1/v2 collections tested.
- [ ] Commit: `[A9] frontend: nullable-status union, legacy badges, errorCode/errorMessage failures`.

## Task A10 — single-flight, instance-scoped (review A-R3, A-R20)

**Files:** `jobRunner.ts`; `lib/db/src/schema/solve_active_runs.ts` (new).

Retained in A per the 2026-09-22 decision, scoped to one instance for coherence with A2. A6's cache identity is a prerequisite, not an implementation.

- [ ] **Uniqueness scope — the round-1 contradiction, resolved.** The unique constraint is on **`(claim_generation, composite_hash)`**, not on `composite_hash` alone. A globally unique row on the hash would coordinate *every* instance, which contradicts the single-instance scope; generation-scoping makes the boundary real rather than asserted. **Scaling's migration path:** drop `claim_generation` from the unique key and gate winner election on the lease instead — stated here so it is a planned extension, not a rewrite.
**Active-run schema — normative (A-R29).** The round-2 bullet said "exact" and then listed instructions; here is the table.

| column | type | null | notes |
|---|---|---|---|
| `id` | bigserial PK | no | |
| `composite_hash` | text | no | A6's identity |
| `claim_generation` | bigint | no | owner; from A1's sequence |
| `state` | text | no | checked enum, below |
| `winner_job_id` | bigint FK `solve_jobs(id)` | no | the job that computes |
| `created_at` / `updated_at` | timestamptz | no | `now()`, DB clock per A-R27 |
| `completed_at` | timestamptz | yes | set on terminal |
| `fanout_cursor` | bigint | yes | last subscriber id completed; idempotent resumption |
| `failure_code` | text | yes | propagated to subscribers on failure |

- **Unique:** `(claim_generation, composite_hash) WHERE state IN ('electing','running','fanning_out')` — partial, so terminal rows don't block a later identical solve. **Scaling migration:** drop `claim_generation` from the key and gate election on the lease instead.
- **Subscribers:** `solve_active_run_subscribers(active_run_id, job_id PK-pair, attached_at, completed_at NULL)`. A subscriber **is** a real `solve_jobs` row — it is not a separate queue concept — so its requested metadata, ownership and latest-job guard all already exist.
- **States and permitted transitions:** `electing → running → fanning_out → {completed | failed}`; `electing → failed` (election lost/aborted); `running → failed`. No transition out of a terminal state. Any other transition is a bug and is asserted against.

- [ ] **Winner election + attachment transaction boundaries.** One transaction: insert the active-run row (unique violation ⇒ this caller is a subscriber, not the winner) and attach the caller as a subscriber. A subscriber observes its own `solve_jobs` row staying `queued` with a distinguishable "waiting on an identical run" state — it does not poll the active-run table.
- [ ] **Cache recheck transition.** After winning election and before spawning, re-read the cache under `composite_hash`. A hit short-circuits straight to `fanning_out` — this closes the window where an entry lands between the caller's own miss and its election.
- [ ] **Fan-out, per-subscriber transactions — not one global transaction.** For each subscriber, in its own transaction: `composePublishedResult` with **that job's** requested metadata, complete that job, publish to its scenario **only if** it is still the latest authorized run (A7's CAS), then advance `fanout_cursor`. Per-subscriber isolation is what makes partial failure survivable.
- [ ] **Partial fan-out failure and crash recovery.** `fanout_cursor` makes fan-out **idempotent and resumable**: recovery resumes after the cursor, never republishing an already-completed subscriber. A subscriber whose latest-job CAS fails is skipped as stale, not retried.
- [ ] **Winner failure/timeout propagation.** Winner failure sets `failure_code` and `state='failed'`; every attached subscriber is completed as failed with the same public `errorCode`/`errorMessage`. No subscriber is silently left queued.
- [ ] **Terminal retention:** terminal active-run rows are retained for a stated window for debuggability, then deleted by the same sweep that handles stale records. **Stale-record takeover** reuses A2's lease staleness: a non-terminal active-run whose owning generation's heartbeat is expired is taken over and failed, releasing its subscribers.
- [ ] Tests: N identical cold requests → exactly one solve, N correctly-composed results; winner failure propagates to all; stale active-run reclaimed; **two process generations prove the instance boundary** rather than assuming it; cache-appears-after-election path.
- [ ] Commit: `[A10] instance-scoped single-flight with subscriber fan-out`.

## Task A11 — staged v1→v2 rollout + rollback floor (§2.13; Q54/Q63/Q81; review A-R4, A-R22)

**Files:** feature-flag config; deploy runbook doc.

**Landing the default-off flag and runbook is not the same as enabling R3.** This task may land early; activation may not.

- [ ] Implement A0's release-state matrix: R1 (nullable schema + **three-way** reader, writes B-format) → R2 (client compatible with B and v2, `errorCode`/`errorMessage` alongside the old `error` for the window) → R3 (`v2_write` flag, default off).
- [ ] **R3 activation prerequisites — normative and complete (A-R30).** The round-2 list omitted A0, A1, A2 and this task's own landed flag. Full list: `A0 + A1 + A2 + A3 + A4 + A5 + A6 + A7 + A8 + A9 + A10 + A12 + A14`, **plus** this task's landed default-off flag/runbook, **plus committed and reviewed A13a** pre-activation evidence, **plus** the Linux no-orphan evidence from A3, **plus** pre-R1 drain evidence from Render deploy/health showing zero pre-R1 instances, **plus** the approved G-cache artifact. Any missing item blocks activation regardless of flag state.
- [ ] **Who authorizes and where evidence lives.** The `v2_write` flip is a **product-owner decision**, not an agent's — the same authority that signed DEC-2026-09-21-01. Activation evidence (the prerequisite checklist with commit SHAs, the no-orphan artifact, the drain proof) is recorded in `docs/CHANGELOG-implementation.md` in the same commit that enables the flag, per hard rule #9.
- [ ] Rollback floor: never below R1 once any v2 row exists; disable `v2_write` **before** rollback; concrete treatment of already-written v2 `scenarios.result`, `solve_jobs.result` and cache rows.
- [ ] Observability (Q81): the client build/contract-version signal, the named compatibility cutoff and window, and the cleanup criterion. The legacy **stored-row** reader is retained indefinitely (Q69) and is explicitly separated from the removable public-compat fields.
- [ ] Deploy order `nos-api` → `nos-studio`. Per the CLAUDE.md gotcha, expect to trigger the `nos-studio` deploy manually.
- [ ] Commit: `[A11] staged v1→v2 rollout config + R3 activation gate + rollback floor + runbook`.

## Task A12 — telemetry at real emission sites (§2.7.1/§2.11; Q56; review A-R15, A-R24)

**Files:** `artifacts/api-server/src/solver/jobRunner.ts`; `artifacts/api-server/src/lib/posthog.ts`; `artifacts/api-server/src/lib/sentry.ts`; `artifacts/api-server/src/lib/sentry.test.ts`; `artifacts/api-server/src/instrument.ts`; tests alongside each.

Two contracts, kept separate — product telemetry is not operator diagnostics:

- [ ] **PostHog (product):** `"scenario solve completed"` — necessarily v2 post-cutover, existing allowed properties retained, emitted **only after** A7's publication transaction commits. `"scenario solve failed"` — bounded `errorCode` tag only, no diagnostic contents. **No legacy-read event** (legacy is surfaced via the typed `legacyUnverified` field).
- [ ] **Sentry (operator sink):** bounded `failureReason`/`failureStage` tags plus the structured allowlisted `errorDetail`; still prohibits raw payloads, secrets, paths, stdout/stderr and arbitrary exception text.
- [ ] Tests at **every actual emission site** for the property allowlist and for no payload/objective-input/path/diagnostic leakage.
- [ ] Commit: `[A12] per-site PostHog/Sentry telemetry contracts + allowlist tests`.

## Task A14 — Render shutdown budget (review A-R28) — **owner: `devops-engineer`**

**Files:** `render.yaml`; `docs/ops/` runbook note.

No A task owned `render.yaml`, so the platform deadline A2/A3 must finish inside was unowned. `render.yaml` currently sets **no** `maxShutdownDelaySeconds`, so the drain budget is the **30 s default** (range 1–300). The request contract has **no solver time ceiling** (§2.12), so a long CBC solve can outlive the deadline and take SIGKILL before the supervisor finishes group-death proof and cleanup — orphaning exactly what A3 exists to prevent.

- [ ] Set **`maxShutdownDelaySeconds: 120`** on `nos-api`. Rationale: generous against the spike's sub-second teaching solves while far below the 300 s cap, so a deploy is never blocked for minutes by one long solve.
- [ ] **Shutdown budget, stated and summing under the platform deadline.** App-internal deadline **90 s** — a **30 s margin** below the platform's 120 s, because the platform SIGKILLs unconditionally. Allocation: stop-admission + stop-scan (immediate) → in-flight solve grace **60 s** → TERM grace **5 s** → KILL + bounded group-death probe **10 s** → temp cleanup **5 s** → DB terminal/ownership-release update **5 s** → PostHog/Sentry flush **5 s**.
- [ ] **An in-flight solve that exceeds the remaining budget is interrupted on deploy**, not allowed to overrun — it terminates via A3's supervisor and its row is released for the incoming generation, per A2's drain. Deploys are never held open by an unbounded solve.
- [ ] Test: a solve deliberately longer than the drain deadline is interrupted cleanly — no orphan process, temp reclaimed, row released, one deterministic terminal outcome.
- [ ] Commit: `[A14] render.yaml maxShutdownDelaySeconds + documented shutdown budget`.

## Task A13a — QA pre-activation gate (review A-R16, A-R22, A-R30)

**Owner:** `qa-sdet`, real browser + Linux. Every assertion traces to exactly one implementing task; no orphan acceptance criteria.

**Committed and reviewed BEFORE `v2_write` is enabled.** Round 2 put pre- and post-activation verification in one task with one commit, which under hard rule #4 forces either enabling R3 before its evidence is committed, or a task that cannot finish its second half. Split into A13a/A13b.

- [ ] Process-level (A3): missing executable, nonzero exit, every invalid fd3 form, Python and parser exceptions, cleanup failure, outer timeout, cancellation/deploy interruption, and the Linux no-orphan proof. Tests reference A3.T row IDs.
- [ ] Queue (A2): restart-mid-load with a deep queue → no stuck jobs and **exactly-once terminal publication** (execution may repeat after an ambiguous crash); **two overlapping generations** → no live job is failed or stolen, and a row enqueued by the old generation after the new one's first scan is still picked up; false-stale prevention; DB outage during heartbeat; historical null-snapshot rows terminate once.
- [ ] Shutdown (A14): a solve exceeding the drain deadline is interrupted cleanly inside the budget — no orphan, temp reclaimed, ownership released.
- [ ] Publication (A7): atomic publication, stale/older-job completion, cache-hit composition using the current job's requested values.
- [ ] Single-flight (A10): N identical cold requests → 1 solve, N composed results, instance boundary proven across two generations.
- [ ] Full verification gate + **direct** `python3 tests/e2e_accuracy.py` (99/99, objectives unchanged after B's DEC-authorized status correction) + `e2e_journey.py` repair onto `/auth/register`+`/auth/login` (argon2).
- [ ] Per the CLAUDE.md standing step, grep `artifacts/studio/e2e/` for any testid or visible string A9 changed and rewrite those sibling specs before merge.

- [ ] Commit: `[A13a] QA pre-activation gate` — **this commit is a named R3 prerequisite.**

## Task A13b — QA post-activation smoke (review A-R30)

**Runs and commits AFTER `v2_write` is enabled.**

- [ ] A v2 write lands and reads back correctly through the three-way reader; a legacy and a B-unversioned row still read correctly alongside it; cache writes carry the composite identity.
- [ ] The rollback floor is exercised once in a non-production environment: disable `v2_write`, confirm R1's three-way reader still serves the already-written v2 rows, confirm no reader falls below R1.
- [ ] Commit: `[A13b] QA post-activation smoke + rollback-floor exercise`.

## Ordering & parallelism

**A3 first** (authorized preparatory slice, independently executable). **A14 may run in parallel with A3** — it is devops-owned, touches only `render.yaml`, and A3's no-orphan proof is only trustworthy inside a budget that actually holds. Then A0 → A1 → A2 (durable spine). A4 after A3. A5 after A4 + A1. A6 after A4 + G-cache. A7 after A6. A8/A9 after A4/A5. A10 after A6 + A2. A11's flag/runbook after A0/A4/A5, but **R3 activation only after the full prerequisite list above**. A12 after A5/A7. **A13a before activation (committed + reviewed), A13b after.**

Dispatch via the agent team with **pre-created locked worktrees** (per the CLAUDE.md gotcha — do not rely on `isolation: "worktree"`); controller cherry-picks each commit onto the bundle branch and re-gates.

## Preserved principles (validated across both reviews)

Node, as the surviving actor, owns the process group and the exact solve directory · fd3 is separated from bounded stdout/stderr · a process message is success-envelope **xor** private failure, and failures never become result envelopes · requested and effective solver-limit values stay separate · cacheable and published shapes are distinct with one composition point · public failures use coarse stable codes and fixed safe messages · a pre-R1 reader is forbidden after the first canonical v2 write, and the legacy stored-row reader remains indefinitely · the Linux no-orphan proof is a real writer-activation gate, not paperwork · historical unknown metadata stays null rather than fabricated.

## Review disposition — round 1 (2026-09-22)

> Both reviews' verbatim text is preserved in **[`specs/2026-09-22-scnd-correctness-A-review-record.md`](../specs/2026-09-22-scnd-correctness-A-review-record.md)** (historical, non-normative). The tables below are the verdicts; that file is the input they were rendered against.

All 16 findings accepted; two framing corrections.

| Finding | Disposition | Landed in |
|---|---|---|
| A-R1 §34 approval assumed but absent | Accepted | Status header, G-Q73 |
| A-R2 durable payload/restart safety undesigned | Accepted on facts; A-or-Scaling binary rejected — **split** | A1, A2, scope boundary |
| A-R3 single-flight untasked | Accepted; **retained in A** | A10 |
| A-R4 rollout incompatible with post-B baseline | Accepted; §2.13 predates the A/B split | A0, A11 |
| A-R5 composite cache identity underspecified | Accepted | G-cache, A6 |
| A-R6 `request\|default` contradicts §2.12 | Accepted | A1 |
| A-R7 result-consumer migration incomplete | Accepted, **corrected**: `_envelope_compat.py` is a test shim | A8, A9 |
| A-R8 schema authority ambiguous | Accepted (Q83 already decided) | Global constraints, A4 |
| A-R9 permanent failed-job API unresolved | Accepted; **decided**: `errorCode` + permanent `errorMessage` | A0, A5 |
| A-R10 A2/A3 not independently releasable | Accepted; dual-output-flag rejected, producer+reader merged | A3 |
| A-R11 terminal contract not exhaustive | Accepted | A3.T |
| A-R12 process containment omits safeguards | Accepted | A3 |
| A-R13 cache/publication lifecycle untasked | Accepted | A7 |
| A-R14 atomic publication unprotected | Accepted | A7 |
| A-R15 telemetry ownership vague | Accepted | A12 |
| A-R16 QA validates unimplemented behavior | Accepted | A13 |

## Review disposition — round 2 (2026-09-22)

All 8 findings accepted. Three additions recorded beyond the review's own text.

| Finding | Disposition | Landed in |
|---|---|---|
| A-R17 single-instance recovery unsafe under rolling deploy | Accepted, **and escalated**: verified live in production today — `render.yaml:8` `healthCheckPath` guarantees overlap, `index.ts:26` reaps before `app.listen`, `index.ts:41` exits with no drain. Resolution: **minimal owner heartbeat + expiry lease in A** | Scope boundary, A1 liveness columns, A2 lease + drain |
| A-R18 permitted preparatory slice impossible | Accepted; **whole A3 authorized** as the preparatory slice, moved first, made dependency-free; private schema defined in A3 | Status header, A3, ordering |
| A-R19 canonical source contradictory (Q73/Q76) | Accepted; **list extended** — the design's "Out of scope" line still routes durable queue/restart/single-flight to B2, contradicting A2/A10 (introduced by the round-1 fold) | A0 Part 2 |
| A-R20 A10 uniqueness contradicts single-instance claim | Accepted; unique key scoped to `(claim_generation, composite_hash)` with a stated Scaling migration; fan-out made exact | A10 |
| A-R21 durable-schema/recovery edge cases open | Accepted; generation = Postgres sequence, historical-null rows terminate once, indexes moved to A1, exact terminal predicate, `octet_length` | A1, A2 |
| A-R22 R3 activation dependencies permit incomplete R3 | Accepted; activation prerequisite list made normative, A6 ordered before A7, QA split pre/post activation | A11, A7, A13 |
| A-R23 Q78 terminal table deferred to implementation | Accepted; table published with row IDs | A3.T |
| A-R24 telemetry/route seams unnamed | Accepted; exact files named | A5, A12 |

**Additions beyond the review:** (1) A-R17 is a live defect, not only a design flaw — the current SIGTERM handler performs no drain and orphans CBC children; (2) A-R19's correction list was incomplete as written; (3) the in-process outer timeout (`jobRunner.ts:357`) cannot terminate a row whose process died, so "let it time out" was never a viable recovery strategy.

**Approval remains explicit.** Closing A-R1–A-R24 does not self-approve the plan; a new consolidated review must record the approval decision.

---

## Review disposition — round 3 (2026-09-22)

All 6 findings accepted. One product-owner authorization obtained. Verbatim review text: see the review record linked above.

| Finding | Disposition | Landed in |
|---|---|---|
| A-R25 A3's "private-only" boundary self-contradictory | Accepted, **and escalated** — the current error path also *caches* the failure, not only publishes it. Resolution: the behavior change is **authorized**, the "entirely private" claim is **withdrawn** | Status header, A3.C, A3.T column-activation note |
| A-R26 boot-only recovery strands rows across deploy overlap | Accepted; **recurring bounded CAS dispatcher scan** adopted as the baseline; index reshaped to `(queued_at, id)`; exactly-once *publication* separated from at-least-once *execution* | A1 index, A2 |
| A-R27 lease/expiry/drain semantics undecided | Accepted; concrete values recorded (10 s / 60 s / 6× / DB clock), stale row **terminally failed not requeued**, and the unsafe round-2 drain wording corrected | A2 |
| A-R28 Render shutdown budget unowned | Accepted; new devops-owned task; platform wording corrected from "`healthCheckPath` guarantees overlap" to the zero-downtime/no-disk lifecycle; field semantics verified against the `render-web-services` skill | A14, scope boundary |
| A-R29 A10 labels an undecided schema "exact" | Accepted without reservation — the round-2 bullet listed instructions, not a schema. Normative table, state machine and fan-out protocol now published | A10 |
| A-R30 R3 prerequisite list and QA commit structure incomplete | Accepted; list completed with A0/A1/A2/A14 and the landed flag; QA split into **A13a** (committed pre-activation) and **A13b** (post-activation) | A11, A13a, A13b |

---

## Author responses to review (kept for later review)

Per-finding reasoning behind each verdict, with the evidence each was checked against. Recorded here because the disposition tables compress a verdict to one cell, and a later reviewer needs to audit *why* a finding was accepted, corrected, or escalated — not just that it was. **Non-normative**: where a response conflicts with a task body, the task body wins.

### Round 3

- **A-R25 — accepted and escalated.** Verified `resultEnvelope.ts:60` accepts `status: "error"`, and `jobRunner.ts:416-417` then runs `writeThroughCache(...)` **and** `markSucceeded(...)` in sequence. So the current behavior is not merely "an error envelope publishes as a result" — it also **poisons the cache under the inputs hash**, so every later byte-identical solve replays the stored failure without re-running, and the run is reported as `"scenario solve completed"`. The review named the job-status and scenario-result halves; the cache half is a third observable. That made the round-2 "entirely private" claim indefensible and also settled the compatibility question: preserving today's behavior behind an adapter would mean deliberately keeping a cache-poisoning bug alive for the whole A3→A5 window. Product owner authorized the change on 2026-09-22.
- **A-R26 — accepted, no reservation.** The scenario is exact: the old generation keeps serving and enqueuing after the new generation's one-time scan, and `pendingJobs` (`jobRunner.ts:90`) is process-local, so those rows have no in-memory owner anywhere. Took the recurring CAS scan over the handoff option — a handoff still needs a fallback for hard kills, at which point it is a lease with extra moving parts. The index correction is right and consequential: a bare `(status) WHERE status='queued'` partial index cannot serve an ordered oldest-first claim.
- **A-R27 — accepted; round-2 drain wording was genuinely unsafe.** The specific defect: round 2 said "stop heartbeat renewal for jobs being handed off", which lets the incoming generation declare a *live* solve stale and reclaim it — reintroducing A-R17's race through the drain path. Corrected to renew until terminal update, verified child termination, or explicit atomic release. Chose **terminal-fail over requeue** for a reclaimed stale row because bounded `attempts` live in Scaling; without them an auto-requeue is an unbounded retry loop, which is worse than an honest failure the student can retry. Chose **database clock** because two generations can skew against each other and a lease comparison must be single-authority.
- **A-R28 — accepted; my platform wording was wrong.** I attributed deploy overlap to `healthCheckPath`. Verified against the `render-web-services` skill: deploys are zero-downtime **unless a persistent disk is attached** (`render.yaml` attaches none), health checks only gate *eligibility*, and `maxShutdownDelaySeconds` is range **1–300**, default **30**. Confirmed `render.yaml` sets neither the field nor a disk. The ownership gap was real — no A task owned `render.yaml`, so A3's no-orphan proof was being written against a deadline nobody controlled. Chose 120 s platform / 90 s internal: generous against sub-second teaching solves, far below the cap, and with a real margin because the platform SIGKILL is unconditional.
- **A-R29 — accepted, no defence.** The round-2 bullet said "Active-run schema, exact:" and then listed the *topics* to decide. That is the same compression failure round 1 correctly flagged in the original plan, repeated by me one level down. Replaced with an actual column table, a checked state enum with permitted transitions, and a `fanout_cursor` making fan-out idempotent and resumable.
- **A-R30 — accepted.** Verified the round-2 list omitted A0, A1, A2 and this task's own landed flag. The QA point is a real hard-rule-#4 conflict: one task with one commit cannot hold evidence that must be committed *before* activation and smoke that must run *after*. Split into A13a/A13b.

### Round 2 (retrospective)

- **A-R17** — accepted and escalated from design flaw to **live production bug**: `render.yaml` attaches no disk so deploys are zero-downtime; `index.ts:26` runs `reapStuckJobs()` before `app.listen`, so the booting instance fails the live instance's running jobs; `index.ts:41` exits on SIGTERM with no drain, orphaning CBC children. Resolved by adding a minimal owner heartbeat to A, which also removed the "one predicate Scaling must remember to replace" landmine rather than merely documenting it.
- **A-R18** — accepted; the contradiction was mine (an atomic A3 cannot have an executable "half", and the ordering made A0–A2 false prerequisites).
- **A-R19** — accepted with the list **extended**: the design's "Out of scope" line still routed durable queue/restart/single-flight to B2, contradicting A2/A10 — a contradiction the round-1 fold itself introduced.
- **A-R20** — accepted; a globally unique row on the composite hash coordinates every instance, so the uniqueness mechanism and the single-instance non-goal could not both hold.
- **A-R21** — accepted; `octet_length` was the sharpest item, since Postgres `length()` counts characters and would admit roughly 4× the intended byte budget on multibyte diagnostics.
- **A-R22** — accepted; the A6→A7 edge was a real ordering bug, as A7's `feasible` rule needs a cache key A6 has not yet defined.
- **A-R23, A-R24** — accepted; both were under-delivery on my part, not disagreements.

### Round 1 (retrospective)

All 16 accepted, with two corrections to the review's framing:

- **A-R7** — the finding listed `_envelope_compat.py` among production result consumers. It lives at `artifacts/api-server/src/solver/tests/_envelope_compat.py` and the design (§2.6) already calls it a test shim, so it belongs in the QA/fixture task, not the consumer inventory. Everything else in the finding held.
- **A-R2** — the finding offered a binary (A owns everything / Scaling owns everything). Rejected in favour of a split, since lease semantics with no second consumer is speculative machinery. *Note: round 3's A-R17 later forced a minimal lease back into A anyway — for rolling-deploy safety, not for multi-worker coordination — so the split survived but its boundary moved by one column.*

A cross-cutting note for a later reviewer: the recurring failure mode across all three rounds was **compression** — a normative decision in a long design source being restated as a topic heading in a shorter plan, which reads as decided and is not. A-R29 is the cleanest example. When auditing a future revision, treat any bullet whose body lists *what to decide* rather than *the decision* as an open finding regardless of the word "exact".
