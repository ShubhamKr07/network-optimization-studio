# WatBot QFs, Part A (WQF-A): implementation plan

> **For agentic workers: execution model.** This repo runs plans by **agent-team dispatch per `AGENTS.md`**, not `superpowers:subagent-driven-development` and not `superpowers:executing-plans`.
>
> - **Worktrees.** The lead pre-creates one locked worktree per task: `git worktree add --lock /Users/shubhamkr/nos-wqf-a<N> -b wqf-a<N>-work <wqf-a tip sha>`. The lead dispatches without `isolation` (root `CLAUDE.md` Gotchas: `isolation: "worktree"` is racy). The agent's **first** Bash command is `cd /Users/shubhamkr/nos-wqf-a<N> && git rev-parse --abbrev-ref HEAD`. It must print `wqf-a<N>-work`; on anything else, STOP and report. Its second command is the base guard `git merge-base --is-ancestor <wqf-a tip sha the lead quoted> HEAD`, which must exit 0. A fresh worktree has no `node_modules`, so run `pnpm install --frozen-lockfile` before anything else.
> - **Landing.** The lead fast-forwards `wqf-a` onto each task's commit: `git fetch . wqf-a<N>-work:wqf-a`. This refuses a non-fast-forward. Use cherry-pick only if two tasks ran in parallel. The next task's worktree is cut from the new `wqf-a` tip.
> - **Order.** Tasks run **sequentially, in listed order**. Each task appends to the tail of `docs/CHANGELOG-implementation.md`, so parallel tasks would conflict there. If the lead runs A5/A6 alongside A1–A4 anyway, resolve the tail conflict on cherry-pick by keeping both entries. WQF-A7 (the paid run) can run whenever its approval arrives once A1–A4 have landed. A5/A6 do not wait for it.
> - **Roles and review** (`AGENTS.md` model policy). A1–A4: `backend-engineer`. A5–A6: `frontend-engineer`. Both execute on sonnet. The lead reviews each on Opus and also runs `ponytail:ponytail-review`. A7: the lead, with the owner's spend approval. A8: `qa-sdet`, reviewed by a separate `fable`-model reviewer agent, never by the lead.
> - **Skills (root `CLAUDE.md` rule 12).** Every engineering task's Step 0 invokes `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before any code. qa-sdet is exempt. If a ponytail ruleset is injected into it anyway, it ignores it and says so in its report.
> - **Never GLM** (root rule 10). Steps use checkbox (`- [ ]`) syntax.

**Goal:** six WatBot fixes from the owner's 2026-11-24/25 requests, shipped as Part A of the WQF bundle:
- separate the two reasons a block is dropped;
- cap the off-topic exemption;
- treat a tab with no scenario as no context;
- write numbers with thousands separators;
- make the citation popover show the formatted page once;
- add the WatBot icon.

A paid test-set run measures the backend changes.

**Spec:** [`docs/superpowers/specs/2026-11-25-watbot-qf-bundle-design.md`](../specs/2026-11-25-watbot-qf-bundle-design.md), **Part A (A1–A7) and its Testing lines only**. Parts B and C have their own plans, branches and approvals.

**Architecture:** the backend (A1–A4) touches only `artifacts/api-server/src/watbot/**`, `routes/watbot.ts` and the test-set runner:
- the engine gets a second drop counter and a one-block off-topic exemption;
- `buildRequest` decides "no context" by whether the summary carries a scenario;
- `SYSTEM_PROMPT` gets one rule;
- the grader gets one counter and one reported-only check.

The studio (A5–A6) touches only `components/workspace/watbot/**`, `pages/Workspace.tsx` (the toolbar button) and one new asset. A new pure module, `citationHighlight.ts`, splits a passage into text and math segments and marks the cited range. The popover renders those segments.

There is **no** OpenAPI, generated-code, DB-schema, solver or `solve.py` change. The SSE notice kind stays `claim_removed`.

**Tech stack:** Express + Anthropic TS SDK + pino (api-server), vitest + supertest against real local Postgres, React + Vite + Tailwind v4 + Radix Popover + KaTeX (lazy `MathText`), vitest + RTL, Playwright.

## Global Constraints

- **Branch:** `wqf-a`, cut by the lead from the commit on `watbot-qf-spec` that adds this plan, so the merge carries the spec and the plan. Every commit lands on a `wqf-a<N>-work` branch and then on `wqf-a`. Nothing is committed on `main`.
- **Commit guard** before every commit: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. Stage an explicit path list `P` and check that `git diff --cached --name-only` equals it. Then commit with `git commit --only -m "…" -- "${P[@]}"`. Never pipe a git command whose exit code gates the next step.
- **Commit message:** `[WQF-A<n>] <imperative summary>`, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One task = one commit. The task's changelog entry goes in the **same** commit (root hard rule 9).
- **Changelog:** WQF-A1 opens the section `## WQF-A — WatBot QFs, Part A (2026-11-25)` at the tail of `docs/CHANGELOG-implementation.md`. Each task then appends a `### WQF-A<n> — <title>` subsection. Every count in it (tests, gate totals, costs) is copied from the run's own output in that session. An underivable value is the literal `unknown`, never an estimate.
- **Hard rules that bind here:**
  - #1: generated code is untouched; nothing here changes the API contract.
  - #2: `e2e_accuracy.py` is untouched. No solver change, so it is not a gate here, but `pnpm gate` still runs pytest.
  - #10: no GLM.
  - #12: skills, as described in the execution note above.
- **Local DB:** pass `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline to every api-server vitest run. Before any *full* suite, require zero concurrent vitest. Never chain this check with `&&`:
  ```bash
  cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || { echo "vitest busy: $cnt"; exit 1; }
  ```
- **Load flakes:** a failing test is first matched **by name** against `docs/superpowers/flake-registry.md`, then re-run twice in isolation. Record new sightings there, in the same commit. A single isolated failure is inconclusive.
- **e2e:** always `E2E_BASE_URL=http://localhost:<studio-port>`. Without it, Playwright tests a remote Replit app (`artifacts/studio/e2e/CLAUDE.md`). Two-server local recipe, run from the task's worktree, each server in its own background shell:
  ```bash
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=<api-port> pnpm --filter api-server run dev
  PORT=<studio-port> BASE_PATH=/ API_PROXY_TARGET=http://localhost:<api-port> VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev
  ```
  - **Ports** (chosen to avoid other sessions): A5 3151/5151; A6 3161/5161; A8 3181/5181; close-out 3191/5191.
  - **Ready:** wait until `curl -sf http://localhost:<api-port>/api/healthz` and `curl -sf -o /dev/null http://localhost:<studio-port>/` both succeed. Use an until-loop through Monitor, since foreground `sleep` is blocked.
  - **Stop:** stop only the shells you started, never `pkill`.
  - **What is stubbed:** `watbot.spec.ts` stubs every WatBot endpoint, so no model call and no spend.
- **Strings, verbatim from the spec:**
  - Drop notice: `Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.` The notice kind stays `claim_removed`.
  - Off-topic decline cap: **25 words**, counted as whitespace-separated tokens.
  - Icon size: **16 px** in the toolbar, **14 px** in the panel header. `alt=""`.
  - Number rule: thousands separators on numbers of four or more digits; keep the units the Student context uses (demand-mi, mi, tons); `$` only for money values.
- **Public repo (PRIV-1).** No book text, LaTeX transcriptions, production ids, emails, IPs or reply text from a live run in any committed file.
  - Test fixtures use made-up text. Every fixture below is invented.
  - The A7 changelog records counts and rates only, never a reply or a number a reply contained.
- **Prompt-change rule** (`prompt.ts:9-10`; WatBot spec §7): a `SYSTEM_PROMPT` edit (A4) needs a **passing paid test-set run before it ships**. That run is A7, which needs its own owner spend approval. No deploy of nos-api happens before A7 passes, unless the owner explicitly accepts shipping without it.

## Decisions taken at plan time (spec ambiguities)

| ID | Ambiguity | Choice |
|---|---|---|
| P1 | A1: can one block count under both reasons? | **Yes.** Each counter answers "how often did this reason fire". An uncited block that also carries an unseen value increments both, so `claimsRemoved + valuesBlocked` can exceed the number of dropped blocks. |
| P2 | A2: which block is "the first uncited block"? | The first block that is uncited **and not already kept by FR-17** (`keepUncitedBlock`: a question, or under 12 words). A short "Sorry." before the decline does not spend the exemption. The first such block spends it whether or not it is forwarded, so a 26-word first block is dropped and so is everything after it. |
| P3 | A3: append the tab after `NO_CONTEXT`? | **No.** The spec says the tab name "may" follow. `NO_CONTEXT` is sent verbatim, which is the simplest option and adds no new string to the uncached turn. Scenario presence is read from the summary's `Scenario: ` segment. Only `buildContext` writes that segment, and the client tab is an OpenAPI enum (`openapi.yaml:1462`), so a tab-only summary can never contain it. |
| P4 | A4: the spec's example number | The prompt uses the **made-up** `12,345,678`. The spec's example `29,873,735,731` equals a committed answer-key objective (`watbot/eval/answerKeys.json:40`), and putting it in the system prompt would seed the very value the leak grader checks. |
| P5 | A5: the failed-load view; the old "Loading…" line | On a failed load, the cited text stays visible with "Source unavailable" under it. "Loading…" is dropped, because the cited text *is* the loading view. The cited-text fallback is shown unmarked, since all of it is cited. |
| P6 | A1: where and what to log | In the route's `finalize`, for every answer that reached the model: `logger.info({ claimsRemoved, valuesBlocked }, "WatBot: answer saved")`. Counts only, no ids and no text. Not in the engine, which the test-set CLI also runs. |
| P7 | A7: "count of 4+-digit numbers without separators" | Counts **numbers**, not replies. A 4+-digit run not preceded by a digit, `.` or `,` (`/(?<![\d.,])\d{4,}/g`) counts, so a year such as 2026 counts too (reported, not a bar). |
| P8 | `CLAIM_REMOVED_NOTICE` home | Moves from `routes/watbot.ts:149` to `engine.ts` beside `STOPPED_NOTICE`/`FAILED_NOTICE`, so the route test can import the exact string. |

### Overkill check (root rule 11)

- **A1–A4:** one boolean, one counter, one regex and one prompt line. A typed `hasScenario` flag threaded through `AnswerInput` (route, test-set runner, smoke CLI) was rejected as three call sites to change for the same answer the summary already gives.
- **A5:** about 40 lines of pure TypeScript and no new dependency. Fuzzy matching and DOM-range highlighting libraries were rejected: the spec forbids fuzzy matching, and the segments are needed anyway to keep formulas unmarked.
- **A6:** a plain `<img>` of a static asset, with no SVG inlining or sprite.

None of these has a simpler alternative that still covers the spec item in full.

## File structure

| File | Change | Task |
|---|---|---|
| `artifacts/api-server/src/watbot/engine.ts` | `CLAIM_REMOVED_NOTICE`; `valuesBlocked`; split drop decision (A1); one-block off-topic exemption (A2) | A1, A2 |
| `artifacts/api-server/src/watbot/citations.ts` | `MAX_DECLINE_WORDS`, `wordCount` | A2 |
| `artifacts/api-server/src/watbot/prompt.ts` | `hasScenario` in `buildRequest` (A3); number rule in `SYSTEM_PROMPT` (A4) | A3, A4 |
| `artifacts/api-server/src/routes/watbot.ts` | import the notice; stored notice on either drop; counts log | A1 |
| `artifacts/api-server/src/watbot/eval/grader.ts` | `valuesBlocked` / `valueBlockedRate` (A1); `unseparatedNumbers` (A4) | A1, A4 |
| `artifacts/api-server/src/migrations/watbotTestSet.ts` | report column (A1); unseparated count (A4) | A1, A4 |
| `artifacts/api-server/src/migrations/watbotSmoke.ts` | print `blocked` | A1 |
| `artifacts/studio/src/components/workspace/watbot/useWatBotConversation.ts` | live notice text | A1 |
| `artifacts/studio/src/components/workspace/watbot/citationHighlight.ts` | **new**: `MATH`, `Segment`, `citationSegments` | A5 |
| `artifacts/studio/src/components/workspace/watbot/MathText.tsx` | import `MATH` from the new module | A5 |
| `artifacts/studio/src/components/workspace/watbot/WatBotMessages.tsx` | `CitationChip`: one view | A5 |
| `artifacts/studio/src/assets/watbot-icon.svg` | **new**: the owner's icon | A6 |
| `artifacts/studio/src/pages/Workspace.tsx` | icon in the toolbar button | A6 |
| `artifacts/studio/src/components/workspace/watbot/WatBotPanel.tsx` | icon in the header | A6 |
| tests | `watbotEngine.test.ts`, `watbotRoutes.test.ts`, `watbotEvalGrader.test.ts`, `useWatBotConversation.test.tsx`, `WatBotMessages.test.tsx`, **new** `citationHighlight.test.ts`, `WatBotPanel.test.tsx`, `Workspace.test.tsx`, `e2e/watbot.spec.ts`, **new** `e2e/watbot-qf-a.spec.ts` (A8) | all |

---

### Task WQF-A1: Count the two drop reasons apart, with one honest notice

**Role:** `backend-engineer`. This task also hands it `artifacts/studio/src/components/workspace/watbot/useWatBotConversation.ts` and two studio test files. The notice string is one contract across both layers, so it is one commit (root Gotchas).

**Files:**
- Modify: `artifacts/api-server/src/watbot/engine.ts:21-23,51-60,67-70,139-150`
- Modify: `artifacts/api-server/src/routes/watbot.ts:16-19,149,336-352` (+ logger import)
- Modify: `artifacts/api-server/src/watbot/eval/grader.ts:36-47,72`
- Modify: `artifacts/api-server/src/migrations/watbotTestSet.ts:81,142,167`
- Modify: `artifacts/api-server/src/migrations/watbotSmoke.ts:31`
- Modify: `artifacts/studio/src/components/workspace/watbot/useWatBotConversation.ts:10`
- Test: `artifacts/api-server/src/__tests__/watbotEngine.test.ts`, `artifacts/api-server/src/__tests__/watbotRoutes.test.ts`, `artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts`, `artifacts/studio/src/__tests__/useWatBotConversation.test.tsx`, `artifacts/studio/src/__tests__/WatBotMessages.test.tsx:21,30`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces:
  - `export const CLAIM_REMOVED_NOTICE: string` (engine.ts).
  - `AnswerResult.valuesBlocked: number`.
  - `GradedRow.valuesBlocked: number`.
  - `BucketReport.valueBlockedRate: number`.
  - The engine's block decision computes the two booleans `uncited` and `blocked`. WQF-A2 edits the `uncited` line.

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing engine tests.** In `watbotEngine.test.ts`:
  1. Extend the engine import (line 12) to `import { answerQuestion, CLAIM_REMOVED_NOTICE, MAX_REQUEUES, MAX_ROUNDS, setTransientBackoffForTests, TRANSIENT_BACKOFF_MS, type AnswerInput, type EngineEvent, type RoundGate } from "../watbot/engine.js";`.
  2. Change these existing expectations, which count a value drop as a claim today:
     - line 311: `expect(r).toMatchObject({ messageType: "off_topic", claimsRemoved: 0 });` → `expect(r).toMatchObject({ messageType: "off_topic", claimsRemoved: 0, valuesBlocked: 0 });`
     - line 339: `expect(r).toMatchObject({ claimsRemoved: 1, blocks: [] });` → `expect(r).toMatchObject({ claimsRemoved: 0, valuesBlocked: 1, blocks: [] });`
     - line 460: `expect(hidden.claimsRemoved).toBe(1);` → `expect(hidden).toMatchObject({ claimsRemoved: 0, valuesBlocked: 1 });`
     - line 562: `expect(hidden.result.claimsRemoved).toBe(1);` → `expect(hidden.result).toMatchObject({ claimsRemoved: 0, valuesBlocked: 1 });`
  3. Add, inside `describe("answerQuestion", …)` right after the test ending at line 340:

```ts
  // WQF-A1: the two reasons a block is dropped are counted apart; one notice covers the answer.
  const citedLoc = { type: "content_block_location", cited_text: "x", document_index: 0, document_title: "Chapter 3", start_block_index: 0, end_block_index: 1 };
  it("counts an uncited claim and a blocked value apart, with one notice for the answer", async () => {
    const client = fakeClient([{ events: [
      ...textBlock(0, "Open-site counts scale roughly with the square root of demand points in this dataset overall.", []),
      ...textBlock(1, "The total cost is 1,234,567 in this solution.", [citedLoc]),
      ...textBlock(2, "What would happen with p = 1?", []),
    ], final: { stop_reason: "end_turn" } }]);
    const events: EngineEvent[] = [];
    const r = await answerQuestion(baseInput(client, { emit: (e) => events.push(e) }));
    expect(r).toMatchObject({ claimsRemoved: 1, valuesBlocked: 1 });
    expect(r.blocks.map((b) => b.text)).toEqual(["What would happen with p = 1?"]);
    expect(events.filter((e) => e.type === "notice")).toEqual([{ type: "notice", kind: "claim_removed" }]);
  });
  it("counts an uncited block that also carries an unseen value under both reasons", async () => {
    const r = await answerQuestion(baseInput(fakeClient([answerRound("Every plant should ship 25,000 tons on the cheapest lane to cover the remaining demand in full.")])));
    expect(r).toMatchObject({ claimsRemoved: 1, valuesBlocked: 1, blocks: [] });
  });
  it("words the drop notice for both reasons", () => {
    expect(CLAIM_REMOVED_NOTICE).toBe("Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.");
  });
```

- [ ] **Step 2: Write the failing route test.** In `watbotRoutes.test.ts`:
  1. Change line 2 to `import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";`.
  2. Change line 18 to `import { CLAIM_REMOVED_NOTICE, FAILED_NOTICE, STOPPED_NOTICE, setTransientBackoffForTests } from "../watbot/engine.js";`.
  3. Add `import { logger } from "../lib/logger.js";` after line 19.
  4. In the test "drops a short uncited block naming a facility imported in the context scenario but absent from the summary" (starts at line 455), wrap the ask as shown and add the assertions after `expect(res.text).toContain('"kind":"claim_removed"');`:

```ts
      const info = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
      const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
        .send({ question: "Which sites?", context: { tab: "cost-summary", scenarioId: scenario!.id } });
      expect(res.text).not.toContain("event: block");
      expect(res.text).toContain('"kind":"claim_removed"');
      // WQF-A1: a value-only drop still stores the notice, and the counts are logged, never text.
      const notices = (await rows(id)).filter((r) => r.role === "notice").map((r) => r.blocks[0]!.text);
      expect(notices).toEqual([CLAIM_REMOVED_NOTICE]);
      expect(info).toHaveBeenCalledWith({ claimsRemoved: 0, valuesBlocked: 1 }, "WatBot: answer saved");
      info.mockRestore();
```

  This replaces the test's existing `const res = …` statement and the two `expect(res.text)` lines. `"Should fresno stay open?"` ends with `?`, so it is not an uncited claim. Only the facility check drops it.

- [ ] **Step 3: Write the failing grader test.** In `watbotEvalGrader.test.ts`:
  1. Change the `row` helper (line 69) to `leak: false, reasons: [], endsWithQuestion: true, costUsd: 0.001, claimsRemoved: 0, valuesBlocked: 0, forwardedBlocks: 1, ...over,`.
  2. Add, after the test ending at line 95:

```ts
  it("reports the values-blocked rate apart from the claim-removed rate (WQF-A1)", () => {
    const report = buildReport([row({ id: "a", valuesBlocked: 1 }), row({ id: "b", claimsRemoved: 1 }), row({ id: "c" })]);
    expect(report[0]!.valueBlockedRate).toBeCloseTo(1 / 3, 6);
    expect(report[0]!.claimRemovedRate).toBeCloseTo(1 / 3, 6);
  });
```

- [ ] **Step 4: Write the failing studio tests.**
  1. In `useWatBotConversation.test.tsx`, add inside the `describe`:

```tsx
  it("shows the drop notice in the server's wording (WQF-A1)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse(
      'event: notice\ndata: {"kind":"claim_removed"}\n\nevent: done\ndata: {"messageId":43}\n\n'));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    await act(async () => { await result.current.ask("Why?", null); });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.items.find((i) => i.kind === "notice")!.blocks[0]!.text)
      .toBe("Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.");
  });
```

  2. In `WatBotMessages.test.tsx`:
     - line 21: change the fixture text to `"Part of this answer was removed: it wasn't backed by a course source, or it gave away a result."`
     - line 30: change the regex to `/Part of this answer was removed/`

- [ ] **Step 5: Run them and confirm they fail.**
  - `cd /Users/shubhamkr/nos-wqf-a1 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/watbotEngine.test.ts src/__tests__/watbotEvalGrader.test.ts src/__tests__/watbotRoutes.test.ts`
    Expected:
    - FAIL on the 4 changed and 3 new engine tests: `valuesBlocked` is undefined, the export is missing, `claimsRemoved` is 1 where 0 is expected;
    - FAIL on the grader test: `valueBlockedRate` is undefined;
    - FAIL on the route test: the stored notice has the old text, and there is no `info` call.
  - `pnpm --filter studio exec vitest run src/__tests__/useWatBotConversation.test.tsx src/__tests__/WatBotMessages.test.tsx`
    Expected: FAIL on the new hook test, which receives the old text. `WatBotMessages.test.tsx` passes, because it is a fixture-only change.

- [ ] **Step 6: Implement the engine.** In `engine.ts`:
  1. After line 23 (`export const REFUSED_NOTICE = …`), add:

```ts
// WQF-A1: one notice for both drop reasons (uncited claim, or an unseen value or site).
export const CLAIM_REMOVED_NOTICE = "Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.";
```

  2. Line 53, `  claimsRemoved: number; usage: WatBotUsage;`, becomes:

```ts
  claimsRemoved: number;                   // uncited blocks dropped (FR-17)
  valuesBlocked: number;                   // blocks dropped by the D20 value check, cited or not (WQF-A1)
  usage: WatBotUsage;
```

  3. Line 68, `  blocks: [], claimsRemoved: 0, usage: zeroUsage(model), refused: false, stopped: false,`, becomes `  blocks: [], claimsRemoved: 0, valuesBlocked: 0, usage: zeroUsage(model), refused: false, stopped: false,`.
  4. Lines 143-149 (the comment, `const keep = …`, and the two `if`/`else if` lines) become:

```ts
        // Kept when cited, or an uncited question / short connective (FR-17), or the off-topic
        // decline, which is uncited by design; and, cited or not, when it carries no unseen value
        // or site (D20, revised 2026-11-22). WQF-A1: each reason has its own counter; one notice.
        const uncited = !(b.citations.length > 0 || keepUncitedBlock(b.text) || out.messageType === "off_topic");
        const blocked = !passesValueCheck(b.text, input.facilityNames, input.shownFacts ?? "");
        const firstDrop = out.claimsRemoved + out.valuesBlocked === 0;
        if (uncited) out.claimsRemoved++;
        if (blocked) out.valuesBlocked++;
        if (!uncited && !blocked) { out.blocks.push(b); roundForwardedChars += b.text.length; input.emit({ type: "block", block: b }); }
        else if (firstDrop) input.emit({ type: "notice", kind: "claim_removed" });
```

- [ ] **Step 7: Implement the route.** In `routes/watbot.ts`:
  1. Lines 16-19 become:

```ts
import {
  answerQuestion, CLAIM_REMOVED_NOTICE, emptyAnswerResult, FAILED_NOTICE, REFUSED_NOTICE, STOPPED_NOTICE,
  type AnswerResult, type RoundGate,
} from "../watbot/engine.js";
```

  2. Add `import { logger } from "../lib/logger.js";` after line 28 (the closing `} from "../watbot/limits.js";`).
  3. Delete line 149, `const CLAIM_REMOVED_NOTICE = "One claim was removed — I couldn't support it with a course source.";`, and the blank line after it.
  4. After `tutorMessageId = saved!.id;` (line 340), add:

```ts
        logger.info({ claimsRemoved: r.claimsRemoved, valuesBlocked: r.valuesBlocked }, "WatBot: answer saved"); // WQF-A1: counts only
```

  5. Line 348, `        ...(r.claimsRemoved ? [CLAIM_REMOVED_NOTICE] : []),`, becomes `        ...(r.claimsRemoved || r.valuesBlocked ? [CLAIM_REMOVED_NOTICE] : []),`.

- [ ] **Step 8: Implement the grader, runner and smoke.**
  1. `grader.ts` line 41: `  claimsRemoved: number; forwardedBlocks: number;` → `  claimsRemoved: number; valuesBlocked: number; forwardedBlocks: number;`.
  2. `grader.ts` line 46: insert `valueBlockedRate: number; ` after `claimRemovedRate: number; `.
  3. `grader.ts`, after line 72: `      valueBlockedRate: share(rs.filter((r) => r.valuesBlocked > 0).length),`.
  4. `watbotTestSet.ts` line 81: `|| (t.role === "tutor" ? "(The tutor's reply was removed; you only saw a notice that a claim couldn't be supported.)" : "(no message)");` → `|| (t.role === "tutor" ? "(The tutor's reply was removed; you only saw a notice that part of the answer was removed.)" : "(no message)");`.
  5. `watbotTestSet.ts` line 142: `claimsRemoved: r.claimsRemoved, forwardedBlocks: r.blocks.length };` → `claimsRemoved: r.claimsRemoved, valuesBlocked: r.valuesBlocked, forwardedBlocks: r.blocks.length };`.
  6. `watbotTestSet.ts` line 167: insert `valuesBlocked: \`${(b.valueBlockedRate * 100).toFixed(0)}%\`, ` after the `claimRemoved: …,` entry.
  7. `watbotSmoke.ts` line 31: `removed: r.claimsRemoved, searched,` → `removed: r.claimsRemoved, blocked: r.valuesBlocked, searched,`.

- [ ] **Step 9: Implement the studio notice.** In `useWatBotConversation.ts`, line 10 becomes `  claim_removed: "Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.",`.

- [ ] **Step 10: Run the Step 5 commands again.** Expected: all PASS. Then confirm that no old wording is left:
  ```bash
  grep -rn -e "One claim was removed" -e "claim couldn't be supported" artifacts/api-server/src artifacts/studio/src artifacts/studio/e2e
  ```
  Expected: no output.

- [ ] **Step 11: Gate the task.**
  1. `pnpm run typecheck`. Expected: exit 0.
  2. Check that zero vitest processes are running (Global Constraints).
  3. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
  4. `pnpm --filter studio test`

  Expected: all pass, or only failures that are registered by name and pass twice in isolation.

- [ ] **Step 12: Changelog.** Append to `docs/CHANGELOG-implementation.md`:
  1. The heading `## WQF-A — WatBot QFs, Part A (2026-11-25)`.
  2. One line linking the spec and this plan.
  3. Then:

```markdown
### WQF-A1 — two drop counters, one honest notice

- **Engine:** `claimsRemoved` (uncited) and new `valuesBlocked` (D20 value check, cited or not) count apart. One block can count under both (plan P1). One `claim_removed` notice per answer, on the first drop of either kind. The stored notice now fires on either counter (`routes/watbot.ts`), and its text moved to `engine.ts` as `CLAIM_REMOVED_NOTICE`, the spec's wording. The studio's live notice text matches.
- **Log:** `WatBot: answer saved` with `{ claimsRemoved, valuesBlocked }` for every answer that reached the model. Counts only.
- **Test set:** a per-type `valuesBlocked` column beside `claimRemoved`; the smoke CLI prints `blocked`.
- **Tests:** <list each new/changed test by name>, all red before the change.
- **Gate:** <typecheck; api-server and studio totals, copied from this session's output>.
```

  Replace each `<…>` with the real names and counts before committing, or write `unknown`.

- [ ] **Step 13: Commit.**

```bash
cd /Users/shubhamkr/nos-wqf-a1
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
P=(artifacts/api-server/src/watbot/engine.ts artifacts/api-server/src/routes/watbot.ts artifacts/api-server/src/watbot/eval/grader.ts artifacts/api-server/src/migrations/watbotTestSet.ts artifacts/api-server/src/migrations/watbotSmoke.ts artifacts/studio/src/components/workspace/watbot/useWatBotConversation.ts artifacts/api-server/src/__tests__/watbotEngine.test.ts artifacts/api-server/src/__tests__/watbotRoutes.test.ts artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts artifacts/studio/src/__tests__/useWatBotConversation.test.tsx artifacts/studio/src/__tests__/WatBotMessages.test.tsx docs/CHANGELOG-implementation.md)
git add -- "${P[@]}"
git diff --cached --name-only | sort; printf '%s\n' "${P[@]}" | sort   # the two lists must match
git commit --only -m "$(printf '[WQF-A1] count uncited claims and blocked values apart, with one notice\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')" -- "${P[@]}"
git show --stat HEAD
```

---

### Task WQF-A2: Cap the off-topic exemption at one decline of at most 25 words

**Role:** `backend-engineer`.

**Files:**
- Modify: `artifacts/api-server/src/watbot/citations.ts:6-13`
- Modify: `artifacts/api-server/src/watbot/engine.ts`: the import at line 7, the state after line 96, and the `const uncited` line added by WQF-A1
- Test: `artifacts/api-server/src/__tests__/watbotEngine.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: WQF-A1's block decision (`uncited`, `blocked`, `firstDrop`).
- Produces: `export const MAX_DECLINE_WORDS = 25` and `export const wordCount: (text: string) => number` (citations.ts).

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing tests.** In `watbotEngine.test.ts`:
  1. Line 5, `import { keepUncitedBlock, passesValueCheck } from "../watbot/citations.js";`, becomes `import { keepUncitedBlock, MAX_DECLINE_WORDS, MIN_CLAIM_WORDS, passesValueCheck, wordCount } from "../watbot/citations.js";`.
  2. Add, right after the test "still value-checks an off-topic decline":

```ts
  // WQF-A2: the exemption covers one decline of at most 25 words, never a whole uncited answer.
  const LONG_UNCITED = "Minimize the total of cost times flow over every lane, subject to supply at each plant and demand at each customer being met.";
  const words = (n: number) => `${Array(n).fill("decline").join(" ")}.`;
  const offTopic = (...texts: string[]) => fakeClient([toolRound("t1", "record_message_type", { type: "off_topic" }),
    { events: texts.flatMap((t, i) => textBlock(i, t, [])), final: { stop_reason: "end_turn" as const } }]);
  it("drops every uncited block after the first in an off-topic answer", async () => {
    const events: EngineEvent[] = [];
    const r = await answerQuestion(baseInput(offTopic(DECLINE, LONG_UNCITED), { emit: (e) => events.push(e) }));
    expect(wordCount(LONG_UNCITED)).toBeGreaterThanOrEqual(MIN_CLAIM_WORDS); // non-vacuity: claim-length, not FR-17-short
    expect(r.blocks.map((b) => b.text)).toEqual([DECLINE]);
    expect(r).toMatchObject({ claimsRemoved: 1, valuesBlocked: 0 });
    expect(events.filter((e) => e.type === "notice")).toEqual([{ type: "notice", kind: "claim_removed" }]);
  });
  it("forwards a first uncited off-topic block of 25 words and drops one of 26", async () => {
    expect(wordCount(words(25))).toBe(MAX_DECLINE_WORDS);
    expect((await answerQuestion(baseInput(offTopic(words(25))))).blocks).toHaveLength(1);
    expect(await answerQuestion(baseInput(offTopic(words(26))))).toMatchObject({ blocks: [], claimsRemoved: 1 });
  });
  it("a too-long first block spends the exemption, so the decline after it is dropped too", async () => {
    expect(await answerQuestion(baseInput(offTopic(words(26), DECLINE)))).toMatchObject({ blocks: [], claimsRemoved: 2 });
  });
  it("a short line before the decline does not spend the exemption (plan P2)", async () => {
    const r = await answerQuestion(baseInput(offTopic("Sorry.", DECLINE)));
    expect(r.blocks.map((b) => b.text)).toEqual(["Sorry.", DECLINE]);
  });
```

- [ ] **Step 2: Run them and confirm they fail.**
  `cd /Users/shubhamkr/nos-wqf-a2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/watbotEngine.test.ts`
  Expected: FAIL, because `wordCount`/`MAX_DECLINE_WORDS` are not exported, so the new tests error. Once they exist, the three cap tests fail because every uncited off-topic block is forwarded. The "Sorry." test passes both before and after; it guards P2 against an over-strict fix.

- [ ] **Step 3: Implement `citations.ts`.** Lines 6-13 become:

```ts
export const MIN_CLAIM_WORDS = 12;
export const MAX_DECLINE_WORDS = 25; // WQF-A2: the one off-topic decline allowed uncited
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// ponytail: word-count / question-mark heuristic decides what is a "claim";
// upgrade to a second-pass check only if reports show it misclassifying.
export function keepUncitedBlock(text: string): boolean {
  const t = text.trim();
  return t.endsWith("?") || wordCount(t) < MIN_CLAIM_WORDS;
}
```

- [ ] **Step 4: Implement `engine.ts`.**
  1. Line 7 becomes `import { keepUncitedBlock, mapCitation, MAX_DECLINE_WORDS, passesValueCheck, wordCount } from "./citations.js";`.
  2. After line 96 (`  let reforce = false; …`), add `  let declineUsed = false; // WQF-A2: the off-topic exemption covers one block per answer`.
  3. Replace WQF-A1's comment and its `const uncited = …` line with:

```ts
        // Kept when cited, or an uncited question / short connective (FR-17); and, cited or not,
        // when it carries no unseen value or site (D20, revised 2026-11-22). WQF-A1: each reason
        // has its own counter; one notice.
        let uncited = b.citations.length === 0 && !keepUncitedBlock(b.text);
        // WQF-A2: in an off-topic answer only the first block that would otherwise be dropped as
        // uncited may pass, as the one-line decline, and only at MAX_DECLINE_WORDS or fewer. It
        // spends the exemption either way; the value check below still applies.
        if (uncited && out.messageType === "off_topic" && !declineUsed) {
          declineUsed = true;
          uncited = wordCount(b.text) > MAX_DECLINE_WORDS;
        }
```

  Leave the `blocked`, `firstDrop` and forward/notice lines from WQF-A1 unchanged.

- [ ] **Step 5: Run the Step 2 command.** Expected: PASS, including the unchanged WATBOT-REPLY-ENDINGS tests "forwards an uncited off-topic decline of 12+ words" and "still drops the same uncited text for any other type".

- [ ] **Step 6: Gate the task.**
  1. `pnpm run typecheck`.
  2. Check that zero vitest processes are running.
  3. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`.

  Expected: as in WQF-A1 Step 11.

- [ ] **Step 7: Changelog.** Append:

```markdown
### WQF-A2 — off-topic exemption capped at one decline of ≤ 25 words

- **Engine:** in an `off_topic` answer, only the first block that would otherwise be dropped as uncited is exempt, and only at ≤ `MAX_DECLINE_WORDS` (25) whitespace-separated words. It spends the exemption either way. Short FR-17 blocks do not spend it (plan P2). Every later uncited block is dropped. The value check still applies to every block. No buffering: decided per block as it finishes.
- **Why:** a mislabelled request (e.g. a full formulation: no 4+-digit number, no facility name) could pass uncited under the old blanket exemption.
- **Tests:** <names>, red before the change except the P2 guard.
- **Gate:** <counts from this session>.
```

- [ ] **Step 8: Commit.** Use the WQF-A1 Step 13 commands, with:
  - worktree `/Users/shubhamkr/nos-wqf-a2`;
  - `P=(artifacts/api-server/src/watbot/citations.ts artifacts/api-server/src/watbot/engine.ts artifacts/api-server/src/__tests__/watbotEngine.test.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A2] cap the off-topic exemption at one decline of at most 25 words`.

---

### Task WQF-A3: A tab without a scenario is no context

**Role:** `backend-engineer`.

**Files:**
- Modify: `artifacts/api-server/src/watbot/prompt.ts:103-105,135`
- Test: `artifacts/api-server/src/__tests__/watbotEngine.test.ts:258-285`, `artifacts/api-server/src/__tests__/watbotRoutes.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: none.
- Produces: `buildRequest` sends `NO_CONTEXT` whenever `contextSummary` has no `Scenario: ` segment. The `buildRequest` signature is unchanged.

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing unit tests.** In `watbotEngine.test.ts`, inside `describe("buildRequest", …)`:
  1. Line 260: `contextSummary: "Output Map · Baseline · p = 4"` → `contextSummary: "Tab: output-map · Scenario: Baseline · p = 4"`. This fixture predates the route's summary format.
  2. Line 268: `expect(JSON.stringify(last)).toContain("Output Map · Baseline · p = 4");` → `expect(JSON.stringify(last)).toContain("Student context: Tab: output-map · Scenario: Baseline · p = 4");`.
  3. Line 277: `const some = buildRequest({ ...base, contextSummary: "Tab: Output Map" });` → `const some = buildRequest({ ...base, contextSummary: "Tab: output-map · Scenario: Baseline · p = 4" });`.
  4. Line 281: `expect(text(some)).toBe("Student context: Tab: Output Map\n\nStudent message: What is p-median?");` → `expect(text(some)).toBe("Student context: Tab: output-map · Scenario: Baseline · p = 4\n\nStudent message: What is p-median?");`.
  5. Add after that test:

```ts
  // WQF-A3: an open tab with no scenario (none selected, or a re-answer whose scenario was deleted)
  // is no context; with a scenario, the summary is context whether or not a tab is open.
  it("sends NO_CONTEXT for a tab with no scenario", () => {
    const base = { model: "m", bundle, fixedQuestions: [], history: [], question: "q" };
    const text = (contextSummary: string) => ((buildRequest({ ...base, contextSummary }).messages.at(-1)!.content as Anthropic.TextBlockParam[])[0]!).text;
    expect(text("Tab: output-map")).toBe(`${NO_CONTEXT}\n\nStudent message: q`);
    expect(text(" · Scenario: Baseline · not solved yet")).toBe("Student context:  · Scenario: Baseline · not solved yet\n\nStudent message: q");
  });
```

- [ ] **Step 2: Write the failing route test.** In `watbotRoutes.test.ts`:
  1. Line 17, `import { REPAIR_LABELS } from "../watbot/prompt.js";`, becomes `import { NO_CONTEXT, REPAIR_LABELS } from "../watbot/prompt.js";`.
  2. Add, after the test "a report stores the context of the question that produced the reported answer, not the newest one":

```ts
  // WQF-A3: the studio sends a tab with scenarioId null whenever no scenario is selected.
  it("sends NO_CONTEXT for a tab with no scenario, and the Student context for an owned scenario", async () => {
    const seen: Anthropic.MessageStreamParams[] = [];
    const inner = scriptedClient("What would change with p = 1?");
    useClient({ messages: { stream: (params, opts) => { seen.push(params); return inner.messages.stream(params, opts); } } });
    const cookie = await registerAndGetCookie();
    const [sc] = await db.insert(scenariosTable).values({ name: "Baseline", userId: lastUserId(), modelId: "p-median-us", inputs: {} }).returning();
    try {
      const id = await newConversation(cookie);
      const ask = (context: object) => request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context });
      expect((await ask({ tab: "output-map", scenarioId: null })).text).toContain("event: done");
      expect((await ask({ tab: "output-map", scenarioId: sc!.id })).text).toContain("event: done");
      const lastTurn = (p: Anthropic.MessageStreamParams) => ((p.messages.at(-1)!.content as Anthropic.TextBlockParam[])[0]!).text;
      expect(lastTurn(seen[0]!)).toBe(`${NO_CONTEXT}\n\nStudent message: q`);
      expect(lastTurn(seen[1]!)).toMatch(/^Student context: Tab: output-map · Scenario: Baseline · /);
    } finally {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, sc!.id));
    }
  });
```

- [ ] **Step 3: Run them and confirm they fail.**
  `cd /Users/shubhamkr/nos-wqf-a3 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/watbotEngine.test.ts src/__tests__/watbotRoutes.test.ts`
  Expected: FAIL on the unit test (`Student context: Tab: output-map`, not `NO_CONTEXT`) and on the route test's first `lastTurn` (`Student context: Tab: output-map…`). The rewritten fixtures at lines 260-281 already pass, which shows the scenario path is unchanged.

- [ ] **Step 4: Implement.** In `prompt.ts`:
  1. After line 105 (`export const NO_CONTEXT = …`), add:

```ts
// WQF-A3 — only an owned scenario makes Student context. buildContext (routes/watbot.ts) writes
// "Tab: <tab> · Scenario: <name> · …"; the tab is an OpenAPI enum, so a tab-only summary (no
// scenario selected, or a re-answer whose scenario was deleted) never carries this segment.
const hasScenario = (summary: string) => /(?:^|· )Scenario: /.test(summary);
```

  2. Line 135 becomes `  const ctx = hasScenario(input.contextSummary) ? \`Student context: ${input.contextSummary}\n\n\` : \`${NO_CONTEXT}\n\n\`;`. This is the existing template literal; only the condition changes.

- [ ] **Step 5: Run the Step 3 command.** Expected: PASS. The test set is unaffected: every `testSet.json` summary carries `Scenario: ` (all 20 listed contexts start `Tab: … · Scenario: Baseline`).

- [ ] **Step 6: Gate the task.** Same as WQF-A2 Step 6.

- [ ] **Step 7: Changelog.** Append:

```markdown
### WQF-A3 — a tab without a scenario is no context

- **Prompt:** `buildRequest` sends `NO_CONTEXT` verbatim unless the summary carries a `Scenario: ` segment, which only `buildContext` writes for an owned scenario (the tab is an enum). Covers both the question path (studio sends a tab with `scenarioId: null`) and the re-answer path (source scenario deleted), in one place. The tab name is not appended (plan P3). Closes WATBOT-NO-SCREEN-REF's open follow-up.
- **Tests:** <names>; two old fixtures moved to the route's summary format.
- **Gate:** <counts>.
```

- [ ] **Step 8: Commit.** Use the WQF-A1 Step 13 commands, with:
  - worktree `/Users/shubhamkr/nos-wqf-a3`;
  - `P=(artifacts/api-server/src/watbot/prompt.ts artifacts/api-server/src/__tests__/watbotEngine.test.ts artifacts/api-server/src/__tests__/watbotRoutes.test.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A3] send no context for a tab without a scenario`.

---

### Task WQF-A4: Thousands separators, and a report of numbers written without them

**Role:** `backend-engineer`.

**Files:**
- Modify: `artifacts/api-server/src/watbot/prompt.ts:33` (insert a line after it)
- Modify: `artifacts/api-server/src/watbot/eval/grader.ts` (after line 34)
- Modify: `artifacts/api-server/src/migrations/watbotTestSet.ts:20,112,124-135,173-174`
- Test: `artifacts/api-server/src/__tests__/watbotEngine.test.ts`, `artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces: `export const unseparatedNumbers: (reply: string) => string[]` (grader.ts). The runner prints `Unseparated 4+-digit numbers: <n> in <m> of <r> replies (reported, not a bar)`.

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing tests.**
  1. `watbotEngine.test.ts` line 11: add `SYSTEM_PROMPT` to the `../watbot/prompt.js` import list.
  2. Add inside `describe("buildRequest", …)`:

```ts
  // WQF-A4: the example number is made up (plan P4); the value check reads the separated form.
  it("asks for thousands separators, the context's units, and $ only for money", () => {
    expect(SYSTEM_PROMPT).toContain("- Write numbers of four or more digits with thousands separators, for example 12,345,678. Keep the units the Student context uses, such as demand-mi, mi or tons, and use $ only for money values.");
    expect(extractNumbers("12,345,678 demand-mi")).toEqual([12345678]);
  });
```

  3. `watbotEvalGrader.test.ts` line 5: add `unseparatedNumbers` to the import list.
  4. Append:

```ts
// WQF-A4: numbers of four or more digits written without thousands separators (reported, not a bar).
describe("unseparatedNumbers", () => {
  it("finds every 4+-digit run with no separators", () => {
    expect(unseparatedNumbers("The total is 12345678 demand-mi, and a site costs $2500.")).toEqual(["12345678", "2500"]);
  });
  it("accepts separated numbers, short numbers and decimals", () => {
    expect(unseparatedNumbers("The total is 12,345,678 demand-mi; p = 3, 450 mi, a rate of 0.12345 per mile.")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  `cd /Users/shubhamkr/nos-wqf-a4 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/watbotEngine.test.ts src/__tests__/watbotEvalGrader.test.ts`
  Expected: FAIL. The prompt line is missing, and `unseparatedNumbers` is not a function.

- [ ] **Step 3: Implement the prompt.** In `prompt.ts`, insert after line 33 (`- Write plain prose. … for example Σ cost_ij · x_ij.`):

```
- Write numbers of four or more digits with thousands separators, for example 12,345,678. Keep the units the Student context uses, such as demand-mi, mi or tons, and use $ only for money values.
```

  This is inside the `SYSTEM_PROMPT` template literal. `$ only` is not `${`, so it does not interpolate.

- [ ] **Step 4: Implement the grader.** In `grader.ts`, after line 34 (`export const latexMarkup = …`), add:

```ts

// WQF-A4 — a 4+-digit run not preceded by a digit, "." or ",": written without thousands
// separators (a decimal's fraction digits are skipped). Years count too; reported, not a bar.
const UNSEPARATED = /(?<![\d.,])\d{4,}/g;
export const unseparatedNumbers = (reply: string): string[] => reply.match(UNSEPARATED) ?? [];
```

- [ ] **Step 5: Implement the runner.** In `watbotTestSet.ts`:
  1. Line 20: add `unseparatedNumbers` to the `../watbot/eval/grader.js` import list.
  2. After line 112 (`  const latexReplies: string[] = [];`), add `  const unseparated: string[] = [];` and `  let unseparatedCount = 0;`.
  3. After line 133 (`    if (tex) latexReplies.push(…);`), add:

```ts
    const raw = unseparatedNumbers(reply);
    if (raw.length) { unseparatedCount += raw.length; unseparated.push(`UNSEPARATED ${base.id} (${base.modelId}): ${raw.length}`); }
```

  4. After line 174 (`  console.log(\`Replies with LaTeX: …\`);`), add:

```ts
  for (const line of unseparated) console.log(line);
  console.log(`Unseparated 4+-digit numbers: ${unseparatedCount} in ${unseparated.length} of ${replies} replies (reported, not a bar)`);
```

  The per-reply line prints a **count**, never the number. A printed number could be an answer-key value, and these lines may be quoted in public notes.

- [ ] **Step 6: Run the Step 2 command.** Expected: PASS.

- [ ] **Step 7: Gate the task.** Same as WQF-A2 Step 6.

- [ ] **Step 8: Changelog.** Append:

```markdown
### WQF-A4 — thousands separators

- **Prompt:** one `SYSTEM_PROMPT` rule: separators on 4+-digit numbers, the Student context's units, `$` only for money. The example `12,345,678` is invented (plan P4: the spec's example equals a committed answer-key objective). No value-check change: `extractNumbers` already reads `1,234,567`, `$1.23M`, `1.2 million`. This edit rewrites the prompt cache once after deploy, and **needs WQF-A7's passing paid run before it ships** (`prompt.ts:9-10`).
- **Test set:** `unseparatedNumbers` (grader); the runner prints `Unseparated 4+-digit numbers: n in m of r replies (reported, not a bar)`, per-reply counts only.
- **Tests:** <names>, red first.
- **Gate:** <counts>.
```

- [ ] **Step 9: Commit.** Use the WQF-A1 Step 13 commands, with:
  - worktree `/Users/shubhamkr/nos-wqf-a4`;
  - `P=(artifacts/api-server/src/watbot/prompt.ts artifacts/api-server/src/watbot/eval/grader.ts artifacts/api-server/src/migrations/watbotTestSet.ts artifacts/api-server/src/__tests__/watbotEngine.test.ts artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A4] ask for thousands separators and report numbers written without them`.

---

### Task WQF-A5: The citation popover shows the formatted page, once

**Role:** `frontend-engineer`. This task hands it `artifacts/studio/e2e/watbot.spec.ts`, because the sibling specs break in this commit (root Gotchas).

**Files:**
- Create: `artifacts/studio/src/components/workspace/watbot/citationHighlight.ts`, `artifacts/studio/src/__tests__/citationHighlight.test.ts`
- Modify: `artifacts/studio/src/components/workspace/watbot/MathText.tsx:8-11` (move the regex out)
- Modify: `artifacts/studio/src/components/workspace/watbot/WatBotMessages.tsx:1,79-102`
- Modify (rewrite): `artifacts/studio/src/__tests__/WatBotMessages.test.tsx`
- Modify: `artifacts/studio/e2e/watbot.spec.ts:50-52,100-111,435-500`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces:
  - `export const MATH: RegExp` (global).
  - `export type Segment = { text: string; math: boolean; mark: boolean }`.
  - `export function citationSegments(body: string, citedText: string): Segment[]`. The concatenated `text` of the result always equals `body`.
  - The popover's scroll container carries `data-testid="watbot-source"`.
- Removes: the "Open full source" button and the "Loading…" status line.

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Then start the two servers on ports 3151/5151 (Global Constraints).

- [ ] **Step 1: Write the failing pure tests.** Create `artifacts/studio/src/__tests__/citationHighlight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { citationSegments } from "@/components/workspace/watbot/citationHighlight";

// Made-up text throughout: this repo is public.
const marked = (body: string, cited: string) => citationSegments(body, cited).filter((s) => s.mark).map((s) => s.text);

describe("citationSegments (WQF-A5)", () => {
  it("marks the first exact occurrence of a shorter cited span", () => {
    expect(citationSegments("A b. C d. C d.", "C d.")).toEqual([
      { text: "A b. ", math: false, mark: false },
      { text: "C d.", math: false, mark: true },
      { text: " C d.", math: false, mark: false },
    ]);
  });
  it("matches across runs of whitespace and marks the body's own characters", () => {
    expect(marked("Intro.\n\nEach  customer\nis served.", "  Each customer is   served.\n")).toEqual(["Each  customer\nis served."]);
  });
  it("marks nothing when the cited text is the whole body, missing, or empty", () => {
    expect(marked("Whole page.", "Whole page.")).toEqual([]);
    expect(marked(" Whole\npage. ", "Whole page.")).toEqual([]);
    expect(marked("Whole page.", "Other text.")).toEqual([]);
    expect(marked("Whole page.", "   ")).toEqual([]);
  });
  it("never marks a formula: only the text around it inside the range", () => {
    expect(citationSegments("Pre. A $$x_i$$ B. Post.", "A $$x_i$$ B.")).toEqual([
      { text: "Pre. ", math: false, mark: false },
      { text: "A ", math: false, mark: true },
      { text: "$$x_i$$", math: true, mark: false },
      { text: " B.", math: false, mark: true },
      { text: " Post.", math: false, mark: false },
    ]);
  });
  it("treats $\\cmd…$ inline math as a formula and a price as text", () => {
    expect(citationSegments("Pay $2 for $\\forall$ j. End.", "Pay $2 for $\\forall$ j.")).toEqual([
      { text: "Pay $2 for ", math: false, mark: true },
      { text: "$\\forall$", math: true, mark: false },
      { text: " j.", math: false, mark: true },
      { text: " End.", math: false, mark: false },
    ]);
  });
  it("keeps every character of the body, in order", () => {
    for (const [body, cited] of [["Pre. A $$x$$ B. Post.", "A $$x$$ B."], ["a\n\nb  c", "b c"], ["no math", "zzz"], ["$$x$$", "$$x$$"]]) {
      expect(citationSegments(body!, cited!).map((s) => s.text).join("")).toBe(body);
    }
  });
});
```

- [ ] **Step 2: Rewrite `WatBotMessages.test.tsx`** to the new behaviour. Replace the whole file with:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
// Made-up page text (never book text: this repo is public).
const PAGE = "Page intro.\n\nP-median minimizes demand-weighted distance.\n\nPage end.";
const passageState = { isError: false, isLoading: false, retry: undefined as boolean | undefined, enabled: undefined as boolean | undefined, body: PAGE };
vi.mock("@workspace/api-client-react", () => ({
  getGetWatBotPassageQueryKey: (id: number) => ["passage", id],
  useGetWatBotPassage: (id: number, o: { query: { enabled: boolean; retry: boolean } }) => ({
    data: o.query.enabled && !passageState.isError && !passageState.isLoading ? { id, label: "Ch 3 · p.38", body: passageState.body } : undefined,
    isError: o.query.enabled && passageState.isError, isLoading: o.query.enabled && passageState.isLoading,
    ...(passageState.retry = o.query.retry, passageState.enabled = o.query.enabled, {}),
  }),
  useSubmitWatBotReport: () => ({ mutateAsync, isPending: false }),
  useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }),
}));
import { WatBotMessages } from "@/components/workspace/watbot/WatBotMessages";

const CITED = "P-median minimizes demand-weighted distance.";
const items = [
  { kind: "student" as const, blocks: [{ text: "Why?", citations: [] }] },
  { kind: "tutor" as const, id: 9, blocks: [{ text: "Demand weights distance", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: CITED }] }] },
  { kind: "notice" as const, blocks: [{ text: "Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.", citations: [] }] },
];
const unsaved = (citedText: string) => [{ kind: "tutor" as const, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText }] }] }];
const saved = (citedText: string) => [{ ...unsaved(citedText)[0]!, id: 9 }];
const openChip = () => { fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" })); return screen.getByRole("dialog"); };

describe("WatBotMessages", () => {
  afterEach(() => { passageState.isError = false; passageState.isLoading = false; passageState.retry = undefined; passageState.enabled = undefined; passageState.body = PAGE; });
  it("renders student, tutor and notice messages distinctly", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    expect(screen.getByText("Why?").closest("[data-role]")).toHaveAttribute("data-role", "student");
    expect(screen.getByText(/Demand weights distance/).closest("[data-role]")).toHaveAttribute("data-role", "tutor");
    expect(screen.getByText(/Part of this answer was removed/).closest("[data-role]")).toHaveAttribute("data-role", "notice");
  });

  // WQF-A5: one view — the page, with the cited span highlighted inside it.
  it("a saved answer's chip opens straight to the page, with the cited text highlighted once", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent("Page intro.");
    expect([...popover.querySelectorAll("mark")].map((m) => m.textContent)).toEqual([CITED]);
    expect(popover.textContent!.split(CITED)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Open full source" })).toBeNull();
  });

  it("shows the page with no highlight when the citation is the whole page, or is not in it", () => {
    passageState.body = CITED;
    const { unmount } = render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    expect(openChip().querySelector("mark")).toBeNull();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    unmount();
    passageState.body = "Another page entirely.";
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    expect(popover.querySelector("mark")).toBeNull();
    expect(popover).toHaveTextContent("Another page entirely.");
    expect(popover.textContent).not.toContain(CITED); // never the separate quote
  });

  it("shows the cited text while the page loads, with no separate status line", () => {
    passageState.isLoading = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an unsaved answer shows the cited text and never requests the page (D23)", () => {
    render(<WatBotMessages items={unsaved(CITED)} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(passageState.enabled).toBe(false);
  });

  it("keeps the cited text and says 'Source unavailable' when the page fails to load", () => {
    passageState.isError = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(passageState.retry).toBe(false);
  });

  it("reports a cited answer with a reason and note", async () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Report this answer" }));
    fireEvent.click(screen.getByRole("radio", { name: "The citation doesn't support the answer" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Anything else/ }), { target: { value: "wrong page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(mutateAsync).toHaveBeenCalledWith({ data: { messageId: 9, reason: "citation_unsupported", note: "wrong page" } });
    expect(await screen.findByText("Thanks — reported. Your conversation continues.")).toBeInTheDocument();
  });

  it("shows checking source and a Stop control while a block is pending", () => {
    const onStop = vi.fn();
    render(<WatBotMessages items={[]} pending={{ searching: "Chapter 6" }} onStop={onStop} />);
    expect(screen.getByText(/Searching Chapter 6/)).toBeInTheDocument();
    expect(screen.getByText("checking source…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows queue position as text", () => {
    render(<WatBotMessages items={[]} pending={{ searching: null, queued: 2 }} onStop={vi.fn()} />);
    expect(screen.getByText(/number 2 in line/)).toBeInTheDocument();
  });

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

  it("never falls back to an earlier answer: a trailing student or notice hides the rating line", () => {
    const fb = { conversationId: 5, onRepair: vi.fn() };
    const student = { kind: "student" as const, blocks: [{ text: "And now?", citations: [] }] };
    render(<WatBotMessages items={[items[0]!, items[1]!, student]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
    render(<WatBotMessages items={[items[0]!, items[1]!, student, items[2]!]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
  });

  // WATBOT-POPOVER-KATEX + WQF-A5: formulas render as math, and a formula inside the cited span stays unmarked.
  it("renders the page's LaTeX as math and marks only the text around a formula in the cited span", async () => {
    passageState.body = "Page text $$\\sum_{i} d_i$$ continues. The cost is $$x_{ij} + y$$ here. Page end.";
    render(<WatBotMessages items={saved("The cost is $$x_{ij} + y$$ here.")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$$");
    expect([...popover.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["The cost is ", " here."]);
    expect(popover.querySelector("mark .katex")).toBeNull();
    expect(popover.textContent).toContain("continues.");
  });

  it("keeps an unclosed $$ as text and shows invalid LaTeX without throwing", async () => {
    render(<WatBotMessages items={unsaved("Bad $$\\frac{$$ then cut $$\\sum_i")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelector(".katex-error")).not.toBeNull());
    expect(popover.textContent).toContain("then cut $$\\sum_i");
  });

  // WATBOT-POPOVER-INLINE-MATH: the corpus also writes symbols as single-$ inline math.
  it("renders single-$ inline math that starts with a command, and leaves prices as text", async () => {
    render(<WatBotMessages items={unsaved("For $\\forall$ j $\\in$ J, each site costs $2 or $3 more.")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$\\forall$");
    expect(popover.textContent).toContain("each site costs $2 or $3 more.");
  });

  it("caps the page's height so a long passage scrolls inside the popover", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveClass("max-h-48", "overflow-auto", "whitespace-pre-wrap");
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[var(--radix-popover-content-available-height)]", "overflow-y-auto");
  });

  it("never lets an unclosed $\\cmd run past the end of its line", async () => {
    render(<WatBotMessages items={unsaved("cut $\\forall\nnew para $$x$$ costs $5")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(1));
    expect(screen.getByTestId("watbot-source").textContent).toContain("cut $\\forall");
    expect(screen.getByTestId("watbot-source").textContent).toContain("costs $5");
  });
});
```

- [ ] **Step 3: Write the failing real-browser tests** in `artifacts/studio/e2e/watbot.spec.ts`. jsdom cannot see the highlight paint, `white-space`, the computed height cap, or the scroll (studio `CLAUDE.md`).
  1. Lines 50-52 become:

```ts
  await page.route("**/api/watbot/passages/11", (r) =>
    r.fulfill({ json: { id: 11, label: "Ch 3 · p.38", body: PAGE_38 } }),
  );
```

  2. Add after line 37 (`const STATUS_OK = …`):

```ts
// Made-up page text that contains ANSWER_SSE's cited text (WQF-A5 highlights it inside the page).
const PAGE_38 = "Page 38 opens here.\n\nMinimize demand-weighted distance.\n\nPage 38 ends here.";
```

  3. Replace lines 100-111 (the WATBOT-8b test `"WatBot: 'Open full source' is reachable from the citation popover"`; that button is gone) with:

```ts
// WQF-A5: a saved answer's chip opens straight to its formatted page, with the cited text
// highlighted inside it once. (Replaces the WATBOT-8b "Open full source" check: the button is gone.)
test("WatBot: a citation opens to its page with the cited text highlighted once", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "srcpage");
  await stubWatBot(page);
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  // The popover is portaled out of the panel, so query the page.
  const popover = page.getByRole("dialog", { name: "Source Ch 3 · p.38" });
  const source = popover.getByTestId("watbot-source");
  await expect(source).toContainText("Page 38 opens here.", { timeout: T });
  await expect(popover.locator("mark")).toHaveText(["Minimize demand-weighted distance."]);
  expect((await popover.innerText()).split("Minimize demand-weighted distance.")).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Open full source" })).toHaveCount(0);
  // CSS only a browser applies: the page keeps its paragraphs, and the highlight is painted.
  await expect(source).toHaveCSS("white-space", "pre-wrap");
  expect(await popover.locator("mark").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await popover.screenshot({ path: test.info().outputPath("citation-page.png") });
});
```

  4. Replace lines 435-467 (the comment and the test `"WatBot: citation popover renders $$ LaTeX as math"`) with:

```ts
// WATBOT-POPOVER-KATEX + WQF-A5: the page's formulas ($$…$$ LaTeX) render as math, with KaTeX's
// CSS applied and its font loaded (jsdom cannot see either); a formula inside the cited span is
// not highlighted, only the text around it.
test("WatBot: citation popover renders $$ LaTeX as math, unhighlighted inside the cited span", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "katex");
  const cited = "The objective is $$\\sum_{i} \\sum_{j} c_{ij} x_{ij}$$ for all pairs.";
  const mathSse = [
    sseEvent("block", { text: "The objective sums cost over every assignment", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: cited }] }),
    sseEvent("done", { messageId: 902 }),
  ].join("");
  await stubWatBot(page, { messagesBody: mathSse });
  await page.route("**/api/watbot/passages/11", (r) =>
    r.fulfill({ json: { id: 11, label: "Ch 3 · p.38", body: `Page text $$\\frac{a}{b} \\le 1$$ continues.\n\n${cited}\n\nPage ends.` } }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  const popover = page.getByRole("dialog", { name: "Source Ch 3 · p.38" });
  await expect(popover.getByTestId("watbot-source")).toContainText("continues.", { timeout: T });
  await expect(popover.locator(".katex-html")).toHaveCount(2, { timeout: T });
  await expect(popover.locator(".katex-html").first()).toBeVisible();
  expect(await popover.innerText()).not.toContain("$$");
  await expect(popover.locator("mark")).toHaveText(["The objective is", "for all pairs."]);
  await expect(popover.locator("mark .katex")).toHaveCount(0);
  // Both are false without katex.min.css: its rule positions .katex-mathml absolutely, and its
  // @font-face rules are the only source of a KaTeX_Main face. (document.fonts.check() is true
  // for any unknown family, so it cannot fail.)
  await expect(popover.locator(".katex-mathml").first()).toHaveCSS("position", "absolute");
  // A short page must not make the height-capped box scroll (KaTeX struts can add a pixel).
  expect(await popover.getByTestId("watbot-source").evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "KaTeX_Main" && f.status === "loaded")), { timeout: T }).toBe(true);
  await popover.screenshot({ path: test.info().outputPath("katex-popover.png") });
});
```

  5. Replace lines 469-500 (the comment and the test `"WatBot: a long citation popover stays inside the viewport and renders $\\cmd$ inline math"`) with:

```ts
// WATBOT-POPOVER-INLINE-MATH + WQF-A5: a whole-page passage scrolls inside its 12rem box
// (max-h-48 = 192px at the 16px root) and the popover stays on screen; $\forall$ renders.
test("WatBot: a long citation popover stays inside the viewport and renders $\\cmd$ inline math", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 600 });
  await registerFreshAccount(page, "longcite");
  const longQuote = `For $\\forall$ j $\\in$ J the sum is one. ${"Every customer must be served by one site. ".repeat(60)}`;
  await stubWatBot(page, { messagesBody: [
    sseEvent("block", { text: "Each customer is served once", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: longQuote }] }),
    sseEvent("done", { messageId: 903 }),
  ].join("") });
  await page.route("**/api/watbot/passages/11", (r) =>
    r.fulfill({ json: { id: 11, label: "Ch 3 · p.38", body: `Page 38 opens here.\n\n${longQuote}\n\nPage 38 ends here.` } }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  const popover = page.getByRole("dialog", { name: "Source Ch 3 · p.38" });
  const source = popover.getByTestId("watbot-source");
  await expect(source).toContainText("Page 38 ends here.", { timeout: T });
  await expect(popover.locator(".katex-html")).toHaveCount(2, { timeout: T });
  expect(await source.innerText()).not.toContain("$\\forall$");
  await expect(popover.locator("mark").last()).toContainText("Every customer must be served by one site.");
  await expect(source).toHaveCSS("max-height", "192px");
  expect(await source.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const box = (await popover.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await popover.screenshot({ path: test.info().outputPath("long-citation.png") });
});
```

- [ ] **Step 4: Run them and confirm they fail.**
  1. `cd /Users/shubhamkr/nos-wqf-a5 && pnpm --filter studio exec vitest run src/__tests__/citationHighlight.test.ts src/__tests__/WatBotMessages.test.tsx`
     Expected: `citationHighlight.test.ts` FAILs because the module is missing. In `WatBotMessages.test.tsx`, the new A5 tests fail because there is no `watbot-source` and the chip still needs "Open full source".
  2. `cd /Users/shubhamkr/nos-wqf-a5/artifacts/studio && E2E_BASE_URL=http://localhost:5151 pnpm exec playwright test e2e/watbot.spec.ts --grep "citation"`
     Expected: the three rewritten tests FAIL, because there is no `watbot-source` and no `mark` inside a page. The journey test, which also matches `citation`, passes: its cited text is inside `PAGE_38`.

- [ ] **Step 5: Implement `citationHighlight.ts`.** Create `artifacts/studio/src/components/workspace/watbot/citationHighlight.ts`:

```ts
// WQF-A5 — where the cited text sits in its passage, for the citation popover. Free of KaTeX,
// so the main bundle can split a page without loading the lazy MathText chunk.

// $$…$$, or single-$ inline math that starts with a \command ($\forall$); a price such as
// "$2 or $3" never starts with a backslash, so it stays text. Inline math ends at its line, so
// an unclosed $\cmd (a quote cut mid-formula) cannot swallow the next paragraph.
export const MATH = /\$\$([\s\S]+?)\$\$|\$(\\[a-zA-Z][^$\n]*)\$/g;

export type Segment = { text: string; math: boolean; mark: boolean };

// Runs of whitespace become one space; at[i] is where the i-th kept character sits in `s`.
function collapse(s: string) {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const space = /\s/.test(s[i]!);
    if (space && text.endsWith(" ")) continue;
    text += space ? " " : s[i];
    at.push(i);
  }
  return { text, at };
}

// [start, end) of the cited text in `body`: the first exact match once whitespace runs are
// collapsed in both (no fuzzy matching). null when it is empty, missing, or the whole body.
function citedRange(body: string, citedText: string): [number, number] | null {
  const cited = collapse(citedText).text.trim();
  const b = collapse(body);
  const k = cited ? b.text.indexOf(cited) : -1;
  if (k < 0 || cited === b.text.trim()) return null;
  return [b.at[k]!, b.at[k + cited.length - 1]! + 1];
}

// The body split into text and formulas; only text inside the cited range is marked, so a
// formula renders whole and unmarked even inside the range. The texts join back to `body`.
export function citationSegments(body: string, citedText: string): Segment[] {
  const range = citedRange(body, citedText);
  const out: Segment[] = [];
  const text = (from: number, to: number) => {
    const clamp = (n: number) => Math.min(Math.max(n, from), to);
    const [a, z] = range ? [clamp(range[0]), clamp(range[1])] : [to, to];
    if (from < a) out.push({ text: body.slice(from, a), math: false, mark: false });
    if (a < z) out.push({ text: body.slice(a, z), math: false, mark: true });
    if (z < to) out.push({ text: body.slice(z, to), math: false, mark: false });
  };
  let last = 0;
  for (const m of body.matchAll(MATH)) {
    text(last, m.index!);
    out.push({ text: m[0], math: true, mark: false });
    last = m.index! + m[0].length;
  }
  text(last, body.length);
  return out;
}
```

- [ ] **Step 6: Point `MathText.tsx` at the shared regex.** Lines 8-11 (the comment and `const MATH = …`) become `import { MATH } from "./citationHighlight"; // one regex for splitting and rendering`. Line 5, `import katex from "katex";`, and the `export default` function stay unchanged.

- [ ] **Step 7: Implement the popover.** In `WatBotMessages.tsx`:
  1. Line 1 becomes `import { Fragment, lazy, Suspense, useState } from "react";`.
  2. Add `import { citationSegments } from "./citationHighlight";` after line 8.
  3. Replace `CitationChip` (lines 79-102) with:

```tsx
function CitationChip({ c, saved }: { c: WatBotCitation; saved: boolean }) {
  const [open, setOpen] = useState(false);
  // WQF-A5: a saved answer opens straight to its page. retry:false — passages 404 until the
  // answer is saved (D23), so an unsaved one never asks and shows the cited text alone.
  const { data: passage, isError } = useGetWatBotPassage(c.passageId, { query: { queryKey: getGetWatBotPassageQueryKey(c.passageId), enabled: open && saved, retry: false } });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Source: ${c.label}`} data-testid="watbot-citation-chip"
          className="inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 align-middle font-mono text-[11px]">
          <BookOpen className="size-2.5" aria-hidden="true" />{c.label}
        </button>
      </PopoverTrigger>
      {/* Portaled + collision-aware (Radix), so the panel's overflow-y-auto can't clip it. */}
      <PopoverContent aria-label={`Source ${c.label}`} collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-16px)] overflow-y-auto p-3 text-xs">
        {/* One view: the page with the cited span marked (formulas never marked); the cited text alone until it loads. */}
        <span tabIndex={0} data-testid="watbot-source" className="block max-h-48 overflow-auto whitespace-pre-wrap">
          {passage
            ? citationSegments(passage.body, c.citedText).map((s, i) => (
              <Fragment key={i}>{s.math ? withMath(s.text) : s.mark ? <mark className="bg-warning-bg">{s.text}</mark> : s.text}</Fragment>
            ))
            : withMath(c.citedText)}
        </span>
        {isError && <p role="alert" className="mt-2 text-danger">Source unavailable</p>}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 8: Run the Step 4 commands again.** Expected: all PASS. Then run the whole spec: `E2E_BASE_URL=http://localhost:5151 pnpm exec playwright test e2e/watbot.spec.ts` (from `artifacts/studio`). Expected: all pass.

- [ ] **Step 9: Non-vacuity, remove → red → restore (requirement 3).** From `/Users/shubhamkr/nos-wqf-a5/artifacts/studio`:

```bash
F=src/components/workspace/watbot/WatBotMessages.tsx
cp $F /tmp/wqf-a5-WatBotMessages.tsx
perl -pi -e 's/<mark className="bg-warning-bg">\{s\.text\}<\/mark>/<>{s.text}<\/>/' $F
E2E_BASE_URL=http://localhost:5151 pnpm exec playwright test e2e/watbot.spec.ts --grep "highlighted once|unhighlighted"   # expect 2 FAILED (no mark)
cp /tmp/wqf-a5-WatBotMessages.tsx $F
perl -pi -e 's/block max-h-48 overflow-auto whitespace-pre-wrap/block overflow-auto whitespace-pre-wrap/' $F
E2E_BASE_URL=http://localhost:5151 pnpm exec playwright test e2e/watbot.spec.ts --grep "long citation"   # expect FAILED: max-height "none"
cp /tmp/wqf-a5-WatBotMessages.tsx $F && rm /tmp/wqf-a5-WatBotMessages.tsx
git diff --stat -- $F   # must show only this task's real change
E2E_BASE_URL=http://localhost:5151 pnpm exec playwright test e2e/watbot.spec.ts   # all pass again
```

  If either removal stays green, the assertion cannot fail. Fix the assertion before going on.

- [ ] **Step 10: Sibling-spec sweep (root Gotchas).**
  ```bash
  grep -rn -e "Open full source" -e "Full page text" -e "Loading…" artifacts/studio/e2e artifacts/studio/src/__tests__ | grep -iv "scenario\|model"
  ```
  Expected: no WatBot hit. Then `pnpm --filter studio run typecheck:e2e`. Expected: exit 0.

- [ ] **Step 11: Gate the task.**
  1. `pnpm run typecheck`.
  2. Check that zero vitest processes are running.
  3. `pnpm --filter studio test`.

  Expected: all pass, or only registered flakes that pass twice in isolation. Stop both servers.

- [ ] **Step 12: Changelog.** Append:

```markdown
### WQF-A5 — citation popover shows the formatted page, once

- **Studio:** a saved answer's chip opens straight to `GET /watbot/passages/:id`, rendered as the old full source (paragraphs, KaTeX, `max-h-48` + scroll). The cited text is marked inside it when it is a shorter sub-span: first exact match once whitespace runs are collapsed in both, no fuzzy match; whole-body or not-found → page with no mark, never the separate quote. Formulas are split out first (`citationSegments`, new `citationHighlight.ts`, which now also owns the `MATH` regex `MathText` uses), so a formula inside the range renders whole and unmarked. While loading, and for an unsaved answer (D23), the cited text shows alone with the same formatting; "Source unavailable" stays for a failed load, under the cited text (plan P5). "Open full source" and "Loading…" are gone.
- **Tests:** `citationHighlight.test.ts` (6), `WatBotMessages.test.tsx` rewritten (<n> tests), `e2e/watbot.spec.ts`: 3 rewritten real-browser tests (highlight paint and `pre-wrap`; formula unmarked inside the span with KaTeX CSS and font; 192 px cap + scroll + popover in a 600 px viewport). All red first; non-vacuity checked by removing the `<mark>` and the `max-h-48` (each went red), then restored.
- **Gate:** <counts>.
```

- [ ] **Step 13: Commit.** Use the WQF-A1 Step 13 commands, with:
  - worktree `/Users/shubhamkr/nos-wqf-a5`;
  - `P=(artifacts/studio/src/components/workspace/watbot/citationHighlight.ts artifacts/studio/src/components/workspace/watbot/MathText.tsx artifacts/studio/src/components/workspace/watbot/WatBotMessages.tsx artifacts/studio/src/__tests__/citationHighlight.test.ts artifacts/studio/src/__tests__/WatBotMessages.test.tsx artifacts/studio/e2e/watbot.spec.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A5] open citations to the formatted page with the cited text highlighted`.

---

### Task WQF-A6: WatBot icon in the toolbar and the panel header

**Role:** `frontend-engineer`. This task hands it `artifacts/studio/e2e/watbot.spec.ts`.

**Files:**
- Create: `artifacts/studio/src/assets/watbot-icon.svg` (copied from `/Users/shubhamkr/Downloads/WatBot icon.svg`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:53,4689`
- Modify: `artifacts/studio/src/components/workspace/watbot/WatBotPanel.tsx:1-6,45`
- Test: `artifacts/studio/src/__tests__/WatBotPanel.test.tsx`, `artifacts/studio/src/__tests__/Workspace.test.tsx:306-315`, `artifacts/studio/e2e/watbot.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: none.
- Produces: an `<img alt="">` inside `[data-testid=button-watbot]` (16×16) and inside the WatBot panel's `<header>` (14×14). The button's accessible name stays `WatBot`, or `WatBot unavailable` with the dot.

- [ ] **Step 0: Skills.** Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Start the servers on ports 3161/5161.

- [ ] **Step 1: Copy and check the asset.** The owner confirmed the rights; no credit is needed.

```bash
cd /Users/shubhamkr/nos-wqf-a6
cp "/Users/shubhamkr/Downloads/WatBot icon.svg" artifacts/studio/src/assets/watbot-icon.svg
grep -c -i -E '<script|<foreignObject|\son[a-z]+=|(xlink:)?href="(https?:)?//' artifacts/studio/src/assets/watbot-icon.svg   # expect 0
head -2 artifacts/studio/src/assets/watbot-icon.svg   # expect the 512×512 viewBox line
```

  If the count is not 0, STOP and report.

- [ ] **Step 2: Write the failing tests.**
  1. In `WatBotPanel.test.tsx`, add inside the `describe`:

```tsx
  it("shows the WatBot icon beside the name, decorative, at 14 px (WQF-A6)", () => {
    renderPanel();
    const icon = screen.getByRole("complementary", { name: "WatBot" }).querySelector("header img")!;
    expect(icon).toHaveAttribute("alt", "");
    expect(icon).toHaveAttribute("width", "14");
    expect(icon.getAttribute("src")).toMatch(/watbot-icon\.svg|^data:image\/svg\+xml/);
    expect(icon.nextElementSibling).toHaveTextContent("WatBot");
  });
```

  2. In `Workspace.test.tsx`, inside `it("button-watbot opens and closes the docked panel", …)`, after `const btn = screen.getByTestId("button-watbot");` (line 308), add:

```tsx
    // WQF-A6: a decorative 16 px icon; the button's name stays "WatBot".
    expect(btn.querySelector("img")).toHaveAttribute("alt", "");
    expect(btn.querySelector("img")).toHaveAttribute("width", "16");
    expect(screen.getByRole("button", { name: "WatBot" })).toBe(btn);
```

  3. In `e2e/watbot.spec.ts`:
     - Line 12 becomes `import { test, expect, type Page, type Locator } from "./fixtures";`.
     - Add after the test `"WatBot: unavailable state shows the toolbar dot"`:

```ts
// WQF-A6: the icon renders beside the name, 16 px in the toolbar and 14 px in the panel header.
// Real browser only: jsdom loads no image and lays nothing out.
test("WatBot: the icon renders beside the name in the toolbar and the panel header", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "icon");
  await stubWatBot(page);
  await page.goto("/chapter-3");
  const button = page.getByTestId("button-watbot");
  await expect(button).toHaveAccessibleName("WatBot", { timeout: T }); // alt="" leaves the name to the text
  const loaded = (img: Locator) => img.evaluate((el) => ((el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0));
  const toolbarIcon = button.locator('img[alt=""]');
  await expect.poll(() => loaded(toolbarIcon), { timeout: T }).toBeGreaterThan(0);
  const tb = (await toolbarIcon.boundingBox())!;
  const bb = (await button.boundingBox())!;
  expect([Math.round(tb.width), Math.round(tb.height)]).toEqual([16, 16]);
  expect(tb.x).toBeGreaterThanOrEqual(bb.x);
  expect(Math.abs(tb.y + tb.height / 2 - (bb.y + bb.height / 2))).toBeLessThanOrEqual(1); // vertically centred beside the text
  await button.click({ timeout: T });
  const headerIcon = page.getByTestId("watbot-panel").locator('header img[alt=""]');
  await expect.poll(() => loaded(headerIcon), { timeout: T }).toBeGreaterThan(0);
  const hb = (await headerIcon.boundingBox())!;
  expect([Math.round(hb.width), Math.round(hb.height)]).toEqual([14, 14]);
  await page.getByTestId("watbot-panel").locator("header").screenshot({ path: test.info().outputPath("watbot-icon-header.png") });
});
```

- [ ] **Step 3: Run them and confirm they fail.**
  1. `pnpm --filter studio exec vitest run src/__tests__/WatBotPanel.test.tsx src/__tests__/Workspace.test.tsx`. Expected: the two new assertions FAIL because there is no `img`.
  2. From `artifacts/studio`: `E2E_BASE_URL=http://localhost:5161 pnpm exec playwright test e2e/watbot.spec.ts --grep "icon renders"`. Expected: FAIL at the `loaded` poll, because there is no `img`.

- [ ] **Step 4: Implement the toolbar.** In `Workspace.tsx`:
  1. After line 53 (`import { WatBotHistory } from "@/components/workspace/watbot/WatBotHistory";`), add `import watbotIconUrl from "@/assets/watbot-icon.svg";`.
  2. Line 4689, `              WatBot{watbotStatus && !watbotStatus.available && <span aria-label="unavailable" className="ml-1.5 inline-block size-2 rounded-full bg-warning" />}`, becomes:

```tsx
              <img src={watbotIconUrl} alt="" width={16} height={16} className="size-4" />
              WatBot{watbotStatus && !watbotStatus.available && <span aria-label="unavailable" className="ml-1.5 inline-block size-2 rounded-full bg-warning" />}
```

  The `Button` is already `inline-flex items-center gap-2` (`components/ui/button.tsx:8`). The unavailable dot is kept.

- [ ] **Step 5: Implement the header.** In `WatBotPanel.tsx`:
  1. After line 6 (`import { WatBotStarters } from "./WatBotStarters";`), add `import watbotIconUrl from "@/assets/watbot-icon.svg";`.
  2. Line 45, `        <span aria-hidden="true" className="size-3.5 rounded-sm bg-primary" />`, becomes `        <img src={watbotIconUrl} alt="" width={14} height={14} className="size-3.5" />`.

- [ ] **Step 6: Run the Step 3 commands again.** Expected: PASS. Then run the whole spec: `E2E_BASE_URL=http://localhost:5161 pnpm exec playwright test e2e/watbot.spec.ts`. Expected: all pass, including `"unavailable state shows the toolbar dot"`.

- [ ] **Step 7: Non-vacuity, remove → red → restore.** From `/Users/shubhamkr/nos-wqf-a6/artifacts/studio`:

```bash
for F in src/pages/Workspace.tsx src/components/workspace/watbot/WatBotPanel.tsx; do cp $F /tmp/wqf-a6-$(basename $F); done
perl -pi -e 's/^\s*<img src=\{watbotIconUrl\} alt="" width=\{16\} height=\{16\} className="size-4" \/>\n//' src/pages/Workspace.tsx
E2E_BASE_URL=http://localhost:5161 pnpm exec playwright test e2e/watbot.spec.ts --grep "icon renders"   # expect FAILED (toolbar)
cp /tmp/wqf-a6-Workspace.tsx src/pages/Workspace.tsx
perl -pi -e 's/<img src=\{watbotIconUrl\} alt="" width=\{14\} height=\{14\} className="size-3.5" \/>//' src/components/workspace/watbot/WatBotPanel.tsx
E2E_BASE_URL=http://localhost:5161 pnpm exec playwright test e2e/watbot.spec.ts --grep "icon renders"   # expect FAILED (header)
cp /tmp/wqf-a6-WatBotPanel.tsx src/components/workspace/watbot/WatBotPanel.tsx && rm /tmp/wqf-a6-*.tsx
E2E_BASE_URL=http://localhost:5161 pnpm exec playwright test e2e/watbot.spec.ts --grep "icon renders"   # passes again
```

- [ ] **Step 8: Sibling-spec sweep.** Look for any spec that reads the button by exact text or by its first child:
  ```bash
  grep -rn -e 'button-watbot' -e 'name: "WatBot"' artifacts/studio/e2e artifacts/studio/src/__tests__
  ```
  Expected: every hit uses the test id, `aria-pressed`, the unavailable label or `toHaveAccessibleName`. None reads `textContent` exactly, and none relies on child order. Rewrite any that does, in this commit. Then `pnpm --filter studio run typecheck:e2e`.

- [ ] **Step 9: Gate the task.**
  1. `pnpm run typecheck`.
  2. Check that zero vitest processes are running.
  3. `pnpm --filter studio test`.

  Stop both servers.

- [ ] **Step 10: Changelog.** Append:

```markdown
### WQF-A6 — WatBot icon

- **Studio:** the owner's SVG (512×512, green gradient robot; checked: no script, event handler, foreignObject or external href; owner confirmed rights, no credit) at `src/assets/watbot-icon.svg`, rendered as `<img alt="">` beside "WatBot": 16 px on the toolbar button (unavailable dot kept), 14 px in the panel header in place of the placeholder square.
- **Tests:** RTL `WatBotPanel` / `Workspace` (alt, size, accessible name unchanged); e2e `"the icon renders beside the name…"`: image loaded, 16×16 and vertically centred in the button, 14×14 in the header. Red first; non-vacuity by removing each `<img>` (each went red), then restored.
- **Gate:** <counts>.
```

- [ ] **Step 11: Commit.** Use the WQF-A1 Step 13 commands, with:
  - worktree `/Users/shubhamkr/nos-wqf-a6`;
  - `P=(artifacts/studio/src/assets/watbot-icon.svg artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/components/workspace/watbot/WatBotPanel.tsx artifacts/studio/src/__tests__/WatBotPanel.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/e2e/watbot.spec.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A6] add the WatBot icon to the toolbar button and panel header`.

---

### Task WQF-A7: Paid test-set run (GATED: owner spend approval)

**Role:** the lead. **Never automatic.** This step spends real money and needs its own explicit owner "yes" for this run. Approval for merge, push or deploy is not spend approval.

**Files:**
- Modify: `docs/CHANGELOG-implementation.md` (results only)

**Interfaces:**
- Consumes:
  - WQF-A1: the `valuesBlocked` column.
  - WQF-A2/A3: engine and prompt behaviour.
  - WQF-A4: the prompt rule and the `Unseparated 4+-digit numbers` line.

- [ ] **Step 1: Preconditions.**
  1. `git log --oneline main..wqf-a | grep -c "\[WQF-A[1-4]\]"`. Expected: `4`.
  2. Cut `git worktree add --lock /Users/shubhamkr/nos-wqf-a7 -b wqf-a7-work $(git rev-parse wqf-a)`, then run `pnpm install --frozen-lockfile` in it.
  3. `psql "postgresql://shubhamkr@localhost:5432/nos_dev" -tAc "select count(*) from course_passages"`. Expected: a non-zero count; the bundle and search read the corpus from here.
  4. `ls artifacts/api-server/src/watbot/eval/answerKeys.json`. Expected: present.

- [ ] **Step 2: STOP. Ask the owner for spend approval for this one run.** Quote:
  - the spec's estimate (≈ $0.41);
  - the last measured full run, `$0.4127` (WATBOT-REPLY-ENDINGS, 2026-11-23, `docs/CHANGELOG-implementation.md`);
  - what it measures: leaks against the unchanged bars, `claimRemoved`, the new `valuesBlocked`, off-topic empty replies, and the unseparated-number count.

  Also state that nos-api does not ship the `SYSTEM_PROMPT` change without a passing run, unless the owner explicitly accepts that. Wait for an explicit yes.

- [ ] **Step 3: Run it** (only after the yes). Read the key from the keychain inside the command; it is never echoed or stored:

```bash
cd /Users/shubhamkr/nos-wqf-a7 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" ANTHROPIC_API_KEY="$(/usr/bin/security find-generic-password -s nos-dev-anthropic -w)" pnpm --filter api-server watbot-test-set run --confirm-spend
```

  Expected: exit 0, meaning every bucket is at or under its leak bar. The output includes the per-type table (with `claimRemoved`, `valuesBlocked` and `emptyReply`), the `Unseparated 4+-digit numbers: …` line and `TOTAL costUsd …`. On `401 invalid x-api-key`, STOP and tell the owner (precedent 2026-11-23). On `BAR MISSED`, STOP: the change does not ship. Tighten the prompt on the branch, as a new task commit, and ask for a new paid run.

- [ ] **Step 4: STOP. Show the owner the columns on a Lavish page** (memory: Lavish for manual review): `claimRemoved` vs `valuesBlocked` per type, off-topic `emptyReply`, and the unseparated count. None of these has a bar. The owner decides whether they are acceptable before ship. Never call a high empty-reply or drop rate a pass on your own.

- [ ] **Step 5: Changelog and commit.** Append `### WQF-A7 — paid test-set run` with:
  - the per-type table: type, n, leaks, bar, agreement, claimRemoved, valuesBlocked, emptyReply, costUsd;
  - the unseparated-number line;
  - the exit code;
  - `TOTAL costUsd` quoted from the output;
  - the owner's decision from Step 4, with its date.

  Write counts and rates only, never a reply text or a number from a reply (PRIV-1). Then commit with:
  - worktree `/Users/shubhamkr/nos-wqf-a7`;
  - `P=(docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A7] record the paid test-set run`.

  If the owner declines the run, record that decision instead under the same heading. The deploy request must then say the prompt change ships unmeasured.

---

### Task WQF-A8: Real-browser QA (qa-sdet)

**Role:** `qa-sdet` (no karpathy/ponytail), reviewed by a separate `fable`-model reviewer agent. Ports 3181/5181.

**Files:**
- Create: `artifacts/studio/e2e/watbot-qf-a.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes:
  - the `watbot-source` test id, `<mark>` highlighting and the "Source unavailable" alert from WQF-A5;
  - the header and toolbar `img[alt=""]` from WQF-A6;
  - `stubWatBot`-style stubbing, as in `watbot.spec.ts`.

- [ ] **Step 1: Write `e2e/watbot-qf-a.spec.ts`.** Stub every WatBot endpoint with `page.route` exactly as `watbot.spec.ts:39-53` does, so no spend is possible. Use made-up passage text only. Cover:
  1. **Dark theme** (`page.emulateMedia({ colorScheme: "dark" })`):
     - the highlight's computed `background-color` differs from the source box's own background;
     - both icons load (`naturalWidth > 0`) at 16 and 14 px.
  2. **Keyboard:**
     - Tab to a citation chip and press Enter; the popover opens to the page;
     - Tab moves focus into `watbot-source` (`tabIndex=0`);
     - `PageDown` scrolls it (`scrollTop` increases on a long page);
     - Escape closes the popover and focus returns to the chip.
  3. **Loading, then page:** hold the `passages/11` route on a promise. While it is held, the box shows the cited text and there is no `mark`. After `fulfill`, the page shows, with the `mark`.
  4. **Failed load:** `passages/11` returns 500. The alert `Source unavailable` shows, and the cited text stays visible above it.

  Bound every interaction after a dialog opens with an explicit `{ timeout }` (`e2e/CLAUDE.md`).

- [ ] **Step 2: Run it twice, green both times.** From `artifacts/studio`: `E2E_BASE_URL=http://localhost:5181 pnpm exec playwright test e2e/watbot-qf-a.spec.ts --repeat-each 2`. Also run `watbot.spec.ts` twice, the same way. A failure is a defect: report it to the lead, who fixes it on the branch as a new commit before merge. Do not loosen an assertion to pass.

- [ ] **Step 3: Optional paid live check (GATED: separate owner spend approval, about $0.01).** This proves the A1 log line and the A3 `NO_CONTEXT` path through the real local API.
  1. Ask the lead to get the owner's yes. Then start the local API with `ANTHROPIC_API_KEY="$(/usr/bin/security find-generic-password -s nos-dev-anthropic -w)"` inline.
  2. Ask one question with only a tab open (no scenario selected) and one off-topic question.
  3. Confirm that the API log shows `WatBot: answer saved` with only `claimsRemoved`/`valuesBlocked`.
  4. Confirm that the tab-only answer does not describe "your map".

  Record quoted counts and the observed cost only. Skip this step if not approved, and say so.

- [ ] **Step 4: Changelog and commit.** Append `### WQF-A8 — real-browser QA`, listing what was covered, each run's pass count copied from the output, and any defects found and where they were fixed. Then commit with:
  - worktree `/Users/shubhamkr/nos-wqf-a8`;
  - `P=(artifacts/studio/e2e/watbot-qf-a.spec.ts docs/CHANGELOG-implementation.md)`;
  - message `[WQF-A8] add real-browser QA for the citation popover and icon`.

  Then `pnpm --filter studio run typecheck:e2e`.

---

### Task WQF-A9: Close-out (lead). Every arrow below is a STOP for its own approval

- [ ] **Step 1: Full gate on the `wqf-a` tip.** Cut `git worktree add --lock --detach /Users/shubhamkr/nos-wqf-a-close wqf-a`, then run `pnpm install --frozen-lockfile`. Check that zero vitest processes are running. Then:
  ```bash
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm gate
  ```
  - Exit 0: green.
  - Exit 3: a vitest timeout. That measures load, so re-run serially with zero concurrent vitest.
  - Exit 1: a real failure. Match it by name in the flake registry, then re-run it twice in isolation.

  `e2e_accuracy.py`/`e2e_journey.py` are not required: there is no solver change (hard rule #2 is unaffected).

- [ ] **Step 2: Sibling-spec sweep over the whole branch.**
  ```bash
  git diff main...wqf-a --stat
  grep -rn -e "Open full source" -e "One claim was removed" -e "Full page text" artifacts/studio/e2e artifacts/studio/src artifacts/api-server/src
  ```
  Expected: no hits. Then `grep -rln "watbot-citation-chip\|button-watbot\|Source Ch " artifacts/studio/e2e` and confirm that every listed spec passed in Step 3.

- [ ] **Step 3: e2e gate, local.** Start the two servers from the close-out worktree on ports 3191/5191, then:
  ```bash
  cd /Users/shubhamkr/nos-wqf-a-close && E2E_BASE_URL=http://localhost:5191 pnpm e2e:gate
  ```
  Expected: all pass. A failure is first matched by name against `docs/superpowers/flake-registry.md` and re-run twice in isolation. `design-upgrade-p5.spec.ts` needs network to `tile.openstreetmap.org`. Record the totals. Stop the servers.

- [ ] **Step 4: `superpowers:finishing-a-development-branch`.** Then **STOP for merge approval.** The request quotes:
  - the gate and e2e totals;
  - the WQF-A7 status (passed, or declined by the owner);
  - the A8 results.

- [ ] **Step 5: On merge approval only.**
  1. Run `git fetch origin`, then `git merge-base --is-ancestor origin/main main`. If local `main` is stale, stop and reconcile.
  2. Merge `wqf-a` into local `main` with `git merge --no-ff wqf-a`, in whichever checkout holds `main`. If none does: `git worktree add /Users/shubhamkr/nos-wqf-a-merge main`. Assert `git rev-parse --abbrev-ref HEAD` prints `main` before merging, as a separate command and not piped.
  3. On a `docs/CHANGELOG-implementation.md` tail conflict, keep main's text verbatim, followed by this branch's section.

- [ ] **Step 6: Whole-branch review on the merged state.** Dispatch an Opus reviewer (`model: opus`) plus `ponytail:ponytail-review` over `main` vs its pre-merge parent. Give the reviewer the code and the spec, not this plan's conclusions. Findings go back on `wqf-a` as new commits (Step 5a: `git switch wqf-a` before committing), then re-gate and re-merge.

- [ ] **Step 7: `/harness-retro WQF-A`.**

- [ ] **Step 8: STOP for push approval.** Say that a push is deploy-adjacent: `nos-api` has `autoDeployTrigger: commit`, and `nos-studio` can deploy on push. On approval, make the push conditional on a clean PRIV-1 scan:
  ```bash
  if git log origin/main..main -p | grep -i -E '@gmail|srv-[a-z0-9]{8,}|dpg-[a-z0-9]{8,}|([0-9]{1,3}\.){3}[0-9]{1,3}'; then echo "PRIV-1 hit — push refused"; else git push origin main; fi
  ```
  Then check `mcp__render__list_deploys` for both services.

- [ ] **Step 9: STOP for deploy approval.** Invoke the `render-ops` skill first. The request includes:
  - the checklist from `pnpm deploy:preflight -- <deployed-sha>..HEAD`, for each service's deployed sha;
  - `git diff --stat <nos-api deployed-sha>..HEAD -- lib/db/src/schema/`, which is expected empty (no schema change in Part A);
  - the A7 status.

  **Order: nos-api first, then nos-studio.** Before each `trigger_deploy`, re-fetch `origin/main`, because Render builds the tip. After nos-api: `/api/healthz` returns 200 and the first minute of logs has no `warn`/`error`. After nos-studio: the toolbar icon and a citation popover look right on the live site, checked without asking a paid question. Record the deploy on a new branch (`wqf-a-deploy`) in the changelog, through the same pipeline.

- [ ] **Step 10: Worktree retirement.** This needs its own approval:
  - read-only proof first: `git cherry main wqf-a<N>-work` shows no `+` lines, the status is clean, and the exact path is validated;
  - then `git worktree unlock` and `git worktree remove <exact path>` for each `nos-wqf-a*`.

  Never `rm -rf`. `git branch -D` needs a second approval.

---

## Self-review (done at plan time)

- **Spec coverage.** Each Part A item maps to a task:
  - A1 (two counters, log, runner columns, one notice and its text) → WQF-A1.
  - A2 (one block, ≤ 25 words, later blocks dropped, value check kept, no buffering) → WQF-A2.
  - A3 (`NO_CONTEXT` for tab-only, both paths, in `buildRequest`) → WQF-A3.
  - A4 (prompt rule; no value-check change, proven by a test) → WQF-A4.
  - A5 (direct to page, loading and unsaved fallback, "Source unavailable", collapsed-whitespace first exact match, whole/not-found unmarked, formulas split and unmarked) → WQF-A5.
  - A6 (asset, `<img alt="">`, 16/14 px, dot kept, placeholder replaced) → WQF-A6.
  - A7 (paid run, own approval, per-type report with the new count) → WQF-A7.
  - Testing: every item has a test that is red first; A5 height and highlight and A6 icon have real-browser assertions with non-vacuity steps; full gate and e2e gate with `E2E_BASE_URL` before merge → WQF-A9.
- **Placeholder scan.** The only `<…>` fields are changelog counts, which must be copied from the run in that session (repo rule: never fabricate; `unknown` otherwise).
- **Type consistency.** These names are used identically across all tasks: `valuesBlocked`, `valueBlockedRate`, `CLAIM_REMOVED_NOTICE`, `MAX_DECLINE_WORDS`, `wordCount`, `unseparatedNumbers`, `citationSegments`, `Segment`, `MATH`, `watbot-source`, `watbotIconUrl`.
