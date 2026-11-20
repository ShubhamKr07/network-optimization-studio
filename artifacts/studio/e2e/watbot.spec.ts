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

const STATUS_OK = { available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false };

async function stubWatBot(page: Page, opts: { messagesBody?: string } = {}) {
  await page.route("**/api/watbot/status", (r) => r.fulfill({ json: STATUS_OK }));
  await page.route("**/api/watbot/conversations**", (r) =>
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
  await page.route("**/api/watbot/reports", (r) => r.fulfill({ status: 201, body: "" }));
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

test("WatBot: history lists past conversations for the chapter", async ({ page }) => {
  test.setTimeout(90_000);
  await registerFreshAccount(page, "hist");
  await stubWatBot(page);
  await page.route("**/api/watbot/conversations**", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 201, json: { id: 77, modelId: "p-median-us", title: "New conversation", updatedAt: new Date().toISOString() } })
      : r.fulfill({ json: [{ id: 5, modelId: "p-median-us", title: "Earlier question about p", updatedAt: new Date().toISOString() }] }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: "Conversation history" }).click({ timeout: T });
  await expect(panel.getByTestId("watbot-history")).toContainText("Earlier question about p", { timeout: T });
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
