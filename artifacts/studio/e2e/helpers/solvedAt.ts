/**
 * Shared helper — read a scenario's `solvedAt` as the completion signal for a
 * solve that an e2e test just triggered.
 *
 * `solvedAt` became the standard signal in CH4UX-7 because the two obvious
 * alternatives are both wrong:
 *   - waiting on the solve overlay is a race (it is transient, and a fast
 *     solve can come and go between polls), and
 *   - `output-map-tab` alone is a false positive whenever that tab was
 *     already open before the solve started.
 *
 * The pattern is: capture `readSolvedAt()` BEFORE triggering, then poll until
 * the value differs. Polling for "not null" is not enough — a scenario that
 * was already solved once has a non-null `solvedAt` from the start.
 *
 *   const before = await readSolvedAt(page, id);
 *   // ... trigger the solve ...
 *   await expect
 *     .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
 *     .not.toBe(before);
 *
 * Extracted from SEVEN byte-identical copies (`bundle2-fastfollow`,
 * `jade-ch9-workspace-bundle`, `jade-two-echelon`, `posthog-analytics`,
 * `workspace-fixups`, `workspace-fixups-2`, `workspace-ux-r1-r9`) which had
 * drifted only in the `id` parameter's type — `string` in four, `number` in
 * three, for the same route parameter. Hence `string | number` here: both
 * call styles are real and both interpolate identically into the URL.
 *
 * ---
 *
 * HAZARD, for whoever writes the first CONCURRENT-solve spec. Not reachable
 * today; do not "fix" anything on account of it.
 *
 * `solvedAt` only advances when `jobRunner`'s publication CAS matches, and
 * that `.where()` requires BOTH `latestSolveJobId = jobId` AND
 * `solveInputRevision = enqueuedSolveInputRevision` (`jobRunner.ts:1481-1488`).
 * A solve that succeeds but has been SUPERSEDED — a newer solve enqueued, or
 * the inputs edited, while it was running — deliberately does not publish
 * (the `succeeded-but-superseded` branch immediately below that CAS), so
 * `solvedAt` is left unchanged. A `readSolvedAt`-based wait on that solve
 * therefore never observes a change and hangs for the full `SOLVE_TIMEOUT`
 * before failing — and it fails looking like a solver timeout, which is the
 * wrong diagnosis entirely.
 *
 * Why it cannot happen right now — and the reason is NOT the obvious one.
 * `playwright.config.ts` sets `fullyParallel: false` but does not set
 * `workers`, so Playwright defaults to roughly half the CPU cores and
 * `fullyParallel: false` serialises only the tests *within* a file: **spec
 * FILES do run in parallel**. What actually protects this is that the CAS is
 * per-scenario and every spec registers its own user and creates its own
 * scenarios, so no two specs ever touch the same `scenarios` row. A future
 * spec that shares or seeds a fixed scenario id would be exposed while still
 * looking "sequential".
 *
 * CH4UX-6's in-flight lock narrows the UI path but does not close it as an
 * absolute: `src/pages/Workspace.tsx:3050-3059` documents in its own comment that
 * `enqueueSolve` has a second caller (`handleSaveAsScenario`) which does not
 * re-run the guard, and that two rapid clicks there still produce two
 * `enqueueSolve` calls. That path creates *separate* scenarios, so it cannot
 * produce same-scenario overlap — but do not restate it as "impossible", which
 * is an absolute the source declines to make.
 *
 * The moment a spec drives two solves against ONE scenario — or edits inputs
 * mid-solve — this becomes reachable. In that case,
 * wait on the specific job (`GET /api/scenarios/{scenarioId}/solve-jobs/{jobId}`
 * — note the PLURAL path segment, `openapi.yaml:352`; it reports a terminal
 * status regardless of whether its result was published) rather than on the
 * scenario's `solvedAt`.
 *
 * One more non-publication mode, for completeness — not reachable from a spec,
 * so it does not change the advice above. `enqueueSolveJob`
 * (`jobRunner.ts:342`) passes `enqueuedSolveInputRevision: null`, and the CAS
 * turns a null into `sql`false``, so a job enqueued through that primitive
 * NEVER publishes and `solvedAt` never advances — no concurrency required.
 * That is intended and documented at the call site; the primitive has only
 * in-process callers (tests and programmatic use), never the HTTP path a
 * Playwright spec drives.
 */
import { expect, type Page } from "@playwright/test";

export async function readSolvedAt(page: Page, id: string | number): Promise<string | null> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  // Cast rather than reading off the implicit `any` the seven copies used:
  // `(await resp.json()).solvedAt` type-checks against nothing, so a rename of
  // this field would have been silent in all seven. Narrow, so it is not a
  // claim about the rest of the payload.
  const body = (await resp.json()) as { solvedAt?: string | null };
  return body.solvedAt ?? null;
}
