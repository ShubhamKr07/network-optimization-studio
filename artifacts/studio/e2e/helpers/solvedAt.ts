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
 * Why it cannot happen right now: every spec is sequential with exactly one
 * in-flight solve, and CH4UX-6's in-flight lock makes overlapping solves
 * impossible to trigger from the UI. The moment a spec drives two solves at
 * once — or edits inputs mid-solve — this becomes reachable. In that case,
 * wait on the specific job (`GET /api/scenarios/{scenarioId}/solve-jobs/{jobId}`
 * — note the PLURAL path segment, `openapi.yaml:352`; it reports a terminal
 * status regardless of whether its result was published) rather than on the
 * scenario's `solvedAt`.
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
