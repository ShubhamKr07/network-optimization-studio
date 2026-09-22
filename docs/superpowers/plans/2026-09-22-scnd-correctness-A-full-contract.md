# SCND Correctness — Full Contract (Option A) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit that passes the applicable full verification gate. Design source: `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (§§2–3; decisions Q4–Q72) **and** `docs/superpowers/specs/2026-09-20-scnd-scaling-phase0-design.md` §34 (decisions Q73–Q84, controlling). This plan turns that contract into executable tasks. **Runs AFTER Option B ships.**

**Status: BLOCKED for full execution — one task is authorized.** Two deep approval reviews (2026-09-22, rounds 1 and 2) returned REQUEST CHANGES; all 24 findings are folded below (disposition records at the end). Approval of *this* revision is still required and is not granted by the fold.

**Authorized now:** task **A3** in full, as the preparatory slice §34 permits. A3 is entirely private — fd3 protocol, process-group supervision, temp-dir ownership, the terminal state machine, and the Linux no-orphan proof — and changes no public response, no stored-result version, and no cache behavior; `v2_write` stays disabled throughout. It has no dependency on A0/A1/A2. **Nothing else executes until the entry gates close.**

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
- **Scope boundary with Scaling (decided 2026-09-22, revised after review A-R17):** A owns durable payloads, boot recovery, the CAS claim, **and a minimal owner heartbeat/expiry lease** — the last is not optional, because Render's rolling deploy (`render.yaml:8` `healthCheckPath`) guarantees two process generations overlap on every deploy even at one instance, so no configuration assertion can establish that a prior owner is dead. Multi-worker coordination — `worker_id`, bounded `attempts`/retry policy, `FOR UPDATE SKIP LOCKED` polling, fairness, connection-pool sizing, backpressure/admission, readiness-on-DB-failure — belongs to `2026-09-22-scnd-scaling-design.md`, sized by Measurement. Scaling **extends** A's lease; it does not replace A's recovery semantics.

---

## Task A3 — fd3 protocol + Node process-group supervisor (§2.11; Q52/Q64/Q71/Q74/Q77/Q78; review A-R10, A-R11, A-R12, A-R18, A-R23) — **AUTHORIZED PREPARATORY SLICE**

**Files:** `artifacts/api-server/src/solver/solve.py`; `artifacts/api-server/src/solver/cbc_termination.py`; `artifacts/api-server/src/solver/jobRunner.ts`; `artifacts/api-server/src/solver/solverProcessMessage.ts` (new, private Zod).

Executes **first** and independently: no dependency on A0/A1/A2. Producer and reader ship in **one commit** — splitting them leaves an intermediate deployable state where Python writes fd3 while the Node runner still reads stdout's last line (`jobRunner.ts:163`), a broken runtime and a failing gate between commits (hard rule #4). The dual-output-flag alternative is rejected: transitional protocol code costs more than the atomic commit. This is the one task that intentionally spans more than a file pair.

**Preparatory boundary (explicit):** public responses, stored-result shape, and cache behavior are **unchanged**; `v2_write` stays disabled; failures continue to persist into the **existing** `solve_jobs.error` column until A1/A5 move them to the typed columns. No public-contract activation.

- [ ] **Private schema, defined here — not deferred to A4.** `solverProcessMessage.ts` owns the server-side Zod for `SolverProcessMessage` **and** the `SolverSuccessEnvelopeV2` payload it transports, per the schema-authority constraint. A4 later adds the *public* shapes and reuses this private one; it does not redefine it.
- [ ] **Python side:** emit on **fd 3** exactly one newline-terminated JSON object, `{envelope | failure}` (success-envelope **xor** failure), ≤1 MiB read incrementally with abort-at-cap; set fd 3 close-on-exec **before** spawning CBC. Failure = `{failureReason, failureStage, errorDetail}` with structured allowlisted detail — never raw stdout/exception/paths. Map every current `_load_error_envelope`/error exit to the failure branch with the correct `failureReason`/`failureStage` per §2.11's enums. stdout/stderr separately capped at ≤64 KiB each.
- [ ] **Node side:** spawn Python **detached** (process-group leader); read fd 3; on outer timeout/cancel send TERM→(grace)→KILL to the **whole group**; wait/reap the direct child and probe group death on a bounded interval. **Node owns** the per-solve temp dir (mkdtemp → pass the validated path in → verified idempotent removal after group death); Q77's validated-directory parameter is the exact seam.
- [ ] Implement the normative terminal table below; every row ID gets a deterministic test.
- [ ] **Containment acceptance:** Linux/POSIX-only startup fail-fast; stated TERM grace duration and probe interval; CBC log and `.sol` maximum on-disk sizes with bounded incremental reads; visible internal recording of cleanup failure; defined cancellation sources (SIGTERM/deploy, internal cancel, public cancel if one exists); repeated timeout/cancel/crash runs with no process, descriptor or artifact accumulation.
- [ ] **Go/no-go no-orphan proof on Linux (Q74):** record Python+CBC PIDs/PGID; force timeout and forced-kill including killed-parent/CBC-alive; prove no survivor, temp reclaimed, publish-once, repeated-timeout leak-free. Per Q74 this proof gates **R3/`v2_write`**, not the start of this task.
- [ ] Commit: `[A3] fd3 SolverProcessMessage + Node process-group supervisor + terminal state machine + no-orphan proof`.

### A3.T — normative terminal table (Q78; review A-R23)

Dimensions: **T** outer timeout fired · **C** cancellation fired · **X** process exit (`0` / `≠0` / open) · **M** fd3 message (`VS` valid-success · `VF` valid-failure · `missing` · `partial` · `oversize` · `invalid` · `both` · `neither`) · **K** cleanup outcome. Precedence is evaluated **once**: `T > C > (X × M)`. Cleanup never changes classification. Tests reference row IDs.

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
- [ ] **Indexes owned here, not in A2:** partial index on `(status) WHERE status = 'queued'` for the claim path; index on `(status, owner_heartbeat_at) WHERE status = 'running'` for stale-lease recovery; the existing history-read indexes are preserved.
- [ ] `enqueueSolveJob` writes payload + requested values/sources **atomically at enqueue**, in the same insert.
- [ ] Tests: enqueue atomicity; historical-null tolerance on every read path; `input_snapshot` rejects a payload failing `SolveInput` validation; source columns reject any value but `'request'`; **multibyte diagnostic truncation** and the `octet_length` constraint; generation values are strictly increasing across simulated boots.
- [ ] Commit: `[A1] solve_jobs durable payload, ownership/liveness, failure and requested-limit columns`.

## Task A2 — durable queue, restart recovery, owner lease (review A-R2, A-R17, A-R21; Q84)

**Files:** `jobRunner.ts`; `artifacts/api-server/src/index.ts` (boot ordering + SIGTERM drain).

**The live defect this fixes — present in production today, on every deploy.** `render.yaml:8` sets `healthCheckPath`, so Render runs zero-downtime rolling deploys: the new instance boots and must pass its health check while the old instance is **still serving and still solving**. `index.ts:26` calls `reapStuckJobs()` *before* `app.listen`, and `reapStuckJobs` (`jobRunner.ts:230`) marks **every** `running` row failed on the premise that *"any `solve_jobs` row left in `running` status from a prior process is, by definition, no longer running"* (`:225-227`). During a rolling deploy that premise is false: the booting instance fails the live instance's in-flight solves. Meanwhile `index.ts:41`'s SIGTERM handler flushes PostHog/Sentry and calls `process.exit(0)` immediately — **no drain** — so the old instance's solves die mid-flight and their CBC children are orphaned. Separately, `pendingJobs` (`jobRunner.ts:90`) is process-local and the reaper never touches `queued` rows, so with `CONCURRENCY=3`/`QUEUE_DEPTH_LIMIT=30` up to 30 rows are orphaned `queued` forever while `Workspace.tsx:2753` polls them every 800 ms with no cap — an endless spinner. The in-process outer timeout (`jobRunner.ts:357`) cannot save them: that `setTimeout` dies with its process.

- [ ] **Owner lease.** The process executing a job refreshes `owner_heartbeat_at` on a fixed interval. Recovery reclaims a `running` row **only** when its heartbeat is stale past a threshold (threshold > interval by a stated safety factor). Liveness, not instance count, is the reclaim predicate — this is what makes overlap safe.
- [ ] **Boot recovery** reconstructs **queued** rows from `input_snapshot`/`model_id` into the worker pool, and reclaims only **stale-lease** `running` rows. Runs before the server accepts traffic; if it cannot reach Postgres, boot **fails closed** rather than serving with an unrecovered queue.
- [ ] Atomic `queued`→`running` **CAS claim** (`UPDATE … WHERE id = ? AND status = 'queued' RETURNING`), stamping `claim_generation`, `claimed_at`, `owner_heartbeat_at`.
- [ ] **Exact ownership-checked terminal predicate:** `WHERE id = ? AND status = 'running' AND claim_generation = ?`. A **zero-row result is a dropped stale completion** — recorded internal-only, never retried, never published.
- [ ] **Historical non-terminal rows (A-R21).** Rows predating A1 have null `input_snapshot`/`model_id` and are unrecoverable by construction. Deterministic treatment: move them once to a terminal `failed` state under the safe public error contract (`SOLVE_FAILED` + safe message). Never spin on them, never fabricate an input to re-run them.
- [ ] **SIGTERM drain** (replaces today's immediate `process.exit(0)`): stop admitting, stop claiming, stop heartbeat renewal for jobs being handed off, let in-flight solves finish or be terminated by A3's supervisor, flush telemetry, exit within Render's deadline.
- [ ] Tests: **two simultaneously alive process generations** — the new generation must not fail or steal the old generation's live job, and after genuine owner death recovery must reach exactly one deterministic terminal outcome; kill-and-reboot with N queued rows → all execute exactly once; double recovery is a no-op; stale-generation completion is dropped (zero-row predicate); boot with DB unreachable fails closed; historical null-snapshot rows terminate once.
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
- [ ] **Active-run schema, exact:** fields, state set, owner (`claim_generation`), created/updated timestamps, terminal state, retention/deletion policy, and stale-record recovery keyed on A2's lease staleness.
- [ ] **Subscriber representation and attachment transaction:** how a concurrent identical cold request attaches, and what it observes while waiting.
- [ ] **Fan-out, exact:** one compute result completes **N** subscriber jobs; each subscriber gets its **own** `composePublishedResult` using **its own** requested metadata; each scenario publication is gated on that subscriber job still being the latest authorized run (A7's CAS). State the transaction boundaries — per-subscriber, not one global transaction.
- [ ] Winner failure/timeout propagation to every subscriber; **partial fan-out failure**; crash recovery mid-fan-out; and the outcome when a cache entry appears **after** winner election (recheck and short-circuit).
- [ ] Tests: N identical cold requests → exactly one solve, N correctly-composed results; winner failure propagates to all; stale active-run reclaimed; **two process generations prove the instance boundary** rather than assuming it; cache-appears-after-election path.
- [ ] Commit: `[A10] instance-scoped single-flight with subscriber fan-out`.

## Task A11 — staged v1→v2 rollout + rollback floor (§2.13; Q54/Q63/Q81; review A-R4, A-R22)

**Files:** feature-flag config; deploy runbook doc.

**Landing the default-off flag and runbook is not the same as enabling R3.** This task may land early; activation may not.

- [ ] Implement A0's release-state matrix: R1 (nullable schema + **three-way** reader, writes B-format) → R2 (client compatible with B and v2, `errorCode`/`errorMessage` alongside the old `error` for the window) → R3 (`v2_write` flag, default off).
- [ ] **R3 activation prerequisites — normative and complete.** All of: `A3 + A4 + A5 + A6 + A7 + A8 + A9 + A10 + A12` complete, **plus** A13's pre-activation gate passed, **plus** the Linux no-orphan evidence from A3, **plus** pre-R1 drain evidence from Render deploy/health showing zero pre-R1 instances, **plus** the approved G-cache artifact. Any missing item blocks activation regardless of flag state.
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

## Task A13 — QA, pre- and post-activation (review A-R16, A-R22)

**Owner:** `qa-sdet`, real browser + Linux. Every assertion traces to exactly one implementing task; no orphan acceptance criteria.

**Phase 1 — pre-activation gate (runs before `v2_write` is enabled):**

- [ ] Process-level (A3): missing executable, nonzero exit, every invalid fd3 form, Python and parser exceptions, cleanup failure, outer timeout, cancellation/deploy interruption, and the Linux no-orphan proof. Tests reference A3.T row IDs.
- [ ] Queue (A2): restart-mid-load with a deep queue → no stuck jobs, each solve runs exactly once; **two overlapping generations** → no live job is failed or stolen; historical null-snapshot rows terminate once.
- [ ] Publication (A7): atomic publication, stale/older-job completion, cache-hit composition using the current job's requested values.
- [ ] Single-flight (A10): N identical cold requests → 1 solve, N composed results, instance boundary proven across two generations.
- [ ] Full verification gate + **direct** `python3 tests/e2e_accuracy.py` (99/99, objectives unchanged after B's DEC-authorized status correction) + `e2e_journey.py` repair onto `/auth/register`+`/auth/login` (argon2).
- [ ] Per the CLAUDE.md standing step, grep `artifacts/studio/e2e/` for any testid or visible string A9 changed and rewrite those sibling specs before merge.

**Phase 2 — post-activation smoke (runs immediately after `v2_write` is enabled):**

- [ ] A v2 write lands and reads back correctly through the three-way reader; a legacy and a B-unversioned row still read correctly alongside it; cache writes carry the composite identity; the rollback floor is exercised once in a non-production environment.
- [ ] Commit: `[A13] QA: pre-activation gate + post-activation smoke`.

## Ordering & parallelism

**A3 first** (authorized preparatory slice, independently executable). Then A0 → A1 → A2 (durable spine). A4 after A3. A5 after A4 + A1. A6 after A4 + G-cache. A7 after A6. A8/A9 after A4/A5. A10 after A6 + A2. A11's flag/runbook after A0/A4/A5, but **R3 activation only after the full prerequisite list above**. A12 after A5/A7. A13 Phase 1 before activation, Phase 2 after.

Dispatch via the agent team with **pre-created locked worktrees** (per the CLAUDE.md gotcha — do not rely on `isolation: "worktree"`); controller cherry-picks each commit onto the bundle branch and re-gates.

## Preserved principles (validated across both reviews)

Node, as the surviving actor, owns the process group and the exact solve directory · fd3 is separated from bounded stdout/stderr · a process message is success-envelope **xor** private failure, and failures never become result envelopes · requested and effective solver-limit values stay separate · cacheable and published shapes are distinct with one composition point · public failures use coarse stable codes and fixed safe messages · a pre-R1 reader is forbidden after the first canonical v2 write, and the legacy stored-row reader remains indefinitely · the Linux no-orphan proof is a real writer-activation gate, not paperwork · historical unknown metadata stays null rather than fabricated.

## Review disposition — round 1 (2026-09-22)

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
