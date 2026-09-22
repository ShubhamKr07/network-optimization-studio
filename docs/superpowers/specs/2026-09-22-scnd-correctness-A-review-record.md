# SCND Correctness (Option A) — Approval Review Record

**Date:** 2026-09-22
**Subject:** `docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md`
**Status:** Historical record. **Not normative** — the plan is the single normative body. This file preserves the two approval reviews *as written*, because each was folded into the plan and then overwritten, leaving no copy in git.

> **Why this file exists.** Both reviews arrived as uncommitted additions to the plan and were rewritten in place during the fold, so the pre-fold file never reached a commit. `git log -S` on either review's text returns nothing. The dispositions survive as tables in the plan; the findings' own wording did not. Reconstructed here verbatim so the reasoning behind each accepted finding remains auditable.
>
> **Process rule going forward:** commit an incoming review *before* folding it, so the fold shows as a real diff against the review rather than against the pre-review file.
>
> **Round 3 (A-R25–A-R30) is NOT reproduced here — it does not need to be.** The rule above was applied for the first time on it: its verbatim text is committed in the plan at **`bf76b04`** (`docs: record round-3 re-approval review verbatim`), so `git show bf76b04` recovers it in full and the fold in the following commit reads as a real diff against it. Rounds 1 and 2 are transcribed below only because no such commit exists for them.
>
> Round 3's dispositions and the author responses to all three rounds live in the plan itself, under "Review disposition — round 3" and "Author responses to review".

Dispositions for every finding below are in the plan's two "Review disposition" tables. Where a finding was accepted with a correction, the correction is recorded there, not here — this file is the input, not the verdict.

---

## Round 1 — deep approval review (2026-09-22)

### Decision

**REQUEST CHANGES — NOT APPROVED FOR EXECUTION.**

The architectural direction is sound, but the plan does not yet implement everything it promises and does not close the controlling post-spike review. Until the findings below are resolved, only the preparatory Node process-supervisor work permitted by the Phase-0 ledger §34 may begin, with all v2 writes, v2 cache operations, and public-contract activation disabled.

### Critical findings

#### A-R1 — the plan assumes an approval that explicitly did not pass

The gate above says the §34 consolidated approval review must pass and assumes that it did. It did not: `2026-09-20-scnd-scaling-phase0-design.md` §34 concludes that P0R.3/P0R.4 remain unapproved until Q73–Q84 and the §34.5 checklist close. This plan also cites decisions only through Q72, omitting the controlling Q73–Q84 findings.

**Required correction:** make the plan's status explicitly blocked; incorporate and resolve Q73–Q84; replace the assumption with a new review record that explicitly approves the corrected plan. Do not treat this review section itself as approval.

#### A-R2 — durable payload and restart safety are promised but not designed

The goal promises durable payloads and A9 expects a restart-mid-load run with no stuck jobs, but A1 adds only failure/request metadata. It does not add `model_id`, an immutable validated `input_snapshot`, claim ownership, a lease, attempt count, execution deadline, recovery semantics, or idempotent ownership-checked terminal updates.

The current runner keeps executable payloads only in the process-local `pendingJobs` map. On restart it reaps `running` rows but does not reconstruct queued work; a queued row can therefore remain stuck forever. This also conflicts with `2026-09-22-scnd-scaling-design.md`, which says Option A supplies durable payloads and the lease/attempt substrate used by the worker tier.

**Required decision/correction:** choose one owner and make the documents consistent:

- If A owns restart safety, add the complete durable-queue slice: immutable payload/version snapshot, atomic `queued`→`running` CAS claim, `worker_id`/deployment ownership, lease expiry, bounded attempts, retry-exhaustion outcome, race-safe recovery, idempotent ownership-checked completion, readiness behavior when recovery cannot reach Postgres, claim/lease/history indexes, explicit connection-pool sizing, SIGTERM drain, and a latest-job/scenario-revision publication guard.
- If Scaling/B2 owns it, remove `durable payloads`, restart safety, restart-mid-load acceptance, and the Scaling dependency on A from this plan.

#### A-R3 — single-flight has an acceptance test but no implementation task

A9 requires `N` identical cold requests to produce one solve, and the ordering paragraph says single-flight "rides A6's cache identity." A6 implements only cache identity plus cache read/write. No task defines the active-run record, winner election, subscriber attachment, transaction/uniqueness mechanism, cache recheck after winning, failure/timeout propagation, retry behavior, stale-owner recovery, or cross-worker behavior.

**Required correction:** either add a separately designed and owned single-flight task with schema/protocol/tests, or remove single-flight from A, A9, and the Scaling reliability dependency. A cache-key identity is necessary for single-flight but is not an implementation of it.

#### A-R4 — the rollout is incompatible with the stated post-B baseline

This plan runs after Option B and says B already ships truthful result fields and a legacy guard, while A7 starts from an R1 writer that emits v1. B actually introduces an intermediate representation: truthful `solutionStatus`/`terminationReason` fields, but no full five-schema contract or `envelopeVersion`. The plan does not explain how that representation relates to historical unversioned legacy rows or canonical A v2 rows.

**Required correction:** inventory and name every post-B representation and define the transition among:

1. historical unversioned legacy results;
2. B's truthful-but-unversioned results;
3. canonical A v2 published results;
4. existing v1 cache entries; and
5. new composite-versioned v2 cache entries.

The release matrix must state the reader, writer, public serializer, cache reader/writer, and frontend behavior for every release. A likely safe R1 is a three-way stored-result reader that continues B-format writes; R2 deploys a client compatible with B and A v2; R3 enables versioned writes only after drain proof. This must be decided, not left implicit.

#### A-R5 — the mandatory composite cache identity remains underspecified

A6's "solve.py + cbc_termination + model/config" manifest and "byte-framed" wording do not close Q35/Q41. A one-time deployed banner smoke check is evidence about one deployment, not a deterministic per-instance identity, and a pinned string can be wrong across architecture or image changes.

**Required correction before approval:** define:

- the exhaustive, sorted manifest of exact paths/artifacts;
- canonical path normalization, encoding, ordering, length framing, hash algorithm, and output format;
- the exact `SOLVER_CONTRACT_VERSION` value/ownership;
- the exact PuLP identity;
- a runtime-derived identity for the actual CBC executable used by each instance (and whether this is banner/build identity, binary digest, or both);
- complete worked hash vectors with expected digests;
- fail-closed startup behavior and operator recovery;
- tests for stability and invalidation by every input component; and
- the behavior of existing/unversioned cache rows, mixed instances, and rollback.

No v2 cache read or write may ship before this design artifact is separately reviewed and approved.

### Important findings

#### A-R6 — A1's source enum contradicts the accepted request contract

A1 permits `requested_gap_source = request|default`, while the accepted contract keeps `gap` and `timeLimitSec` required with no new defaults. For the current version, both source fields must be the literal `request`. `requested_time_limit_source` is also left without exact values.

**Required correction:** specify exact Drizzle/PostgreSQL types and constraints. Use `double precision` (or an explicitly justified scaled `numeric`) for `requested_gap`, `integer` for `requested_time_limit_sec`, and a current-version checked literal `request` for both source columns. State whether enums are PostgreSQL enums, checked varchar columns, or only TypeScript types. Enforce the 2,048-byte `error_detail` bound before persistence and explicitly decide whether a DB check mirrors it.

#### A-R7 — the result-consumer migration is incomplete

A4 names `resultEnvelope.ts` and `routes/scenarios.ts`, but the full contract also affects:

- `routes/solveHistory.ts` and the exact placement/meaning of `legacyUnverified`;
- output exports for current scenario results and `solve_jobs.result` history rows;
- the required `409 / LEGACY_RESULT_REQUIRES_RESOLVE` rejection;
- `_envelope_compat.py`, which must not discard new evidence fields;
- Studio and Workspace result/failure rendering;
- all generated-client consumers of nullable/expanded `status`;
- mixed historical-legacy, B-unversioned, and v2 collections; and
- history values for v2 success, legacy success, failure, and missing/malformed summaries.

There is currently no frontend implementation task even though the contract changes visible status values, nullable objective handling, failure presentation, and legacy badges.

**Required correction:** add named backend-consumer, compatibility-shim, frontend, and mixed-data tasks with files and tests. Assert that a legacy/unverified result is never rendered or exported as proven optimal.

#### A-R8 — private and public schema authority is ambiguous

fd3 messages, cache values, and raw stored rows are private server contracts; normalized scenario results, solve jobs, history, and errors are public API contracts. "Five schemas + OpenAPI + Zod" can lead to two hand-maintained authorities for private schemas.

**Required correction:** state explicitly that OpenAPI owns public response/request shapes, while server-owned Zod owns fd3, cache, and raw-storage validation unless a documented one-way generator is introduced. Add equivalence/boundary tests where a private value becomes a public value. Do not expose private failure or cache shapes merely to reuse OpenAPI generation.

#### A-R9 — the permanent failed-job API is unresolved

A5 retains a derived safe `SolveJob.error`, but A7 never says what remains after the transitional alias is removed. Choose one permanent contract:

- `errorCode` plus a permanent `errorMessage`; or
- `errorCode` only, with one canonical client-side message mapping.

The rollout also still lacks a public-serializer flag name/owner, exact transitional OpenAPI schema, observable client build/contract-version signal, named compatibility cutoff/window, cleanup criterion, and concrete rollback handling for already-written v2 `scenarios.result`, `solve_jobs.result`, and cache rows.

**Required correction:** publish an exact R1/R2/R3/rollback/cleanup state matrix covering reader, writer, serializer, cache, client, flags, deploy ordering, drain evidence, compatibility evidence, and row treatment.

#### A-R10 — A2 and A3 are not independently releasable as written

A2 moves the Python contract to fd3, but the existing Node runner reads the final stdout line until A3 lands. That can break the full gate and runtime between commits, contradicting the plan's independently testable task rule.

**Required correction:** either introduce the fd3 producer behind a default-off protocol flag/temporary dual-output compatibility path that keeps the old runner functional, or combine the producer and reader into one atomic task/commit. Every task commit must pass the applicable full verification gate and must not create a deployable broken intermediate state.

#### A-R11 — the terminal-state contract is still not exhaustive

"timeout > cancel > exit-code×message×cleanup" is not an executable truth table. The plan must define every combination of:

- timeout fired/not fired;
- cancellation fired/not fired;
- exit zero/nonzero/no close yet;
- fd3 message valid success/valid failure/missing/partial/oversized/invalid/both/neither;
- cleanup success/failure; and
- late message/late exit after a terminal decision.

Normative minimum: timeout and cancellation dominate; otherwise only exit zero plus one valid success message may publish. A valid failure message fails regardless of exit zero. A success message with nonzero exit never publishes. Missing/invalid/both/neither messages fail. Late events are dropped. Cleanup failure after a valid result is recorded internally according to the chosen policy and never causes double publication.

**Required correction:** include the literal table in the design/plan and assign deterministic tests for every row or equivalence class.

#### A-R12 — process containment omits required safeguards

Add exact acceptance for:

- Linux/POSIX-only startup fail-fast;
- TERM grace duration and bounded group-death probe interval;
- direct-child wait/reap and descendant group-death proof;
- CBC log and `.sol` maximum on-disk sizes plus incremental/bounded reads;
- verified, idempotent cleanup and visible internal cleanup-failure recording;
- defined cancellation sources (SIGTERM/deploy, internal cancel, public cancel if one exists);
- shutdown ordering: reject/stop admission, stop claims, drain HTTP, finish or terminate children, release/requeue/fail under the lease policy, close DB/PostHog/Sentry, exit within Render's deadline; and
- repeated timeout/cancel/crash runs with no process, descriptor, or artifact accumulation.

#### A-R13 — cache/publication lifecycle is not assigned to a task

The contract requires an explicit outcome branch before cache write and `markSucceeded`:

- `optimal`, `infeasible`, `unbounded` → succeeded, cache, publish;
- `feasible` → succeeded, cache only under the complete effective-limit/version key, publish with truthful label;
- `no_solution` → succeeded, do not cache, publish the no-incumbent result; and
- execution failure → failed job, no cache, no scenario publication.

A6 currently says only "v2 cache read/write keyed on it." It does not implement or test this policy.

**Required correction:** assign the outcome-policy branch to a named task, including fresh and cache-hit composition, and test every solution/failure outcome before cache/publication.

#### A-R14 — existing atomic publication is not protected

The current `markSucceeded` transaction atomically updates the job result/summary and the scenario result/run pointer. The plan must prevent regression of this invariant.

**Required correction:** explicitly require one transaction for job result/summary plus scenario result/run pointer, ownership/latest-job CAS if durable recovery is in A, and completion telemetry only after commit. Test transaction failure/rollback and stale/older-job completion.

#### A-R15 — telemetry ownership and leakage boundaries are vague

Business events currently emit through PostHog; Sentry is an operator sink. A8 names no files or exact emission sites and conflates public/product telemetry with operator diagnostics.

**Required correction:** name the PostHog and Sentry files/sites and keep two contracts:

- product events: bounded properties (`errorCode` for failure; approved success properties), no payload/input/path/diagnostic leakage;
- Sentry: bounded internal `failureReason`/`failureStage` tags plus structured allowlisted `errorDetail`, while still prohibiting raw payloads, secrets, paths, stdout/stderr, and arbitrary exception text.

Test each actual emission site. Emit completion only after the publication transaction commits. Do not add a legacy-read event.

#### A-R16 — QA validates behavior that preceding tasks do not necessarily implement

The restart-mid-load and single-flight assertions are currently orphan acceptance criteria. A9 also compresses process-level runner cases that §34 says remain open.

**Required correction:** make A9 trace every assertion to one implementation task and include, at minimum, missing executable, nonzero exit, every invalid fd3 form, Python/parser exception, cleanup failure, outer timeout, cancellation/deploy interruption, restart/recovery according to the chosen queue policy, atomic publication, cache-hit composition using the current job's requested values, and the Linux no-orphan proof. Keep `e2e_accuracy.py` objectives unchanged after B's DEC-authorized status correction; repair and run `e2e_journey.py` as explicitly scoped.

### Validated strengths

The following directions are approved in principle and should be preserved through the rewrite:

- Node, as the surviving actor, owns the process group and exact solve directory.
- fd3 is separated from bounded stdout/stderr.
- A process message is success-envelope xor private failure; failures never become result envelopes.
- Requested and effective solver-limit values are separated.
- Cacheable and published result shapes are distinct, with one composition point on fresh and cache-hit paths.
- Public failures use coarse stable codes and fixed safe messages.
- A pre-R1 reader is forbidden after the first canonical v2 write; the legacy stored-row reader remains indefinitely unless data is explicitly migrated or removed.
- The Linux no-orphan proof is a real writer-activation gate, not a paperwork check.
- Historical unknown metadata remains null rather than being fabricated.

### Required structure for re-approval

Revise the plan so that it contains explicit, independently testable deliverables for:

1. post-B baseline inventory and closure of Q73–Q84;
2. the durable-queue/recovery ownership decision and, if retained in A, its complete protocol;
3. a compatible fd3/process-supervisor slice;
4. exact database types, constraints, failure persistence, and permanent public error API;
5. private/public schema authority plus all backend, history, export, compatibility-shim, and frontend consumers;
6. an exact, separately approved composite cache-identity artifact;
7. the outcome-specific cache/publication lifecycle and atomic publication;
8. a separate single-flight protocol task, or its removal from A;
9. the complete R1/R2/R3/rollback/cleanup release matrix;
10. PostHog/Sentry telemetry contracts at real emission sites; and
11. QA whose acceptance criteria are each owned by a preceding implementation task.

After those changes, run a new consolidated approval review. Approval of the rewritten plan must be explicit; satisfying the checklist does not self-approve execution.

---

## Round 2 — re-approval review (2026-09-22)

### Decision

**REQUEST CHANGES — NOT YET APPROVED FOR FULL EXECUTION.**

This revision resolves most findings from the first deep review, especially schema authority, permanent error semantics, backend/frontend consumer ownership, cache/publication policy, atomic publication, single-flight task ownership, and the PostHog/Sentry separation. The remaining findings below are implementation-driving rather than editorial; they must close before full approval.

No source or test execution was performed as part of this review. The review used the committed plan at `2909916`; unrelated uncommitted solver/parser changes in the worktree were left untouched and were not treated as evidence that a plan task is complete.

### Blocking findings

#### A-R17 — CRITICAL: single-instance restart recovery is unsafe during rolling deployment

A2 assumes that a `running` row owned by a prior process generation is reclaimable because the service is configured for one instance. That assumption does not hold during a rolling/zero-downtime deployment: an old and a new process may overlap even when the steady-state instance count is one. The new process can mark the old process's genuinely running job failed; the old process can then finish successfully, only to have its completion dropped by the generation check. The user sees a failure despite a completed solve.

An instance-count configuration assertion proves neither process death nor absence of deployment overlap. `claim_generation` alone identifies an owner but does not establish that the owner is dead.

**Required correction:** give A enough liveness evidence for process-generation overlap. Choose and specify one of:

1. a minimal owner heartbeat/expiry lease in A (Scaling may still extend it with multi-worker polling, attempts, fairness, and `FOR UPDATE SKIP LOCKED`); or
2. an exact deployment handoff protocol that proves the prior queue consumer is dead before any `running` row is reclaimed.

Test two simultaneously alive process generations explicitly: the new generation must not fail or steal the old generation's live job; after genuine owner death, recovery must reach one deterministic terminal outcome. Update the A/Scaling scope boundary to reflect the chosen minimum.

#### A-R18 — CRITICAL: the only permitted preparatory slice is impossible under the task graph

The status permits only "A3's supervisor half" before full approval, but A3 deliberately combines the Python producer, Node fd3 reader, process supervisor, terminal state machine, and no-orphan proof into one atomic commit. The ordering then requires `A0 → A1 → A2 → A3`, even though A0–A2 are not part of the narrow §34 preparatory authorization. There is therefore no executable interpretation of the permitted "half."

A3 also transports and validates a success envelope before A4 defines the private `SolverSuccessEnvelopeV2` schema, so the protocol task lacks its authoritative message schema at the point it must test the fd3 reader.

**Required correction:**

- Either create a concrete preparatory task (for example A3a) containing the exact private protocol/supervisor work permitted before public activation, or explicitly authorize the whole private A3 task as the preparatory slice.
- Define the private `SolverProcessMessage` and success-envelope schema in or before that task; do not wait until A4.
- State that the preparatory slice leaves public responses, stored-result versions, and cache behavior unchanged and keeps `v2_write` disabled.
- Remove the false A0→A1→A2 prerequisite if the preparatory supervisor slice is independently executable, or obtain approval for those prerequisites first.
- Replace every reference to "A3's supervisor half" with the exact task identifier that can actually be committed and gated.

#### A-R19 — HIGH: Q73/Q76 are not closed in the canonical design source

The plan's status is now clear, but its normative design source remains contradictory: the solver-contract header says P0R.1 is GO and P0R.2 is DONE, later headings/summary retain stale HOLD/pending/three-schema language, and P0R.2 still contains the removed public error-envelope rule. An implementer is still directed by two incompatible contracts.

A0 currently names only the plan and solver-contract §2.13, so it does not own these corrections.

**Required correction:** expand A0's files and acceptance criteria to update, in one consistency pass:

- the solver-contract header/current-status statement;
- P0R.1 and P0R.2 task headings;
- P0R.2's category-by-category completion status;
- the stale public error-envelope paragraph (replace it with failed job + `errorCode`/`errorMessage`, no result publication);
- the P0R.3/P0R.4 headings and authorization state;
- the summary table and stale schema count/names; and
- any final ledger/provenance language that conflicts with the controlling §34 state.

The resulting single state must be: Python capture/parser evidence GO; Node no-orphan acceptance open until the preparatory task proves it; parser/fixture portion complete; process-level runner portion owned by A3/A13; P0R.3/P0R.4 unapproved until the named gates close; no public/v2 error envelope anywhere.

#### A-R20 — HIGH: A10's single-instance claim contradicts its database uniqueness mechanism

A10 says the active-run record is keyed by A6's composite hash with winner election by database uniqueness, then says a second instance would solve independently. A globally unique database row on the composite hash coordinates or blocks every instance, not only one. The non-goal and the mechanism cannot both be true.

The task also leaves result fan-out underspecified: one compute result must complete N subscriber jobs, compose each job's own requested metadata, and publish to each scenario only if that subscriber job is still the latest authorized run.

**Required correction:**

- If A10 is truly single-instance, scope uniqueness explicitly to `(claim_generation, composite_hash)` (or use an equivalent instance-scoped mechanism) and state how Scaling later migrates/extends it to fleet-wide uniqueness.
- Define the active-run schema fields, states, owner, timestamps, terminal state, retention/deletion, and stale-record recovery.
- Define subscriber representation and attachment transaction.
- Define per-subscriber `composePublishedResult`, job completion, scenario latest-job CAS, and transaction boundaries.
- Define winner failure/timeout propagation, partial fan-out failure, crash recovery, and the outcome when a cache entry appears after winner election.
- Add tests for two process generations proving the selected single-instance boundary rather than assuming it.

#### A-R21 — HIGH: durable-schema and historical-recovery edge cases remain open

A1/A2 do not yet define:

- how `claim_generation` is created and made monotonic/durable across boot/crash;
- what boot recovery does with historical `queued` or `running` rows whose new `input_snapshot`, `model_id`, or claim fields are null;
- the exact claim/recovery indexes (A2 tests them but its file list does not own the schema);
- the exact ownership-checked terminal-update predicate; or
- the byte-vs-character semantics of the DB diagnostic constraint.

**Required correction:**

- Define the generation authority (database sequence/row, UUID ownership token if monotonicity is unnecessary, or another exact mechanism); do not call a random token monotonic.
- Choose a deterministic terminal treatment for historical non-terminal rows without executable snapshots, using the safe public error contract; never spin or fabricate an input.
- Put the partial queued-claim/recovery indexes in A1's schema task or add the schema file to A2.
- State the terminal write as an exact ownership/status predicate, e.g. `WHERE id=? AND status='running' AND claim_generation=?`, and require a zero-row result to be treated as a dropped stale completion.
- Mirror the 2,048-**byte** bound with `octet_length(error_detail) <= 2048` (nullable-safe check), not a character-count function.
- Test multibyte diagnostic truncation and the DB constraint.

#### A-R22 — HIGH: rollout activation dependencies permit an incomplete R3

A11 currently depends only on A0/A4/A5. That can create the writer flag/runbook before process supervision, composite cache identity, outcome policy, consumer compatibility, frontend handling, single-flight, telemetry, and final QA are ready. Merely having a default-off flag is acceptable, but its activation prerequisites must be normative and complete.

A7 also follows A4 without an explicit dependency on A6, although its `feasible` cache rule cannot be truthfully satisfied until the complete composite/effective-limit cache key exists.

**Required correction:** distinguish "land the default-off flag/runbook" from "enable R3." R3 activation requires all of:

`A3 + A4 + A5 + A6 + A7 + A8 + A9 + A10 + A12 + A13 pre-activation gate + Linux no-orphan evidence + pre-R1 drain evidence + approved G-cache artifact`.

Order A6 before A7, or explicitly keep every v2 cache path in A7 disabled until A6 is present and verified. A13 must have a pre-activation phase that runs before the flag is enabled and a post-activation smoke phase after enabling it.

### Plan-quality corrections required for approval

#### A-R23 — publish the Q78 terminal table rather than deferring it to implementation

A3's normative precedence is substantially improved, but §34 explicitly requires the complete terminal race table to be normative before approval. "Enumerate during the task" still defers part of the contract to the implementer.

**Required correction:** add the actual table (or complete named equivalence-class table) to this plan or the canonical contract before execution. It must cover timeout, cancellation, exit state/code, message kind/validity, cleanup outcome, late events, terminal classification, cache/publish permission, and diagnostic disposition. Tests must reference table row IDs.

#### A-R24 — telemetry and route seams must be named now

A12 says files are named at execution time, which contradicts the plan's goal of assigning every seam before execution. The current sites are known.

**Required correction:** name at least `artifacts/api-server/src/solver/jobRunner.ts`, `artifacts/api-server/src/lib/posthog.ts`, `artifacts/api-server/src/lib/sentry.ts`, `artifacts/api-server/src/instrument.ts`, and their test files. A5 must likewise name the solve-job polling endpoint in `routes/scenarios.ts` and `routes/solveHistory.ts` rather than the directory-wide `routes/` placeholder.

### Validated resolutions from round 1

The following earlier findings are substantially resolved and should remain unchanged unless a later correction requires a narrow adjustment:

- **A-R6:** requested-limit source fields are pinned to the current literal `request`; numeric types are corrected.
- **A-R7:** backend history/export and frontend consumer tasks now exist; `_envelope_compat.py` is correctly identified as a test shim.
- **A-R8:** OpenAPI/public versus server-Zod/private schema authority is explicit.
- **A-R9:** the permanent API is `errorCode + errorMessage`; raw stored diagnostics are not public.
- **A-R10:** fd3 producer and reader are intended to land atomically; only the preparatory-authorization wording/order remains unresolved under A-R18.
- **A-R11/A-R12:** the required terminal dimensions and containment safeguards are identified; A-R23 requires the promised table to be published before approval.
- **A-R13:** the solution-outcome cache/publication policy has a named task.
- **A-R14:** existing atomic job/scenario publication and post-commit telemetry are explicitly protected.
- **A-R15:** PostHog product events and Sentry operator diagnostics are separate contracts.
- **A-R16:** QA assertions now trace to named implementation tasks, subject to the corrected activation ordering in A-R22.

### Round-2 re-approval conditions

Before the next approval review:

1. make process-generation overlap safe (A-R17);
2. make the preparatory authorization an executable task and place its private schema correctly (A-R18);
3. correct the canonical source's Q73/Q76 status and remove its stale error envelope (A-R19);
4. make A10's uniqueness scope and subscriber fan-out exact (A-R20);
5. close generation, historical-null, index, ownership-predicate, and byte-check details (A-R21);
6. make the R3 activation dependency graph and pre/post activation QA explicit (A-R22);
7. publish the normative terminal table with row IDs (A-R23); and
8. replace remaining file/directory placeholders with exact seams (A-R24).

The composite cache identity remains an intentional external entry gate: the plan can describe A6, but no v2 cache operation or R3 activation is authorized until the separately reviewed G-cache artifact supplies the exact manifest, framing, runtime identities, vectors, and fail-closed behavior.

**Approval remains explicit:** closing A-R17–A-R24 does not self-approve the plan. A new consolidated review must record the approval decision.
