// SCU-2.P3 — click one Download ▾ item and read back the file the browser
// actually saved (a real `download` event, not a spy), so a spec can assert
// the file name and row completeness.
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export async function downloadVia(page: Page, triggerTestId: string, itemTestId: string): Promise<{ name: string; text: string }> {
  await page.getByTestId(triggerTestId).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(itemTestId).click()]);
  const path = await download.path();
  if (!path) throw new Error(`download ${download.suggestedFilename()} has no local path`);
  return { name: download.suggestedFilename(), text: await readFile(path, "utf8") };
}

/** The data lines of a one-header-line CSV (blank trailing lines ignored). */
export function csvDataLines(text: string): string[] {
  return text.split("\n").filter(line => line.trim() !== "").slice(1);
}
