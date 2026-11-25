/**
 * WQF-C5 — Base multiplier: Apply writes round2(Base × m) for every filtered row across all pages in one
 * PATCH, and the costs persist across a reload. Real API + DB (local two-server recipe); no solve.
 * Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { fillTableFilter, closePopover } from "./helpers/inputTable";
import { CHAPTERS } from "../src/lib/chapters";
import { round2 } from "../src/lib/deliveryCosts";

const T = 10_000;
const MODEL = "delivery-teaching-us";
const here = path.dirname(fileURLToPath(import.meta.url));
const COSTS = JSON.parse(fs.readFileSync(path.resolve(here, "../../../solvers/delivery-teaching-us/dataset/costs.json"), "utf8")) as Record<string, number>;
const chapterPath = CHAPTERS.find(c => c.modelId === MODEL)!.path;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc5-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

async function createAndOpenCosts(page: Page): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: "E2E WQF-C5", modelId: MODEL, inputs: SOLVED_MODEL_INPUTS[MODEL] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await page.getByTestId("sidebar-input-deliveryCosts").click({ timeout: T });
  await expect(page.getByTestId("delivery-costs-page-indicator")).toBeVisible({ timeout: 15_000 });
  return id;
}

const patchOf = (page: Page, id: string) =>
  page.waitForResponse(r => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/scenarios/${id}`, { timeout: 15_000 });

test("WQF-C5: Apply on a filter spanning 7 pages writes all 313 rows once, and they persist after reload", async ({ page }) => {
  await register(page);
  const id = await createAndOpenCosts(page);
  try {
    await fillTableFilter(page, "from", "W8");
    await closePopover(page);
    await expect(page.getByTestId("delivery-costs-page-indicator")).toContainText("Page 1 of 7", { timeout: T });

    await page.getByTestId("input-deliverycost-multiplier").fill("1.5");
    const patch = patchOf(page, id);
    await page.getByTestId("button-deliverycost-apply-multiplier").click({ timeout: T });
    expect((await patch).status()).toBe(200);

    const row = await (await page.request.get(`/api/scenarios/${id}`)).json();
    const saved = new Map((row.inputs.laneCostOverrides as { fromId: string; toId: string; cost: number }[]).map(o => [`${o.fromId},${o.toId}`, o.cost]));
    const expected = new Map(Object.entries(COSTS).filter(([k]) => k.startsWith("W8,")).map(([k, base]) => [k, round2(base * 1.5)]));
    expect(expected.size).toBe(313);
    expect(saved).toEqual(expected);

    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
    await page.getByTestId("sidebar-input-deliveryCosts").click({ timeout: T });
    await fillTableFilter(page, "from", "W8");
    await fillTableFilter(page, "to", "C269");
    await closePopover(page);
    // costs.json "W8,C269": 1047.7157 × 1.5 = 1571.57355 → 1571.57 (C6 display).
    await expect(page.getByTestId("input-deliverycost-W8-C269")).toHaveValue("1571.57", { timeout: T });
    await expect(page.getByTestId("badge-deliverycost-overridden-W8-C269")).toBeVisible();
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});

test("WQF-C5: an unfiltered Apply writes all 10,329 lanes in one accepted PATCH", async ({ page }) => {
  await register(page);
  const id = await createAndOpenCosts(page);
  try {
    await page.getByTestId("input-deliverycost-multiplier").fill("1");
    const patch = patchOf(page, id);
    await page.getByTestId("button-deliverycost-apply-multiplier").click({ timeout: T });
    expect((await patch).status()).toBe(200);
    const row = await (await page.request.get(`/api/scenarios/${id}`)).json();
    expect(row.inputs.laneCostOverrides).toHaveLength(10_329);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
