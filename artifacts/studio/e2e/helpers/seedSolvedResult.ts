/**
 * Seeds a SOLVED result into the UI without running the solver (e2e convention:
 * real CBC timing belongs to pytest). Answers `GET /api/scenarios/:id` with the
 * real row plus the given `result`, `stale: false` and a fresh `solvedAt`.
 *
 * Lifted from `max-coverage-objective.spec.ts` (`installSolveStubs`, the
 * scenario-GET handler). Only the GET is intercepted, and only the exact
 * `/api/scenarios/:id` URL — sub-resources (`/export`, `/solve-jobs/...`) and
 * every write go to the real API. `page.request` is not intercepted by
 * `page.route`, so reading the row back through it still shows the real,
 * un-seeded scenario.
 */
import type { Page } from "@playwright/test";

export async function seedSolvedResult(page: Page, scenarioId: string | number, result: unknown): Promise<void> {
  await page.route(`**/api/scenarios/${scenarioId}`, async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, result, stale: false, solvedAt: new Date().toISOString() } });
  });
}
