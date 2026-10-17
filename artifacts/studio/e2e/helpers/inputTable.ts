// SCU-2.P4.1 — Playwright helpers for the migrated input tables (Bundle 2 P4).
// The From/To boxes became FilterMenu text controls inside a popover (spec
// B2.2), Upload/Download became menus (B2.3/B2.4), and demand cells show
// grouped numbers (B2.9) — `Number("1,234")` is NaN, so read them here.
import { expect, type Locator, type Page } from "@playwright/test";

const TIMEOUT = 10_000;

/** Opens the active tab's FilterMenu (if closed) and types into `input-filter-{key}`. */
export async function fillTableFilter(page: Page, key: string, value: string): Promise<void> {
  const popover = page.getByTestId("filter-menu-popover");
  if (!(await popover.isVisible())) await page.getByTestId("button-filter-menu-trigger").click({ timeout: TIMEOUT });
  await expect(page.getByTestId(`input-filter-${key}`)).toBeVisible({ timeout: TIMEOUT });
  await page.getByTestId(`input-filter-${key}`).fill(value);
}

/** Closes an open FilterMenu / menu popover so it cannot cover the table. */
export async function closePopover(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-menu-popover")).toHaveCount(0, { timeout: TIMEOUT });
}

/** Opens a Download ▾ / Upload ▾ menu and clicks one item. */
export async function chooseMenuItem(page: Page, triggerTestId: string, itemTestId: string): Promise<void> {
  await page.getByTestId(triggerTestId).click({ timeout: TIMEOUT });
  await page.getByTestId(itemTestId).click({ timeout: TIMEOUT });
}

/** A grouped FormattedNumberInput value ("1,234.5") as a number. */
export async function readGroupedNumber(input: Locator): Promise<number> {
  return Number((await input.inputValue()).replace(/,/g, ""));
}

/** What a FormattedNumberInput shows for `n` (en-US grouping). */
export function grouped(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 20 });
}
