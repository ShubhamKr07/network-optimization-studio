/**
 * Browser E2E — CH4UX-7: the `SolveProgressOverlay` contract.
 *
 * CH4UX-5/CH4UX-6 moved the whole saving/solving/failed lifecycle out of the
 * Solve dialog and into a blocking overlay. Three of its properties need a
 * real browser and cannot be proven by the component tests:
 *
 *   1. It is genuinely MODAL — focus starts inside it, Tab/Shift+Tab cannot
 *      leave it, Escape and a backdrop click are inert while running, and the
 *      workspace behind it cannot be activated. jsdom has no focus-order or
 *      pointer-events model that makes any of this meaningful;
 *      `SolveProgressOverlay.test.tsx` can only prove the Escape *handler*
 *      calls `preventDefault`, not that Escape fails to dismiss.
 *   2. On failure it focuses an action, Adjust really reopens the Solve
 *      dialog with focus inside it, and Close restores focus to the trigger.
 *   3. Under `prefers-reduced-motion: reduce` the spinner genuinely stops —
 *      a computed-style fact, which jsdom does not compute.
 *
 * Determinism comes from controlling the job responses, NOT from racing a
 * real CBC run:
 *   - `POST /scenarios/:id/solve` is fulfilled with a synthetic jobId, so no
 *     solver process is ever started and nothing has to be cleaned up
 *     server-side beyond the scenario row itself.
 *   - `GET /scenarios/:id/solve-jobs/:jobId` is either held open (the overlay
 *     stays in `solving` for as long as the test needs) or answered with a
 *     terminal `failed` job (the error card appears immediately).
 *
 * A real solver failure is deliberately NOT used as the trigger: a 1s time
 * limit on a large problem can still return a valid terminal result, so it
 * is not a reliable way to reach the failed branch.
 *
 * Target: E2E_BASE_URL env var. Requires the local dev proxy (vite's
 * API_PROXY_TARGET) — see CLAUDE.md's "To run e2e locally" recipe.
 */
import { test, expect, type Page } from "@playwright/test";

// Bounds every action to a diagnosable failure rather than letting an
// element that never becomes actionable consume the whole test budget —
// especially relevant here, where every interaction follows a dialog or
// overlay transition.
test.use({ actionTimeout: 10_000 });

const HEADER_TIMEOUT = 10_000;
const OVERLAY_TIMEOUT = 15_000;
/** Long enough that the "running" overlay is up for the entire test, short
 * enough that a leaked route handler cannot outlive the run. */
const STALL_MS = 60_000;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

/** Mirrors `input-map-v2.spec.ts`/`posthog-analytics.spec.ts`'s p-median-us
 * prelude. p=1 keeps the scenario tiny — not that it matters, since no
 * solver ever runs in this file. */
async function createScenario(page: Page): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: {
      name: `E2E Overlay Contract ${Date.now()}`,
      modelId: "p-median-us",
      inputs: {
        p: 1,
        distanceBands: [250, 500, 750],
        capacityMode: "none",
        uniformCapacity: null,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
      },
    },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()).id as number;
}

async function openWorkspace(page: Page, id: number): Promise<void> {
  await page.goto(`/chapter-3?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
}

/** Answer the enqueue with a synthetic job id so no real solver process is
 * ever spawned. `POST /scenarios/:id/solve` returns `SolveJobQueued`
 * (`{jobId}`) — Workspace.tsx's `enqueueSolve` reads exactly that field. */
async function stubEnqueue(page: Page, jobId = 987654): Promise<void> {
  await page.route("**/scenarios/*/solve", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId }),
    });
  });
}

/** Hold the job poll open, so the overlay stays in its `solving` phase for
 * the duration of the test. */
async function stallSolveJob(page: Page, holdMs: number): Promise<void> {
  await page.route("**/scenarios/*/solve-jobs/*", async route => {
    await new Promise(r => setTimeout(r, holdMs));
    // Only reached if the test outlives the stall; answered rather than
    // aborted so a late resolution cannot surface as a network error.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(solveJobBody("running")),
    });
  });
}

/** Answer the job poll with a terminal `failed` job. */
async function failSolveJob(page: Page, errorMessage: string): Promise<void> {
  await page.route("**/scenarios/*/solve-jobs/*", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(solveJobBody("failed", errorMessage)),
    }),
  );
}

/** A complete `SolveJob` body — every field the schema marks required, so
 * the client never sees a shape the real API could not produce. */
function solveJobBody(status: "running" | "failed", errorMessage: string | null = null) {
  const now = Date.now();
  return {
    id: 987654,
    status,
    error: errorMessage,
    errorCode: status === "failed" ? "SOLVE_FAILED" : null,
    errorMessage,
    resultSummary: null,
    queuedAt: new Date(now - 3_000).toISOString(),
    startedAt: new Date(now - 2_500).toISOString(),
    finishedAt: status === "failed" ? new Date(now).toISOString() : null,
  };
}

/** Press Solve and hand off to the overlay. Both stubs must already be
 * installed — the dialog closes on submit, so there is no later opportunity
 * to intercept. */
async function submitSolve(page: Page): Promise<void> {
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
}

function focusIsInside(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).evaluate(el => el.contains(document.activeElement));
}

test.describe("solve progress overlay — contract (CH4UX-5/6)", () => {
  test("is modal: focus is trapped inside it, Escape and a backdrop click are inert", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(page);

    try {
      await openWorkspace(page, id);
      await stubEnqueue(page);
      await stallSolveJob(page, STALL_MS);
      await submitSolve(page);

      const overlay = page.getByTestId("solve-progress-overlay");
      await expect(overlay).toBeVisible({ timeout: OVERLAY_TIMEOUT });
      await expect(page.getByTestId("solve-progress-phase")).toHaveText("Solving…");
      // The dialog handed off immediately — it is not merely covered.
      await expect(page.getByTestId("solve-dialog")).not.toBeVisible({ timeout: HEADER_TIMEOUT });

      // Focus lands INSIDE the overlay. This is the `onOpenAutoFocus`
      // redirect in SolveProgressOverlay.tsx: the running branch has no
      // focusable child, and Radix's default fallback would leave focus on
      // <body> — outside a modal that has set `pointer-events: none` on the
      // body and prevents Escape. A keyboard user would have no tab stop
      // and no way back.
      await expect.poll(() => focusIsInside(page, "solve-progress-overlay")).toBe(true);

      // Tabbing in either direction cannot escape the focus scope.
      for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
      expect(await focusIsInside(page, "solve-progress-overlay")).toBe(true);
      await page.keyboard.press("Shift+Tab");
      expect(await focusIsInside(page, "solve-progress-overlay")).toBe(true);

      // Escape is prevented while running (there is nothing to cancel — the
      // API has no cancel endpoint), and AlertDialog suppresses
      // outside-click dismissal.
      await page.keyboard.press("Escape");
      await expect(overlay).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(overlay).toBeVisible();

      // The one control a keyboard user could otherwise still reach mid-run.
      await expect(page.getByTestId("button-run-optimizer")).toBeDisabled();

      // The running branch offers no dismissal of any kind.
      await expect(page.getByTestId("solve-progress-close")).toHaveCount(0);
      await expect(page.getByTestId("solve-progress-adjust")).toHaveCount(0);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("on failure: the error card focuses Adjust, Adjust reopens the dialog, Close dismisses and re-enables the trigger", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(page);

    try {
      await openWorkspace(page, id);
      await stubEnqueue(page);
      await failSolveJob(page, "Solve failed — please try again.");
      await submitSolve(page);

      const overlay = page.getByTestId("solve-progress-overlay");
      await expect(overlay).toBeVisible({ timeout: OVERLAY_TIMEOUT });
      await expect(page.getByTestId("solve-progress-error")).toHaveText("Solve failed — please try again.");
      // The failed branch has two focusable children and Adjust carries
      // `autoFocus`, so Radix's own default lands there — the running
      // branch's `onOpenAutoFocus` redirect is deliberately NOT applied here.
      await expect(page.getByTestId("solve-progress-adjust")).toBeFocused();

      // Adjust is the ONLY retry path (a solve that just failed is unlikely
      // to succeed unchanged), so it must really reopen the parameter
      // dialog rather than blind-retry.
      await page.getByTestId("solve-progress-adjust").click({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(overlay).toHaveCount(0);
      // (No `solve-progress-elapsed` toHaveCount(0) check here: the overlay
      // as a whole is already asserted absent one line above, so a check on
      // one of its children could not fail independently — it would be
      // vacuous. `resetSolveState` clearing `lastJobSnapshot` is covered by
      // Workspace.test.tsx, which can observe the state directly.)
      await expect.poll(() => focusIsInside(page, "solve-dialog")).toBe(true);

      // Close path: fail again and dismiss. `resetSolveState` releases the
      // in-flight lock, so the trigger becomes usable again.
      // (Where FOCUS lands after this dismissal is asserted separately
      // below — see the `test.fail()` case, which records a real,
      // currently-unfixed gap rather than hiding it here.)
      await page.getByTestId("solve-dialog-solve").click();
      await expect(overlay).toBeVisible({ timeout: OVERLAY_TIMEOUT });
      await expect(page.getByTestId("solve-progress-error")).toHaveText("Solve failed — please try again.");
      await page.getByTestId("solve-progress-close").click({ timeout: HEADER_TIMEOUT });
      await expect(overlay).toHaveCount(0);
      await expect(page.getByTestId("button-run-optimizer")).toBeEnabled({ timeout: HEADER_TIMEOUT });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  /**
   * KNOWN GAP, measured on this branch — deliberately recorded as
   * `test.fail()` rather than weakened, deleted, or rewritten to assert the
   * broken behaviour.
   *
   * Dismissing the overlay's error card leaves `document.activeElement ===
   * document.body`: the next Tab jumps to the FIRST focusable element on the
   * page (`button-page-back`), not back to where the student was. Measured
   * directly with a throwaway probe against a real browser on this branch —
   * focus is on `solve-progress-adjust` immediately before the Close click
   * and on `<body>` ~1.2s after it.
   *
   * Mechanism: Radix's FocusScope restores focus to whatever was focused when
   * the scope MOUNTED. The overlay mounts in the same commit that unmounts
   * the Solve dialog (CH4UX-6's handoff), so that remembered element is
   * `solve-dialog-solve` — already detached by the time the scope unmounts,
   * making the restore a no-op.
   *
   * This is the mirror image of the OPEN-side hole CH4UX-6 already found and
   * fixed with `onOpenAutoFocus` (where Radix's restore target,
   * `button-run-optimizer`, was disabled and focus likewise fell to <body>).
   * Only the close direction is still open. It is a regression introduced by
   * this branch: before CH4UX-6 the dialog stayed open through a failure and
   * its own Close restored focus to `button-run-optimizer`, which was still
   * mounted.
   *
   * Severity is lower than the open-side hole — nothing is trapped, the page
   * stays fully usable, and Tab still works — so this is filed, not fixed
   * here: CH4UX-7 is an e2e-only task and the fix is a `src/` change
   * (an `onCloseAutoFocus` redirect on `AlertDialogContent`, pointing at
   * `button-run-optimizer`, which `resetSolveState` has just re-enabled).
   *
   * `test.fail()` and not `test.fixme()` on purpose: this RUNS, so the day
   * the app is fixed it goes red as an "unexpected pass" and forces this
   * marker to be removed, instead of quietly rotting as a skip.
   */
  test.fail("KNOWN GAP (CH4UX-7): Close should restore focus to the trigger, but leaves it on <body>", async ({ page }) => {
    test.setTimeout(90_000);
    await registerAndGoHome(page);
    const id = await createScenario(page);

    try {
      await openWorkspace(page, id);
      await stubEnqueue(page);
      await failSolveJob(page, "Solve failed — please try again.");
      await submitSolve(page);

      const overlay = page.getByTestId("solve-progress-overlay");
      await expect(overlay).toBeVisible({ timeout: OVERLAY_TIMEOUT });
      await page.getByTestId("solve-progress-close").click({ timeout: HEADER_TIMEOUT });
      await expect(overlay).toHaveCount(0);
      await expect(page.getByTestId("button-run-optimizer")).toBeEnabled({ timeout: HEADER_TIMEOUT });

      // The DESIRED behaviour, asserted as-is. Currently fails.
      await expect(page.getByTestId("button-run-optimizer")).toBeFocused();
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });

  test("reduced motion stops the spinner animation", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await registerAndGoHome(page);
    const id = await createScenario(page);

    try {
      await openWorkspace(page, id);
      await stubEnqueue(page);
      await stallSolveJob(page, STALL_MS);
      await submitSolve(page);

      await expect(page.getByTestId("solve-progress-overlay")).toBeVisible({ timeout: OVERLAY_TIMEOUT });

      // `animate-spin motion-reduce:animate-none` on the running branch's
      // Loader2. The spinner must still be PRESENT (this is not a test that
      // the element disappears) and its animation must resolve to none.
      const spinner = page.getByTestId("solve-progress-overlay").locator("svg.animate-spin");
      await expect(spinner).toHaveCount(1);
      await expect
        .poll(() => spinner.evaluate(el => getComputedStyle(el).animationName))
        .toBe("none");

      // Non-vacuity guard for the assertion above: the SAME element animates
      // normally once the reduced-motion preference is lifted, so "none" is
      // a real consequence of the media query and not of the class being
      // absent, the element being detached, or Chromium reporting "none"
      // for everything in a headless run.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect
        .poll(() => spinner.evaluate(el => getComputedStyle(el).animationName))
        .not.toBe("none");
    } finally {
      await page.emulateMedia({ reducedMotion: null });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
