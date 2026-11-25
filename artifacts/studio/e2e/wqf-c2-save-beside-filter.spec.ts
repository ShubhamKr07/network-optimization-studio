/**
 * WQF-C2 — Save sits beside Filter in the table toolbar (spec Part C2). Layout lives in CSS, so this is
 * a real-browser test (jsdom has no Tailwind). Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md).
 */
import { test, expect, type Page, type Locator } from "./fixtures";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;
const box = async (l: Locator) => (await l.boundingBox())!;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc2-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

async function openTab(page: Page, modelId: string, tab: string): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: `E2E WQF-C2 ${modelId}`, modelId, inputs: SOLVED_MODEL_INPUTS[modelId] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await page.getByTestId(`sidebar-input-${tab}`).click({ timeout: T });
  return id;
}

test("WQF-C2: on Chapter 5 Customers (313 rows) Save is the next control right of Filter, on the same line", async ({ page }) => {
  await register(page);
  const id = await openTab(page, "delivery-teaching-us", "customers");
  try {
    const toolbar = page.getByTestId("customers-tab-toolbar");
    const filter = toolbar.getByTestId("button-filter-menu-trigger");
    const save = toolbar.getByTestId("button-save");
    await expect(filter).toBeVisible({ timeout: 15_000 });
    await expect(save).toBeVisible({ timeout: T });
    await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
    const f = await box(filter);
    const s = await box(save);
    expect(Math.abs(f.y + f.height / 2 - (s.y + s.height / 2)), "same line").toBeLessThanOrEqual(4);
    const gap = s.x - (f.x + f.width);
    expect(gap, "Save starts right after Filter").toBeGreaterThanOrEqual(0);
    expect(gap, "no control between them").toBeLessThanOrEqual(16);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});

test("WQF-C2: on JADE Transportation Costs (2 rows, Filter hidden) Save takes Filter's place at the toolbar's right end, above the table", async ({ page }) => {
  await register(page);
  const id = await openTab(page, "two-echelon-jade-us", "transportCosts");
  try {
    const tab = page.getByTestId("transport-costs-tab");
    const save = tab.getByTestId("data-table-save-slot").getByTestId("button-save");
    await expect(save).toBeVisible({ timeout: 15_000 });
    await expect(tab.getByTestId("button-filter-menu-trigger")).toHaveCount(0);
    await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
    const s = await box(save);
    const head = await box(tab.locator("thead"));
    expect(s.y + s.height, "Save sits above the table").toBeLessThanOrEqual(head.y);
    // The slot's parent is the toolbar's right-aligned group; its parent is the toolbar row itself.
    const toolbarRight = await save.evaluate(el => el.closest('[data-testid="data-table-save-slot"]')!.parentElement!.parentElement!.getBoundingClientRect().right);
    expect(Math.abs(s.x + s.width - toolbarRight), "right end of the toolbar").toBeLessThanOrEqual(2);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
