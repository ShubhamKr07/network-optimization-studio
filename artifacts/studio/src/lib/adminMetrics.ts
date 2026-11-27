// Pure helpers for the admin dashboard. Days are US Central (America/Chicago),
// the same boundary the API uses; dates travel as YYYY-MM-DD strings.

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => toIso(toMs(d) + n * DAY_MS);

/** A real calendar date in YYYY-MM-DD form (date inputs emit "" when cleared). */
export const isIsoDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && toIso(toMs(d)) === d;

export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
}

export function presetRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = chicagoToday(now);
  return { from: addDays(to, -(days - 1)), to };
}

/** Monday on or before the given calendar date. */
export function weekStartOf(d: string): string {
  const dow = new Date(toMs(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** Sum the numeric `keys` of daily rows into Monday-first weeks, ascending. */
export function weekly<K extends string>(
  days: Array<{ date: string } & Record<K, number>>,
  keys: K[],
): Array<{ weekStart: string } & Record<K, number>> {
  const out = new Map<string, { weekStart: string } & Record<K, number>>();
  for (const day of days) {
    const ws = weekStartOf(day.date);
    let w = out.get(ws);
    if (!w) {
      w = { weekStart: ws } as { weekStart: string } & Record<K, number>;
      for (const k of keys) w[k] = 0 as never;
      out.set(ws, w);
    }
    for (const k of keys) w[k] = (w[k] + day[k]) as never;
  }
  return [...out.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export const MIN_N = 5;
/** A rate, or null (shown as "–") when fewer than 5 observations back it. */
export const rateOrDash = (num: number, n: number): number | null => (n < MIN_N ? null : num / n);

/** 0 → -1 (empty cell); the rest into 5 steps cut at the 20/40/60/80% quantiles of the non-zero values. */
export function heatBins(values: number[]): number[] {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((f) => nz[Math.max(0, Math.floor(f * nz.length) - 1)] ?? 0);
  return values.map((v) => (v <= 0 ? -1 : cuts.filter((c) => v > c).length));
}

/** Percent change of a over b; null without a base. */
export const delta = (a: number, b: number): number | null => (b === 0 ? null : ((a - b) / b) * 100);

// Display formatters (en-US; text only, never HTML).
export const num = (v: number) => new Intl.NumberFormat("en-US").format(v);
export const usd = (v: number, d = 2) => `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}`;
export const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
export const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  concept_question: "Concept",
  incorrect_attempt: "Incorrect attempt",
  correct_attempt: "Correct attempt",
  stuck_or_wants_answer: "Stuck",
  off_topic: "Off-topic",
};
export const UNRECORDED = "Unrecorded";

/** Anthropic's input_tokens excludes cache reads, so the share is over all input-side tokens. */
export const cacheShare = (t: { input: number; cacheRead: number; cacheWrite: number }): number => {
  const all = t.input + t.cacheRead + t.cacheWrite;
  return all ? t.cacheRead / all : 0;
};

export const REASON: Record<string, string> = {
  too_many_questions: "Too many questions", hard_to_follow: "Hard to follow", not_what_i_asked: "Not what I asked", still_stuck: "Still stuck", other: "Other",
  wrong_or_misleading: "Wrong or misleading", citation_unsupported: "Citation doesn't support it",
};
