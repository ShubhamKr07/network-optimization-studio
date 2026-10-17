// Minimal client-side CSV writer + file download, shared by the client-built
// exports (JADE Flows' per-leg tables, Solution Summary compare). Moved out of
// JadeFlowsTab.tsx (SCU-1.3) so there is exactly one copy. SCU-1.R added
// `\r` quoting and a formula-injection guard for non-numeric strings.
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

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** `<base>.<format>` download; objects are pretty-printed JSON, strings pass through. */
export function downloadAs(base: string, format: "csv" | "json", data: string | object): void {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  downloadTextFile(`${base}.${format}`, text, format === "csv" ? "text/csv" : "application/json");
}
