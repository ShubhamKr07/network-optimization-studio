/**
 * Shared helper — conditionally skip a JADE (two-echelon-jade-us) test when
 * the model is currently locked.
 *
 * `capabilities.locked: true` on the JADE manifest makes the api-server
 * 403 every scenario-scoped route for that model by design; the
 * test-only unlock seam (`setLockedModelsForTests()` in
 * `middlewares/lockedModel.ts`) is a same-process module-level variable a
 * separate Playwright process cannot reach, so a JADE spec run against a
 * locked server cannot exercise anything past scenario creation.
 *
 * This reads the lock state from the live `GET /api/models` response (the
 * same endpoint the running app itself queries), not a hardcoded constant
 * and not a static read of the manifest file — so the condition reflects
 * whatever the server currently serves. The day the manifest's `locked`
 * flag flips back to `false`, this call observes that at test-run time and
 * stops skipping automatically; no spec file needs to change.
 */
import { test, type Page } from "@playwright/test";

export async function skipIfJadeLocked(page: Page): Promise<void> {
  const resp = await page.request.get("/api/models");
  const models = (await resp.json()) as Array<{
    id?: string;
    modelId?: string;
    capabilities?: { locked?: boolean };
  }>;
  const jade = models.find((m) => (m.id ?? m.modelId) === "two-echelon-jade-us");
  const locked = jade?.capabilities?.locked === true;
  test.skip(locked, "two-echelon-jade-us is locked (capabilities.locked=true) — every scenario-scoped route 403s and the test-only unlock seam is unreachable from Playwright's separate process. Self-healing: this reads GET /api/models at run time, so unlocking the model resumes this test with no spec edit.");
}
