// Minimal client-side CSV writer + file download, shared by the client-built
// exports (JADE Flows' per-leg tables, Solution Summary compare). Moved out of
// JadeFlowsTab.tsx (SCU-1.3) so there is exactly one copy; behaviour is
// byte-identical (same escaping, same `new Blob([text], { type })`).
export function csvCell(value: string | number): string {
  let s = String(value);
  // Spreadsheet formula injection: only STRING cells (names, labels). Numbers stay raw.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !(s.trim() !== "" && Number.isFinite(Number(s)))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export function downloadClientCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  downloadTextFile(filename, [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n"), "text/csv");
}
