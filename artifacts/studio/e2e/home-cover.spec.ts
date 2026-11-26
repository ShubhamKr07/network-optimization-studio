import { test, expect, type Page } from "./fixtures";
import { measureHomeContrast } from "./helpers/homeContrast";

const T = 10_000;

// Recent-solves rows are stubbed (real CBC timing belongs to pytest): one of each
// chip so every row variant is measured. Only the list endpoint is intercepted.
const HISTORY = [
  { id: 9001, scenarioId: 1, scenarioName: "Hcv succeeded", modelId: "p-median-us", status: "succeeded", objective: 1234567, objectiveMode: null, weightedAvgDistance: 321.5, distanceUnit: "mi", errorCode: null, errorMessage: null, runTimeSec: 1.23, legacyUnverified: false },
  { id: 9002, scenarioId: 2, scenarioName: "Hcv unverified", modelId: "max-coverage-us", status: "succeeded", objective: 98, objectiveMode: "coverage", weightedAvgDistance: 210, distanceUnit: "mi", errorCode: null, errorMessage: null, runTimeSec: 0.8, legacyUnverified: true },
  { id: 9003, scenarioId: 3, scenarioName: "Hcv failed", modelId: "delivery-teaching-us", status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", errorCode: "SOLVE_FAILED", errorMessage: "The solver could not finish this scenario.", runTimeSec: null, legacyUnverified: false },
  { id: 9004, scenarioId: 4, scenarioName: "Hcv running", modelId: "two-echelon-jade-us", status: "running", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", errorCode: null, errorMessage: null, runTimeSec: null, legacyUnverified: false },
].map((h) => ({ ...h, queuedAt: new Date().toISOString(), finishedAt: null }));

async function home(page: Page, scheme: "light" | "dark" = "light", withHistory = false) {
  await page.addInitScript((s) => { try { localStorage.setItem("nos:theme-pref", s); } catch { /* storage unavailable */ } }, scheme);
  if (withHistory) {
    await page.route("**/api/solve-history*", (route) => route.fulfill({ json: HISTORY }));
  }
  const email = `e2e-hcv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const res = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1", acceptTerms: true } });
  expect(res.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("landing-card-p-median-us")).toBeVisible({ timeout: T });
  if (withHistory) await expect(page.getByTestId("link-solve-history-9001")).toBeVisible({ timeout: T });
}
const cols = (page: Page) =>
  page.locator(".home-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);

test.describe("home cover (HCV)", () => {
  test("H5: 3 columns at 1440, 2 at 820, 1 at 390", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    expect(await cols(page)).toBe(3);
    await page.setViewportSize({ width: 820, height: 1000 });
    expect(await cols(page)).toBe(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await cols(page)).toBe(1);
  });

  test("H1: the header is one row of at most 72 px at 1440 and 390, with no horizontal overflow", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await home(page);
      const box = await page.locator("header.home-top").boundingBox();
      expect(box!.height, `header height at ${width}`).toBeLessThanOrEqual(72);
      // The shell root is overflow-hidden, so documentElement.scrollWidth can never exceed
      // innerWidth; assert on the real scrollers instead.
      expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth), `main has no horizontal overflow at ${width}`).toBe(true);
      expect(await page.locator("header.home-top .wrap").evaluate((el) => el.scrollWidth <= el.clientWidth), `header row has no horizontal overflow at ${width}`).toBe(true);
      await expect(page.locator("header.home-top")).toContainText("Offered by Michael Watson");
      await expect(page.getByTestId("button-logout")).toBeVisible();
      await page.context().clearCookies();
    }
  });

  test("H9: band and card surfaces follow the app theme (dark)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page, "dark");
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("header.home-top")).toBe("rgb(15, 74, 19)");
    expect(await bg(".home-card")).toBe("rgb(22, 36, 26)");
  });

  test("H9: band and card surfaces (light)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page, "light");
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("header.home-top")).toBe("rgb(23, 102, 27)");
  });

  test("H2: Delete my account is a button that opens the existing confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    const del = page.getByTestId("homepage-credit-footer").getByTestId("link-delete-account");
    expect(await del.evaluate((el) => el.tagName)).toBe("BUTTON");
    await del.click({ timeout: T });
    await expect(page.getByRole("dialog")).toContainText("Delete your account?");
    await page.getByTestId("button-cancel-delete").click({ timeout: T });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`H5: a Tab walk reaches every control with a solid ring in the right colour (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await home(page, scheme);
      // Ring colours from home.css: `.home :focus-visible` uses --focus-ring (#17661B light,
      // #F2E9A8 dark); `.btn-band` and `.home-bottom` force #F2E9A8 on the green bands; the
      // feedback pill sits over the paper and uses --focus-ring.
      const BAND = "rgb(242, 233, 168)";
      const PAPER = scheme === "light" ? "rgb(23, 102, 27)" : BAND;
      const expected: Record<string, string> = {
        "button-logout": BAND,
        "link-/chapter-3": PAPER,
        "feedback-button": PAPER,
        "link-terms": BAND,
        "link-delete-account": BAND,
      };
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const seen: Record<string, { style: string; color: string }> = {};
      for (let i = 0; i < 60 && Object.keys(seen).length < Object.keys(expected).length; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { id: el.getAttribute("data-testid") ?? "", style: cs.outlineStyle, color: cs.outlineColor };
        });
        if (info && info.id in expected) seen[info.id] = { style: info.style, color: info.color };
      }
      expect(Object.keys(seen).sort(), "every expected control was reached by Tab").toEqual(Object.keys(expected).sort());
      for (const [id, want] of Object.entries(expected)) {
        expect(seen[id].style, `${id} ring style`).toBe("solid");
        expect(seen[id].color, `${id} ring colour`).toBe(want);
      }
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`contrast >= 4.5:1 on every home text node (${scheme}, ${width}px)`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await home(page, scheme, true);
        const r = await measureHomeContrast(page);
        expect(r.checked, "text nodes measured (non-vacuous)").toBeGreaterThan(40);
        expect(r.findings).toEqual([]);
      });
    }
  }

  // Review notes (2026-11-26): the pill's hover green kept white text at 4.17:1, and the home focus
  // rule leaked an outline + 3px radius onto library controls inside the feedback panel.
  test("Feedback pill hover keeps white text at >= 4.5:1", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    const pill = page.getByTestId("feedback-button");
    await pill.hover();
    await expect.poll(() => pill.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 102, 27)");
  });

  test("library controls in the feedback panel keep their own focus style (no home outline)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    await page.getByTestId("feedback-button").click({ timeout: T });
    const input = page.getByTestId("feedback-input");
    await input.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { id: el.getAttribute("data-testid"), outline: cs.outlineColor, radius: cs.borderTopLeftRadius };
    });
    expect(focused.id).toBe("feedback-input");
    expect(focused.outline, "home focus-ring green must not reach the textarea").not.toBe("rgb(23, 102, 27)");
    expect(focused.radius, "home 3px focus radius must not reach the textarea").not.toBe("3px");
  });
});
