# WatBot answer feedback and repair — design

Date: 2026-11-22 · Status: approved by the owner 2026-11-22; ships with the first WatBot deploy · Task prefix: `WATBOT-FB` · Builds on [Spec 1](2026-11-20-watbot-panel-qa-design.md)

The student rates WatBot's latest answer with ✓ or ✗. A ✗ asks for a reason, and three of the reasons make WatBot answer again under a different reply rule. Every rating is stored, so the teaching team can see which answers helped, why the others didn't, and whether the re-answer fixed it.

## 1. Decisions

| # | Decision | Rejected |
|---|---|---|
| F1 | The rating line sits at the foot of the conversation, under the **latest** tutor answer, from the first answer on. A new answer resets it, so every rating belongs to one tutor message | Prompt on leaving the panel (easy to dismiss); a rating under every reply (rates replies, not understanding) |
| F2 | ✗ shows five preset reasons, one choice. "Other" opens an optional note (≤ 500 characters) | ✗ alone (no reason); a free-text box only |
| F3 | Reasons 1–3 re-answer the student's latest question; reasons 4 and Other show a fixed "rephrase" notice and make no model call (§3) | No repair, tracking only |
| F4 | Reason 1 re-answers under an "explain first" rule that still never gives, confirms or corrects the answer, so Spec 1's leak rules hold on every re-answer | Allowing the answer on request; reason 1 on concept questions only |
| F5 | A re-answer counts as one of the student's 50 questions per 24 h and goes through the monthly cap and the per-user lock, like any question | Free re-answers, once or unlimited |
| F6 | One path for the re-answer: `POST …/feedback` stores the rating, then the client calls the existing `POST …/messages` with `repairOf` | The feedback endpoint streams its own answer (duplicates admission, SSE, finalize); the client sends the reason as student text (cannot enforce the rule or the type exclusion) |

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
- The rating can be changed until a re-answer is made from it. Once `repair_message_id` is set, the rating is final, because the re-answer is the new latest answer.

## 3. Re-answer rules

A re-answer resends the **original student question** (the last student row before the rated tutor row) with its stored context. The history is everything before the new student row, so it includes the answer being repaired. The new student row stores the ↻ label, not the original text.

The server adds a fixed note to the last user turn, after `Student message: <original question>`:

`(Re-answer: the student pressed "<label>" on your previous reply.)`

Round 1 still forces `record_message_type`. The engine takes `repair?: { reason, excludeType }` and changes only the tool results:

- **R1 · `too_many_questions`:** the tool result is the recorded type's `REPLY_RULES` entry followed by `REPAIR_RULES.too_many_questions`:
  > Re-answer rule: the student said your previous reply asked too many questions. Explain the idea behind their message from a cited passage first, in two to four sentences, then ask at most one question. Still never give, confirm or correct the answer, and never state an optimal facility set, an objective value or a complete formulation that the Student context does not show.
- **R2 · `hard_to_follow`:** the type's rule followed by `REPAIR_RULES.hard_to_follow`:
  > Re-answer rule: the student found your previous reply hard to follow. Keep to the reply rule above, but break the cited passage into small, plain steps, one idea per sentence, and explain every term you use.
- **R3 · `not_what_i_asked`:** `excludeType` is the message type stored on the original student row.
  - A `record_message_type` call naming that type is not stored. It gets an `is_error` result: "The student said your previous reply did not answer what they asked, so <type> is ruled out. Record a different type."
  - The next valid call is stored (M1's first-wins applies to accepted calls only) and gets that type's normal rule.
  - If the original row has no type (the model skipped it), nothing is excluded.

`REPAIR_RULES` lives in `prompt.ts` next to `REPLY_RULES`, so Spec 1 §7 applies: any edit needs a passing test-set run before it ships. `SYSTEM_PROMPT` and `TOOLS` do not change, so the cached bundle prefix is unaffected.

## 4. API

New endpoint, `POST /watbot/conversations/:conversationId/feedback`, `submitWatBotFeedback`:

- **Body:** `{ messageId, helped, reason?, note? }`. `reason` is required when `helped` is false and must be absent when it is true. `note` is allowed only with `other`, ≤ 500 characters, trimmed, and empty becomes null.
- **Rules:**
  - 404 if the conversation is not the caller's, or `messageId` is not a tutor row in it.
  - 409 `feedback_locked` if that message's rating already has a `repair_message_id`.
  - Upserts on `message_id`.
- **Response:** 201 `{ id, repair: boolean }`, where `repair` is true for reasons 1–3.
- The insert runs in a `catch` with no error binding: the note is user-written text, and an unwrapped drizzle error carries its parameters into every error sink (api-server gotcha).

Change to `AskWatBotRequest`: optional `repairOf` (integer feedback id). When it is present:

- The feedback row must be the caller's, in this conversation, with a ✗ and a reason in 1–3, on the conversation's **latest** tutor row, and with `repair_message_id` null. Otherwise 404, or 409 `feedback_locked` if it was already used.
- `question` is still validated, but the server stores its own ↻ label as the student row text and sends the original question to the engine.
- Admission is unchanged (F5). `repair_message_id` is set inside the same per-user lock that inserts the student row, so two parallel requests can't both repair from one rating.

Both changes go into `lib/api-spec/openapi.yaml`, and the Orval client is regenerated in the same commit (hard rule 1). `feedback_locked` is a new closed-union error code: the TypeScript union, the OpenAPI enum and the regenerated client change together.

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
| repair_message_id | integer → watbot_messages.id, `on delete set null` | the re-answer's student row |
| created_at, updated_at | timestamptz | |

- This is a new table only. No existing column changes, so no `required[]` or backfill concerns. Production still needs `drizzle-kit push` before the deploy (`docs/ops/schema-push-before-deploy.md`), because every read of a missing table fails.
- The re-answer's student row stores its own `message_type`. For R3 that is the corrected type.
- `watbot_reports` is not reused. Reports flag a faulty answer with their own reasons, while feedback rates helpfulness and drives a repair. Mixing the two would blur both metrics.

## 6. Metrics

New queries in `docs/ops/watbot-metrics.md`, by model and by the rated answer's student message type:

- Helped rate: ✓ ÷ rated answers. Coverage: rated ÷ answered.
- Reason counts for ✗.
- Repair outcome: the share of re-answers whose own rating is ✓.
- R3 corrections: original type → corrected type, a direct measure of classification errors.

## 7. Testing

- **Engine (`watbotEngine.test.ts`):**
  - R1 and R2 append the repair rule after the type's rule.
  - R3 rejects the excluded type, stores the next valid one, and returns that type's rule.
  - With no repair, the tool results are byte-identical to today's.
- **Routes:**
  - 404 for another user's conversation or message, and for a non-tutor `messageId`.
  - Body validation: a reason with ✓, a note without `other`.
  - Upsert, then 409 after a repair.
  - `repairOf` on a non-latest answer, reasons 4 and Other, or a used rating → rejected.
  - A repair inserts an `answered` student row that counts toward the 50.
  - Two parallel repairs from one rating: exactly one is admitted.
- **Studio RTL:**
  - The line shows only under the latest tutor answer with blocks.
  - ✓ shows "Thanks".
  - ✗, then reason 1 → the feedback and ask calls run in order, and the ↻ line appears.
  - Other → the note box, then the notice. Reason 4 → the notice, no ask call.
  - A new answer resets the line.
- **Real-browser QA** (qa-sdet): the full ✓ and ✗ flows against a local stack, including one paid re-answer per reason 1–3.
- **Test set:** the owner approves about 15 repair cases added to `eval/testSet.json`, mostly R1 on wrong attempts and "give me the answer" messages, where a leak is most likely. Each case carries the history to the answer being repaired. The runner passes `repair` and the grader applies the same leak bar. A passing paid run is needed before ship (the last full run cost $0.2524). It needs explicit approval, like every paid run.

## 8. Out of scope

A teaching-team view of ratings (they are SQL-only, like reports and gaps); PostHog events; rating older answers; more than one reason per ✗.
