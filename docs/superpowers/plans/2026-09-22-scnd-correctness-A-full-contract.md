# SCND Correctness — Full Contract (Option A) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit that passes the applicable full verification gate. Design source: `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (§§2–3; decisions Q4–Q72) **and** `docs/superpowers/specs/2026-09-20-scnd-scaling-phase0-design.md` §34 (decisions Q73–Q84, controlling). This plan turns that contract into executable tasks. **Runs AFTER Option B ships.**

**Status: BLOCKED for full execution — one task is authorized.** Three deep approval reviews (2026-09-22, rounds 1–3) returned REQUEST CHANGES; all 30 findings are folded below (disposition records + author responses at the end). Approval of *this* revision is still required and is not granted by the fold.

**Authorized now: A3 and A14.** A3 is the preparatory slice §34 permits — fd3 protocol, process-group supervision, temp-dir ownership, the terminal state machine, and the Linux no-orphan proof; it has no dependency on A0/A1/A2 and `v2_write` stays disabled throughout. **A14 is authorized with it (product owner, 2026-09-22, review A-R31.4):** it only sets `maxShutdownDelaySeconds` in `render.yaml` and documents the budget — no schema, no contract, no v2 write — and A3's no-orphan proof is otherwise measured against an unowned 30 s default that may not hold in production. **Nothing else executes until the entry gates close** — see the gate matrix, which states per gate what may run in order to close it.

**A3 is NOT "entirely private" — that round-2 claim was false and is withdrawn (review A-R25).** A3 carries exactly one authorized public behavior change: a solver **error envelope becomes a failed job**. Today `resultEnvelope.ts:60` accepts `status:"error"` and `jobRunner.ts:416-417` then calls **both** `writeThroughCache(...)` and `markSucceeded(...)`, so a dataset/dispatch failure is currently **cached under the inputs hash**, published to `scenarios.result`, and reported as `"scenario solve completed"`. That cached failure is returned for every later identical solve without re-running. A3 ends it: failed job, no scenario result, no cache write, `"scenario solve failed"` telemetry. **Authorized by the product owner on 2026-09-22.** Everything else in A3 stays behind the transitional adapter in A3.C; no canonical v2 scenario or cache row is written.

**Goal:** Make the async solve path *reliable and truthful under concurrency*: durable payloads, queue recovery with owner liveness, safe process supervision, exhaustive failure taxonomy, versioned result cache, and a safe v1→v2 rollout — the reliability layer B deliberately deferred. **"Recovery" here means no job is stranded in a non-terminal state — not that every job eventually runs.** A performs **no automatic retry** (A-R36); a crash at an ambiguous moment can end in an honest terminal failure the student retries.

## Entry gates — matrix (review A-R31)

The round-3 phrasing was circular: a single "all gates close before any non-A3 task executes" rule blocked A0 from running to close `G-baseline`, blocked the very tasks whose written decisions close `G-Q73`, and let `G-cache` block tasks that never touch the cache. **Each gate now names what it blocks and what is allowed to run in order to close it.** Where two statements disagree, this matrix controls.

| Gate | Blocks | Explicitly allowed to run **in order to close it** | Closure means |
|---|---|---|---|
| **G-Q73** — Q73–Q84 unclosed (§34 line 2281: *"Until Q73–Q84 and this checklist close, neither P0R.3 nor P0R.4 is approved"*) | Execution of any task's **code**, except the authorized preparatory slice | Writing the decisions **into** A0–A14 task bodies (a documentation act, not execution) | Every Q73–Q84 has a written decision in its owning task — design-decision closure, **not** acceptance evidence |
| **G-baseline** — post-B inventory + canonical-source consistency pass | A4, A5, A7, A8, A9, A11 (every representation/rollout consumer) | **A0 itself** | A0 committed |
| **G-cache** — composite identity artifact (Q35/Q41/Q75) | **A6 and A6's consumers only** — A7's v2 cache paths, A10, R3 activation. It does **not** block A0/A1/A2/A3/A4/A5/A14 | Authoring and reviewing the artifact | Artifact separately reviewed and **approved** |
| **G-review** — consolidated approval of this revision | All non-preparatory execution | This fold, and the next review | An explicit recorded approval decision |
| **Cohort gate** — reliability pain not yet demonstrated | Speculative execution of the reliability layer | — | Real or synthetic-load-proven cohort evidence |

**Cohort-gate exceptions, stated (A-R31.5):** **A3** and **A14** are exempt because §34's preparatory authorization is independent of cohort evidence — it exists precisely to *produce* evidence. **A1+A2** are exempt because they fix a defect live in production today (see A2). No other task is exempt.

**G-cache rationale (unchanged):** §2.10 calls Q35 an open mandatory gate. A one-time deployed banner check is evidence about one deployment, not a per-instance identity — P0R.1 found the CBC build differs by architecture (`2.10.3` x64 vs `2.10.10` Linux arm64), so the identity must be **runtime-derived on each instance**.

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
- [ ] **Latest-request publication authority (A-R32).** Add nullable **`scenarios.latest_solve_job_id`** (`integer`, FK → `solve_jobs.id`, `onDelete: "set null"`, matching `result_run_id`'s existing types), set to the new job id **atomically with enqueue** in the same transaction as the `solve_jobs` insert. This is the authority A7's publication CAS tests against. **`result_run_id` keeps its existing meaning** — provenance of the *currently published* result — and must not be overloaded: it is written at publish time, so it cannot tell whether job 1 is stale after job 2 was requested. Without the new column the plan cannot prevent: enqueue job 1 → resubmit as job 2 → job 2 publishes → job 1 completes and overwrites it. Index `scenarios(latest_solve_job_id)`.
- [ ] **Recovery identity — no new columns needed (A-R33).** Enqueue-time identity is **already durably captured**: `solve_jobs.inputs_hash` is `notNull` (`solve_jobs.ts:12`) and `computeInputsHash` (`jobRunner.ts:110-116`) is `sha256(modelId + datasetVersion + SOLVER_CODE_HASH + canonicalJson(inputs))`. A2 recomputes it at claim time and compares. Separate `dataset_version`/`solver_version` columns would duplicate this, and A1+A2 therefore do **not** need to depend on G-cache. **Stated gap:** `SOLVER_CODE_HASH` hashes only `solve.py` (§2.10), so a `cbc_termination.py`-only change is invisible to this comparison until A6 substitutes the composite identity into the same check. A6's swap is a drop-in — the comparison logic does not change.
- [ ] **Ownership + liveness columns (A-R17, A-R21):** `claim_generation`, `claimed_at`, `owner_heartbeat_at`. **`claim_generation` authority is a Postgres sequence** (`nextval`) read once at boot — durable and monotonic across boot and crash by construction. A random UUID is an ownership *token*, not a monotonic generation, and is not used for ordering. **Deliberately excluded and owned by Scaling:** `worker_id`, bounded `attempts`, retry policy.
- [ ] **Indexes owned here, not in A2 (A-R26):** partial index on **`(queued_at, id) WHERE status = 'queued'`** — ordered, because A2's recurring dispatcher scan claims oldest-first and a bare `(status)` partial index cannot serve that ordering, and **partial so A10's `waiting_on_active_run` rows are structurally unclaimable** (A-R34); index on `(owner_heartbeat_at) WHERE status = 'running'` for stale-lease recovery; index `scenarios(latest_solve_job_id)`; the existing history-read indexes are preserved.
- [ ] **Job status value set.** Add **`waiting_on_active_run`** to the internal `solve_jobs.status` CHECK (A-R34). It is internal-only — the public serializer renders it as `queued`, and no OpenAPI enum value is added.
- [ ] `enqueueSolveJob` writes payload + requested values/sources **atomically at enqueue**, in the same insert.
- [ ] Tests: enqueue atomicity; historical-null tolerance on every read path; `input_snapshot` rejects a payload failing `SolveInput` validation; source columns reject any value but `'request'`; **multibyte diagnostic truncation** and the `octet_length` constraint; generation values are strictly increasing across simulated boots.
- [ ] Commit: `[A1] solve_jobs durable payload, ownership/liveness, failure and requested-limit columns`.

## Task A2 — durable queue, restart recovery, owner lease (review A-R2, A-R17, A-R21; Q84)

**Files:** `jobRunner.ts`; `artifacts/api-server/src/index.ts` (boot ordering + SIGTERM drain).

**The live defect this fixes — present in production today, on every deploy.** `render.yaml:8` sets `healthCheckPath`, so Render runs zero-downtime rolling deploys: the new instance boots and must pass its health check while the old instance is **still serving and still solving**. `index.ts:26` calls `reapStuckJobs()` *before* `app.listen`, and `reapStuckJobs` (`jobRunner.ts:230`) marks **every** `running` row failed on the premise that *"any `solve_jobs` row left in `running` status from a prior process is, by definition, no longer running"* (`:225-227`). During a rolling deploy that premise is false: the booting instance fails the live instance's in-flight solves. Meanwhile `index.ts:41`'s SIGTERM handler flushes PostHog/Sentry and calls `process.exit(0)` immediately — **no drain** — so the old instance's solves die mid-flight and their CBC children are orphaned. Separately, `pendingJobs` (`jobRunner.ts:90`) is process-local and the reaper never touches `queued` rows, so with `CONCURRENCY=3`/`QUEUE_DEPTH_LIMIT=30` up to 30 rows are orphaned `queued` forever while `Workspace.tsx:2753` polls them every 800 ms with no cap — an endless spinner. The in-process outer timeout (`jobRunner.ts:357`) cannot save them: that `setTimeout` dies with its process.

- [ ] **Recurring durable dispatch, not a one-time boot scan (A-R26).** A boot-only scan strands work: during a zero-downtime deploy the **old** process keeps accepting requests and enqueuing rows *after* the new process finishes its scan, and when SIGTERM lands its process-local `pendingJobs` (`jobRunner.ts:90`) vanishes — those rows stay `queued` in Postgres with nobody looking. A durable row does not make the dispatcher durable. **Decided mechanism:** a **recurring bounded dispatcher scan** on a fixed interval, claiming oldest-first via the CAS below, bounded by free worker slots. Scaling later optimizes it with `FOR UPDATE SKIP LOCKED`; the recurring scan is the robust baseline. In-process enqueue still kicks the pump directly — the scan is the safety net, not the primary path.
- [ ] **Dispatcher loop — exact (A-R37).** Interval **5 s**. Claim batch **bounded by free worker slots, max 5 per tick**. **Reentrancy:** one in-process mutex guards the tick; a tick already running is skipped, never queued up. **Slot reservation:** the enqueue kick and the scanner tick reserve slots through the *same* counter guarded by that mutex, so they cannot jointly over-claim past `CONCURRENCY`. **DB error backoff:** exponential with jitter, capped at 60 s; a failed tick **never cancels the schedule** — the loop must prove it continues after transient Postgres failure. Each transition to/from backoff emits one operator log line, not one per tick.
- [ ] **Ordering and starvation:** strict `(queued_at, id)` oldest-first, matching A1's index. No priority classes in A; per-user fairness is Scaling's. A persistently failing job cannot block the queue head, because a claim moves it out of `queued` before execution.
- [ ] **Version-aware claim (A-R33).** At claim time recompute the inputs hash from the row's `input_snapshot`/`model_id` against the **runtime** dataset + solver identity and compare to the stored `inputs_hash`. **Mismatch ⇒ fail the job once** with a safe, explicitly retryable public outcome — never silently execute an old snapshot under new solver semantics. This covers a queued job crossing a dataset change, a solver change, a compatible deploy, an incompatible deploy, and a rollback.
- [ ] **Delivery guarantee — no automatic retry (A-R36; decided 2026-09-22).** The round-3 wording claimed at-least-once execution while simultaneously terminally failing every stale row; those cannot both hold — a crash between the CAS claim and the spawn fails a job that never executed once. **The honest contract: A performs no automatic retry.** An ambiguous claim may end in terminal failure; terminal **publication** remains exactly-once via the ownership predicate. All "restart-safe" language implying in-flight work completes is removed — restart safety here means *no job is stranded in a non-terminal state*, not *every job eventually runs*. The public failure message must direct the student to retry, and A9 renders it that way. Bounded `attempts`/retry policy stays in Scaling; A must not imply it exists.
- [ ] **Owner lease — exact values (A-R27).** Heartbeat interval **10 s**; stale threshold **60 s** (safety factor **6×**); **clock authority is the database** (`now()` on both write and comparison — never the app clock, which can skew between generations). Takeover predicate: `UPDATE solve_jobs SET … WHERE id = ? AND status = 'running' AND owner_heartbeat_at < now() - interval '60 seconds' RETURNING` — atomic, so two scanners cannot both take over. **A reclaimed stale `running` row is terminally failed, not requeued**: re-execution is safe but auto-retry is not, because bounded `attempts` live in Scaling and an unbounded retry loop is worse than an honest failure. The student retries explicitly.
- [ ] **Heartbeat refresh is ownership-checked (A-R37).** The refresh uses the **same predicate as completion** — `WHERE id = ? AND status = 'running' AND claim_generation = ?`. A **zero-row refresh means ownership is already lost**, and the owner must immediately trigger A3 process-group cancellation, not merely decline to publish.
- [ ] **Heartbeat failure cancels compute, not just publication (A-R37).** If a refresh fails because Postgres is unavailable, the owner fails closed **and cancels the process group at once**. Suppressing only publication would leave an expensive orphaned CBC run burning the full solve limit for a result nobody can publish.
- [ ] **Null-heartbeat transition (A-R37).** `owner_heartbeat_at IS NULL` on a `running` row — an A1-era row, or one claimed across the A2 deploy — matches neither the stale-lease predicate nor the historical-null-snapshot rule, so it would be stranded. Explicit one-time transitional predicate: a `running` row with a **valid snapshot** but **null lease** is adopted by stamping `now()` once at boot if unclaimed by this generation, then follows the normal stale path; with **no** snapshot it takes the historical terminal-fail path.
- [ ] **Drain (A-R27).** The draining process **keeps renewing the heartbeat while it still owns and runs the job**, and stops **only** after (a) the terminal update commits, (b) child termination is verified by A3's supervisor, or (c) an explicit atomic ownership release. Stopping renewal at SIGTERM would let the incoming generation declare a live solve stale and reclaim it.
- [ ] **Exactly one SQL transition per shutdown category (A-R37) — the round-3 wording conflated three different outcomes.** (1) **Never-claimed queued work stays `queued`** — untouched, picked up by the next generation's scan. (2) **A solve completing inside the grace period commits normally** through the ownership predicate. (3) **A solve exceeding the grace period is group-cancelled and moved, ownership-checked, to a terminal interrupted/failed outcome** — this is a *terminal failure*, and A14 must not call it "released for the incoming generation"; nothing requeues it. (4) **If Postgres is unavailable after verified child death**, the row stays owned/`running` for the later stale sweep, and the old owner publishes nothing. Only case (3) is an explicit ownership release, and it releases a row that is already terminal.
- [ ] **Boot recovery** is the first iteration of the recurring scan, plus a one-time pass over historical rows. Runs before the server accepts traffic; if it cannot reach Postgres, boot **fails closed**.
- [ ] Atomic `queued`→`running` **CAS claim** (`UPDATE … WHERE id = ? AND status = 'queued' RETURNING`), stamping `claim_generation`, `claimed_at`, `owner_heartbeat_at` from `now()`.
- [ ] **Exact ownership-checked terminal predicate:** `WHERE id = ? AND status = 'running' AND claim_generation = ?`. A **zero-row result is a dropped stale completion** — recorded internal-only, never retried, never published.
- [ ] **Historical non-terminal rows (A-R21).** Rows predating A1 have null `input_snapshot`/`model_id` and are unrecoverable by construction. Deterministic treatment: move them once to a terminal `failed` state under the safe public error contract (`SOLVE_FAILED` + safe message). Never spin on them, never fabricate an input to re-run them.
- [ ] **SIGTERM drain** (replaces today's immediate `process.exit(0)` at `index.ts:41`): stop admitting, stop claiming, stop the recurring scan, keep heartbeating owned jobs, let in-flight solves finish or be terminated by A3's supervisor, apply the exact transition above per category, flush telemetry, exit inside the budget A14 defines.
- [ ] Tests: **two simultaneously alive process generations** — the new generation must not fail or steal the old generation's live job; **a row enqueued by the old generation after the new generation's first scan is still picked up**; pending queued rows survive SIGTERM reaching the old process; false-stale prevention under a slow-but-alive owner; genuine owner death reaches one deterministic terminal outcome; **zero-row heartbeat refresh cancels the process group**; DB outage during heartbeat cancels compute and publishes nothing; **the dispatcher keeps scanning after a transient Postgres failure**; an old owner's late completion is dropped by the zero-row predicate; SIGTERM immediately before and immediately after a heartbeat renewal; **crash immediately after claim and immediately before spawn ends in the declared no-retry terminal failure** (not a silent stall, and not a false at-least-once claim); **version mismatch at claim fails once, retryably**; null-heartbeat running rows take the transitional path; boot with DB unreachable fails closed; historical null-snapshot rows terminate once.
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
- [ ] **Preserve the existing atomic publication.** `jobRunner.ts:302` already updates the job result/summary and the scenario result/run pointer in one transaction; require that this stays **one** transaction and emit completion telemetry **only after commit**.
- [ ] **The publication CAS — now backed by a real authority (A-R32).** Two independent predicates in that one transaction: the **job** terminal update is ownership-checked (`id + status='running' + claim_generation`, from A2), and the **scenario** update fires **only if `scenarios.latest_solve_job_id = <this job id>`** (A1's new column). The job predicate alone proves only that the job still owns its own row — it says nothing about whether the scenario has since been resubmitted.
- [ ] **Superseded-but-successful jobs (A-R32).** A job whose compute succeeded but whose scenario CAS fails is **still recorded terminally as succeeded** and stays addressable in solve history with its result; it simply never becomes the scenario's current result. It is not a failure and must not be shown as one.
- [ ] Tests: every solution and failure outcome against cache and publication; fresh and cache-hit composition; transaction failure/rollback; **inverted completion order** (job 1 enqueued, job 2 enqueued and published, job 1 completes last and does not overwrite); an input edit with **no** second solve; cache-hit completion against a superseded scenario; scenario deletion and concurrent enqueue boundaries.
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
- [ ] **Retry affordance (A-R36).** Because A performs no automatic retry, an interrupted/ambiguous-crash failure must render with an explicit **retry action**, not a dead end — this is the UI half of the no-retry contract. A **superseded-but-successful** job (A7) renders in history as succeeded, never as a failure.
- [ ] All generated-client consumers of the nullable/expanded `status` compile and render; mixed v1/v2 collections tested.
- [ ] Commit: `[A9] frontend: nullable-status union, legacy badges, errorCode/errorMessage failures`.

## Task A10 — single-flight, instance-scoped (review A-R3, A-R20)

**Files:** `jobRunner.ts`; `lib/db/src/schema/solve_active_runs.ts` (new).

Retained in A per the 2026-09-22 decision, scoped to one instance for coherence with A2. A6's cache identity is a prerequisite, not an implementation.

- [ ] **Uniqueness scope — the round-1 contradiction, resolved.** The unique constraint is on **`(claim_generation, composite_hash)`**, not on `composite_hash` alone. A globally unique row on the hash would coordinate *every* instance, which contradicts the single-instance scope; generation-scoping makes the boundary real rather than asserted. **Scaling's migration path:** drop `claim_generation` from the unique key and gate winner election on the lease instead — stated here so it is a planned extension, not a rewrite.
**Active-run schema — normative (A-R29).** The round-2 bullet said "exact" and then listed instructions; here is the table.

**`solve_active_runs`** — types match the existing `serial`/`integer` authority (`solve_jobs.id` and `scenarios.id` are `serial`; the round-3 draft's `bigint`/`bigserial` was a mismatch, A-R35):

| column | type | null | notes |
|---|---|---|---|
| `id` | `serial` PK | no | |
| `composite_hash` | `varchar` | no | A6's identity |
| `claim_generation` | `bigint` | no | owner; from A1's sequence (that column really is bigint) |
| `state` | `varchar` + CHECK | no | enum below |
| `winner_job_id` | `integer` FK → `solve_jobs(id)` `ON DELETE CASCADE` | no | the computing job |
| `outcome_kind` | `varchar` + CHECK | yes | `optimal\|feasible\|infeasible\|unbounded\|no_solution\|failed` |
| `outcome_result` | `jsonb` | yes | **durable cacheable result**, written before fan-out |
| `failure_code` | `varchar` | yes | propagated to subscribers on failure |
| `subscribers_sealed_at` | `timestamptz` | yes | set when membership closes |
| `fanout_cursor` | `integer` | yes | last completed subscriber `job_id`; ascending key |
| `created_at`/`updated_at` | `timestamptz` | no | DB clock per A-R27 |
| `completed_at` | `timestamptz` | yes | terminal only |

**`solve_active_run_subscribers`** — `active_run_id integer FK ON DELETE CASCADE`, `job_id integer FK → solve_jobs(id) ON DELETE CASCADE`, PK `(active_run_id, job_id)`, `attached_at timestamptz NOT NULL`, `completed_at timestamptz NULL`. Index `(active_run_id, job_id)` serves the ascending cursor scan. A subscriber **is** a real `solve_jobs` row, so its requested metadata, ownership and latest-job authority already exist.

- **Unique:** `(claim_generation, composite_hash) WHERE state NOT IN ('completed','failed')` — partial, so terminal rows don't block a later identical solve. **Scaling migration:** drop `claim_generation` from the key and gate election on the lease.
- **States (A-R35.4 — fan-out is NOT terminal):** `electing → running → outcome_durable → fanning_out_success → completed`, and `{electing|running} → fanning_out_failure → failed`. **`completed`/`failed` are reached only after every sealed subscriber is terminal** — the round-3 design set `state='failed'` the moment the winner failed, which hid unfinished failure fan-out from recovery. No transition out of a terminal state; any other transition is asserted against.

- [ ] **`waiting_on_active_run` — subscribers must be undispatchable (A-R34).** The round-3 design left a losing caller `queued` while A2's recurring dispatcher claims **every** oldest `queued` row, so the next tick would reclaim it and spawn a **second solve** — defeating single-flight entirely. Fix: a new internal job state **`waiting_on_active_run`**, excluded from A2's claim predicate and from A1's `(queued_at, id) WHERE status='queued'` partial index, so it is structurally impossible to claim.
- [ ] **Election happens AFTER the claim, so the loser transitions out of `running` (A-R34).** The real flow claims a job (`queued → running`) before `runJob` reaches the cache lookup and election, so two identical jobs can both be `running` when one loses. The loser is atomically attached as a subscriber **and** moved `running → waiting_on_active_run` in one transaction, **clearing `claim_generation`/`claimed_at`/`owner_heartbeat_at`** so the stale-lease sweep cannot later resurrect it. Its worker slot is freed immediately.
- [ ] **Surface of the new state.** Terminal predicates, cancellation and deletion handle `waiting_on_active_run` explicitly. **Public serialization: it renders as `queued`** to keep R1/R2 clients unchanged, while remaining distinct internally; solve history treats it as not-yet-run. No OpenAPI enum value is added for it.
- [ ] **Winner election — `ON CONFLICT`, not a caught unique violation (A-R35.1).** An unhandled unique violation aborts the PostgreSQL transaction, so the round-3 "unique violation ⇒ subscriber" could not continue in the same transaction. Use `INSERT … ON CONFLICT (claim_generation, composite_hash) WHERE … DO NOTHING RETURNING id`: a returned id means winner; no row means loser, which then `SELECT … FOR UPDATE`s the conflicting active run (locking it against a concurrent seal) and attaches in the same transaction. Retry once if that run reached terminal between the two statements.
- [ ] **Sealed subscriber set (A-R35.2).** `subscribers_sealed_at` is set in the transaction that moves to `fanning_out_*`. Attachment is permitted **only while it is null**; a caller arriving after the seal loses attachment and proceeds as its own fresh election. This closes the round-3 hole where a late subscriber attached after the final cursor check and stayed incomplete forever.
- [ ] **Durable outcome before fan-out (A-R35.3).** `outcome_kind` + `outcome_result` are committed **before** the first subscriber completes. Without them, a crash after CBC succeeds but before fan-out leaves recovery with no result to finish subscribers — acute for `no_solution`, which A7 deliberately does **not** cache, so the cache cannot serve as the recovery source.
- [ ] **Cache recheck transition.** After winning election and before spawning, re-read the cache under `composite_hash`; a hit writes the durable outcome and goes straight to `fanning_out_success`.
- [ ] **Fan-out, per-subscriber transactions.** Ascending by `job_id`, strictly greater than `fanout_cursor`. Each subscriber, in its own transaction: `composePublishedResult` with **that job's** requested metadata, ownership-checked job completion, scenario publish only if `scenarios.latest_solve_job_id` still matches (A7), then **advance `fanout_cursor` in the same transaction** — cursor and completion must be atomic or resumption can skip or repeat. Cursor invariant: every subscriber with `job_id ≤ fanout_cursor` is terminal.
- [ ] **Crash recovery.** Resume at `fanout_cursor` for whichever `fanning_out_*` state the row is in; a subscriber whose scenario CAS fails is recorded terminally succeeded-but-superseded (A7) and the cursor still advances, so it is never revisited.
- [ ] **Stale takeover — a predicate per non-terminal state (A-R35.6).** A non-terminal active run whose `claim_generation` has an expired heartbeat (A2) is taken over atomically. `electing`/`running` → `fanning_out_failure` with `failure_code`; `outcome_durable`/`fanning_out_*` → **resume fan-out**, because the durable outcome makes completion possible and failing those subscribers would discard a real result.
- [ ] **Retention — exact (A-R35.7).** Terminal rows are deleted **7 days** after `completed_at`, by a bounded sweep of **≤500 rows per tick**, only where `state IN ('completed','failed')` and no subscriber has `completed_at IS NULL`. Subscribers cascade.
- [ ] Tests (A-R35): crash after election; after durable outcome but before the first subscriber; midway through success fan-out; midway through failure fan-out; a late attach racing the seal; after terminal transition but before cleanup; **concurrent real elections with the A2 dispatcher running**, not N direct calls with the pump mocked.
- [ ] Tests: N identical cold requests → exactly one solve, N correctly-composed results; winner failure propagates to all; stale active-run reclaimed; **two process generations prove the instance boundary** rather than assuming it; cache-appears-after-election path.
- [ ] Commit: `[A10] instance-scoped single-flight with subscriber fan-out`.

## Task A11 — staged v1→v2 rollout + rollback floor (§2.13; Q54/Q63/Q81; review A-R4, A-R22)

**Files:** feature-flag config; deploy runbook doc.

**Landing the default-off flag and runbook is not the same as enabling R3.** This task may land early; activation may not.

- [ ] Implement A0's release-state matrix: R1 (nullable schema + **three-way** reader, writes B-format) → R2 (client compatible with B and v2, `errorCode`/`errorMessage` alongside the old `error` for the window) → R3 (`v2_write` flag, default off).
- [ ] **R3 activation prerequisites — normative and complete (A-R30).** The round-2 list omitted A0, A1, A2 and this task's own landed flag. Full list: `A0 + A1 + A2 + A3 + A4 + A5 + A6 + A7 + A8 + A9 + A10 + A12 + A14`, **plus** this task's landed default-off flag/runbook, **plus committed and reviewed A13a** pre-activation evidence, **plus** the Linux no-orphan evidence from A3, **plus** pre-R1 drain evidence from Render deploy/health showing zero pre-R1 instances, **plus** the approved G-cache artifact. Any missing item blocks activation regardless of flag state.
- [ ] **Exact flag (A-R38).** Key **`SOLVER_V2_WRITE_ENABLED`**, read from the Render environment for `nos-api`. **Strict accepted values `"true"`/`"false"`**; anything else — unset, blank, `"1"`, mixed case — is **false, fail-closed**, matching `parsePositiveIntEnv`'s existing strictness (`jobRunner.ts:63`). The resolved value is logged once at startup alongside the build/contract-version signal.
- [ ] **A commit and an environment flip are different operations (A-R38).** Landing the default-off flag is a Git commit in this task. **Enabling it is an external Render environment change**, and the two must not be conflated. Evidence record for the external change, written to `docs/CHANGELOG-implementation.md`: approver, UTC timestamp, service (`nos-api`, `srv-d9hglg6pbkes73a1j8b0`), deploy id, the commit SHA the flip was applied against, old and new value, and the exact rollback step.
  *Citation corrected:* round 3 cited "hard rule #9". **This branch's `CLAUDE.md` has hard rules 1–8 only** — rules 9 and 10 exist on `main` (`git show main:CLAUDE.md`). The changelog requirement is stated directly here rather than by number, and the citation becomes valid once `main` merges into this branch.
- [ ] **Drain proof from a version signal, not a health check (A-R38).** "Zero pre-R1 instances" is proven from the server's **build/contract-version signal** — every instance reports its contract version on `/api/healthz` and in its startup log; drain is proven when no response carries a pre-R1 version for a full observation window. A health check that merely returns 200 cannot distinguish old from new instances.
- [ ] **Compatibility window — concrete (A-R38).** Minimum observation window **7 days** after R2 ships; measurable exit threshold: **zero requests from a pre-R2 client build** across that window, measured by the client version signal. The transitional alias is removed in the **first release after** the threshold is met, not automatically.
- [ ] **Transitional `error` is a safe alias (A-R38).** During the window, public `error` is a **serializer alias of `errorMessage`** — never the raw stored diagnostic (A5). Nullable: `null` for non-failed jobs. Removed in the release named above; `errorCode`/`errorMessage` are permanent.
- [ ] **Row behavior on writer disable and rollback (A-R38).** Disabling the writer leaves already-written v2 `scenarios.result`, `solve_jobs.result` and v2 cache rows **in place and readable** — R1's three-way reader handles them, which is exactly why the rollback floor is R1. No row is rewritten or deleted on disable; unversioned cache rows remain a cache miss.
- [ ] **Who authorizes.** The `SOLVER_V2_WRITE_ENABLED` flip is a **product-owner decision**, not an agent's — the same authority that signed DEC-2026-09-21-01.
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
- [ ] **An in-flight solve that exceeds the remaining budget is interrupted on deploy**, not allowed to overrun — it terminates via A3's supervisor and its row moves, ownership-checked, to a **terminal interrupted/failed** outcome (A2's shutdown category 3). **Wording corrected (A-R37):** round 3 called this "released for the incoming generation", which reads as a requeue; nothing requeues it, and A declares no automatic retry. Deploys are never held open by an unbounded solve.
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

**One dependency DAG, whose edges agree with the gate matrix (A-R31.6).** Round 3 said "A4 after A3" while `G-baseline` requires A0 first — those disagreed. Edges:

```
A3 ─┐                     (authorized; no deps)
A14─┘                     (authorized; no deps; parallel with A3)

A0 ──► A1 ──► A2          (A0 closes G-baseline; A1 schema; A2 dispatcher/lease)
A0, A3 ──► A4             (A4 needs BOTH the baseline inventory and A3's private schema)
A4, A1 ──► A5
A4, G-cache ──► A6
A6 ──► A7                 (A7's feasible rule needs A6's key)
A4, A5 ──► A8, A9
A6, A2, A7 ──► A10        (needs the cache identity, the claim/lease, and the publication CAS)
A5, A7 ──► A12
A0, A4, A5 ──► A11        (lands the default-off flag only)
everything ──► A13a ──► [product-owner flag flip] ──► A13b
```

**R3 activation is not an edge in this DAG** — it is the external, product-owner-authorized environment change gated by A11's full prerequisite list.

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

## Review disposition — round 4 (2026-09-22)

All 8 findings accepted. Two product-owner decisions obtained. Verbatim review text: committed at `9a4b22a`.

| Finding | Disposition | Landed in |
|---|---|---|
| A-R31 entry gates circular, contradictory authority | Accepted; the single rule is replaced by a **gate matrix** naming per gate what may run to close it, plus one dependency DAG. **A14 authorized** alongside A3 (product owner) | Gate matrix, status header, Ordering DAG |
| A-R32 publication CAS has no authoritative latest-job value | Accepted; `scenarios.latest_solve_job_id` set atomically at enqueue, `result_run_id` left as provenance only; superseded-but-successful jobs defined | A1, A7, A10 |
| A-R33 recovery not version-aware | Accepted, **with a simpler mechanism** — `solve_jobs.inputs_hash` already carries enqueue-time identity, so no new columns and **no G-cache dependency** for A1+A2 | A1, A2 |
| A-R34 subscribers dispatchable, so single-flight can duplicate solves | Accepted without reservation; new non-dispatchable `waiting_on_active_run` state, excluded from the claim predicate and the partial index; election defined **after** the claim | A1, A2, A10 |
| A-R35 A10 state machine not crash-resumable or transactionally closed | Accepted, all 7 sub-points; `ON CONFLICT` election, sealed subscriber set, durable outcome before fan-out, non-terminal fan-out states, atomic cursor+completion, exact retention, corrected `serial`/`integer` types | A10 |
| A-R36 at-least-once claim contradicted by terminal-fail policy | Accepted; **decided: no automatic retry**. The at-least-once wording and all "restart-safe" language implying completion are removed; UI gains an explicit retry affordance | Goal, A2, A9 |
| A-R37 dispatcher/heartbeat-loss/shutdown underspecified and contradictory | Accepted; exact interval/batch/mutex/backoff, ownership-checked heartbeat that cancels on zero rows, DB-error cancels compute, null-heartbeat transition, one SQL transition per shutdown category | A2, A14 |
| A-R38 rollout still placeholder | Accepted; exact flag key/values/fail-closed, commit-vs-environment-flip separated, evidence-record fields, version-signal drain proof, 7-day window, `error` as safe alias. **Hard-rule citation correction confirmed against this branch** | A11 |

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

### Round 4

- **A-R31 — accepted, mine.** Every sub-point checks out; the gate list was written as a guard and read as a deadlock. The substantive fix is not wording, it is separating **design-decision closure** (writing decisions into task bodies, which is documentation) from **post-implementation acceptance evidence** — round 3 used one word, "close", for both. `G-cache` was also scoped far too widely: it belongs to A6 and A6's consumers, not to A0/A1/A2/A4/A5, none of which touch the cache.
- **A-R32 — accepted, no reservation.** Verified `scenarios.resultRunId` is `integer`, written at publish, `onDelete: "set null"` (`scenarios.ts:26`). It answers "which job produced what is showing", never "which job is currently authorized", so the race is real exactly as described: enqueue job 1 → resubmit as job 2 → job 2 publishes → job 1 lands last and wins. A2's ownership predicate cannot help, since job 1 legitimately still owns *its own row*. Took the recommended `latest_solve_job_id` and deliberately did **not** overload `result_run_id`.
- **A-R33 — accepted in substance, with a materially simpler fix.** The review proposed new `dataset_version`/`solver_version` columns and suggested A1+A2 might have to depend on the approved G-cache artifact. Neither is necessary: `solve_jobs.inputs_hash` is already `notNull` (`solve_jobs.ts:12`) and `computeInputsHash` (`jobRunner.ts:110-116`) already hashes `modelId + datasetVersion + SOLVER_CODE_HASH + canonicalJson(inputs)`. Enqueue-time identity is therefore durably recorded today; version-aware recovery is a recompute-and-compare at claim time. That preserves the ordering the review feared was unsound. **Honest limitation, recorded rather than hidden:** `SOLVER_CODE_HASH` covers only `solve.py` (§2.10), so a `cbc_termination.py`-only change escapes the check until A6 substitutes the composite identity — a drop-in swap into the same comparison.
- **A-R34 — accepted, and the sharpest finding of the round.** A pure composition failure: A2 and A10 were each internally coherent and jointly broken, because A2's dispatcher claims *every* oldest `queued` row and A10 parked losers in exactly that state. The next tick would have spawned the duplicate solve single-flight exists to prevent. The second half is equally important and I had missed it entirely — the real flow claims **before** `runJob` reaches election, so the loser is already `running` and needed a defined `running → waiting_on_active_run` transition with its lease fields cleared, or the stale sweep would resurrect it later.
- **A-R35 — accepted, all seven.** Two are load-bearing. First, "unique violation ⇒ subscriber" is not implementable as written: in PostgreSQL an unhandled unique violation aborts the transaction, so the caller cannot simply continue — hence `ON CONFLICT … DO NOTHING RETURNING` plus a locking `SELECT … FOR UPDATE` of the conflicting run. Second, the missing durable outcome: a crash after CBC succeeds but before fan-out left recovery with nothing to finish subscribers from, and the cache is not a fallback because A7 deliberately does not cache `no_solution`. The `bigint`-vs-`serial` type complaint is also correct against the existing schema.
- **A-R36 — accepted; the contradiction was mine and it was flat.** Round 3 asserted at-least-once execution *and* terminal-fail-never-requeue in the same task. A crash between the CAS claim and the spawn produces a job that failed with zero executions, so the guarantee was simply false. Product owner chose **no automatic retry**, the honest reading of what A actually builds; retry policy stays in Scaling. Consequence tracked into the goal statement, A2 and A9's retry affordance rather than left as a local edit — a delivery guarantee is not a sentence in one task.
- **A-R37 — accepted.** The wording contradiction is real and I introduced it: A2 called it an ownership release, A14 called it "released for the incoming generation", and A3.T classified it as terminal failure — three names for what must be one transition. Corrected to terminal failure everywhere, with the release confined to a row that is already terminal. The heartbeat points are right too: refresh needed the same ownership predicate as completion, and a DB heartbeat failure must **cancel the process group**, not merely suppress publication, or a doomed CBC run burns the whole solve limit. The `owner_heartbeat_at IS NULL` gap was a genuine hole between two rules I had written as if they were exhaustive.
- **A-R38 — accepted, and the hard-rule sub-point is correct for a reason worth recording.** I cited "hard rule #9" for the changelog requirement. This worktree's `CLAUDE.md` has rules **1–8**; rules 9 and 10 exist only on `main`, confirmed by reading `main`'s copy directly. The reviewer read the branch and was right; my citation was valid against `main` and invalid here. Branch divergence, not a misreading on either side — so the requirement is now stated directly instead of by number. The deeper point also stands and is the one that matters operationally: **a Git commit and a Render environment-variable flip are different operations**, and treating the flag flip as "recorded in the same commit" was a category error.

**Cross-cutting note, updated after round 4.** Rounds 1–3 were dominated by *compression* failures. Round 4 is dominated by a different and harder class: **composition** failures, where two individually correct tasks contradict each other at their seam — A-R34 (dispatcher vs subscribers), A-R32 (a CAS with no authority behind it), A-R37 (one transition under three names), A-R36 (two guarantees that cannot both hold). Single-task review will not surface these. Audit the **seams**: for every cross-task reference — "A7's CAS", "stays queued", "released" — check that the named thing exists, that both sides mean the same state, and that both tasks' predicates agree on which rows they touch.

---
