# WatBot answer feedback and repair — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student rates WatBot's latest answer ✓ or ✗. A ✗ asks for a reason, and three of the reasons re-answer under a changed reply rule. Every rating is stored.

**Architecture:** A new `watbot_feedback` table and a `POST …/feedback` endpoint store the rating. For reasons 1–3, the studio then calls the existing `POST …/messages` with `repairOf`, so admission, limits, SSE and finalize stay one path. The engine gets one optional input, `repair: { rule, excludeType }`, which changes only `record_message_type` tool results. `SYSTEM_PROMPT` and `TOOLS` are untouched, so the cached bundle prefix is unaffected.

**Tech stack:** Drizzle (Postgres), Express + Zod (Orval-generated from `lib/api-spec/openapi.yaml`), Anthropic TS SDK, React + React Query, vitest/RTL, Playwright for QA.

**Spec:** [`docs/superpowers/specs/2026-11-22-watbot-answer-feedback-design.md`](../specs/2026-11-22-watbot-answer-feedback-design.md) (owner-approved 2026-11-22; ships with the first WatBot deploy).

## Global constraints

- Branch `watbot-feedback`, cut from `watbot-deploy-prep` at `28482b6e`. Every commit lands here. Before each commit, run the guard: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN"; exit 1; }`. Commit with explicit pathspecs.
- Commit format: `[WATBOT-FB-<n>] <imperative summary>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One task = one commit, plus a changelog entry in `docs/CHANGELOG-implementation.md` in the same commit.
- Hard rules that bind here:
  - #1: never edit `lib/api-zod/src/generated/**` or `lib/api-client-react/src/generated/**`. Change `openapi.yaml` and run `pnpm --filter @workspace/api-spec codegen`, then commit the spec and the regenerated output together.
  - #5: non-owned resources return **404**.
  - #10: no GLM.
  - #12: engineering roles invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code.
- **A new closed-union error code changes three places in one commit:** `WATBOT_ERROR_CODES`, the OpenAPI `WatBotError` enum, and the regenerated client.
- A drizzle call that carries user-written text (the feedback note) uses `catch { … }` with **no error binding** (`artifacts/api-server/CLAUDE.md`).
- `REPAIR_RULES` is prompt text. Spec 1 §7 applies: a passing paid test-set run before it ships (Task 6). Every paid run needs an explicit owner yes, per run.
- Use these strings verbatim:
  - Reason keys: `too_many_questions | hard_to_follow | not_what_i_asked | still_stuck | other`.
  - Re-answer labels: `↻ Explain with fewer questions`, `↻ Explain it step by step`, `↻ That's not what I asked`.
  - Rating prompt: `Did this help you understand the topic?`
  - Thanks text: `Thanks for the feedback.`
  - Rephrase notice: `Try asking again in your own words, and say which step you're stuck on.`
- Local DB: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`, passed inline. Before trusting a full suite, require 0 concurrent vitest processes. Load flakes are listed in `docs/superpowers/flake-registry.md`.

### Spec revisions this plan implements

The spec is the single normative body. It already carries the plan-time refinements: the `watbot_feedback_locked` name, the `{ id, repairLabel }` response, the re-answer note, root-question chains, and ratings not returned by `GET`. It also carries decisions **F7–F10** from the Codex adversarial review (2026-11-22):
- **F7:** the claim happens at admission, under the per-user lock, with a compare-and-set.
- **F8:** a stale claim can be reclaimed.
- **F9:** every answer, ordinary or re-answer, runs the value check on cited blocks too. This revises Spec 1's D20, already edited in its spec.
- **F10:** the re-answer's context is rebuilt server-side from the source row.

Where this plan and the spec differ, the spec wins. Fix the plan.

---

### Task 1 (WATBOT-FB-1): `watbot_feedback` table

**Files:**
- Modify: `lib/db/src/schema/watbot.ts`.
- Test: `artifacts/api-server/src/__tests__/watbotSchema.test.ts`.
- Modify: `docs/CHANGELOG-implementation.md`.

**Interfaces, produces:**
- `WATBOT_FEEDBACK_REASONS` and `type WatBotFeedbackReason`.
- `watbotFeedbackTable`, exported from `@workspace/db`.

- [ ] **Step 1: Write the failing test.** Append to the `describe("watbot schema")` block, and add `watbotFeedbackTable, WATBOT_FEEDBACK_REASONS` to the import:

```ts
  it("feedback: one row per tutor message, cascades with the user, and a deleted repair row nulls the link", async () => {
    expect(WATBOT_FEEDBACK_REASONS).toEqual(["too_many_questions", "hard_to_follow", "not_what_i_asked", "still_stuck", "other"]);
    for (const c of getTableConfig(watbotFeedbackTable).columns) {
      if (c.columnType === "PgTimestamp") expect((c as unknown as { withTimezone: boolean }).withTimezone).toBe(true);
    }
    const userId = await newUser();
    const [conv] = await db.insert(watbotConversationsTable).values({ userId, modelId: "p-median-us", title: "t" }).returning();
    const [tutor] = await db.insert(watbotMessagesTable).values({ conversationId: conv!.id, userId, role: "tutor", blocks: [{ text: "x", citations: [] }] }).returning();
    const [repairRow] = await db.insert(watbotMessagesTable).values({ conversationId: conv!.id, userId, role: "student", blocks: [{ text: "↻ Explain it step by step", citations: [] }] }).returning();
    await db.insert(watbotFeedbackTable).values({ userId, conversationId: conv!.id, messageId: tutor!.id, helped: false, reason: "hard_to_follow", repairMessageId: repairRow!.id });
    await expect(db.insert(watbotFeedbackTable).values({ userId, conversationId: conv!.id, messageId: tutor!.id, helped: true })).rejects.toThrow();
    await db.delete(watbotMessagesTable).where(eq(watbotMessagesTable.id, repairRow!.id));
    const [fb] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.messageId, tutor!.id));
    expect(fb!.repairMessageId).toBeNull();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    expect(await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.conversationId, conv!.id))).toHaveLength(0);
  });
```

- [ ] **Step 2: Run it and confirm it fails.** Run `DATABASE_URL=… pnpm --filter api-server exec vitest run src/__tests__/watbotSchema.test.ts`. Expected: FAIL, because `watbotFeedbackTable` is not exported.

- [ ] **Step 3: Implement.** In `lib/db/src/schema/watbot.ts`, add `boolean` to the `drizzle-orm/pg-core` import. Add the reasons constant after `WATBOT_MESSAGE_STATUSES`, and the table after `watbotReportsTable`:

```ts
// WATBOT-FB — reasons a student gives for a ✗ rating. The first three re-answer.
export const WATBOT_FEEDBACK_REASONS = ["too_many_questions", "hard_to_follow", "not_what_i_asked", "still_stuck", "other"] as const;
export type WatBotFeedbackReason = (typeof WATBOT_FEEDBACK_REASONS)[number];
```

```ts
// WATBOT-FB — one ✓/✗ per tutor answer (upserted). repair_message_id is the
// re-answer's student row; once set, the rating is final.
export const watbotFeedbackTable = pgTable("watbot_feedback", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").notNull()
    .references(() => watbotConversationsTable.id, { onDelete: "cascade" }),
  messageId: integer("message_id").notNull().references(() => watbotMessagesTable.id, { onDelete: "cascade" }),
  helped: boolean("helped").notNull(),
  reason: varchar("reason", { length: 32 }).$type<WatBotFeedbackReason>(), // null when helped
  note: text("note"),                                                       // reason "other" only
  repairMessageId: integer("repair_message_id").references(() => watbotMessagesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("UQ_watbot_feedback_message").on(t.messageId)]);
```

- [ ] **Step 4: Push to local `nos_dev` and run the test.** Run `DATABASE_URL=… pnpm --filter @workspace/db push`, then the Step 2 command. Expected: PASS. The local push is not a production push.

- [ ] **Step 5: Commit.** Add a changelog entry, `## WATBOT-FB-1 — watbot_feedback table (date)`. It records a new table only, and that **production needs `drizzle-kit push` before deploy** (`docs/ops/schema-push-before-deploy.md`). Then commit `lib/db/src/schema/watbot.ts artifacts/api-server/src/__tests__/watbotSchema.test.ts docs/CHANGELOG-implementation.md`.

---

### Task 2 (WATBOT-FB-2): repair rules and engine input

**Files:**
- Modify: `artifacts/api-server/src/watbot/prompt.ts` and `artifacts/api-server/src/watbot/engine.ts`.
- Test: `artifacts/api-server/src/__tests__/watbotEngine.test.ts`.
- Modify: `docs/CHANGELOG-implementation.md`.

**Interfaces:**
- **Consumes:** `WatBotFeedbackReason` from Task 1.
- **Produces, from `prompt.ts`:**
  - `REPAIR_REASONS` and `type WatBotRepairReason`.
  - `isRepairReason(r: unknown): r is WatBotRepairReason`.
  - `REPAIR_LABELS: Record<WatBotRepairReason, string>`.
  - `REPAIR_RULES: Record<WatBotRepairReason, string | null>`.
  - `repairQuestion(question: string, reason: WatBotRepairReason): string`.
  - `excludedTypeResult(type: WatBotMessageType): string`.
- **Produces, from `engine.ts`:** `AnswerInput.repair?: { rule: string | null; excludeType: WatBotMessageType | null }`.

- [ ] **Step 1: Write the failing tests.** In `watbotEngine.test.ts`, add `REPAIR_RULES, excludedTypeResult, repairQuestion` to the prompt import, then add inside `describe("answerQuestion")`:

```ts
  // WATBOT-FB R1/R2: the repair rule follows the type's own rule.
  it("appends the repair rule to the recorded type's reply rule", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "incorrect_attempt" }),
      answerRound("Which constraint does that choice break?"),
    ]);
    await answerQuestion(baseInput(client, { repair: { rule: REPAIR_RULES.too_many_questions, excludeType: null } }));
    expect(lastToolResults(client.calls[1]!)).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: `${REPLY_RULES.incorrect_attempt}\n\n${REPAIR_RULES.too_many_questions}` },
    ]);
  });

  // WATBOT-FB R3: the ruled-out type is rejected and not stored; the next valid one is.
  it("rejects the excluded type, then stores the next type with its normal rule", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "concept_question" }),
      toolRound("t2", "record_message_type", { type: "stuck_or_wants_answer" }),
      answerRound("What does the passage say about it?"),
    ]);
    const result = await answerQuestion(baseInput(client, { repair: { rule: null, excludeType: "concept_question" } }));
    expect(lastToolResults(client.calls[1]!)).toEqual([{ type: "tool_result", tool_use_id: "t1", is_error: true, content: excludedTypeResult("concept_question") }]);
    expect(lastToolResults(client.calls[2]!)).toEqual([{ type: "tool_result", tool_use_id: "t2", content: REPLY_RULES.stuck_or_wants_answer }]);
    expect(result.messageType).toBe("stuck_or_wants_answer");
  });

  // F9 / Spec 1 D20 (revised): a citation does not make a leaked value safe, in any answer.
  it("drops a cited block that carries an unseen value, and keeps it when the context shows the value", async () => {
    const cited = { type: "content_block_location", cited_text: "x", document_index: 0, document_title: bundle[0]!.title, start_block_index: 0, end_block_index: 1 };
    const round = () => [toolRound("t1", "record_message_type", { type: "stuck_or_wants_answer" }),
      { events: textBlock(0, "The total cost is 1,234,567 in this solution.", [cited]), final: { stop_reason: "end_turn" as const } }];
    const events: EngineEvent[] = [];
    const hidden = await answerQuestion(baseInput(fakeClient(round()), { emit: (e) => events.push(e) }));
    expect(hidden.blocks).toHaveLength(0);
    expect(hidden.claimsRemoved).toBe(1);
    expect(events).toContainEqual({ type: "notice", kind: "claim_removed" });
    const shown = await answerQuestion(baseInput(fakeClient(round()), { shownFacts: "objective 1234567" }));
    expect(shown.blocks).toHaveLength(1); // non-vacuity: the citation itself is accepted, only the value decides
    const repaired = await answerQuestion(baseInput(fakeClient(round()), { repair: { rule: REPAIR_RULES.too_many_questions, excludeType: null } }));
    expect(repaired.blocks).toHaveLength(0);
  });

  it("repairQuestion puts the re-answer note after the original question; REPAIR_RULES has no rule for R3", () => {
    expect(repairQuestion("Why p = 3?", "hard_to_follow")).toBe('Why p = 3?\n\n(Re-answer: the student asked "Explain it step by step" about your previous reply.)');
    expect(REPAIR_RULES.not_what_i_asked).toBeNull();
  });
```

The existing test "record_message_type stores the type and returns that type's reply rule" already pins the no-repair result byte for byte. Keep it unchanged.

- [ ] **Step 2: Run them and confirm they fail.** Run `DATABASE_URL=… pnpm --filter api-server exec vitest run src/__tests__/watbotEngine.test.ts`. Expected: 4 FAIL, on missing exports and a missing `repair` field. Before relying on it, check that the citation literal in the F9 test matches what `mapCitation` accepts: read `citations.ts`, and make sure the "context shows the value" half really forwards one block. A test where every case drops the block proves nothing. Then run the whole api-server suite: any existing test that forwards a cited block with a 4+-digit number or a facility name not in its context now fails. Fix that test's context, never the rule, and list each one in the changelog entry. A grep at plan time (2026-11-22) found only two cited-block tests, `watbotEngine.test.ts:271` and `:320`, and neither carries such a value, so none is expected to fail.

- [ ] **Step 3: Implement `prompt.ts`.** Add after `REPLY_RULES`, and add `type WatBotFeedbackReason` to the `@workspace/db` import:

```ts
// WATBOT-FB §3 — re-answers after a ✗. Returned in the tool result after the
// type's rule, so SYSTEM_PROMPT and TOOLS (the cached prefix) never change.
export const REPAIR_REASONS = ["too_many_questions", "hard_to_follow", "not_what_i_asked"] as const satisfies readonly WatBotFeedbackReason[];
export type WatBotRepairReason = (typeof REPAIR_REASONS)[number];
export const isRepairReason = (r: unknown): r is WatBotRepairReason => (REPAIR_REASONS as readonly unknown[]).includes(r);

export const REPAIR_LABELS: Record<WatBotRepairReason, string> = {
  too_many_questions: "↻ Explain with fewer questions",
  hard_to_follow: "↻ Explain it step by step",
  not_what_i_asked: "↻ That's not what I asked",
};

export const REPAIR_RULES: Record<WatBotRepairReason, string | null> = {
  too_many_questions: "Re-answer rule: the student said your previous reply asked too many questions. Explain the idea behind their message from a cited passage first, in two to four sentences, then ask at most one question. Still never give, confirm or correct the answer, and never state an optimal facility set, an objective value or a complete formulation that the Student context does not show.",
  hard_to_follow: "Re-answer rule: the student found your previous reply hard to follow. Keep to the reply rule above, but break the cited passage into small, plain steps, one idea per sentence, and explain every term you use.",
  not_what_i_asked: null, // R3 re-types the message instead (excludedTypeResult)
};

export const repairQuestion = (question: string, reason: WatBotRepairReason) =>
  `${question}\n\n(Re-answer: the student asked "${REPAIR_LABELS[reason].replace(/^↻ /, "")}" about your previous reply.)`;

export const excludedTypeResult = (type: WatBotMessageType) =>
  `The student said your previous reply did not answer what they asked, so ${type} is ruled out. Record a different type.`;
```

- [ ] **Step 4: Implement `engine.ts`.**
  - Add `excludedTypeResult` to the prompt import.
  - Add to `AnswerInput`, after `gate?`:
    ```ts
      repair?: { rule: string | null; excludeType: WatBotMessageType | null }; // WATBOT-FB: re-answer after a ✗
    ```
  - Replace the `if (isMessageType(type)) { … }` branch in the tool loop with:
    ```ts
              if (isMessageType(type) && out.messageType === null && type === input.repair?.excludeType) {
                results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: excludedTypeResult(type) });
              } else if (isMessageType(type)) {
                out.messageType ??= type; // first call wins; a second call cannot relabel the message
                const rule = REPLY_RULES[out.messageType]; // ...nor switch its rule
                results.push({ type: "tool_result", tool_use_id: tu.id, content: input.repair?.rule ? `${rule}\n\n${input.repair.rule}` : rule });
              }
    ```
  - Keep the existing `else` (the unknown-type error) as it is.
  - **F9 / Spec 1 D20 (revised):** in `streamRound`'s `content_block_stop` branch, replace the comment and the `keep` expression with:
    ```ts
            // Cited, or an uncited question / short connective (FR-17): forward only if it also
            // carries no unseen value or site (D20, revised 2026-11-22: cited blocks too).
            const keep = (b.citations.length > 0 || keepUncitedBlock(b.text))
              && passesValueCheck(b.text, input.facilityNames, input.shownFacts ?? "");
    ```

- [ ] **Step 5: Run the tests.** Same command as Step 2, then `pnpm run typecheck`. Expected: all pass.

- [ ] **Step 6: Commit.** Add a changelog entry `WATBOT-FB-2`. It notes:
  - `REPAIR_RULES` is new prompt text.
  - Spec 1 D20 was revised: cited blocks now get the value check.
  - Task 6's paid run gates the ship.

  Commit the three files, any existing tests whose context had to change, and the changelog.

---

### Task 3 (WATBOT-FB-3): contract and routes

**Files:**
- Modify: `lib/api-spec/openapi.yaml`.
- Regenerate: `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**`.
- Modify: `artifacts/api-server/src/watbot/errors.ts`, `artifacts/api-server/src/routes/watbot.ts` and `artifacts/studio/src/pages/Workspace.tsx` (the `WATBOT_ERROR_COPY` entry).
- Modify: `docs/superpowers/specs/2026-11-22-watbot-answer-feedback-design.md` (fold the plan-time refinements).
- Modify: `docs/ops/watbot-metrics.md` and `docs/CHANGELOG-implementation.md`.
- Test: `artifacts/api-server/src/__tests__/watbotRoutes.test.ts`.

**Interfaces:**
- **Consumes:** Task 1's table and Task 2's `REPAIR_*` exports.
- **Produces, over HTTP:**
  - `POST /api/watbot/conversations/:conversationId/feedback`. Body `{ messageId, helped, reason?, note? }`; responds 201 `{ id: number, repairLabel: string | null }`.
  - `AskWatBotRequest.repairOf?: integer`.
- **Produces, from Orval:**
  - `useSubmitWatBotFeedback()`, whose `mutateAsync({ conversationId, data })` resolves to `WatBotFeedbackResponse`.
  - Zod `SubmitWatBotFeedbackBody`.

- [ ] **Step 1: Write the failing route tests.** Add `watbotFeedbackTable` to the `@workspace/db` import and `REPAIR_LABELS` from `../watbot/prompt.js`, then append inside `describe("watbot routes")`:

```ts
  const ask = (cookie: string, id: number, body: object) =>
    request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ context: null, ...body });
  const feedback = (cookie: string, id: number, body: object) =>
    request(app).post(`/api/watbot/conversations/${id}/feedback`).set("Cookie", cookie).send(body);
  async function answered(cookie: string, type = "incorrect_attempt") {
    useClient(scriptedClient("Which constraint does that break?", { type }));
    const id = await newConversation(cookie);
    expect((await ask(cookie, id, { question: "Is p = 5 optimal?" })).status).toBe(200);
    const tutor = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!;
    return { id, tutorId: tutor.id };
  }

  it("feedback: stores ✓ and ✗, upserts on the same answer, and returns the re-answer label only for reasons 1–3", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const up = await feedback(cookie, id, { messageId: tutorId, helped: true });
    expect(up.status).toBe(201);
    expect(up.body.repairLabel).toBeNull();
    const down = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    expect(down.body).toEqual({ id: up.body.id, repairLabel: REPAIR_LABELS.hard_to_follow });
    const other = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "other", note: "  the zones part  " });
    expect(other.body.repairLabel).toBeNull();
    const [fb] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.messageId, tutorId));
    expect(fb).toMatchObject({ helped: false, reason: "other", note: "the zones part", repairMessageId: null });
  });

  it("feedback: 400 on a reason with ✓, a ✗ without a reason, or a note without 'other'; 404 on another user's or a non-tutor message", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true, reason: "other" })).status).toBe(400);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false })).status).toBe(400);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "still_stuck", note: "x" })).status).toBe(400);
    const studentId = (await rows(id)).find((r) => r.role === "student")!.id;
    expect((await feedback(cookie, id, { messageId: studentId, helped: true })).status).toBe(404);
    const other = await registerAndGetCookie();
    expect((await feedback(other, id, { messageId: tutorId, helped: true })).status).toBe(404);
  });

  it("repairOf: re-answers the original question under the repair rule, stores the label, counts toward the limit, then locks the rating", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "too_many_questions" });
    const before = await studentUsage(lastUserId());
    let sent = "";
    const inner = scriptedClient("The passage says…", { type: "incorrect_attempt" }); // one instance: it counts rounds
    useClient({ messages: { stream(params, opts) { sent ||= JSON.stringify(params.messages.at(-1)); return inner.messages.stream(params, opts); } } });
    const res = await ask(cookie, id, { question: "ignored", repairOf: fb.body.id });
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: done");
    expect(sent).toContain("Is p = 5 optimal?");
    expect(sent).toContain('(Re-answer: the student asked \\"Explain with fewer questions\\"');
    const all = await rows(id);
    const repairRow = all.filter((r) => r.role === "student").at(-1)!;
    expect(repairRow).toMatchObject({ status: "answered", messageType: "incorrect_attempt" });
    expect(repairRow.blocks[0]!.text).toBe(REPAIR_LABELS.too_many_questions);
    expect((await studentUsage(lastUserId())).remaining).toBe(before.remaining - 1);
    const [stored] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect(stored!.repairMessageId).toBe(repairRow.id);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true })).status).toBe(409);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true })).body.error).toBe("watbot_feedback_locked");
    expect((await ask(cookie, id, { question: "x", repairOf: fb.body.id })).status).toBe(409);
  });

  it("repairOf: 404 for reasons 4/Other, a ✓, another user's rating, or a rating that is not on the latest answer", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const stuck = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "still_stuck" });
    expect((await ask(cookie, id, { question: "x", repairOf: stuck.body.id })).status).toBe(404);
    const other = await registerAndGetCookie();
    const theirs = await answered(other);
    const theirFb = await feedback(other, theirs.id, { messageId: theirs.tutorId, helped: false, reason: "hard_to_follow" });
    expect((await ask(cookie, id, { question: "x", repairOf: theirFb.body.id })).status).toBe(404);
    const old = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    expect((await ask(cookie, id, { question: "A new question" })).status).toBe(200); // a newer answer now exists
    expect((await ask(cookie, id, { question: "x", repairOf: old.body.id })).status).toBe(404);
  });

  it("R3 sends the original row's type as excluded, and a re-answer of a re-answer resends the root question", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie, "concept_question");
    const fb1 = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "not_what_i_asked" });
    const results: string[] = [];
    const capture = (inner: WatBotClient) => useClient({ messages: { stream(params, opts) { results.push(JSON.stringify(params.messages.at(-1))); return inner.messages.stream(params, opts); } } });
    capture(scriptedClient("Try this.", { type: "concept_question" })); // records the excluded type, so round 2 gets the error result
    expect((await ask(cookie, id, { question: "x", repairOf: fb1.body.id })).status).toBe(200);
    expect(results[1]).toContain("concept_question is ruled out");
    const tutor2 = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!.id;
    const fb2 = await feedback(cookie, id, { messageId: tutor2, helped: false, reason: "hard_to_follow" });
    results.length = 0;
    capture(scriptedClient("Step one: …", { type: "concept_question" }));
    expect((await ask(cookie, id, { question: "x", repairOf: fb2.body.id })).status).toBe(200);
    expect(results[0]).toContain("Is p = 5 optimal?"); // the root question, not the ↻ label of the first re-answer
  });

  // F7: the claim is taken under the per-user lock, before the model call.
  it("claims the rating before the model call; a feedback write during the re-answer is busy", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    useClient(scriptedClient("Step one.", { type: "incorrect_attempt", delayMs: 300 }));
    const inFlight = ask(cookie, id, { question: "x", repairOf: fb.body.id }).then((r) => r); // .then starts the request
    await sleep(100);
    const [mid] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect(mid!.repairMessageId).not.toBeNull();
    const during = await feedback(cookie, id, { messageId: tutorId, helped: true });
    expect(during.status).toBe(409);
    expect(during.body.error).toBe("watbot_busy");
    expect((await inFlight).status).toBe(200);
  });

  // F8: a claim whose student row has no tutor row after it died (crash, failure, stop) and can be taken again.
  it("re-claims a stale claim, and accepts a feedback write over it", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    const [orphan] = await db.insert(watbotMessagesTable).values({ conversationId: id, userId: lastUserId(), role: "student",
      blocks: [{ text: REPAIR_LABELS.hard_to_follow, citations: [] }] }).returning();
    await db.update(watbotFeedbackTable).set({ repairMessageId: orphan!.id }).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" })).status).toBe(201);
    await db.update(watbotFeedbackTable).set({ repairMessageId: orphan!.id }).where(eq(watbotFeedbackTable.id, fb.body.id));
    useClient(scriptedClient("Step one.", { type: "incorrect_attempt" }));
    expect((await ask(cookie, id, { question: "x", repairOf: fb.body.id })).status).toBe(200);
    const [after] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect(after!.repairMessageId).not.toBe(orphan!.id);
  });

  // F10: the server rebuilds the re-answer's context from the source row; the client's is ignored.
  it("a re-answer sent with context null still carries the source question's scenario summary", async () => {
    const cookie = await registerAndGetCookie();
    const [sc] = await db.insert(scenariosTable).values({ name: "Coastal", userId: lastUserId(), modelId: "p-median-us", inputs: { p: 4 } }).returning();
    try {
      useClient(scriptedClient("Which constraint does that break?", { type: "incorrect_attempt" }));
      const id = await newConversation(cookie);
      expect((await ask(cookie, id, { question: "Is p = 5 optimal?", context: { tab: "output-map", scenarioId: sc!.id } })).status).toBe(200);
      const tutorId = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!.id;
      const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "too_many_questions" });
      let sent = "";
      const inner = scriptedClient("The passage says…", { type: "incorrect_attempt" });
      useClient({ messages: { stream(params, opts) { sent ||= JSON.stringify(params.messages.at(-1)); return inner.messages.stream(params, opts); } } });
      expect((await ask(cookie, id, { question: "x", context: null, repairOf: fb.body.id })).status).toBe(200);
      expect(sent).toContain("Scenario: Coastal");
      expect(sent).toContain("p = 4");
      const repairRow = (await rows(id)).filter((r) => r.role === "student").at(-1)!;
      expect(repairRow.context).toMatchObject({ tab: "output-map", scenarioId: sc!.id });
    } finally {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, sc!.id));
    }
  });
```

Two parallel repairs from one rating are covered as follows:
- **Both in flight:** the per-user lock admits one, and the other gets 409 `watbot_busy` (the existing "admits exactly one of two simultaneous questions" test).
- **One after the other:** the compare-and-set claim stops a second repair. So does the latest-answer check, because the first repair's tutor row is now the latest answer. The OpenAPI-enum test already present (`OpenAPI WatBotError enum equals the TS union`) covers the new code once both sides change.

- [ ] **Step 2: Run them and confirm they fail.** Run `DATABASE_URL=… pnpm --filter api-server exec vitest run src/__tests__/watbotRoutes.test.ts`. Expected: the 8 new tests FAIL (404 on `/feedback`, and `repairOf` ignored). Add `scenariosTable` to the test's `@workspace/db` import if it isn't already there.

- [ ] **Step 3: Update the contract in `lib/api-spec/openapi.yaml`.**
  - **New path, after `/watbot/reports`.** It uses the same `tags`, the same `401` response shape and the same `ErrorEnvelope` ref as the report route:
    ```yaml
      /watbot/conversations/{conversationId}/feedback:
        post:
          tags: [WatBot]
          operationId: submitWatBotFeedback
          summary: Rate a WatBot answer (✓/✗, with a reason on ✗)
          parameters:
            - { name: conversationId, in: path, required: true, schema: { type: integer } }
          requestBody:
            required: true
            content:
              application/json:
                schema: { $ref: '#/components/schemas/WatBotFeedbackRequest' }
          responses:
            '201':
              description: Feedback stored. repairLabel is set when the client should re-answer with repairOf.
              content:
                application/json:
                  schema: { $ref: '#/components/schemas/WatBotFeedbackResponse' }
            '400': { description: Invalid feedback., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
            '401': { description: No valid session., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
            '404': { description: Not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
            '409': { description: The rating already produced a re-answer (watbot_feedback_locked)., content: { application/json: { schema: { $ref: '#/components/schemas/WatBotError' } } } }
    ```
    Match the error schema name to the one `/messages` already uses for `watbot_busy`; read the file.
  - **New schemas, next to `WatBotReportRequest`:**
    ```yaml
        WatBotFeedbackRequest:
          type: object
          required: [messageId, helped]
          properties:
            messageId: { type: integer, minimum: 1, maximum: 2147483647 }
            helped: { type: boolean }
            reason: { type: string, enum: [too_many_questions, hard_to_follow, not_what_i_asked, still_stuck, other] }
            note: { type: string, maxLength: 500 }
        WatBotFeedbackResponse:
          type: object
          required: [id, repairLabel]
          properties:
            id: { type: integer }
            repairLabel: { type: string, nullable: true }
    ```
  - **In `AskWatBotRequest.properties`:** add `repairOf: { type: integer, minimum: 1, maximum: 2147483647 }`.
  - **In the `WatBotError` enum:** append `watbot_feedback_locked`.
  - **Then regenerate:** run `pnpm --filter @workspace/api-spec codegen`. Expected: the regenerated files change and the libs typecheck passes.

- [ ] **Step 4: Error code.** In `errors.ts`, append `"watbot_feedback_locked"` to `WATBOT_ERROR_CODES`. In `Workspace.tsx`, add this line to `WATBOT_ERROR_COPY`: `watbot_feedback_locked: "That answer was already re-answered.",`.

- [ ] **Step 5: Helpers and the feedback route.** In `routes/watbot.ts`:
  - **Imports:**
    - `watbotFeedbackTable` and `type WatBotMessageType` from `@workspace/db`.
    - `gt` and `isNull` from `drizzle-orm`.
    - `SubmitWatBotFeedbackBody` from `@workspace/api-zod`.
    - `isRepairReason, REPAIR_LABELS, REPAIR_RULES, repairQuestion, type WatBotRepairReason` from `../watbot/prompt.js`.
  - **Extract the existing context block** of the ask route into `buildContext`, so the re-answer can rebuild context from its source row (F10). The ask route's non-repair path calls it with `dropMissingScenario: false` and keeps today's 404.

```ts
type BuiltContext = { context: WatBotContext | null; shownFacts: string; contextScenarioInputs: unknown };

// Context summary is built server-side from the owned scenario row, never from client text (D20).
// dropMissingScenario: a re-answer whose source scenario is gone keeps the tab only (spec §4).
async function buildContext(tab: string | null, scenarioId: number | null, userId: string, modelId: string,
  { dropMissingScenario }: { dropMissingScenario: boolean }): Promise<BuiltContext | null> {
  let summary = tab ? `Tab: ${tab}` : "";
  let shownFacts = "";
  let contextScenarioInputs: unknown = undefined;
  let keptScenarioId: number | null = null;
  if (scenarioId != null) {
    const [row] = await db.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.userId, userId)));
    if (row && row.modelId === modelId) {
      const s = summarizeScenario(row);
      summary += ` · ${s.summary}`;
      shownFacts = s.facts;
      contextScenarioInputs = row.inputs;
      keptScenarioId = scenarioId;
    } else if (!dropMissingScenario) return null; // caller answers 404
  }
  return { context: { tab, scenarioId: keptScenarioId, summary }, shownFacts, contextScenarioInputs };
}
```

  - **The claim and source helpers, and the route:**

```ts
// F8 — under the per-user lock nothing else of this student's is in flight, so a claim is
// live only if its re-answer produced a tutor row. A claim with none after it died and may be retaken.
async function claimIsLive(repairMessageId: number | null): Promise<boolean> {
  if (repairMessageId == null) return false;
  const [claimed] = await db.select({ conversationId: watbotMessagesTable.conversationId }).from(watbotMessagesTable)
    .where(eq(watbotMessagesTable.id, repairMessageId));
  if (!claimed) return false;
  const [after] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.conversationId, claimed.conversationId), eq(watbotMessagesTable.role, "tutor"),
      gt(watbotMessagesTable.id, repairMessageId))).limit(1);
  return !!after;
}

// What a re-answer resends (spec §3). The question is the ROOT question, followed back through
// earlier re-answers. excludeType and context come from the NEAREST answered student row, the
// one whose answer is being repaired (a re-answer row copies its source's context).
async function repairSource(conversationId: number, tutorId: number) {
  let beforeId = tutorId;
  let nearest: { messageType: WatBotMessageType | null; context: WatBotContext | null } | null = null;
  for (let hop = 0; hop < HISTORY_MESSAGES; hop++) {
    const [row] = await db.select().from(watbotMessagesTable)
      .where(and(eq(watbotMessagesTable.conversationId, conversationId), eq(watbotMessagesTable.role, "student"),
        eq(watbotMessagesTable.status, "answered"), lt(watbotMessagesTable.id, beforeId)))
      .orderBy(desc(watbotMessagesTable.id)).limit(1);
    if (!row) return null;
    nearest ??= { messageType: row.messageType ?? null, context: row.context ?? null };
    const [prior] = await db.select({ messageId: watbotFeedbackTable.messageId }).from(watbotFeedbackTable)
      .where(eq(watbotFeedbackTable.repairMessageId, row.id));
    if (!prior) return { question: row.blocks.map((b) => b.text).join("\n\n"), ...nearest };
    beforeId = prior.messageId;
  }
  return null;
}

// WATBOT-FB — one rating per tutor answer, upserted until a live re-answer claims it (F7, F8).
router.post("/watbot/conversations/:conversationId/feedback", async (req, res) => {
  const parsed = SubmitWatBotFeedbackBody.safeParse(req.body);
  const d = parsed.success ? parsed.data : null;
  const note = d?.note?.trim() || null;
  if (!d || (d.helped ? d.reason !== undefined : d.reason === undefined) || (note !== null && d.reason !== "other")) {
    res.status(400).json({ error: "Invalid feedback." }); return;
  }
  const conv = await ownedConversation(Number(req.params.conversationId), req.userId!);
  if (!conv) { notFound(res); return; }
  const [msg] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.id, d.messageId), eq(watbotMessagesTable.conversationId, conv.id), eq(watbotMessagesTable.role, "tutor")));
  if (!msg) { notFound(res); return; }
  // F7 — the same per-user lock as a question, so a rating can't change under an in-flight re-answer.
  const unlock = tryLockUser(req.userId!);
  if (!unlock) { watbotError(res, 409, "watbot_busy"); return; }
  try {
    const [existing] = await db.select({ repairMessageId: watbotFeedbackTable.repairMessageId }).from(watbotFeedbackTable)
      .where(eq(watbotFeedbackTable.messageId, msg.id));
    if (await claimIsLive(existing?.repairMessageId ?? null)) { watbotError(res, 409, "watbot_feedback_locked"); return; }
    const reason = d.reason ?? null;
    let id: number;
    // No error binding: the Drizzle error carries the note (api-server CLAUDE.md).
    try {
      const [row] = await db.insert(watbotFeedbackTable)
        .values({ userId: req.userId!, conversationId: conv.id, messageId: msg.id, helped: d.helped, reason, note })
        .onConflictDoUpdate({ target: watbotFeedbackTable.messageId, set: { helped: d.helped, reason, note, repairMessageId: null, updatedAt: new Date() } })
        .returning({ id: watbotFeedbackTable.id });
      id = row!.id;
    } catch { res.status(500).json({ error: "Could not store feedback." }); return; }
    res.status(201).json({ id, repairLabel: isRepairReason(reason) ? REPAIR_LABELS[reason] : null });
  } finally {
    unlock();
  }
});
```

  - **`onConflictDoUpdate` sets `repairMessageId: null`.** That's reached only when the claim is absent or stale, so it clears a dead claim (F8).

- [ ] **Step 6: `repairOf` in the ask route.**
  - **The non-repair path.** Replace the route's inline context block with:
    ```ts
      let built: BuiltContext = { context: null, shownFacts: "", contextScenarioInputs: undefined };
      if (parsed.data.context && parsed.data.repairOf == null) {
        const b = await buildContext(parsed.data.context.tab ?? null, parsed.data.context.scenarioId ?? null, req.userId!, conv.modelId, { dropMissingScenario: false });
        if (!b) { notFound(res); return; }
        built = b;
      }
    ```
    Then use `built.context`, `built.shownFacts` and `built.contextScenarioInputs` where the route used `context`, `shownFacts` and `contextScenarioInputs`. Keep the D20 comments.
  - **The repair resolution: first thing inside the outer `try`, under the lock, before `isAvailable()` and before any spend reservation:**

```ts
    // WATBOT-FB F7/F10 — resolved under the per-user lock; the client's context is ignored.
    let repair: { feedbackId: number; reason: WatBotRepairReason; claimedBy: number | null; question: string; excludeType: WatBotMessageType | null } | null = null;
    if (parsed.data.repairOf != null) {
      const [fb] = await db.select().from(watbotFeedbackTable).where(and(eq(watbotFeedbackTable.id, parsed.data.repairOf),
        eq(watbotFeedbackTable.userId, req.userId!), eq(watbotFeedbackTable.conversationId, conv.id)));
      if (!fb || fb.helped || !isRepairReason(fb.reason)) { notFound(res); return; }
      if (await claimIsLive(fb.repairMessageId)) { watbotError(res, 409, "watbot_feedback_locked"); return; }
      const [latest] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
        .where(and(eq(watbotMessagesTable.conversationId, conv.id), eq(watbotMessagesTable.role, "tutor")))
        .orderBy(desc(watbotMessagesTable.id)).limit(1);
      const source = latest?.id === fb.messageId ? await repairSource(conv.id, fb.messageId) : null;
      if (!source) { notFound(res); return; }
      const b = await buildContext(source.context?.tab ?? null, source.context?.scenarioId ?? null, req.userId!, conv.modelId, { dropMissingScenario: true });
      built = b!; // never null with dropMissingScenario
      repair = { feedbackId: fb.id, reason: fb.reason, claimedBy: fb.repairMessageId, question: source.question,
        excludeType: fb.reason === "not_what_i_asked" ? source.messageType : null };
    }
```

  - **Turn-aways before the claim.** `isAvailable()`, the student limit and the spend check still run. A turned-away re-answer logs its student row through `turnAway` as usual, and **never claims**: the rating stays usable.
  - **The question.** Replace `const question = parsed.data.question.trim();` with:
    ```ts
        // A re-answer stores its ↻ label, and sends the root question plus a note to the model.
        const question = repair ? repairQuestion(repair.question, repair.reason) : parsed.data.question.trim();
        const storedText = repair ? REPAIR_LABELS[repair.reason] : question;
    ```
    In `logStudent`, use `blocks: [{ text: storedText, citations: [] }]` and `context: built.context`.
  - **The claim (F7): right after `studentMessageId = await logStudent("answered")` succeeds, and before the SSE headers:**

```ts
    if (repair) {
      // Compare-and-set against the value read above: a concurrent claim, or one taken since, makes this a no-op.
      const claimed = await db.update(watbotFeedbackTable).set({ repairMessageId: studentMessageId, updatedAt: new Date() })
        .where(and(eq(watbotFeedbackTable.id, repair.feedbackId),
          repair.claimedBy == null ? isNull(watbotFeedbackTable.repairMessageId) : eq(watbotFeedbackTable.repairMessageId, repair.claimedBy)))
        .returning({ id: watbotFeedbackTable.id });
      if (!claimed.length) {
        await db.update(watbotMessagesTable).set({ status: "cancelled" }).where(eq(watbotMessagesTable.id, studentMessageId));
        watbotError(res, 409, "watbot_feedback_locked"); return;
      }
    }
```

  - **`finalize()` is unchanged.** It doesn't touch `watbot_feedback`. A re-answer that dies without a tutor row leaves a stale claim, which F8 makes reclaimable. A stop before any round already marks its student row `cancelled`.
  - **In the `answerQuestion({ … })` call,** add:
    ```ts
              repair: repair ? { rule: REPAIR_RULES[repair.reason], excludeType: repair.excludeType } : undefined,
    ```

- [ ] **Step 7: Run them.** Run the Step 2 command, then `pnpm run typecheck`. Expected: all pass. Then run the whole api-server suite once, with 0 concurrent vitest: `DATABASE_URL=… pnpm --filter api-server test`.

- [ ] **Step 8: Docs.**
  - **The spec** is already revised (F7–F10). If implementation forces a change, edit the spec in place in this commit.
  - **`docs/ops/watbot-metrics.md`:** append a section, "## N. Answer feedback (WATBOT-FB)", with these four queries. Run each against local `nos_dev` after a local repair (Task 7 QA or a fixture). That shows each one can return non-zero rows before you record that it does.

```sql
-- Helped rate and coverage, by model
select c.model_id,
       count(f.id)                                         as rated,
       round(avg(case when f.helped then 1.0 else 0 end), 3) as helped_rate,
       round(count(f.id)::numeric / nullif(count(t.id), 0), 3) as coverage
from watbot_messages t
join watbot_conversations c on c.id = t.conversation_id
left join watbot_feedback f on f.message_id = t.id
where t.role = 'tutor' and jsonb_array_length(t.blocks) > 0
group by c.model_id;

-- ✗ reasons, by the rated answer's message type
select coalesce(s.message_type, '(not recorded)') as message_type, f.reason, count(*)
from watbot_feedback f
join lateral (select message_type from watbot_messages s
              where s.conversation_id = f.conversation_id and s.role = 'student' and s.id < f.message_id
              order by s.id desc limit 1) s on true
where not f.helped
group by 1, 2 order by 1, 3 desc;

-- Repair outcome: did the re-answer's own rating come back ✓?
-- helped_after is the ✓ share among RATED re-answers only; an unrated one is neither (spec §6).
select f.reason, count(*) as repairs,
       count(f2.id) as re_rated,
       round(avg(case when f2.helped then 1.0 else 0 end) filter (where f2.id is not null), 3) as helped_after_rated
from watbot_feedback f
join lateral (select id from watbot_messages t where t.conversation_id = f.conversation_id and t.role = 'tutor'
              and t.id > f.repair_message_id order by t.id limit 1) t on true
left join watbot_feedback f2 on f2.message_id = t.id
where f.repair_message_id is not null
group by f.reason;

-- R3 corrections: original type → re-answer type
select coalesce(o.message_type, '(not recorded)') as original, coalesce(r.message_type, '(not recorded)') as corrected, count(*)
from watbot_feedback f
join watbot_messages r on r.id = f.repair_message_id
join lateral (select message_type from watbot_messages s
              where s.conversation_id = f.conversation_id and s.role = 'student' and s.id < f.message_id
              order by s.id desc limit 1) o on true
where f.reason = 'not_what_i_asked'
group by 1, 2 order by 3 desc;
```

- [ ] **Step 9: Commit.** One commit for the contract change: `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated`, `lib/api-client-react/src/generated`, `artifacts/api-server/src/watbot/errors.ts`, `artifacts/api-server/src/routes/watbot.ts`, `artifacts/api-server/src/__tests__/watbotRoutes.test.ts`, `artifacts/studio/src/pages/Workspace.tsx`, `docs/ops/watbot-metrics.md` and the changelog, plus the spec if it changed.

---

### Task 4 (WATBOT-FB-4): studio rating line and re-answer

**Files:**
- Create: `artifacts/studio/src/components/workspace/watbot/WatBotFeedback.tsx`.
- Modify: `artifacts/studio/src/components/workspace/watbot/WatBotMessages.tsx`, `useWatBotConversation.ts` and `artifacts/studio/src/pages/Workspace.tsx`.
- Test: `artifacts/studio/src/__tests__/WatBotFeedback.test.tsx` (new), `WatBotMessages.test.tsx` and `useWatBotConversation.test.tsx`.
- Modify: `docs/CHANGELOG-implementation.md`.

**Interfaces:**
- **Consumes:** `useSubmitWatBotFeedback` from Task 3. Before writing the call, check the generated signature in `lib/api-client-react/src/generated`; the expected shape is `mutateAsync({ conversationId, data })`.
- **Produces:**
  - `useWatBotConversation().repair(feedbackId: number, label: string): Promise<void>`.
  - `WatBotMessages` takes the optional prop `feedback?: { conversationId: number; onRepair: (feedbackId: number, label: string) => void }`.

- [ ] **Step 1: Write the failing component test,** in `WatBotFeedback.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({ useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }) }));
import { WatBotFeedback } from "@/components/workspace/watbot/WatBotFeedback";

describe("WatBotFeedback", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("✓ stores helped and thanks the student", async () => {
    mutateAsync.mockResolvedValue({ id: 1, repairLabel: null });
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={vi.fn()} />);
    expect(screen.getByText("Did this help you understand the topic?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, this helped" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thanks for the feedback."));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: true } });
  });

  it("✗ with reason 1 hands the re-answer label to onRepair", async () => {
    mutateAsync.mockResolvedValue({ id: 7, repairLabel: "↻ Explain with fewer questions" });
    const onRepair = vi.fn();
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole("button", { name: "No, this didn't help" }));
    fireEvent.click(screen.getByLabelText("It kept asking me questions instead of explaining"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onRepair).toHaveBeenCalledWith(7, "↻ Explain with fewer questions"));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: false, reason: "too_many_questions" } });
  });

  it("Other opens the note box; the note is sent and the rephrase notice shows, with no re-answer", async () => {
    mutateAsync.mockResolvedValue({ id: 8, repairLabel: null });
    const onRepair = vi.fn();
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole("button", { name: "No, this didn't help" }));
    expect(screen.queryByLabelText("What's still unclear? (optional)")).toBeNull();
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("What's still unclear? (optional)"), { target: { value: " the zones " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Try asking again in your own words, and say which step you're stuck on."));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: false, reason: "other", note: "the zones" } });
    expect(onRepair).not.toHaveBeenCalled();
  });

  it("shows an error and stays usable when the request fails", async () => {
    mutateAsync.mockRejectedValue(new Error("x"));
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, this helped" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send your feedback. Try again."));
    expect(screen.getByRole("button", { name: "Yes, this helped" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter studio exec vitest run src/__tests__/WatBotFeedback.test.tsx`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `WatBotFeedback.tsx`,** with the same visual idiom as `WatBotReportForm`:

```tsx
import { useState } from "react";
import { Check, X } from "lucide-react";
import { useSubmitWatBotFeedback } from "@workspace/api-client-react";

// WATBOT-FB §2 — keys match WATBOT_FEEDBACK_REASONS (lib/db) and the OpenAPI enum.
const REASONS = [
  ["too_many_questions", "It kept asking me questions instead of explaining"],
  ["hard_to_follow", "The explanation was hard to follow"],
  ["not_what_i_asked", "It didn't answer what I asked"],
  ["still_stuck", "I still don't know how to do the exercise"],
  ["other", "Other"],
] as const;
type Reason = (typeof REASONS)[number][0];

export function WatBotFeedback({ conversationId, messageId, onRepair }: {
  conversationId: number; messageId: number; onRepair: (feedbackId: number, label: string) => void;
}) {
  const submit = useSubmitWatBotFeedback();
  const [stage, setStage] = useState<"ask" | "reasons" | "thanks" | "rephrase">("ask");
  const [reason, setReason] = useState<Reason>("too_many_questions");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async (helped: boolean) => {
    setError(null);
    const data = helped ? { messageId, helped } : { messageId, helped, reason, ...(reason === "other" && note.trim() ? { note: note.trim() } : {}) };
    try {
      const r = await submit.mutateAsync({ conversationId, data });
      if (r.repairLabel) onRepair(r.id, r.repairLabel);
      else setStage(helped ? "thanks" : "rephrase");
    } catch { setError("Could not send your feedback. Try again."); }
  };
  if (stage === "thanks") return <p role="status" className="text-[11px] text-muted-foreground">Thanks for the feedback.</p>;
  if (stage === "rephrase") return <p role="status" className="text-[11px] text-muted-foreground">Try asking again in your own words, and say which step you're stuck on.</p>;
  return (
    <div data-testid="watbot-feedback" className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span>Did this help you understand the topic?</span>
        <button type="button" aria-label="Yes, this helped" disabled={submit.isPending} onClick={() => void send(true)} className="grid size-8 place-items-center rounded border"><Check className="size-3.5" aria-hidden="true" /></button>
        <button type="button" aria-label="No, this didn't help" aria-expanded={stage === "reasons"} disabled={submit.isPending} onClick={() => setStage("reasons")} className="grid size-8 place-items-center rounded border"><X className="size-3.5" aria-hidden="true" /></button>
      </div>
      {stage === "reasons" && (
        <form className="flex flex-col gap-2 rounded-md border bg-background p-3" onSubmit={(e) => { e.preventDefault(); void send(false); }}>
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1.5 font-mono text-[11px] tracking-widest text-muted-foreground">WHAT WENT WRONG?</legend>
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex min-h-7 items-center gap-2 text-sm">
                <input type="radio" name={`feedback-${messageId}`} checked={reason === value} onChange={() => setReason(value)} />{label}
              </label>
            ))}
          </fieldset>
          {reason === "other" && (
            <label className="text-xs font-medium">What's still unclear? (optional)
              <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 block w-full rounded-md border px-3 py-2 text-sm" />
            </label>
          )}
          <button type="submit" disabled={submit.isPending} className="h-8 self-start rounded bg-primary px-3.5 text-xs font-semibold text-primary-foreground">Send</button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run it.** Use the Step 2 command. Expected: PASS.

- [ ] **Step 5: Placement test.** In `WatBotMessages.test.tsx`, add `useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }),` to the mock and append:

```tsx
  it("shows the rating line once, under the latest saved tutor answer, and only when idle", () => {
    const two = [...items, { kind: "student" as const, blocks: [{ text: "And now?", citations: [] }] },
      { kind: "tutor" as const, id: 12, blocks: [{ text: "Look at the zones.", citations: [] }] }];
    const fb = { conversationId: 5, onRepair: vi.fn() };
    const { rerender } = render(<WatBotMessages items={two} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.getAllByTestId("watbot-feedback")).toHaveLength(1);
    rerender(<WatBotMessages items={two} pending={{ searching: null }} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
    rerender(<WatBotMessages items={[...two.slice(0, 4), { kind: "tutor" as const, id: 13, blocks: [] }]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull(); // the latest answer was stopped/failed with no blocks
    rerender(<WatBotMessages items={two} pending={null} onStop={vi.fn()} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull(); // no conversation yet
  });
```

- [ ] **Step 6: Implement the placement.** In `WatBotMessages.tsx`, import `WatBotFeedback` and add the prop. Then render the line after the item list:

```tsx
export function WatBotMessages({ items, pending, onStop, feedback }: {
  items: ChatItem[]; pending: Pending | null; onStop: () => void;
  feedback?: { conversationId: number; onRepair: (feedbackId: number, label: string) => void };
}) {
  const latestTutor = [...items].reverse().find((x) => x.kind === "tutor");
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite" data-testid="watbot-messages">
      {items.map((item, i) => <Message key={item.id ?? item.key ?? `i${i}`} item={item} />)}
      {feedback && !pending && latestTutor?.id && latestTutor.blocks.length > 0 && (
        <WatBotFeedback key={latestTutor.id} conversationId={feedback.conversationId} messageId={latestTutor.id} onRepair={feedback.onRepair} />
      )}
      {/* …existing pending pills and Stop row unchanged… */}
```

`key={latestTutor.id}` gives the line a fresh state for every new answer (spec F1). Run the messages test. Expected: PASS.

- [ ] **Step 7: The hook's `repair`.** The server rebuilds a re-answer's context from the source row (spec F10), so the hook sends `context: null` and keeps no context of its own. That also makes a re-answer work after `load()`.
  - **Test.** In `useWatBotConversation.test.tsx`, follow the file's existing `fetch` mock pattern and add a test. Call `load(5, [studentItem, tutorItem])`, then `repair(7, "↻ Explain it step by step")`:
    - the `fetch` URL ends in `/watbot/conversations/5/messages`;
    - its body equals `{ question: "↻ Explain it step by step", context: null, repairOf: 7 }`;
    - the label shows as a student item.
  - **Implementation,** in `useWatBotConversation.ts`:
    - Change the signature to `ask = useCallback(async (question, context, repairOf?: number) => {`.
    - Use `body: JSON.stringify({ question, context, ...(repairOf ? { repairOf } : {}) })`.
    - Add `const repair = useCallback((feedbackId: number, label: string) => ask(label, null, feedbackId), [ask]);`, and return `repair`.

  Run the hook test. Expected: PASS.

- [ ] **Step 8: Wire it in `Workspace.tsx`.** Add `feedback={watbot.conversationId ? { conversationId: watbot.conversationId, onRepair: (id, label) => { void watbot.repair(id, label); } } : undefined}` to the `<WatBotMessages … />` element.

- [ ] **Step 9: Run the studio suite and typecheck.** Run `pnpm --filter studio test`, then `pnpm run typecheck`. Expected: all pass. Then grep the e2e specs for anything this change could break: `grep -rn "watbot-messages\|Report this answer\|watbot-" artifacts/studio/e2e/`. Run any matching spec against local servers, with `E2E_BASE_URL` set (`artifacts/studio/e2e/CLAUDE.md`).

- [ ] **Step 10: Commit** the new and modified studio files, the tests and the changelog entry `WATBOT-FB-4`.

---

### Task 5 (WATBOT-FB-5): test-set support for re-answer cases

**Files:**
- Modify: `artifacts/api-server/src/watbot/eval/testSet.ts` (type and validation), `artifacts/api-server/src/watbot/eval/grader.ts` (two new rates) and `artifacts/api-server/src/migrations/watbotTestSet.ts` (runner).
- Test: `artifacts/api-server/src/__tests__/watbotEvalFiles.test.ts` and `artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts`.
- Modify: `docs/CHANGELOG-implementation.md`.

**Interfaces:**
- **Consumes:** `isRepairReason`, `REPAIR_RULES` and `repairQuestion` from Task 2.
- **Produces:** `TestMessage.repair?: { reason: WatBotRepairReason; excludeType?: WatBotMessageType }`.

- [ ] **Step 1: Write the failing test.** In `watbotEvalFiles.test.ts`, follow its existing parse-error pattern and add two cases:
  - a message with `repair: { reason: "still_stuck" }` fails with `repair.reason must be one of too_many_questions, hard_to_follow, not_what_i_asked`;
  - a message with `repair: { reason: "hard_to_follow" }` and no `history` fails with `a repair case needs the history up to the answer being repaired`.

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter api-server exec vitest run src/__tests__/watbotEvalFiles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **In `testSet.ts`:** add `repair?: { reason: WatBotRepairReason; excludeType?: WatBotMessageType };` to `TestMessage`. Then add to the per-message validation loop:
    ```ts
        if (m.repair !== undefined) {
          if (!isRepairReason(m.repair?.reason)) fail(`${at}: repair.reason must be one of ${REPAIR_REASONS.join(", ")}`);
          if (!m.history?.length) fail(`${at}: a repair case needs the history up to the answer being repaired`);
        }
    ```
  - **In `watbotTestSet.ts`:** `ask` takes an optional `repair` argument and passes it through. The message loop sends the repaired question:
    ```ts
        const question = m.repair ? repairQuestion(m.question, m.repair.reason) : m.question;
        const repair = m.repair ? { rule: REPAIR_RULES[m.repair.reason], excludeType: m.repair.excludeType ?? null } : undefined;
        const r = await ask(m.modelId, question, m.history ?? [], summary, repair);
    ```
    `m.type` stays the expected type, so agreement is graded on it: for R1 and R2 that's the original type, and for R3 the corrected type.

- [ ] **Step 4: Report the two F9 rates.**
  - **In `grader.ts`:**
    - Add `claimsRemoved: number; forwardedBlocks: number;` to `GradedRow`.
    - Add `claimRemovedRate: number; emptyReplyRate: number;` to `BucketReport`.
    - In `buildReport`, compute:
      ```ts
            claimRemovedRate: share(rs.filter((r) => r.claimsRemoved > 0).length),
            emptyReplyRate: share(rs.filter((r) => r.forwardedBlocks === 0).length),
      ```
  - **In the runner:**
    - `grade` sets `claimsRemoved: r.claimsRemoved, forwardedBlocks: r.blocks.length`.
    - `console.table` gains `claimRemoved` and `emptyReply` columns, formatted like `skippedRecord`.
  - **In `watbotEvalGrader.test.ts`:** add a `buildReport` case. Two rows in one bucket, one with `claimsRemoved: 1, forwardedBlocks: 0` and one with `0, 2`, give `claimRemovedRate` 0.5 and `emptyReplyRate` 0.5.

- [ ] **Step 5: Run them.** Run the Step 2 command, plus `watbotEvalGrader.test.ts`, then `pnpm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** the three source files, the two tests and the changelog entry `WATBOT-FB-5`.

---

### Task 6 (WATBOT-FB-6): re-answer test cases and the paid run (owner gates)

**Files:**
- Modify: `artifacts/api-server/src/watbot/eval/testSet.json`.
- Modify: `docs/CHANGELOG-implementation.md`.

- [ ] **Step 1: Draft 15 re-answer cases.** Write them as a Lavish review page, not straight into the file. Spread them across the models:
  - 6 × `too_many_questions`: 3 on `incorrect_attempt` and 3 on `stuck_or_wants_answer`, where a leak is most likely.
  - 4 × `hard_to_follow`.
  - 5 × `not_what_i_asked`, each with `excludeType` set to a plausible wrong first type and `type` set to the correct one.

  Each case carries `history`: the student's question, then the tutor reply being repaired. Write that reply in the WatBot style, with the flaw the reason names. Set `question` to the original question.
- [ ] **Step 2: STOP. Get the owner's approval of the 15 cases** on the Lavish page. Then add them to `testSet.json` with ids `<model>-repair-NN`, and set `approvedOn` to the approval date.
- [ ] **Step 3: STOP. Get the owner's yes for the paid run.** Quote the last measured full-run cost ($0.2524), plus the 15 cases.
- [ ] **Step 4: Run it.** Follow the "Test set and leak rate" runbook in Spec 1 §7, with the key read only through `/usr/bin/security find-generic-password -s nos-dev-anthropic -w` inside the command. Expected: every bucket is at or under its leak bar, and the runner exits 0.
- [ ] **Step 4b: STOP. Show the owner the `claimRemoved` and `emptyReply` columns** on a Lavish page. These are the cost of the revised D20, and no earlier run measured them, so there is no automatic bar. The owner decides whether they are acceptable before ship. Never call a high empty-reply rate a pass on your own.
- [ ] **Step 5: Commit** `testSet.json` and a changelog entry with the measured table and the total cost, quoted from the run's own output.

---

### Task 7 (WATBOT-FB-7): real-browser QA (qa-sdet)

- [ ] Start the local api-server, with the dev key read through `security` inside the command, and the studio. Then run the full flows in a real browser:
  - ✓, which shows "Thanks".
  - ✗ with each reason 1–3, each giving one paid re-answer: the ↻ line appears, a fresh rating line shows under the new answer, and `watbot_feedback.repair_message_id` is set.
  - Reason 4, and Other with a note: the rephrase notice shows and no model call is made.
  - Reload, then rate the same answer again: it updates.
  - Reload, or open the conversation from history, then press ✗ with reason 1 on a question asked with a scenario open. The re-answer's request carries that scenario's summary (F10). Check the stored student row's `context`.
  - Stop a re-answer before it starts, while it's queued. ✗ on the original answer still works afterwards (F8).
  - The 409 path, by rating the repaired answer through the API.
  - Keyboard-only use of the radio group and Send. Screen-reader names for ✓ and ✗.
- [ ] Run the four metrics queries from Task 3 against local `nos_dev` and confirm each returns at least one row from this session. That's the non-vacuity check before the metrics doc's "executed" claim stands.
- [ ] Record findings. A defect found here is fixed on the branch, as a new commit, before merge.

---

### Task 8: gates and the pipeline stop

- [ ] Run `pnpm gate` (exit 3 means a timeout, so re-run serially), then `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`, then `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`.
- [ ] Invoke `superpowers:finishing-a-development-branch`, then `/harness-retro WATBOT-FB`.
- [ ] **STOP: ask for merge approval.** `watbot-feedback` contains `watbot-deploy-prep`, so merging it into local `main` brings in both. Then come the whole-branch review of the merged range, the pushes, the **production `drizzle-kit push` for `watbot_feedback`**, the corpus load and the deploy. Each of those is its own approval, in the existing order.
