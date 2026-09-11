/** Numeric values only (drops "unknown"/blank/non-numeric). */
export function numeric(values: string[]): number[] {
  return values
    .filter((v) => v !== "" && v !== "unknown")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
}

/** Median of the numeric values, or "unknown" if none are numeric. */
export function medianOf(values: string[]): string {
  const nums = numeric(values).sort((a, b) => a - b);
  if (nums.length === 0) return "unknown";
  const mid = Math.floor(nums.length / 2);
  const med = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return String(Math.round(med * 100) / 100);
}

/** Fraction of rows whose `col` equals `value`, over rows where `col` is a known yes/no. */
export function rateOf(rows: Record<string, string>[], col: string, value: string): string {
  const known = rows.filter((r) => r[col] === "yes" || r[col] === "no");
  if (known.length === 0) return "unknown";
  const hit = known.filter((r) => r[col] === value).length;
  return `${Math.round((hit / known.length) * 100)}% (${hit}/${known.length})`;
}

/** Count occurrences of each distinct value of `col`. */
export function countBy(rows: Record<string, string>[], col: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r[col], (m.get(r[col]) ?? 0) + 1);
  return m;
}

/** ISO-8601 week id `YYYY-WW` for a date (Mon-based, week containing the year's first Thursday). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // to Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}
