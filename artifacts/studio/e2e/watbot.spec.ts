/**
 * WatBot panel e2e journey (WATBOT-9). The WatBot API is fully stubbed with
 * page.route: the SSE answer stream and the JSON endpoints return seeded
 * responses, so no live model call happens and no spend is possible.
 *
 * Event shapes mirror artifacts/api-server/src/routes/watbot.ts:
 *   queued {position} | searching {query} | block {text, citations}
 *   notice {kind} | done {messageId} | error {code}
 *
 * Target: E2E_BASE_URL (local two-server recipe in e2e/CLAUDE.md).
 */
import { test, expect, type Page } from "./fixtures";

const T = 10_000;

async function registerFreshAccount(page: Page, tag: string) {
  const email = `e2e-watbot-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(res.status()).toBe(201);
}

const sseEvent = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const ANSWER_SSE = [
  sseEvent("searching", { query: "Chapter 3" }),
  sseEvent("block", {
    text: "The objective weights each distance by demand",
    citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "Minimize demand-weighted distance." }],
  }),
  sseEvent("done", { messageId: 901 }),
].join("");

const CONVERSATIONS_LIST = /\/api\/watbot\/conversations(\?.*)?$/;

const FIXED_Q = "What decision is this model making, and what is it trying to minimize?";

const STATUS_OK = { available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false };

async function stubWatBot(page: Page, opts: { messagesBody?: string } = {}) {
  await page.route("**/api/watbot/status", (r) => r.fulfill({ json: STATUS_OK }));
  // List/create path only (plus its query string); sub-paths get their own exact routes.
  await page.route(CONVERSATIONS_LIST, (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 201, json: { id: 77, modelId: "p-median-us", title: "New conversation", updatedAt: new Date().toISOString() } })
      : r.fulfill({ json: [] }),
  );
  await page.route("**/api/watbot/conversations/77/messages", (r) =>
    r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: opts.messagesBody ?? ANSWER_SSE }),
  );
  await page.route("**/api/watbot/passages/11", (r) =>
    r.fulfill({ json: { id: 11, label: "Ch 3 · p.38", body: "Full page text for p.38." } }),
  );
}

async function openPanel(page: Page) {
  await page.goto("/chapter-3");
  await page.getByTestId("button-watbot").click({ timeout: T });
  const panel = page.getByTestId("watbot-panel");
  await expect(panel).toBeVisible({ timeout: T });
  return panel;
}

test("WatBot: open from toolbar, ask a fixed question, read a citation, report", async ({ page }) => {
  test.setTimeout(90_000);
  await registerFreshAccount(page, "journey");
  await stubWatBot(page);
  const askRequests: unknown[] = [];
  await page.route("**/api/watbot/conversations/77/messages", async (r) => {
    askRequests.push(r.request().postDataJSON());
    await r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: ANSWER_SSE });
  });
  const reportRequests: unknown[] = [];
  await page.route("**/api/watbot/reports", async (r) => {
    reportRequests.push(r.request().postDataJSON());
    await r.fulfill({ status: 201, body: "" });
  });

  const panel = await openPanel(page);
  await expect(page.getByRole("complementary", { name: "WatBot" })).toBeVisible();
  await expect(page.getByTestId("button-watbot")).toHaveAttribute("aria-pressed", "true");

  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  const messages = panel.getByTestId("watbot-messages");
  await expect(messages.locator('[data-role="student"]')).toContainText("What decision is this model making", { timeout: T });
  await expect(messages.locator('[data-role="tutor"]')).toContainText("The objective weights each distance by demand", { timeout: T });
  // Fresh account, no scenario: no context chip, so the client sends context: null.
  expect(askRequests).toEqual([{ question: FIXED_Q, context: null }]);

  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  await expect(page.getByRole("dialog", { name: "Source Ch 3 · p.38" })).toContainText("Minimize demand-weighted distance.", { timeout: T });

  await panel.getByRole("button", { name: "Report this answer" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-report-form")).toBeVisible({ timeout: T });
  await panel.getByRole("button", { name: "Send report" }).click({ timeout: T });
  await expect(panel.getByText("Thanks — reported. Your conversation continues.")).toBeVisible({ timeout: T });
  expect(reportRequests).toHaveLength(1);
  expect(reportRequests[0]).toMatchObject({ messageId: 901, reason: "wrong_or_misleading" });
});

// Regression (WATBOT-8b): the popover must stay clickable near the panel's left edge.
test("WatBot: 'Open full source' is reachable from the citation popover", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fullsrc");
  await stubWatBot(page);
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  // The popover is portaled out of the panel, so query the page.
  await page.getByRole("button", { name: "Open full source" }).click({ timeout: 5_000 });
  await expect(page.getByText("Full page text for p.38.")).toBeVisible({ timeout: 5_000 });
});

test("WatBot: unavailable state shows the toolbar dot", async ({ page }) => {
  await registerFreshAccount(page, "down");
  await stubWatBot(page);
  const unavailable = { ...STATUS_OK, available: false };
  await page.route("**/api/watbot/status", (r) => r.fulfill({ json: unavailable }));
  await page.goto("/chapter-3");
  await expect(page.getByTestId("button-watbot").getByLabel("unavailable")).toBeVisible({ timeout: T });
  await expect(page.getByTestId("button-watbot")).toBeDisabled();
});

test("WatBot: Stop ends an in-flight answer with an 'Answer stopped' notice", async ({ page }) => {
  test.setTimeout(90_000);
  await registerFreshAccount(page, "stop");
  await stubWatBot(page);
  // The stream never completes until the client aborts.
  await page.route("**/api/watbot/conversations/77/messages", () => new Promise<void>(() => { /* hang */ }));

  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "Ask WatBot" }).fill("Why is p fixed?");
  await panel.getByRole("button", { name: "Send question" }).click({ timeout: T });
  await panel.getByRole("button", { name: "Stop generating" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-messages").locator('[data-role="notice"]')).toHaveText("Answer stopped", { timeout: T });
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0);
});

test("WatBot: a server error event surfaces the watbot-error alert", async ({ page }) => {
  test.setTimeout(90_000);
  await registerFreshAccount(page, "err");
  await stubWatBot(page, { messagesBody: sseEvent("error", { code: "watbot_failed" }) });

  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "Ask WatBot" }).fill("Anything?");
  await panel.getByRole("button", { name: "Send question" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-error")).toHaveText("Something went wrong. Try again.", { timeout: T });
});

test("WatBot: history lists past conversations for the chapter and loads one", async ({ page }) => {
  test.setTimeout(90_000);
  await registerFreshAccount(page, "hist");
  await stubWatBot(page);
  const listModelIds: (string | null)[] = [];
  const now = new Date().toISOString();
  await page.route(CONVERSATIONS_LIST, (r) => {
    if (r.request().method() === "POST") {
      return r.fulfill({ status: 201, json: { id: 77, modelId: "p-median-us", title: "New conversation", updatedAt: now } });
    }
    listModelIds.push(new URL(r.request().url()).searchParams.get("modelId"));
    return r.fulfill({ json: [{ id: 5, modelId: "p-median-us", title: "Earlier question about p", updatedAt: now }] });
  });
  await page.route("**/api/watbot/conversations/5", (r) =>
    r.fulfill({
      json: {
        id: 5, modelId: "p-median-us", title: "Earlier question about p", updatedAt: now,
        messages: [
          { id: 41, role: "student", blocks: [{ text: "Why is p fixed?", citations: [] }], createdAt: now },
          {
            id: 42, role: "tutor", createdAt: now,
            blocks: [{ text: "Because p is the number of warehouses you open", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "Minimize demand-weighted distance." }] }],
          },
        ],
      },
    }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: "Conversation history" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-history")).toContainText("Earlier question about p", { timeout: T });
  expect(listModelIds.length).toBeGreaterThan(0);
  expect(listModelIds.every((m) => m === "p-median-us")).toBe(true);

  await panel.getByTestId("watbot-history").getByRole("button", { name: /Earlier question about p/ }).click({ timeout: T });
  const messages = panel.getByTestId("watbot-messages");
  await expect(messages.locator('[data-role="student"]')).toHaveText("Why is p fixed?", { timeout: T });
  await expect(messages.locator('[data-role="tutor"]')).toContainText("Because p is the number of warehouses you open", { timeout: T });
  // The report affordance needs the tutor row id, so it proves the id survived the load mapping.
  await expect(panel.getByRole("button", { name: "Report this answer" })).toBeVisible({ timeout: T });
});

test("WatBot: narrow viewport collapses the model tree when the panel opens", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1200, height: 900 });
  await registerFreshAccount(page, "narrow");
  await stubWatBot(page);
  await page.goto("/chapter-3");
  await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false", { timeout: T });
  await page.getByTestId("button-watbot").click({ timeout: T });
  await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true", { timeout: T });
});

// ---- WATBOT-FB-7: answer feedback and re-answer (still fully stubbed, no spend) ----

const REPAIR_SSE = [
  sseEvent("block", { text: "Here is a plainer explanation of the objective", citations: [] }),
  sseEvent("done", { messageId: 902 }),
].join("");
// Real strings from REPAIR_LABELS in artifacts/api-server/src/watbot/prompt.ts (hard-coded on purpose: a drifted label must fail here).
const REASON_CASES = [
  { radio: "It kept asking me questions instead of explaining", reason: "too_many_questions", label: "↻ Explain with fewer questions" },
  { radio: "The explanation was hard to follow", reason: "hard_to_follow", label: "↻ Explain it step by step" },
  { radio: "It didn't answer what I asked", reason: "not_what_i_asked", label: "↻ That's not what I asked" },
] as const;
const RATING_Q = "Did this help you understand the topic?";

/** Stubs the messages route with a per-call body list and records each POST body. */
async function stubMessagesSequence(page: Page, bodies: string[]) {
  const posts: unknown[] = [];
  await page.route("**/api/watbot/conversations/77/messages", async (r) => {
    posts.push(r.request().postDataJSON());
    const body = bodies[Math.min(posts.length - 1, bodies.length - 1)]!;
    await r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body });
  });
  return posts;
}

async function stubFeedback(page: Page, reply: { id: number; repairLabel: string | null }) {
  const posts: unknown[] = [];
  await page.route("**/api/watbot/conversations/77/feedback", async (r) => {
    posts.push(r.request().postDataJSON());
    await r.fulfill({ status: 201, json: reply }); // routes/watbot.ts answers feedback with 201
  });
  return posts;
}

async function askFixed(panel: ReturnType<Page["getByTestId"]>) {
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-messages").locator('[data-role="tutor"]')).toContainText("The objective weights", { timeout: T });
  await expect(panel.getByTestId("watbot-feedback")).toBeVisible({ timeout: T });
}

test("WatBot feedback: ✓ stores helped and thanks the student", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-yes");
  await stubWatBot(page);
  const fbPosts = await stubFeedback(page, { id: 1, repairLabel: null });
  const msgPosts = await stubMessagesSequence(page, [ANSWER_SSE]);
  const panel = await openPanel(page);
  await askFixed(panel);
  await expect(panel.getByText(RATING_Q)).toBeVisible({ timeout: T });
  await panel.getByRole("button", { name: "Yes, this helped" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-messages").getByText("Thanks for the feedback.")).toBeVisible({ timeout: T });
  expect(fbPosts).toEqual([{ messageId: 901, helped: true }]);
  expect(msgPosts).toHaveLength(1);
  await expect(panel.getByTestId("watbot-feedback")).toHaveCount(0);
});

/** The rating line must be in its initial state: ✗ collapsed, no radios rendered. */
async function expectFreshRatingLine(panel: ReturnType<Page["getByTestId"]>) {
  const line = panel.getByTestId("watbot-feedback");
  await expect(line.getByRole("button", { name: "No, this didn't help" })).toHaveAttribute("aria-expanded", "false", { timeout: T });
  await expect(line.getByRole("radio")).toHaveCount(0);
}

for (const { radio, reason, label } of REASON_CASES) {
  test(`WatBot feedback: ✗ + "${radio}" posts ${reason}, then a repairOf re-answer with a fresh rating line`, async ({ page }) => {
    test.setTimeout(60_000);
    await registerFreshAccount(page, `fb-repair-${reason}`);
    await stubWatBot(page);
    const fbPosts = await stubFeedback(page, { id: 31, repairLabel: label });
    const msgPosts = await stubMessagesSequence(page, [ANSWER_SSE, REPAIR_SSE]);
    const panel = await openPanel(page);
    await askFixed(panel);
    await expectFreshRatingLine(panel);
    await panel.getByRole("button", { name: "No, this didn't help" }).click({ timeout: T });
    await panel.getByRole("radio", { name: radio, exact: true }).check({ timeout: T });
    await panel.getByRole("button", { name: "Send", exact: true }).click({ timeout: T });

    const messages = panel.getByTestId("watbot-messages");
    await expect(messages.locator('[data-role="student"]').last()).toHaveText(label, { timeout: T });
    await expect(messages.locator('[data-role="tutor"]').last()).toContainText("plainer explanation", { timeout: T });
    expect(fbPosts).toEqual([{ messageId: 901, helped: false, reason }]);
    expect(msgPosts).toHaveLength(2);
    expect(msgPosts[1]).toEqual({ question: label, context: null, repairOf: 31 });
    // A fresh rating line sits under the NEW answer (exactly one, and it is after the last tutor row).
    await expect(panel.getByTestId("watbot-feedback")).toHaveCount(1, { timeout: T });
    await expectFreshRatingLine(panel);
    const order = await messages.evaluate((el) => {
      const kids = Array.from(el.children);
      const fb = kids.findIndex((k) => k.getAttribute("data-testid") === "watbot-feedback");
      const lastTutor = kids.map((k) => k.getAttribute("data-role")).lastIndexOf("tutor");
      return { fb, lastTutor };
    });
    expect(order.fb).toBe(order.lastTutor + 1);
  });
}

test("WatBot feedback: Other with a note shows the rephrase notice and runs no re-answer", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-other");
  await stubWatBot(page);
  const fbPosts = await stubFeedback(page, { id: 32, repairLabel: null });
  const msgPosts = await stubMessagesSequence(page, [ANSWER_SSE]);
  const panel = await openPanel(page);
  await askFixed(panel);
  await expectFreshRatingLine(panel);
  const studentRows = await panel.getByTestId("watbot-messages").locator('[data-role="student"]').count();
  await panel.getByRole("button", { name: "No, this didn't help" }).click({ timeout: T });
  await panel.getByRole("radio", { name: "Other", exact: true }).check({ timeout: T });
  await panel.getByRole("textbox", { name: /What's still unclear/ }).fill("I don't get step 2");
  await panel.getByRole("button", { name: "Send", exact: true }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-messages").getByText("Try asking again in your own words, and say which step you're stuck on.")).toBeVisible({ timeout: T });
  expect(fbPosts).toEqual([{ messageId: 901, helped: false, reason: "other", note: "I don't get step 2" }]);
  // DOM-side negatives first (a re-answer would show Stop / a new student row); the POST count alone is timing-dependent.
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0);
  await expect(panel.getByTestId("watbot-messages").locator('[data-role="student"]')).toHaveCount(studentRows);
  expect(msgPosts).toHaveLength(1);
});

test("WatBot feedback: reason 4 (still stuck) shows the rephrase notice and runs no re-answer", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-stuck");
  await stubWatBot(page);
  const fbPosts = await stubFeedback(page, { id: 33, repairLabel: null });
  const msgPosts = await stubMessagesSequence(page, [ANSWER_SSE]);
  const panel = await openPanel(page);
  await askFixed(panel);
  const studentRows = await panel.getByTestId("watbot-messages").locator('[data-role="student"]').count();
  await panel.getByRole("button", { name: "No, this didn't help" }).click({ timeout: T });
  await panel.getByRole("radio", { name: "I still don't know how to do the exercise" }).check({ timeout: T });
  await panel.getByRole("button", { name: "Send", exact: true }).click({ timeout: T });
  await expect(panel.getByText("Try asking again in your own words")).toBeVisible({ timeout: T });
  expect(fbPosts).toEqual([{ messageId: 901, helped: false, reason: "still_stuck" }]);
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0);
  await expect(panel.getByTestId("watbot-messages").locator('[data-role="student"]')).toHaveCount(studentRows);
  expect(msgPosts).toHaveLength(1);
});

test("WatBot feedback: usable by keyboard alone (arrow keys through the radios, Enter on Send)", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-kbd");
  await stubWatBot(page);
  const fbPosts = await stubFeedback(page, { id: 34, repairLabel: null });
  await stubMessagesSequence(page, [ANSWER_SSE]);
  const panel = await openPanel(page);
  await askFixed(panel);
  // Reach the ✗ button with the keyboard, not a click.
  const no = panel.getByRole("button", { name: "No, this didn't help" });
  await no.focus();
  await expect(no).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(no).toHaveAttribute("aria-expanded", "true", { timeout: T });
  // Tab into the radio group (checked radio is the tab stop), then arrow to reason 2 then 3.
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("radio", { name: "It kept asking me questions instead of explaining" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(panel.getByRole("radio", { name: "The explanation was hard to follow" })).toBeChecked();
  // Skip to reason 4 (still stuck): its rephrase path needs no re-answer stub.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(panel.getByRole("radio", { name: "I still don't know how to do the exercise" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Try asking again in your own words")).toBeVisible({ timeout: T });
  expect(fbPosts).toEqual([{ messageId: 901, helped: false, reason: "still_stuck" }]);
});

// While Stop is visible the last item is the new student row, so the line is hidden by structure alone; this test
// does NOT cover the `!pending` guard itself (WatBotMessages.test.tsx does). It proves a new question hides the
// line and that it returns under the new answer.
test("WatBot feedback: a new question hides the line and it returns under the new answer", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-stream");
  await stubWatBot(page);
  await stubFeedback(page, { id: 35, repairLabel: null });
  // First ask completes; the second never finishes until released.
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  let n = 0;
  await page.route("**/api/watbot/conversations/77/messages", async (r) => {
    n++;
    if (n === 1) { await r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: ANSWER_SSE }); return; }
    await gate;
    await r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: REPAIR_SSE });
  });
  const panel = await openPanel(page);
  await askFixed(panel);
  await panel.getByRole("textbox", { name: "Ask WatBot" }).fill("Another question?");
  await panel.getByRole("button", { name: "Send question" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-stop")).toBeVisible({ timeout: T });
  await expect(panel.getByTestId("watbot-feedback")).toHaveCount(0);
  release();
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0, { timeout: T });
  await expect(panel.getByTestId("watbot-feedback")).toHaveCount(1, { timeout: T });
});

// Commit 57eb268d: the line belongs to the latest answer only and never falls back to an earlier one.
test("WatBot feedback: a stopped second answer leaves no rating line (never falls back to the earlier answer)", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-stopped");
  await stubWatBot(page);
  await stubFeedback(page, { id: 36, repairLabel: null });
  let n = 0;
  await page.route("**/api/watbot/conversations/77/messages", async (r) => {
    n++;
    if (n === 1) { await r.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: ANSWER_SSE }); return; }
    await new Promise<void>(() => { /* hang until the client aborts */ });
  });
  const panel = await openPanel(page);
  await askFixed(panel);
  await panel.getByRole("textbox", { name: "Ask WatBot" }).fill("Another question?");
  await panel.getByRole("button", { name: "Send question" }).click({ timeout: T });
  await panel.getByRole("button", { name: "Stop generating" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-messages").locator('[data-role="notice"]')).toHaveText("Answer stopped", { timeout: T });
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0);
  await expect(panel.getByTestId("watbot-feedback")).toHaveCount(0);
});

test("WatBot feedback: a second answer that errors with no blocks leaves no rating line", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fb-errored");
  await stubWatBot(page);
  await stubFeedback(page, { id: 37, repairLabel: null });
  await stubMessagesSequence(page, [ANSWER_SSE, sseEvent("error", { code: "watbot_failed" })]);
  const panel = await openPanel(page);
  await askFixed(panel);
  await panel.getByRole("textbox", { name: "Ask WatBot" }).fill("Another question?");
  await panel.getByRole("button", { name: "Send question" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-error")).toBeVisible({ timeout: T });
  await expect(panel.getByTestId("watbot-stop")).toHaveCount(0);
  await expect(panel.getByTestId("watbot-feedback")).toHaveCount(0);
});

// WATBOT-POPOVER-KATEX: corpus formulas ($$…$$ LaTeX) render as math in the popover, with KaTeX's
// CSS applied and its font loaded — jsdom cannot see either.
test("WatBot: citation popover renders $$ LaTeX as math", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "katex");
  const mathSse = [
    sseEvent("block", {
      text: "The objective sums cost over every assignment",
      citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "The objective is $$\\sum_{i} \\sum_{j} c_{ij} x_{ij}$$ for all pairs." }],
    }),
    sseEvent("done", { messageId: 902 }),
  ].join("");
  await stubWatBot(page, { messagesBody: mathSse });
  await page.route("**/api/watbot/passages/11", (r) =>
    r.fulfill({ json: { id: 11, label: "Ch 3 · p.38", body: "Page text $$\\frac{a}{b} \\le 1$$ continues." } }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  await page.getByRole("button", { name: "Open full source" }).click({ timeout: 5_000 });
  const popover = page.getByRole("dialog", { name: "Source Ch 3 · p.38" });
  await expect(popover.locator(".katex-html")).toHaveCount(2, { timeout: T });
  await expect(popover.locator(".katex-html").first()).toBeVisible();
  expect(await popover.innerText()).not.toContain("$$");
  // Both are false without katex.min.css: its rule positions .katex-mathml absolutely, and its
  // @font-face rules are the only source of a KaTeX_Main face. (document.fonts.check() is true
  // for any unknown family, so it cannot fail.)
  await expect(popover.locator(".katex-mathml").first()).toHaveCSS("position", "absolute");
  await expect.poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "KaTeX_Main" && f.status === "loaded")), { timeout: T }).toBe(true);
  await popover.screenshot({ path: test.info().outputPath("katex-popover.png") });
});

// WATBOT-POPOVER-INLINE-MATH: a whole-page citation stays on screen (it scrolls instead of running
// off the top), and single-$ inline math such as $\forall$ renders.
test("WatBot: a long citation popover stays inside the viewport and renders $\\cmd$ inline math", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 600 });
  await registerFreshAccount(page, "longcite");
  const longQuote = `For $\\forall$ j $\\in$ J the sum is one. ${"Every customer must be served by one site. ".repeat(60)}`;
  await stubWatBot(page, { messagesBody: [
    sseEvent("block", { text: "Each customer is served once", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: longQuote }] }),
    sseEvent("done", { messageId: 903 }),
  ].join("") });
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: /What decision is this model making/ }).click({ timeout: T });
  await panel.getByRole("button", { name: "Source: Ch 3 · p.38" }).click({ timeout: T });
  const popover = page.getByRole("dialog", { name: "Source Ch 3 · p.38" });
  await expect(popover.locator(".katex-html")).toHaveCount(2, { timeout: T });
  expect(await popover.locator("mark").innerText()).not.toContain("$\\forall$");
  const box = (await popover.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await expect(page.getByRole("button", { name: "Open full source" })).toBeInViewport();
  await popover.screenshot({ path: test.info().outputPath("long-citation.png") });
});
