// QFX-2a — XLSX for the chapter per-table menus, entirely in the browser: the API only speaks CSV/JSON
// (openapi export enum `csv | json`), so a download is the CSV export re-written as one sheet and an upload
// is the first sheet converted to the CSV text the unchanged server CSV import parses.
// Production code reaches this module ONLY via `await import("@/lib/xlsxFile")`, which keeps SheetJS in its
// own lazy chunk (as superFiles.ts does).
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { XLSX_MIME } from "@/lib/clientCsv";
import { readFileAs } from "@/lib/superFiles";

/** A CSV field becomes a number cell only when it is a plain decimal; ids like 007, blanks and 1e5 stay text. */
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** One sheet named `sheetName`, same columns/order/header as the CSV. aoa_to_sheet writes strings as "s" cells, never formulas. */
export function csvTextToXlsxBlob(csvText: string, sheetName: string): Blob {
  const { data } = Papa.parse<string[]>(csvText, { delimiter: ",", skipEmptyLines: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data.map(row => row.map(v => (NUMERIC.test(v) ? Number(v) : v)))), sheetName);
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], { type: XLSX_MIME });
}

/** First sheet -> CSV text; the sheet name and every other sheet are ignored. rawNumbers keeps full precision
 *  (SheetJS's General format would print 33.749001234567 as 33.74900123). */
export async function xlsxFileToCsvText(file: File): Promise<{ ok: true; csvText: string } | { ok: false; message: string }> {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read((await readFileAs(file, "buffer")) as ArrayBuffer, { type: "array" }); }
  catch { return { ok: false, message: "The file is not a readable .xlsx workbook." }; }
  const first = wb.SheetNames[0];
  if (first === undefined) return { ok: false, message: "The workbook has no sheets." };
  const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[first]!, { rawNumbers: true, blankrows: false });
  if ((csvText.split("\n")[0] ?? "").replace(/,/g, "").trim() === "") return { ok: false, message: "The first sheet is empty." };
  return { ok: true, csvText };
}
