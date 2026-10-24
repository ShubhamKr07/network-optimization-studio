// Minimal client-side CSV writer + file download, shared by the client-built
// exports (JADE Flows' per-leg tables, Solution Summary compare). Moved out of
// JadeFlowsTab.tsx (SCU-1.3) so there is exactly one copy. SCU-1.R added
// `\r` quoting and a formula-injection guard for non-numeric strings.
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** `<input type="file" accept>` per import/upload format. */
export const FILE_ACCEPT: Record<DownloadFormat, string> = { csv: ".csv,text/csv", json: ".json,application/json", xlsx: `.xlsx,${XLSX_MIME}` };

export function csvCell(value: string | number): string {
  let s = String(value);
  // Spreadsheet formula injection: only STRING cells (names, labels). Numbers stay raw.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !(s.trim() !== "" && Number.isFinite(Number(s)))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells -> CSV text (no trailing newline). */
export function csvText(lines: Array<Array<string | number>>): string {
  return lines.map(line => line.map(csvCell).join(",")).join("\n");
}

export function downloadBlob(filename: string, data: BlobPart, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  downloadBlob(filename, text, mimeType);
}

/** `<base>.<format>` download; objects are pretty-printed JSON, strings pass through.
 *  QFX-2a — xlsx takes CSV text and saves a one-sheet workbook named `base` (SheetJS is loaded on demand). The csv/json
 *  branch still runs synchronously inside the call (before any await), exactly as before. */
export async function downloadAs(base: string, format: DownloadFormat, data: string | object): Promise<void> {
  if (format === "xlsx") {
    if (typeof data !== "string") throw new Error("XLSX downloads are built from CSV text");
    const { csvTextToXlsxBlob } = await import("@/lib/xlsxFile");
    return downloadBlob(`${base}.xlsx`, csvTextToXlsxBlob(data, base), XLSX_MIME);
  }
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  downloadTextFile(`${base}.${format}`, text, format === "csv" ? "text/csv" : "application/json");
}
