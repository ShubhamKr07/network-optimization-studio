# SCND Correctness — Full Contract (Option A) Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with an independently testable deliverable + a commit that passes the applicable full verification gate. Design source: `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` (§§2–3; decisions Q4–Q72) **and** `docs/superpowers/specs/2026-09-20-scnd-scaling-phase0-design.md` §34 (decisions Q73–Q84, controlling). This plan turns that contract into executable tasks. **Runs AFTER Option B ships.**

**Status: BLOCKED — NOT APPROVED FOR EXECUTION.** The 2026-09-22 deep approval review returned REQUEST CHANGES; its findings are folded into the tasks below (disposition record at the end). Approval of *this* revision is still required and is not granted by the presence of the fold. Until the entry gates close, the only permitted implementation slice is the preparatory Node process-supervisor work §34 allows (task A3's supervisor half), with `v2_write` disabled and no v2 cache read/write or public-contract activation.

**Goal:** Make the async solve path *reliable and truthful under concurrency*: durable payloads, restart-safe queue recovery, safe process supervision, exhaustive failure taxonomy, versioned result cache, and a safe v1→v2 rollout — the reliability layer B deliberately deferred.

## Entry gates (all must close before any task past A3's supervisor half executes)

- **G-Q73 — close Q73–Q84.** §34.4 of the Phase-0 ledger is controlling and **did not pass**: §34 line 2281 states *"Until Q73–Q84 and this checklist close, neither P0R.3 nor P0R.4 is approved for execution."* Each of Q73–Q84 is mapped to an owning task below; closure means each has a written decision in its task, not merely a citation.
- **G-baseline — post-B representation inventory (A0).** No rollout task executes before A0 lands.
- **G-cache — composite identity design artifact (Q35/Q41/Q75).** §2.10 of the contract design states Q35 is an **open mandatory gate**. A one-time deployed banner check is *evidence about one deployment*, not a per-instance identity — P0R.1 found the CBC build differs by architecture (`2.10.3` x64 vs `2.10.10` Linux arm64), so the identity must be **runtime-derived on each instance**. A6 does not start until this artifact exists and is **separately reviewed and approved**.
- **G-review — new consolidated approval review of this revision.** The prior assumption that §34 had passed was false and is removed.
- **Cohort gate:** A is justified only once a real (or synthetic-load-proven) cohort shows reliability pain. Do not execute speculatively. **Exception:** the queued-row recovery slice (A1+A2) fixes a live user-visible defect and is not cohort-gated — see A2.

## Global constraints

- Hard rules #1 (OpenAPI+regen one commit), #2 (`e2e_accuracy.py` — B already applied the DEC correction; A must not change goldens), #3 (nullable-add + drizzle push), #4 (one task = one commit), #6 (no solver-math branches).
- **Schema authority (Q83, decided):** OpenAPI owns **public** request/response shapes. Server-owned Zod owns **private** validation — fd3 messages, cache values, raw stored rows — unless a documented one-way generator is introduced. Private failure and cache shapes are **not** exposed through OpenAPI merely to reuse generation. Every boundary where a private value becomes a public value carries an equivalence test.
- **Scope boundary with Scaling (decided 2026-09-22):** A owns **single-instance** restart safety. Multi-worker coordination — lease expiry, `FOR UPDATE SKIP LOCKED`, `worker_id`, attempt/retry policy, connection-pool sizing, backpressure/admission, readiness-on-DB-failure — belongs to `2026-09-22-scnd-scaling-design.md`, sized by Measurement. That spec's hard-dependency and reliability-gate sections have been corrected to match (2026-09-22) — it no longer claims A supplies the lease/attempt substrate.

---

## Task A0 — post-B baseline inventory + release matrix (Q73/Q81; review A-R4, A-R9)

**Files:** this plan; `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md` §2.13 (correction).

The contract design's §2.13 was written **before** the A/B split and assumes R1's writer emits v1. Post-B that is false: B introduces a third representation — truthful `solutionStatus`/`terminationReason` with **no** `envelopeVersion` and no five-schema contract.

- [ ] Inventory and name all five representations: (1) historical unversioned legacy rows; (2) B's truthful-but-unversioned rows; (3) canonical A v2 published results; (4) existing v1 cache entries; (5) composite-versioned v2 cache entries.
- [ ] Publish the **release-state matrix** — for R1/R2/R3/rollback/cleanup, state: stored-result reader, writer, public serializer, cache reader, cache writer, frontend behavior, flag state, deploy ordering, drain evidence, compatibility evidence, and treatment of already-written rows.
- [ ] **Decided baseline:** R1 = a **three-way** stored-result reader (legacy / B-unversioned / v2) that continues **B-format** writes. R2 = a client compatible with both B and A v2. R3 = versioned writes only after drain proof. Correct §2.13 in the design to match.
- [ ] **Q80 decided:** the permanent failed-job API is **`errorCode` + a permanent `errorMessage`** (server-owned safe message derived from §2.11's table). `errorMessage` is not transitional and is not removed at cleanup; only the *old raw* `SolveJob.error` alias is removed.
- [ ] Commit: `[A0] post-B representation inventory + release-state matrix + permanent error API decision`.

## Task A1 — `solve_jobs` durable schema (§2.11/§2.12; Q59/Q61/Q68/Q79; review A-R2, A-R6)

**Files:** `lib/db/src/schema/solve_jobs.ts`; schema sync via `drizzle-kit push`; `artifacts/api-server/src/solver/jobRunner.ts` (enqueue writes).

All columns **nullable** on add (hard rule #3); historical rows stay null forever (§32.2.4) — never backfilled, never fabricated.

- [ ] **Failure columns:** `failure_reason`, `failure_stage`, `error_code` (checked varchar; TypeScript enums are the authority, DB check mirrors the allowed set), `error_detail` (text). The **2,048-byte** bound on `error_detail` (§2.11) is enforced **before persistence** in application code, **and** mirrored by a DB length check — decided, not left open.
- [ ] **Requested-limit columns (Q79):** `requested_gap` **`double precision`**, `requested_time_limit_sec` **`integer`**, `requested_gap_source` and `requested_time_limit_source` **checked varchar pinned to the literal `'request'`** for this contract version. §2.12 is explicit — *"`source` is always `request`"* — so the earlier `request|default` enum is **removed**; introducing a `default` value requires separately authorized product work that adds a real default.
- [ ] **Durable payload columns (A-R2, single-instance scope):** `model_id`, and an immutable validated `input_snapshot` (jsonb) written at enqueue. This is what makes a queued row executable after process loss; without it the row is unrecoverable.
- [ ] **Claim columns (single-instance scope):** `claimed_at`, `claim_generation` (monotonic boot/deploy identifier) — enough for an atomic `queued`→`running` CAS and ownership-checked completion. **Deliberately excluded and owned by Scaling:** `worker_id`, `lease_expires_at`, `attempts`.
- [ ] `enqueueSolveJob` writes payload + requested values/sources **atomically at enqueue**, in the same insert.
- [ ] Tests: enqueue atomicity; historical-null tolerance on every read path; `input_snapshot` rejects a payload that fails `SolveInput` validation; source columns reject any value but `'request'`; oversized `error_detail` truncates with a marker before persistence.
- [ ] Commit: `[A1] solve_jobs durable payload, claim, failure and requested-limit columns`.

## Task A2 — single-instance durable queue + restart recovery (review A-R2; Q84)

**Files:** `jobRunner.ts`; `artifacts/api-server/src/index.ts` (boot ordering).

**The live defect this fixes.** Today `pendingJobs` (`jobRunner.ts:90`) is a process-local Map and `reapStuckJobs` (`:230`) sweeps only `status="running"`. With `CONCURRENCY=3` and `QUEUE_DEPTH_LIMIT=30`, a restart during a class burst leaves up to 30 rows `queued` forever; `Workspace.tsx:2753` polls them every 800 ms with **no cap and no timeout**, so the student gets a spinner that never ends — no error, no retry prompt — plus a permanent zombie row in solve history.

- [ ] Boot recovery reconstructs **queued** rows from `input_snapshot`/`model_id` into the worker pool, instead of only failing `running` rows. Recovery runs before the server accepts traffic; if it cannot reach Postgres, boot **fails closed** rather than serving with an unrecovered queue.
- [ ] Atomic `queued`→`running` **CAS claim** (`UPDATE … WHERE id = ? AND status = 'queued' RETURNING`), so a double-pump or a racing recovery can never run one job twice.
- [ ] **Idempotent, ownership-checked terminal updates:** a completion whose `claim_generation` no longer matches the row is dropped, not applied. Guards against a late result from a pre-restart process overwriting a newer solve.
- [ ] **Named single-instance invariant — the Scaling landmine.** Today's reaper comment (`jobRunner.ts:225-227`) asserts *"any solve_jobs row left in 'running' status from a prior process is, by definition, no longer running."* That is true for one instance and **destructive for two** — a booting second worker would reap a live worker's jobs and republish over them. Put the predicate in **one named function** (`isReclaimableByThisInstance`) carrying this comment verbatim, and assert the single-instance assumption at boot (explicit config, fail-closed if instance count > 1). Scaling replaces this one predicate with lease expiry; nothing else in A2 changes.
- [ ] **SIGTERM drain:** stop admitting, stop claiming, let in-flight solves finish or be terminated by A3's supervisor, mark remainder recoverable, exit within Render's deadline.
- [ ] Tests: kill-and-reboot with N queued rows → all execute exactly once; kill-and-reboot mid-`running` → row is failed truthfully, not silently requeued; double recovery is a no-op; stale-generation completion is dropped; boot with DB unreachable fails closed; indexes exist for the claim and recovery queries.
- [ ] Commit: `[A2] single-instance durable queue: boot recovery, CAS claim, ownership-checked completion`.

## Task A3 — fd3 protocol + Node process-group supervisor (§2.11; Q52/Q64/Q71/Q74/Q77/Q78; review A-R10, A-R11, A-R12)

**Files:** `artifacts/api-server/src/solver/solve.py`; `cbc_termination.py`; `jobRunner.ts`.

**Producer and reader ship in ONE commit.** Splitting them (the old A2→A3 order) leaves an intermediate deployable state where Python writes fd3 while the Node runner still reads stdout's last line (`jobRunner.ts:163`) — a broken runtime and a failing gate between commits, violating hard rule #4. The dual-output-flag alternative is rejected: transitional protocol code costs more than the atomic commit. This is the one task that intentionally exceeds a single file pair.

- [ ] **Python side:** emit on **fd 3** exactly one newline-terminated JSON object, `{envelope | failure}` (success-envelope **xor** failure), ≤1 MiB read incrementally with abort-at-cap; set fd 3 close-on-exec **before** spawning CBC. Failure = `{failureReason, failureStage, errorDetail}` with structured allowlisted detail — never raw stdout/exception/paths. Map every current `_load_error_envelope`/error exit to the failure branch with the correct `failureReason`/`failureStage` per §2.11's enums. stdout/stderr separately capped at ≤64 KiB each.
- [ ] **Node side:** spawn Python **detached** (process-group leader); read fd 3; on outer timeout/cancel send TERM→(grace)→KILL to the **whole group**; wait/reap the direct child and probe group death on a bounded interval. **Node owns** the per-solve temp dir (mkdtemp → pass the validated path in → verified idempotent removal after group death); Q77's validated-directory parameter is the exact seam.
- [ ] **Terminal truth table (Q78) — literal, in this task, not prose.** Enumerate every combination of: timeout fired/not; cancellation fired/not; exit zero/nonzero/not-yet-closed; fd3 message valid-success/valid-failure/missing/partial/oversized/invalid/both/neither; cleanup success/failure; late message or late exit after a terminal decision. Normative: timeout and cancellation dominate, in that order; **only** exit-zero plus one valid success message publishes; a valid failure message fails **regardless of** exit zero; a success message with nonzero exit never publishes; missing/invalid/both/neither fail; late events are dropped; cleanup failure after a valid result publishes the result and records the cleanup failure internally, never double-publishing. Every row (or named equivalence class) gets a deterministic test.
- [ ] **Containment acceptance:** Linux/POSIX-only startup fail-fast; stated TERM grace duration and probe interval; CBC log and `.sol` maximum on-disk sizes with bounded incremental reads; visible internal recording of cleanup failure; defined cancellation sources (SIGTERM/deploy, internal cancel, public cancel if one exists); repeated timeout/cancel/crash runs with no process, descriptor or artifact accumulation.
- [ ] **Go/no-go no-orphan proof on Linux (Q74):** record Python+CBC PIDs/PGID; force timeout and forced-kill including killed-parent/CBC-alive; prove no survivor, temp reclaimed, publish-once, repeated-timeout leak-free. Per Q74 this proof gates **R3/`v2_write`**, not the start of this task.
- [ ] Commit: `[A3] fd3 SolverProcessMessage + Node process-group supervisor + terminal truth table + no-orphan proof`.

## Task A4 — five schemas + OpenAPI + Zod + normalizer + composition (§2.6/§2.7; Q65/Q83; review A-R8)

**Files:** `lib/api-spec/openapi.yaml` (+regen `lib/api-zod`/`lib/api-client-react` same commit); `resultEnvelope.ts`; `routes/scenarios.ts`.

- [ ] `SolverSuccessEnvelopeV2` / `ResultCacheEntryV2` / `PublishedSolveResultV2` / `StoredScenarioResult` / `NormalizedSolveResult`, split by authority per the global constraint: OpenAPI owns `PublishedSolveResultV2` and `NormalizedSolveResult`; server Zod owns the fd3 envelope, the cache entry, and the raw stored shape.
- [ ] `composePublishedResult(cacheableResult, job)` — the single composition point, applied on **both** fresh-solve and cache-hit paths, attaching the **current** job's requested values so a cache hit never returns another request's values.
- [ ] Legacy normalizer per §2.7, including the status/evidence-aware `objective` rule (a legitimate stored `0` is preserved; `===0` alone is never the test).
- [ ] Assert only the published shape reaches `scenarios.result`/public APIs; §2.4 invariant rejection, including that no failure validates as any result shape; equivalence tests at each private→public boundary.
- [ ] Commit: `[A4] five result schemas + composePublishedResult + legacy normalizer`.

## Task A5 — public `errorCode` + permanent `errorMessage` (§2.11; Q61/Q80; review A-R9)

**Files:** `openapi.yaml`(+regen), `jobRunner.ts`, `routes/`.

- [ ] Exhaustive `failureReason`/Node-class → `errorCode ∈ {SOLVE_FAILED, TIMEOUT}` table per §2.11, with fixed safe messages (interruption → `SOLVE_FAILED` / "Solve interrupted"). `INPUT_INVALID` stays a synchronous 422 with no job.
- [ ] Permanent public shape (A0's decision): `errorCode` **plus** server-owned `errorMessage`. The raw stored `solve_jobs.error` diagnostic is never surfaced; historical failed rows read as a conservative `SOLVE_FAILED` + safe message.
- [ ] Negative-leakage tests across job polling, history, exports, logs and public telemetry: no `failureReason`/`failureStage`/`errorDetail`/path/secret/stdout in any public response.
- [ ] Commit: `[A5] public errorCode + permanent errorMessage + leakage tests`.

## Task A6 — composite cache identity + v2 cache (§2.10; Q35/Q41/Q75; review A-R5) — **needs G-cache**

**Files:** `jobRunner.ts` cache path; a version-manifest module.

G-cache's design artifact must define, and be approved on, all of: the exhaustive sorted manifest of exact paths/artifacts; canonical path normalization, encoding, ordering, length framing, hash algorithm and output format; the exact `SOLVER_CONTRACT_VERSION` value and owner; the exact PuLP identity; a **runtime-derived** identity for the CBC executable each instance actually runs (banner/build id, binary digest, or both — stated); complete worked hash vectors with expected digests; fail-closed startup behavior and operator recovery; stability and per-component invalidation tests; and the behavior of existing unversioned cache rows, mixed instances and rollback.

- [ ] Implement exactly that artifact. `SOLVER_CODE_HASH` (today: `solve.py` only) is replaced.
- [ ] v2 cache read/write keyed on it; a parser or contract-version bump invalidates even with `solve.py` unchanged; unversioned rows are a cache miss.
- [ ] Commit: `[A6] composite solver-contract cache identity + v2 cache`.

## Task A7 — outcome-specific cache/publication lifecycle + atomic publication (§2.8; Q84; review A-R13, A-R14)

**Files:** `jobRunner.ts` (`markSucceeded` and the branch preceding it).

- [ ] Explicit outcome branch before every cache write and `markSucceeded`, per §2.8: `optimal`/`infeasible`/`unbounded` → succeeded, cache, publish · `feasible` → succeeded, cache **only** under the complete effective-limit/version key, publish with the truthful label · `no_solution` → succeeded, **no cache**, publish the no-incumbent result · execution failure → failed job, no cache, no scenario publication.
- [ ] **Preserve the existing atomic publication.** `jobRunner.ts:302` already updates the job result/summary and the scenario result/run pointer in one transaction; require that this stays **one** transaction, extended with the A2 ownership/latest-job check, and emit completion telemetry **only after commit**.
- [ ] Tests: every solution and failure outcome against cache and publication; fresh and cache-hit composition; transaction failure/rollback; a stale or older job's completion never overwrites a newer result.
- [ ] Commit: `[A7] outcome-specific cache/publish lifecycle + atomic publication guard`.

## Task A8 — backend result consumers + compatibility shims (§2.7.1; Q83; review A-R7)

**Files:** `routes/solveHistory.ts`; `routes/scenarios.ts` export paths; `artifacts/api-server/src/solver/tests/_envelope_compat.py`.

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

## Task A10 — single-flight, single-instance scope (review A-R3)

**Files:** `jobRunner.ts`; `lib/db/src/schema/` (active-run record).

Retained in A per the 2026-09-22 decision, but **scoped to one instance** for coherence with A2 — cross-worker coordination requires the lease protocol that A deliberately leaves to Scaling. A cache-key identity (A6) is a prerequisite, not an implementation.

- [ ] Define the active-run record keyed on A6's composite hash, winner election by DB uniqueness within a transaction, subscriber attachment for concurrent identical cold requests, cache recheck after winning, failure/timeout propagation to all subscribers, retry behavior, and stale-owner recovery via A2's `claim_generation`.
- [ ] **Explicit non-goal:** cross-instance single-flight. State that a second instance would solve independently until Scaling's lease protocol lands, and record it as a Scaling dependency.
- [ ] Tests: N identical cold requests → exactly one solve, N results; winner failure propagates to every subscriber; stale owner is reclaimed; cache hit after win short-circuits.
- [ ] Commit: `[A10] single-instance single-flight on the composite cache identity`.

## Task A11 — staged v1→v2 rollout + rollback floor (§2.13; Q54/Q63/Q81; review A-R4)

**Files:** feature-flag config; deploy runbook doc.

- [ ] Implement A0's release-state matrix: R1 (nullable schema + **three-way** reader, writes B-format) → R2 (client compatible with B and v2, `errorCode`/`errorMessage` alongside the old `error` for the window) → R3 (`v2_write` flag, default off, enabled only after drain proof from Render deploy/health showing zero pre-R1 instances).
- [ ] Rollback floor: never below R1 once any v2 row exists; disable `v2_write` **before** rollback; concrete treatment of already-written v2 `scenarios.result`, `solve_jobs.result` and cache rows.
- [ ] Observability (Q81): the client build/contract-version signal, the named compatibility cutoff and window, and the cleanup criterion. Legacy **stored-row** reader is retained indefinitely (Q69) and is explicitly separated from the removable public-compat fields.
- [ ] Deploy order `nos-api` → `nos-studio`. Per the CLAUDE.md gotcha, expect to trigger the `nos-studio` deploy manually.
- [ ] Commit: `[A11] staged v1→v2 rollout config + rollback floor + runbook`.

## Task A12 — telemetry at real emission sites (§2.7.1/§2.11; Q56; review A-R15)

**Files:** the PostHog emission sites and the Sentry configuration, named explicitly in the task at execution time.

Two contracts, kept separate — product telemetry is not operator diagnostics:

- [ ] **PostHog (product):** `"scenario solve completed"` — necessarily v2 post-cutover, existing allowed properties retained, emitted **only after** A7's publication transaction commits. `"scenario solve failed"` — bounded `errorCode` tag only, no diagnostic contents. **No legacy-read event** (legacy is surfaced via the typed `legacyUnverified` field).
- [ ] **Sentry (operator sink):** bounded `failureReason`/`failureStage` tags plus the structured allowlisted `errorDetail`; still prohibits raw payloads, secrets, paths, stdout/stderr and arbitrary exception text.
- [ ] Tests at **every actual emission site** for the property allowlist and for no payload/objective-input/path/diagnostic leakage.
- [ ] Commit: `[A12] per-site PostHog/Sentry telemetry contracts + allowlist tests`.

## Task A13 — QA + full gate (review A-R16)

**Owner:** `qa-sdet`, real browser + Linux.

Every assertion below traces to exactly one implementing task; no orphan acceptance criteria.

- [ ] Process-level (A3): missing executable, nonzero exit, every invalid fd3 form (missing/partial/oversized/invalid/both/neither), Python and parser exceptions, cleanup failure, outer timeout, cancellation/deploy interruption, and the Linux no-orphan proof.
- [ ] Queue (A2): restart-mid-load with a deep queue → no stuck jobs, each solve runs exactly once, no never-ending spinner.
- [ ] Publication (A7): atomic publication, stale/older-job completion, cache-hit composition using the current job's requested values.
- [ ] Single-flight (A10): N identical cold requests → 1 solve, single instance.
- [ ] Full verification gate + **direct** `python3 tests/e2e_accuracy.py` (99/99, objectives unchanged after B's DEC-authorized status correction) + `e2e_journey.py` repair onto `/auth/register`+`/auth/login` (argon2).
- [ ] Per the CLAUDE.md standing step, grep `artifacts/studio/e2e/` for any testid or visible string A9 changed and rewrite those sibling specs before merge.
- [ ] Commit: `[A13] QA: process, restart, publication, single-flight + full gate`.

## Ordering & parallelism

A0 → A1 → A2 (durable spine) → A3 (protocol + supervisor, atomic). A4/A5 after A3. A7 after A4. A6 after A4 + G-cache. A10 after A6 + A2. A8/A9 after A4/A5. A11 after A0/A4/A5. A12/A13 last.

Dispatch via the agent team with **pre-created locked worktrees** (per the CLAUDE.md gotcha — do not rely on `isolation: "worktree"`); controller cherry-picks each commit onto the bundle branch and re-gates.

## Preserved principles (validated by the 2026-09-22 review)

Node, as the surviving actor, owns the process group and the exact solve directory · fd3 is separated from bounded stdout/stderr · a process message is success-envelope **xor** private failure, and failures never become result envelopes · requested and effective solver-limit values stay separate · cacheable and published shapes are distinct with one composition point · public failures use coarse stable codes and fixed safe messages · a pre-R1 reader is forbidden after the first canonical v2 write, and the legacy stored-row reader remains indefinitely · the Linux no-orphan proof is a real writer-activation gate, not paperwork · historical unknown metadata stays null rather than fabricated.

## Review disposition (2026-09-22 deep approval review)

All 16 findings accepted. Two framing corrections recorded. Full finding text is in the review's own record; this table is the normative disposition.

| Finding | Disposition | Landed in |
|---|---|---|
| A-R1 §34 approval assumed but absent | Accepted | Status header, G-Q73 |
| A-R2 durable payload/restart safety undesigned | Accepted on facts; the A-or-Scaling binary rejected — **split**, A owns single-instance | A1, A2, global scope boundary |
| A-R3 single-flight untasked | Accepted; **retained in A**, scoped single-instance | A10 |
| A-R4 rollout incompatible with post-B baseline | Accepted; root cause = §2.13 predates the A/B split | A0, A11 |
| A-R5 composite cache identity underspecified | Accepted | G-cache, A6 |
| A-R6 `request\|default` contradicts §2.12 | Accepted | A1 |
| A-R7 result-consumer migration incomplete | Accepted, **corrected**: `_envelope_compat.py` is a test shim under `tests/`, not a production consumer | A8, A9 |
| A-R8 schema authority ambiguous | Accepted (Q83 already decided) | Global constraints, A4 |
| A-R9 permanent failed-job API unresolved | Accepted; **decided**: `errorCode` + permanent `errorMessage` | A0, A5 |
| A-R10 A2/A3 not independently releasable | Accepted; dual-output-flag option rejected, **producer+reader merged** | A3 |
| A-R11 terminal contract not exhaustive | Accepted | A3 truth table |
| A-R12 process containment omits safeguards | Accepted | A3 |
| A-R13 cache/publication lifecycle untasked | Accepted | A7 |
| A-R14 atomic publication unprotected | Accepted | A7 |
| A-R15 telemetry ownership vague | Accepted | A12 |
| A-R16 QA validates unimplemented behavior | Accepted | A13 |

**Re-approval is still required.** Satisfying this disposition does not self-approve execution; run a new consolidated approval review against this revision.
