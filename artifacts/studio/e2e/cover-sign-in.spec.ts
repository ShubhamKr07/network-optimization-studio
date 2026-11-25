/**
 * CSI-2 — the cover sign-in page in a real browser.
 *
 * jsdom loads no stylesheet and does no layout, so CSI-1's unit tests could only check the page
 * structurally. This spec is where the things the user approved in prototype v8 are actually
 * measured: light-only under a dark OS/app theme (L6), the lede's line count (L12), no horizontal
 * scroll, text size and contrast, the keyboard order and focus rings, new-tab links (L8/L9), the
 * round trips through the real API, and reduced motion.
 *
 * Target: E2E_BASE_URL (local two-server recipe, e2e/CLAUDE.md). External hosts (Amazon,
 * LinkedIn) are stubbed at the context level, so the new-tab checks never touch the network.
 * Set E2E_SHOTS_DIR to also save the full-page screenshots to disk; they are always attached to
 * the test report.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "./fixtures";
import { measureCoverContrast } from "./helpers/coverContrast";

const T = 15_000;
const PASSWORD = "correcthorse1";
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const PAPER = "rgb(234, 243, 232)"; // --paper #EAF3E8
const newEmail = (tag: string) => `e2e-csi2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;

const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1024, h: 768 },
  { w: 390, h: 844 },
] as const;

async function expectCover(page: Page, mode: "login" | "register") {
  await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network Design Labs");
  await expect(page.getByTestId("mode-login")).toHaveAttribute("aria-pressed", String(mode === "login"));
  await expect(page.getByTestId("mode-register")).toHaveAttribute("aria-pressed", String(mode === "register"));
}

test.describe("cover sign-in (signed out)", () => {
  test.use({ storageState: undefined, actionTimeout: T });

  test.beforeEach(async ({ context }) => {
    // The new-tab checks must not depend on the public internet.
    await context.route(/(^|\.)(amazon|linkedin)\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  });

  // ── routes, h1, title ────────────────────────────────────────────────────
  test("/ renders the cover in place (no redirect); /login and /register render it in log-in and create mode", async ({ page }) => {
    await page.goto("/");
    await expectCover(page, "login");
    await expect(page).toHaveURL(/\/$/); // stays on `/`
    await expect(page).toHaveTitle("Network Design Labs");
    expect(await page.getByRole("heading", { level: 1 }).count(), "exactly one h1").toBe(1);

    await page.goto("/login");
    await expectCover(page, "login");
    await expect(page).toHaveTitle("Network Design Labs");
    await expect(page.getByTestId("button-login")).toHaveText("Log in");

    await page.goto("/register");
    await expectCover(page, "register");
    await expect(page.getByTestId("button-register")).toHaveText("Create account");
    await expect(page.getByTestId("link-forgot-password")).toHaveCount(0);
  });

  test("the mode toggle is local state: the URL does not change, hints and submit follow it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hint")).toHaveText("New here? Choose Create account above.");
    await page.getByTestId("mode-register").click();
    await expectCover(page, "register");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".hint")).toContainText("Free for students and instructors using the book");
    await page.getByTestId("mode-login").click();
    await expectCover(page, "login");
    await expect(page.getByTestId("link-forgot-password")).toBeVisible();
  });

  test("submit stays disabled until consent is ticked, in both modes", async ({ page }) => {
    await page.goto("/");
    for (const [mode, button] of [["mode-login", "button-login"], ["mode-register", "button-register"]] as const) {
      await page.getByTestId(mode).click();
      await page.getByTestId("input-email").fill(newEmail("gate"));
      await page.getByTestId("input-password").fill(PASSWORD);
      await expect(page.getByTestId(button)).toBeDisabled();
      await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
      await expect(page.getByTestId(button)).toBeEnabled();
      await page.getByTestId("checkbox-accept-terms").uncheck({ timeout: T });
      await expect(page.getByTestId(button)).toBeDisabled();
    }
  });

  // ── round trips through the real API ─────────────────────────────────────
  test("round trip from `/`: create an account, land on Landing, log out to /login, log back in from `/`", async ({ page }) => {
    const email = newEmail("trip");
    await page.goto("/");
    await page.getByTestId("mode-register").click();
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(PASSWORD);
    await expect(page.getByTestId("button-register")).toBeDisabled();
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
    await page.getByTestId("button-register").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toHaveText(email, { timeout: T });
    await expect(page.getByTestId("cover-shell")).toHaveCount(0);

    await page.getByTestId("button-logout").first().click({ timeout: T });
    await expect(page).toHaveURL(/\/login$/, { timeout: T });
    await expectCover(page, "login");

    await page.goto("/");
    await expectCover(page, "login");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(PASSWORD);
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
    await page.getByTestId("button-login").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toHaveText(email, { timeout: T });
    await expect(page.getByTestId("cover-shell")).toHaveCount(0);
  });

  test("a wrong password shows the error through the cover, and the form keeps the typed email", async ({ page }) => {
    const email = newEmail("wrong");
    await page.goto("/");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill("not-the-password-1");
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
    await page.getByTestId("button-login").click({ timeout: T });
    await expect(page.getByTestId("alert-login-error")).toBeVisible({ timeout: T });
    await expect(page.getByTestId("input-email")).toHaveValue(email);
    await expect(page.getByTestId("text-user-email")).toHaveCount(0); // end state: not signed in
  });

  // ── new-tab links ────────────────────────────────────────────────────────
  test("book, Terms, Privacy and LinkedIn each open a NEW page at the expected URL; the form tab keeps its typed email", async ({ page, context }) => {
    const email = newEmail("tabs");
    await page.goto("/");
    await page.getByTestId("input-email").fill(email);

    const cases: Array<[string, RegExp]> = [
      ["link-book", /^https:\/\/www\.amazon\.com\/dp\/B078PNRZJB$/],
      ["link-consent-terms", /\/terms$/],
      ["link-consent-privacy", /\/privacy$/],
      ["link-linkedin", /^https:\/\/www\.linkedin\.com\/in\/michael-watson-07600a1\/?$/],
    ];
    for (const [id, urlRe] of cases) {
      const link = page.getByTestId(id);
      await expect(link, id).toHaveAttribute("target", "_blank");
      await expect(link, id).toHaveAttribute("rel", /noopener/);
      const before = context.pages().length;
      const [popup] = await Promise.all([context.waitForEvent("page"), link.click({ timeout: T })]);
      await popup.waitForURL(urlRe, { timeout: T });
      expect(popup.url(), id).toMatch(urlRe);
      expect(context.pages().length, `${id}: a second page exists`).toBe(before + 1);
      await popup.close();
      await expect(page, `${id}: the form tab never navigated`).toHaveURL(/\/$/);
      await expect(page.getByTestId("input-email"), `${id}: the form tab keeps its typed email`).toHaveValue(email);
    }
    // The e-mail links are not new-tab pages.
    await expect(page.getByTestId("link-watson-email")).toHaveAttribute("href", "mailto:michael.watson@northwestern.edu");
    await expect(page.getByTestId("cover-help").getByRole("link")).toHaveAttribute("href", "mailto:shubham.shubham4995@gmail.com");
  });

  // ── forgot / reset ───────────────────────────────────────────────────────
  test("forgot-password and reset-password render inside the cover shell and keep their flows", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network Design Labs");
    await expect(page.getByTestId("mode-login")).toHaveCount(0); // heading replaces the toggle
    await page.getByTestId("input-email").fill(newEmail("forgot"));
    await page.getByTestId("button-request-reset").click({ timeout: T });
    await expect(page.getByTestId("text-reset-sent")).toContainText(/if that email has an account/i, { timeout: T });

    await page.goto("/reset-password");
    await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
    await expect(page.getByTestId("text-reset-link-invalid")).toBeVisible({ timeout: T });
  });

async function readFocus(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const rootStyle = getComputedStyle(document.querySelector('[data-testid="cover-shell"]')!);
    const hex = (n: string) => { const h = rootStyle.getPropertyValue(n).trim(); const x = parseInt(h.slice(1), 16); return [(x >> 16) & 255, (x >> 8) & 255, x & 255]; };
    // The ground the ring is drawn on, pessimistic (closest in luminance to the ring colour). An outline with a
    // positive offset is separated from the control by a gap of the surrounding surface, so it is drawn on (and only
    // touches) that surface — for the submit button that is the strip, not the button's own pale fill.
    const offsetRing = parseFloat(cs.outlineOffset) > 0;
    const grounds = el.closest(".go") && !offsetRing ? [hex("--strip-ink")] : el.closest(".strip") ? [hex("--strip-top"), hex("--strip-mid"), hex("--strip-bot")] : [hex("--paper"), hex("--paper-2")];
    const outlined = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
    // Text fields mark focus with a 2px underline in the focus colour (cover.css), not an outline.
    const underlined = el.tagName === "INPUT" && (el.getAttribute("type") ?? "text") !== "checkbox" && parseFloat(cs.borderBottomWidth) >= 2;
    const ringColour = rgb(outlined ? cs.outlineColor : underlined ? cs.borderBottomColor : cs.outlineColor);
    const ratioTo = (g: number[]) => { const [hi, lo] = [lum(ringColour), lum(g)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    return {
      id: el.getAttribute("data-testid") ?? el.id ?? el.tagName,
      focusVisible: el.matches(":focus-visible"),
      outlined,
      underlined,
      boxShadow: cs.boxShadow,
      ringColour: ringColour.join(","),
      ringContrast: Math.round(Math.min(...grounds.map(ratioTo)) * 100) / 100,
    };
  });
}

  // ── keyboard ─────────────────────────────────────────────────────────────
  const TAB_ORDER = ["mode-login", "mode-register", "input-email", "link-forgot-password", "input-password", "checkbox-accept-terms", "link-consent-terms", "link-consent-privacy", "button-login"];

  /** Tab through the log-in form by keyboard from the first toggle, reading and screenshotting each stop. */
  async function walkTabOrder(page: Page, testInfo: import("@playwright/test").TestInfo) {
    await page.goto("/");
    await expectCover(page, "login");
    await page.getByTestId("input-email").fill(newEmail("kbd"));
    await page.getByTestId("input-password").fill(PASSWORD);
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T }); // the submit is only a tab stop once enabled
    await page.getByTestId("mode-login").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab"); // keyboard modality, so :focus-visible applies
    const stops: Array<Awaited<ReturnType<typeof readFocus>>> = [];
    for (let i = 0; i < TAB_ORDER.length; i++) {
      const info = await readFocus(page);
      stops.push(info);
      const png = await page.screenshot({ fullPage: false });
      const name = `focus-${String(i + 1).padStart(2, "0")}-${info.id}.png`;
      await testInfo.attach(name, { body: png, contentType: "image/png" });
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, name), png);
      }
      if (i < TAB_ORDER.length - 1) await page.keyboard.press("Tab");
    }
    return stops;
  }

  test("keyboard: Tab order is toggle -> email -> Forgot? -> password -> consent -> Terms -> Privacy -> submit, every stop is :focus-visible with an indicator", async ({ page }, testInfo) => {
    const stops = await walkTabOrder(page, testInfo);
    expect(stops.map((s) => s.id)).toEqual(TAB_ORDER);
    for (const info of stops) {
      expect(info.focusVisible, `${info.id}: matches :focus-visible after a keyboard Tab`).toBe(true);
      expect(info.outlined || info.underlined || info.boxShadow !== "none", `${info.id}: has a focus indicator ${JSON.stringify(info)}`).toBe(true);
    }
  });

  // Regression guard for the CSI-1 strip focus ring (was 1.02:1 before cover.css scoped .strip back to --focus).
  test("every focus indicator is at least 3:1 against its ground", async ({ page }, testInfo) => {
    const stops = await walkTabOrder(page, testInfo);
    const weak = stops.filter((s) => s.ringContrast < 3).map((s) => `${s.id} ${s.ringContrast}:1`);
    expect(weak, "stops whose focus indicator is under 3:1").toEqual([]);
  });

  // ── light only (L6) ──────────────────────────────────────────────────────
  test.describe("light only under a dark scheme and a stored dark theme", () => {
    test.use({ colorScheme: "dark" });

    test("the paper is #EAF3E8 and nothing under 4.5:1; the app theme IS dark (non-vacuity)", async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("nos:theme-pref", "dark"));
      for (const route of ["/", "/login", "/register", "/forgot-password"]) {
        await page.goto(route);
        await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
        // Non-vacuity: the app really is dark here, so a cover that stayed light is a decision, not an accident.
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")), { timeout: T, message: `${route}: html.dark` }).toBe(true);
        const cover = await page.getByTestId("cover-shell").evaluate((el) => {
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, scheme: cs.colorScheme, color: cs.color };
        });
        expect(cover.bg, `${route}: paper`).toBe(PAPER);
        expect(cover.scheme, `${route}: color-scheme`).toBe("light");
        const scan = await measureCoverContrast(page);
        expect(scan.checked, `${route}: text nodes measured`).toBeGreaterThan(8);
        expect(scan.findings, `${route}: text under 4.5:1`).toEqual([]);
        expect(scan.smallText, `${route}: text under 11px`).toEqual([]);
      }
    });

    test("light-vs-dark control: the SAME paper in a light scheme with no stored pref", async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ baseURL, colorScheme: "light", storageState: undefined });
      try {
        const page = await ctx.newPage();
        await page.goto("/login");
        await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
        expect(await page.getByTestId("cover-shell").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PAPER);
        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
      } finally {
        await ctx.close();
      }
    });
  });

  test("the contrast detector can fail: an injected 3:1 text node and an injected 9px text node are reported", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
    const clean = await measureCoverContrast(page);
    expect(clean.findings).toEqual([]);
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "probe pale";
      p.style.cssText = "color:#8aa88f;font-size:9px;margin:0";
      document.querySelector(".cover .inner")!.appendChild(p);
    });
    const probed = await measureCoverContrast(page);
    expect(probed.findings.some((f) => f.text === "probe pale" && f.ratio < 4.5)).toBe(true);
    expect(probed.smallText.some((f) => f.text === "probe pale" && f.px === 9)).toBe(true);
  });

  // ── layout ───────────────────────────────────────────────────────────────
  for (const { w, h } of WIDTHS) {
    test(`layout at ${w}px: no horizontal scroll, no text under 11px, lede second sentence ${w >= 860 ? "on one line" : "wraps"}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      for (const route of ["/", "/register", "/forgot-password"]) {
        await page.goto(route);
        await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(m.sw, `${route} @${w}: scrollWidth ${m.sw} <= clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw);
        const scan = await measureCoverContrast(page);
        expect(scan.smallText, `${route} @${w}: text under 11px`).toEqual([]);
        expect(scan.findings, `${route} @${w}: text under 4.5:1`).toEqual([]);
        if (route === "/") {
          const lines = await page.locator(".one-line").evaluate((el) => el.getClientRects().length); // one box per wrapped line of an inline span
          if (w >= 860) expect(lines, `@${w}: the lede's second sentence is one line`).toBe(1);
          else expect(lines, `@${w}: the lede's second sentence wraps`).toBeGreaterThan(1);
        }
      }
    });
  }

  // ── reduced motion ───────────────────────────────────────────────────────
  test.describe("reduced motion", () => {
    test("with prefers-reduced-motion: reduce the route paths have no animation", async ({ page }) => {
      // emulateMedia, not test.use({ reducedMotion }): the context option did not take effect here (matchMedia stayed no-preference).
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), "non-vacuity: the preference is really on").toBe(true);
      await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
      const r = await page.locator(".world .route").evaluateAll((els) => els.map((e) => ({ name: getComputedStyle(e).animationName, running: e.getAnimations().length })));
      expect(r.length, "non-vacuity: routes are drawn").toBeGreaterThanOrEqual(7);
      for (const x of r) expect(x).toEqual({ name: "none", running: 0 });
    });
  });

  test.describe("motion allowed (control)", () => {
    test("without the preference the same route paths ARE animated, so the check above can fail", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto("/");
      await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
      const names = await page.locator(".world .route").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
      expect(names.length).toBeGreaterThanOrEqual(7);
      expect(names.every((n) => n !== "none")).toBe(true);
    });
  });

  // ── screenshots: / , /register , /forgot-password x 3 widths x light and dark OS ─────────
  for (const scheme of ["light", "dark"] as const) {
    test(`screenshots (${scheme} OS scheme): /, /register, /forgot-password at 1440, 1024 and 390`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: scheme });
      for (const { w, h } of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        for (const route of ["/", "/register", "/forgot-password"]) {
          await page.goto(route);
          await expect(page.getByTestId("cover-shell")).toBeVisible({ timeout: T });
          await page.waitForTimeout(2300); // let the one-shot route draw-in finish so shots are stable
          const name = `cover${route === "/" ? "-root" : route.replace("/", "-")}-${w}-${scheme}.png`;
          const png = await page.screenshot({ fullPage: true });
          await testInfo.attach(name, { body: png, contentType: "image/png" });
          if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            fs.writeFileSync(path.join(SHOTS, name), png);
          }
          expect(await page.getByTestId("cover-shell").evaluate((el) => getComputedStyle(el).backgroundColor), name).toBe(PAPER);
        }
      }
    });
  }
});
