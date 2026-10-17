// SCU-2.P3 — click one Download ▾ item and read back the file the browser
// actually saved (a real `download` event, not a spy), so a spec can assert
// the file name and row completeness.
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

export async function downloadVia(page: Page, triggerTestId: string, itemTestId: string): Promise<{ name: string; text: string }> {
  await page.getByTestId(triggerTestId).click({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.getByTestId(itemTestId).click({ timeout: 10_000 }),
  ]);
  const path = await download.path();
  if (!path) throw new Error(`download ${download.suggestedFilename()} has no local path`);
  return { name: download.suggestedFilename(), text: await readFile(path, "utf8") };
}

/** The data lines of a one-header-line CSV (blank trailing lines ignored). */
export function csvDataLines(text: string): string[] {
  return text.split("\n").filter(line => line.trim() !== "").slice(1);
}

/**
 * Download the CSV then the JSON via `<trigger>` -> `<trigger>-csv|-json` and
 * assert the contract every output table shares: CSV file name, optional
 * header line, `rows` data lines (default: whatever the CSV carries), JSON
 * `entity`, `unit` (`null` = the envelope must carry none; omit = unchecked)
 * and a JSON row count equal to the CSV's.
 */
export async function expectCsvJsonDownload(
  page: Page,
  triggerTestId: string,
  opts: { csvName: string; entity: string; unit?: string | null; rows?: number; csvHeader?: string },
) {
  const csv = await downloadVia(page, triggerTestId, `${triggerTestId}-csv`);
  expect(csv.name).toBe(opts.csvName);
  if (opts.csvHeader) expect(csv.text.split("\n")[0]).toBe(opts.csvHeader);
  const dataLines = csvDataLines(csv.text);
  if (opts.rows != null) expect(dataLines).toHaveLength(opts.rows);
  const json = JSON.parse((await downloadVia(page, triggerTestId, `${triggerTestId}-json`)).text);
  expect(json.entity).toBe(opts.entity);
  if (opts.unit === null) expect("unit" in json).toBe(false);
  else if (opts.unit !== undefined) expect(json.unit).toBe(opts.unit);
  expect(json.rows).toHaveLength(opts.rows ?? dataLines.length);
  return { csv, json };
}
