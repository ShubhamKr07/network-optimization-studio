import { sql, type SQL } from "drizzle-orm";
import { getManifest } from "../registry/modelRegistry.js";

const TZ = "America/Chicago";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const chicagoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1;
// Date.parse rolls impossible dates forward ("2026-02-30" → 2 March), so round-trip
// the components and reject anything that changed (plan review F1).
const isRealDate = (d: string) => {
  if (!DATE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

export type AdminRange = { from: string; to: string; modelId?: string };
export function parseAdminRange(q: Record<string, unknown>, now = new Date(), opts: { allowModel?: boolean } = {}): { ok: true; range: AdminRange } | { ok: false; error: string } {
  const { from, to, modelId } = q;
  if (typeof from !== "string" || typeof to !== "string" || !isRealDate(from) || !isRealDate(to))
    return { ok: false, error: "Choose a start and end date." };
  if (from > to) return { ok: false, error: "The start date must be on or before the end date." };
  if (to > chicagoToday(now)) return { ok: false, error: "The end date can't be in the future." };
  if (days(from, to) > 90) return { ok: false, error: "Choose a range of 90 days or fewer." };
  if (opts.allowModel !== false && modelId !== undefined && (typeof modelId !== "string" || !getManifest(modelId))) return { ok: false, error: "That chapter model doesn't exist." };
  return { ok: true, range: { from, to, modelId: opts.allowModel === false ? undefined : (modelId as string | undefined) } };
}
// Chicago midnight → instant. date::timestamp AT TIME ZONE tz reads the wall clock in tz.
export const chicagoStart = (d: string): SQL => sql`((${d})::date::timestamp AT TIME ZONE ${TZ})`;
export const chicagoEnd = (d: string): SQL => sql`(((${d})::date + 1)::timestamp AT TIME ZONE ${TZ})`;
export const chicagoDay = (col: SQL): SQL => sql`((${col}) AT TIME ZONE ${TZ})::date`;
export const priorRange = (r: AdminRange): AdminRange => {
  const n = days(r.from, r.to), f = new Date(Date.parse(r.from) - n * 86_400_000), t = new Date(Date.parse(r.from) - 86_400_000);
  return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10), modelId: r.modelId };
};
