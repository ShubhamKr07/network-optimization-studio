# WatBot answer feedback and repair — design

Date: 2026-11-22 · Status: approved by the owner 2026-11-22; ships with the first WatBot deploy. Revised 2026-11-22 for the plan-time refinements and the Codex adversarial review (F7–F10) · Task prefix: `WATBOT-FB` · Builds on [Spec 1](2026-11-20-watbot-panel-qa-design.md)

The student rates WatBot's latest answer with ✓ or ✗. A ✗ asks for a reason, and three of the reasons make WatBot answer again under a different reply rule. Every rating is stored, so the teaching team can see which answers helped, why the others didn't, and whether the re-answer fixed it.

## 1. Decisions

| # | Decision | Rejected |
|---|---|---|
| F1 | The rating line sits at the foot of the conversation, under the **latest** tutor answer, from the first answer on. A new answer resets it, so every rating belongs to one tutor message | Prompt on leaving the panel (easy to dismiss); a rating under every reply (rates replies, not understanding) |
| F2 | ✗ shows five preset reasons, one choice. "Other" opens an optional note (≤ 500 characters) | ✗ alone (no reason); a free-text box only |
| F3 | Reasons 1–3 re-answer the student's latest question; reasons 4 and Other show a fixed "rephrase" notice and make no model call (§3) | No repair, tracking only |
| F4 | Reason 1 re-answers under an "explain first" rule that still never gives, confirms or corrects the answer. Like every answer, the re-answer gets the runtime value check on **every** block, cited ones included (F9), so Spec 1's leak rules hold by enforcement as well as by prompt | Allowing the answer on request; reason 1 on concept questions only |
| F5 | A re-answer counts as one of the student's 50 questions per 24 h and goes through the monthly cap and the per-user lock, like any question | Free re-answers, once or unlimited |
| F6 | One path for the re-answer: `POST …/feedback` stores the rating, then the client calls the existing `POST …/messages` with `repairOf` | The feedback endpoint streams its own answer (duplicates admission, SSE, finalize); the client sends the reason as student text (cannot enforce the rule or the type exclusion) |
| F7 | **Claim at admission.** Under the per-user lock, the re-answer claims its rating with a compare-and-set on `repair_message_id` before any model call. A claimed rating can't be changed, and its reason is the one the rule used. Both feedback writes and re-answers take the per-user lock | Linking the rating after the model call: a delayed second request can pass stale checks and pay for a second repair, and a reason change mid-stream desyncs the stored reason from the rule used |
| F8 | **A stale claim is reclaimable.** Under the per-user lock nothing else of that student's is in flight, so a claim with no tutor row after its student row means the re-answer died (crash, a failure before any model call, or a stop). Such a claim may be taken again. No separate in-progress state is needed | An explicit in-progress status with a recovery job; releasing the claim in `finalize()` (a crash skips it and strands the rating) |
| F9 | **Every answer**, re-answers and ordinary answers alike, applies `passesValueCheck` to cited blocks too (Spec 1 D20, revised by the owner 2026-11-22). A failing block is dropped like an uncited claim (`claim_removed` notice). Complete-formulation leaks have no runtime check, as in Spec 1; the test set's judge covers them (§7) | Prompt-only protection (Codex review: the cited path bypasses the value check); the check on re-answers only (leaves the same gap in every ordinary answer) |
| F10 | **The context comes from the server.** A re-answer rebuilds its context from the source student row's stored `context` (`tab`, `scenarioId`), re-deriving the summary and facts from the owned scenario row as for any question. The client sends no context for a re-answer, so a reload or a conversation picked from history repairs correctly | A client-held "last context" (lost on reload or history pick) |

## 2. What the student sees

- Below the latest tutor answer: **"Did this help you understand the topic?"** with ✓ and ✗ buttons. It is hidden while an answer streams, and when the latest tutor row has no blocks (stopped, refused or failed).
- ✓ stores the rating and the line becomes "Thanks for the feedback."
- ✗ opens the reason list (radio group) and a Send button:

| # | Key | Label | Action |
|---|---|---|---|
| 1 | `too_many_questions` | It kept asking me questions instead of explaining | re-answer, rule R1 |
| 2 | `hard_to_follow` | The explanation was hard to follow | re-answer, rule R2 |
| 3 | `not_what_i_asked` | It didn't answer what I asked | re-answer, re-typed (R3) |
| 4 | `still_stuck` | I still don't know how to do the exercise | notice |
| 5 | `other` | Other (opens "What's still unclear?", optional, ≤ 500 characters) | notice |

- The notice for 4 and Other is client-side, not stored as a row: "Try asking again in your own words, and say which step you're stuck on."
- A re-answer shows as a short student line, then the new answer, which gets its own rating line:
  - ↻ Explain with fewer questions
  - ↻ Explain it step by step
  - ↻ That's not what I asked
- The rating can be changed until a re-answer claims it (F7).
- `GET …/conversations/:id` does not return ratings. After a reload, the line shows again for the latest answer, and a second rating updates the same row.

## 3. Re-answer rules

A re-answer resends the **root** original question. The route follows `watbot_feedback.repair_message_id` back through earlier re-answers until it reaches a student row that is not itself a re-answer. The history is everything before the new student row, so it includes the answer being repaired. The new student row stores the ↻ label, not the original text, and copies the source row's `context`.

The server adds a fixed note to the last user turn, after `Student message: <original question>`:

`(Re-answer: the student asked "<↻ label without the arrow>" about your previous reply.)`

Round 1 still forces `record_message_type`. The engine takes `repair?: { rule, excludeType }`. That input changes only the tool results. The cited-block value check applies to every answer (F9):

- **R1 · `too_many_questions`:** the tool result is the recorded type's `REPLY_RULES` entry followed by `REPAIR_RULES.too_many_questions`:
  > Re-answer rule: the student said your previous reply asked too many questions. Explain the idea behind their message from a cited passage first, in two to four sentences, then ask at most one question. Still never give, confirm or correct the answer, and never state an optimal facility set, an objective value or a complete formulation that the Student context does not show.
- **R2 · `hard_to_follow`:** the type's rule followed by `REPAIR_RULES.hard_to_follow`:
  > Re-answer rule: the student found your previous reply hard to follow. Keep to the reply rule above, but break the cited passage into small, plain steps, one idea per sentence, and explain every term you use.
- **R3 · `not_what_i_asked`:** `excludeType` is the message type stored on the **nearest** answered student row before the rated answer, which is the row whose answer is being repaired.
  - A `record_message_type` call naming that type is not stored. It gets an `is_error` result: "The student said your previous reply did not answer what they asked, so <type> is ruled out. Record a different type."
  - The round after a rejection forces `record_message_type` again, on `FORCE_RECORD_MODELS` only. Without that, the live QA run (WATBOT-FB-7) saw the model answer under `auto` without re-recording, which left the type null.
  - The next valid call is stored (M1's first-wins applies to accepted calls only) and gets that type's normal rule.
  - If that row has no type (the model skipped it), nothing is excluded.

`REPAIR_RULES` lives in `prompt.ts` next to `REPLY_RULES`, so Spec 1 §7 applies: any edit needs a passing test-set run before it ships. `SYSTEM_PROMPT` and `TOOLS` do not change, so the cached bundle prefix is unaffected.

## 4. API

New endpoint, `POST /watbot/conversations/:conversationId/feedback`, `submitWatBotFeedback`:

- **Body:** `{ messageId, helped, reason?, note? }`. `reason` is required when `helped` is false and must be absent when it is true. `note` is allowed only with `other`, ≤ 500 characters, trimmed, and empty becomes null.
- **Rules:**
  - 404 if the conversation is not the caller's, or `messageId` is not a tutor row in it.
  - The endpoint takes the per-user lock (409 `watbot_busy` if a question is in flight).
  - Under the lock: 409 `watbot_feedback_locked` if the rating carries a **live** claim, one whose student row has a tutor row after it.
  - Otherwise it upserts on `message_id`, and clears a stale claim.
- **Response:** 201 `{ id, repairLabel }`. `repairLabel` is the ↻ label for reasons 1–3 and null otherwise, so the labels have one source.
- The insert runs in a `catch` with no error binding: the note is user-written text, and an unwrapped drizzle error carries its parameters into every error sink (api-server gotcha).

Change to `AskWatBotRequest`: optional `repairOf` (integer feedback id). When it is present, under the per-user lock, before any spend reservation or model call:

- **Validation.** The feedback row must be:
  - the caller's, in this conversation;
  - a ✗ with a reason in 1–3;
  - on the conversation's **latest** tutor row;
  - unclaimed, or stale-claimed (F8).

  Otherwise the request gets 404, or 409 `watbot_feedback_locked` for a live claim.
- **Claim.** After the student row is inserted, the server claims the rating with `update … set repair_message_id = <new student row> where id = <feedback> and repair_message_id is not distinct from <value read>`. If no row is updated, the request answers 409 `watbot_feedback_locked`, and the student row is marked `cancelled` so it doesn't count.
- **Question and context.** `question` is still validated but ignored. The server stores its own ↻ label as the student row text and sends the root question to the engine. The client's `context` is ignored, and the server rebuilds it from the source row (F10). If that row's scenario no longer exists or isn't owned, the context keeps the tab only.
- **Admission** is otherwise unchanged (F5).

Both changes go into `lib/api-spec/openapi.yaml`, and the Orval client is regenerated in the same commit (hard rule 1). `watbot_feedback_locked` is a new closed-union error code: the TypeScript union, the OpenAPI enum and the regenerated client change together. A route test pins the response shape and the error code.

## 5. Data

New table `watbot_feedback`. Every FK cascades, as in Spec 1 §6:

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| user_id | varchar → users.id | |
| conversation_id | integer → watbot_conversations.id | |
| message_id | integer → watbot_messages.id, **unique** | the tutor row rated |
| helped | boolean not null | |
| reason | varchar(32) | null when `helped` |
| note | text | `other` only |
| repair_message_id | integer → watbot_messages.id, `on delete set null` | the claiming re-answer's student row (F7) |
| created_at, updated_at | timestamptz | |

- This is a new table only. No existing column changes, so no `required[]` or backfill concerns. Production still needs `drizzle-kit push` before the deploy (`docs/ops/schema-push-before-deploy.md`), because every read of a missing table fails.
- The re-answer's student row stores its own `message_type`, which for R3 is the corrected type, and its own `context`, copied from the source row.
- `watbot_reports` is not reused. Reports flag a faulty answer with their own reasons, while feedback rates helpfulness and drives a repair. Mixing the two would blur both metrics.

## 6. Metrics

New queries in `docs/ops/watbot-metrics.md`, by model and by the rated answer's student message type:

- Helped rate: ✓ ÷ rated answers. Coverage: rated ÷ answered.
- Reason counts for ✗.
- Repair outcome, reported as three figures:
  - repairs;
  - re-answers that were rated;
  - the ✓ share **among rated re-answers only**, with an explicit rated denominator. An unrated re-answer is neither a success nor a failure.
- R3 corrections: original type → corrected type, a direct measure of classification errors.

## 7. Testing

- **Engine (`watbotEngine.test.ts`):**
  - R1 and R2 append the repair rule after the type's rule.
  - R3 rejects the excluded type, stores the next valid one, and returns that type's rule.
  - In every answer, a **cited** block with an unseen 4+-digit value or facility name is dropped with `claim_removed`, and the same block is kept when the context summary shows that value (D14).
  - With no repair, the tool results are byte-identical to today's.
- **Routes:**
  - 404 for another user's conversation or message, and for a non-tutor `messageId`.
  - Body validation: a reason with ✓, a note without `other`.
  - Upsert, then 409 after a live claim.
  - The response shape and the `watbot_feedback_locked` code.
  - `repairOf` on a non-latest answer, reasons 4 and Other, a ✓, or another user's rating → rejected.
  - A repair inserts an `answered` student row that counts toward the 50.
  - **Claim:**
    - The claim is set before the model call. A feedback write during an in-flight re-answer gets 409 `watbot_busy`.
    - A stale claim (a student row with no tutor row after it) can be re-claimed, and a live claim cannot.
  - **Context:** a re-answer sent with `context: null` still uses the source row's scenario summary.
  - **Chains:** a re-answer of a re-answer sends the root question.
- **Studio RTL:**
  - The line shows only under the latest tutor answer with blocks.
  - ✓ shows "Thanks".
  - ✗, then reason 1 → the feedback and ask calls run in order, and the ↻ line appears.
  - Other → the note box, then the notice. Reason 4 → the notice, no ask call.
  - A new answer resets the line.
  - A re-answer after `load()` works, because it doesn't depend on client context.
- **Real-browser QA** (qa-sdet): the full ✓ and ✗ flows against a local stack, including one paid re-answer per reason 1–3 and one after a page reload.
- **Test set:** the owner approves about 15 repair cases added to `eval/testSet.json`, mostly R1 on wrong attempts and "give me the answer" messages, where a leak is most likely.
  - Each case carries the history to the answer being repaired, and the runner passes `repair`.
  - The grader applies the same leak bar to the **streamed output**: the objective and site-set match on the forwarded blocks, plus the formulation judge.
  - The report adds two rates per bucket, because F9 drops more cited text than before:
    - the share of replies with at least one removed claim;
    - the share of replies that forwarded nothing at all.

    The owner reviews both before ship.
  - A passing paid run is needed before ship (the last full run cost $0.2524). It needs explicit approval, like every paid run.

## 8. Rollout and rollback

### Rollout order

1. **Production schema push** of `watbot_feedback` (`docs/ops/schema-push-before-deploy.md`).
2. **Deploy nos-api**, then **deploy nos-studio**.

This order matters for version skew. An old studio against a new API simply shows no rating line, which is safe. A new studio against an old API gets 404 from `POST …/feedback`, so the student sees "Could not send your feedback" and no re-answer runs. That isn't harmful, but it is broken UX, so the API goes first. After any push, check `list_deploys` (render-ops skill).

### Rollback units

Each unit is a commit, or a run of commits, that can be reverted on its own. The SHAs are recorded in the changelog as each task lands.

| Unit | Commits | What a revert removes | What stays |
|---|---|---|---|
| R-A · Whole feature | WATBOT-FB-1…5 | Rating line, endpoint, `repairOf`, repair rules, F9's cited check | WatBot Spec 1 itself; the `watbot_feedback` table and its rows |
| R-B · Re-answers only | the `repairOf` and `REPAIR_*` parts of FB-2/3 and the studio's `onRepair` (FB-4) | Reasons 1–3 re-answering. The studio then shows the rephrase notice for every ✗, and ratings are still stored | Tracking |
| R-C · Cited-block check only | the one-line `keep` change in FB-2 (F9 / Spec 1 D20 revised) | The value check on cited blocks | Everything else |

R-C exists because F9's cost isn't measured until Task 6. If production shows a high empty-reply or claim-removed rate, R-C restores the original D20 without touching the feature.

### Triggers

Any of these is grounds to roll back. The owner decides.

- **R-A or R-B:**
  - A re-answer leaks an optimal facility set, an objective value or a complete formulation in production (a report, or the metrics queries).
  - 5xx errors on `POST …/feedback` or on re-answers (Sentry).
  - A re-answer that bypasses the 50/24 h limit or the monthly cap.
- **R-C:** the empty-reply rate, or a rise in claim-removed notices, makes answers unusable.

### How

1. **Fastest restore.** Roll the affected service back to its previous deploy in the Render Dashboard: nos-api first if both are affected, then nos-studio.
   - Rolling back nos-api past the first WatBot deploy removes WatBot entirely, so prefer a revert for a feature-only rollback.
   - A Dashboard rollback leaves `main` ahead of what's deployed. Follow it with the revert commit below, so the next deploy doesn't re-ship the problem.
2. **Revert.** Revert the unit's commits on a new branch (`git revert <sha>…`, never a force-push), then go through the normal pipeline. Merge, review, push and deploy are each their own approval.
   - Reverting the prompt text (`REPAIR_RULES`) back to the last state that passed the test set needs no new paid run.
   - A partial revert that leaves a new prompt combination needs one (Spec 1 §7).
3. **Data.** **Do not drop `watbot_feedback`.** Code without the feature never reads it, and older code doesn't list it, so the table is harmless either way and its rows keep the feedback already given. Re-answer student rows stay in `watbot_messages` as ordinary student text (the ↻ label). Dropping the table is a separate, explicit decision, after a backup.
4. **Approvals.** A rollback deploy is still a deploy. It needs the owner's explicit yes, with the `pnpm deploy:preflight` checklist, exactly like a forward deploy (CLAUDE.md branch discipline, step 7).

### Rehearsal

Before merge, Task 8 rehearses R-A locally:
1. Revert the WATBOT-FB commits on a scratch branch.
2. Start the API and studio against a `nos_dev` that still holds `watbot_feedback` with rows.
3. Ask a question and load an old conversation that contains a ↻ row.
4. Expect no errors.

Then delete the scratch branch. This proves the "table stays harmless" claim instead of assuming it.

## 9. Out of scope

- A teaching-team view of ratings (SQL-only, like reports and gaps).
- PostHog events.
- Rating older answers.
- More than one reason per ✗.
