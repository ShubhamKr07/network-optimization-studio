/**
 * WQF-C1 — the Output Map summary popover (ⓘ) paints ABOVE the result cards.
 * Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md). The result is SEEDED; the solver never runs.
 *
 * The cards' wrapper is `pointer-events-none` (OutputMapTab.tsx:447), so a bare elementFromPoint
 * skips the card and "finds" the popover even when the card paints on top (e2e/CLAUDE.md). The test
 * first makes the card hit-testable — pointer-events never changes paint order — so the element
 * under the point is the painted one. It also asserts the boxes overlap, else "which is on top"
 * is not a question and the test could not fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const MODEL = "p-median-us";
const here = path.dirname(fileURLToPath(import.meta.url));
const solvedFixture = () => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${MODEL}.json`), "utf8"));
const chapterPath = CHAPTERS.find(c => c.modelId === MODEL)!.path;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc1-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

test("WQF-C1: the Output Map summary popover paints above the Objective card", async ({ page }) => {
  await register(page);
  const create = await page.request.post("/api/scenarios", { data: { name: "E2E WQF-C1", modelId: MODEL, inputs: SOLVED_MODEL_INPUTS[MODEL] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  try {
    await seedSolvedResult(page, id, solvedFixture());
    await page.goto(`${chapterPath}?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
    await page.getByTestId("sidebar-output-output-map").click({ timeout: T });
    const card = page.getByTestId("output-map-metric-overlay");
    await expect(card).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("button-output-map-info").click({ timeout: T });
    const pop = page.getByTestId("output-map-narrative");
    await expect(pop).toBeVisible({ timeout: T });

    const a = (await pop.boundingBox())!;
    const b = (await card.boundingBox())!;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    expect(right - left, "popover and card overlap horizontally").toBeGreaterThan(4);
    expect(bottom - top, "popover and card overlap vertically").toBeGreaterThan(4);

    await page.addStyleTag({
      content: '[data-testid="output-map-metric-overlay"], [data-testid="output-map-metric-overlay"] * { pointer-events: auto !important; }',
    });
    const topmost = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid="output-map-narrative"], [data-testid="output-map-metric-overlay"]')?.getAttribute("data-testid") ?? null;
    }, [(left + right) / 2, (top + bottom) / 2] as [number, number]);
    expect(topmost, "the painted element at the overlap").toBe("output-map-narrative");

    // Stacking asserted as stacking: Radix copies the content's z-index onto its wrapper.
    const z = await pop.evaluate(el => Number(getComputedStyle(el.closest("[data-radix-popper-content-wrapper]")!).zIndex));
    expect(z).toBeGreaterThan(1000);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
