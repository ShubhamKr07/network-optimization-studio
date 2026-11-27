import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { monthlySpendUsd, monthlyCapUsd } from "../watbot/limits.js";
import { CLAIM_REMOVED_NOTICE, REFUSED_NOTICE, STOPPED_NOTICE, FAILED_NOTICE } from "../watbot/engine.js";
import { chicagoStart, chicagoEnd, chicagoDay, priorRange, roleAllowlist, type AdminRange } from "./adminRange.js";

// Wording of the drop notice before 2026-11-25; both texts still sit in old rows.
const OLD_CLAIM_REMOVED = "One claim was removed — I couldn't support it with a course source.";
const DROP_TEXTS = [CLAIM_REMOVED_NOTICE, OLD_CLAIM_REMOVED];

const inRange = (col: SQL, r: AdminRange) => sql`${col} >= ${chicagoStart(r.from)} AND ${col} < ${chicagoEnd(r.to)}`;
const model = (r: AdminRange) => (r.modelId ? sql`AND c.model_id = ${r.modelId}` : sql``);
const textIn = (texts: string[]) => sql.join(texts.map(t => sql`${t}`), sql`, `);
const rowsOf = async <T>(q: SQL) => (await db.execute(q)).rows as T[];
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export const blankDay = (date: string) => ({
  date, asked: 0, answered: 0, cancelled: 0, unavailable: 0, limitReached: 0, ratings: 0, helped: 0,
  notices: 0, refused: 0, stopped: 0, failedNotices: 0, costUsd: 0,
  latencyMedianMs: null as number | null, latencyP95Ms: null as number | null, estimated: 0,
});

// Allowlisted messages in range, with their conversation's model and Chicago day.
const base = (r: AdminRange) => sql`
  SELECT m.*, c.model_id, ${chicagoDay(sql`m.created_at`)} AS day
  FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.user_id
  WHERE m.role IN ('student', 'tutor', 'notice') AND ${roleAllowlist(r)} AND ${inRange(sql`m.created_at`, r)} ${model(r)}`;

export const daysQuery = (r: AdminRange) => sql`
    WITH d AS (SELECT generate_series(${r.from}::date, ${r.to}::date, interval '1 day')::date AS date), b AS (${base(r)})
    SELECT d.date::text AS date,
      count(*) FILTER (WHERE b.role = 'student') AS asked,
      count(*) FILTER (WHERE b.role = 'student' AND b.status = 'answered') AS answered,
      count(*) FILTER (WHERE b.role = 'student' AND b.status = 'cancelled') AS cancelled,
      count(*) FILTER (WHERE b.role = 'student' AND b.status = 'unavailable') AS unavailable,
      count(*) FILTER (WHERE b.role = 'student' AND b.status = 'limit_reached') AS limit_reached,
      coalesce(sum((b.usage->>'costUsd')::numeric) FILTER (WHERE b.role = 'tutor'), 0) AS cost_usd,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY b.latency_ms) FILTER (WHERE b.role = 'tutor') AS latency_median_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY b.latency_ms) FILTER (WHERE b.role = 'tutor') AS latency_p95_ms,
      count(*) FILTER (WHERE b.role = 'tutor' AND (b.usage->>'estimated')::boolean) AS estimated
    FROM d LEFT JOIN b ON b.day = d.date GROUP BY d.date ORDER BY d.date`;

async function dayRows(r: AdminRange) {
  const days = rowsOf<Record<string, string | null>>(daysQuery(r));
  // A notice belongs to the nearest earlier tutor row in its conversation with no student row between (spec §4.1).
  // FAILED_NOTICE may have no tutor row, so it is kept regardless and counted on its own.
  const notices = rowsOf<{ day: string; notices: string; refused: string; stopped: string; failed: string }>(sql`
    WITH b AS (${base(r)}), note AS (
      SELECT n.blocks->0->>'text' AS text, n.day::text AS day, t.id AS tutor_id
      FROM b n
      LEFT JOIN LATERAL (SELECT max(id) AS id FROM watbot_messages WHERE conversation_id = n.conversation_id AND role = 'tutor' AND id < n.id) t ON true
      LEFT JOIN LATERAL (SELECT max(id) AS id FROM watbot_messages WHERE conversation_id = n.conversation_id AND role = 'student' AND id < n.id) s ON true
      WHERE n.role = 'notice' AND (t.id > coalesce(s.id, 0) OR n.blocks->0->>'text' = ${FAILED_NOTICE}))
    SELECT day,
      count(DISTINCT tutor_id) FILTER (WHERE text IN (${textIn(DROP_TEXTS)})) AS notices,
      count(DISTINCT tutor_id) FILTER (WHERE text = ${REFUSED_NOTICE}) AS refused,
      count(DISTINCT tutor_id) FILTER (WHERE text = ${STOPPED_NOTICE}) AS stopped,
      count(*) FILTER (WHERE text = ${FAILED_NOTICE}) AS failed
    FROM note GROUP BY day`);
  const ratings = rowsOf<{ day: string; ratings: string; helped: string }>(sql`
    SELECT ${chicagoDay(sql`f.created_at`)}::text AS day, count(*) AS ratings, count(*) FILTER (WHERE f.helped) AS helped
    FROM watbot_feedback f JOIN watbot_conversations c ON c.id = f.conversation_id JOIN users u ON u.id = f.user_id
    WHERE ${roleAllowlist(r)} AND ${inRange(sql`f.created_at`, r)} ${model(r)} GROUP BY 1`);
  const [d, n, f] = await Promise.all([days, notices, ratings]);
  const byDate = new Map(d.map(row => [row.date!, blankDay(row.date!)]));
  for (const row of d) {
    Object.assign(byDate.get(row.date!)!, {
      asked: num(row.asked), answered: num(row.answered), cancelled: num(row.cancelled), unavailable: num(row.unavailable),
      limitReached: num(row.limit_reached), costUsd: Math.round(num(row.cost_usd) * 1e4) / 1e4,
      latencyMedianMs: numOrNull(row.latency_median_ms), latencyP95Ms: numOrNull(row.latency_p95_ms), estimated: num(row.estimated),
    });
  }
  for (const row of n) Object.assign(byDate.get(row.day) ?? {}, { notices: num(row.notices), refused: num(row.refused), stopped: num(row.stopped), failedNotices: num(row.failed) });
  for (const row of f) Object.assign(byDate.get(row.day) ?? {}, { ratings: num(row.ratings), helped: num(row.helped) });
  return [...byDate.values()];
}

// The view's rule (gap > 30 min starts a session, per user and model), inline so the allowlist and range apply.
const sessionGroups = (r: AdminRange) => sql`
  WITH m AS (SELECT m.user_id, c.model_id, m.created_at,
    CASE WHEN lag(m.created_at) OVER w IS NULL OR m.created_at - lag(m.created_at) OVER w > interval '30 minutes' THEN 1 ELSE 0 END AS is_new
    FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.user_id
    WHERE m.role = 'student' AND m.status = 'answered' AND ${roleAllowlist(r)} AND ${inRange(sql`m.created_at`, r)} ${model(r)}
    WINDOW w AS (PARTITION BY m.user_id, c.model_id ORDER BY m.created_at)),
  s AS (SELECT *, sum(is_new) OVER (PARTITION BY user_id, model_id ORDER BY created_at ROWS UNBOUNDED PRECEDING) AS sn FROM m),
  g AS (SELECT user_id, model_id, sn, min(created_at) AS a, max(created_at) AS b, count(*) AS n FROM s GROUP BY 1, 2, 3)`;

async function period(r: AdminRange) {
  const [tot, byModel, fb, notHelped, reports, gaps, sess] = await Promise.all([
    rowsOf<Record<string, string>>(sql`
      WITH b AS (${base(r)}) SELECT
        count(*) FILTER (WHERE role = 'student' AND status = 'answered') AS answered,
        count(DISTINCT user_id) FILTER (WHERE role = 'student' AND status = 'answered') AS active,
        coalesce(sum((usage->>'costUsd')::numeric) FILTER (WHERE role = 'tutor'), 0) AS cost,
        coalesce(sum((usage->>'inputTokens')::bigint) FILTER (WHERE role = 'tutor'), 0) AS i,
        coalesce(sum((usage->>'outputTokens')::bigint) FILTER (WHERE role = 'tutor'), 0) AS o,
        coalesce(sum((usage->>'cacheReadTokens')::bigint) FILTER (WHERE role = 'tutor'), 0) AS cr,
        coalesce(sum((usage->>'cacheWriteTokens')::bigint) FILTER (WHERE role = 'tutor'), 0) AS cw FROM b`),
    rowsOf<{ model_id: string; students: string }>(sql`
      WITH b AS (${base(r)}) SELECT model_id, count(DISTINCT user_id) AS students FROM b
      WHERE role = 'student' AND status = 'answered' GROUP BY 1 ORDER BY 2 DESC, 1`),
    rowsOf<Record<string, string>>(sql`
      SELECT count(*) AS ratings, count(*) FILTER (WHERE f.helped) AS helped, count(*) FILTER (WHERE f.repair_message_id IS NOT NULL) AS reanswered
      FROM watbot_feedback f JOIN watbot_conversations c ON c.id = f.conversation_id JOIN users u ON u.id = f.user_id
      WHERE ${roleAllowlist(r)} AND ${inRange(sql`f.created_at`, r)} ${model(r)}`),
    rowsOf<{ reason: string | null; count: string }>(sql`
      SELECT coalesce(f.reason, 'other') AS reason, count(*) AS count
      FROM watbot_feedback f JOIN watbot_conversations c ON c.id = f.conversation_id JOIN users u ON u.id = f.user_id
      WHERE NOT f.helped AND ${roleAllowlist(r)} AND ${inRange(sql`f.created_at`, r)} ${model(r)} GROUP BY 1 ORDER BY 2 DESC, 1`),
    rowsOf<{ reason: string | null; count: string }>(sql`
      SELECT coalesce(p.reason, 'other') AS reason, count(*) AS count
      FROM watbot_reports p JOIN watbot_messages m ON m.id = p.message_id JOIN watbot_conversations c ON c.id = m.conversation_id JOIN users u ON u.id = p.user_id
      WHERE ${roleAllowlist(r)} AND ${inRange(sql`p.created_at`, r)} ${model(r)} GROUP BY 1 ORDER BY 2 DESC, 1`),
    // "<topic> (nearest covered: <nearest>)" split by the exact stored pattern; a non-match is grouped whole.
    rowsOf<{ key: string; topic: string; nearest: string | null; n: string; first: Date }>(sql`
      WITH b AS (${base(r)})
      SELECT coalesce(lower(trim(p[1])), lower(trim(g))) AS key,
             min(coalesce(trim(p[1]), trim(g)) COLLATE "C") AS topic, trim(p[2]) AS nearest, count(*) AS n, min(created_at) AS first
      FROM (SELECT gap_topic AS g, created_at, regexp_match(gap_topic, '^(.*) \\(nearest covered: (.*)\\)$') AS p FROM b WHERE role = 'tutor' AND gap_topic IS NOT NULL) x
      GROUP BY 1, 3`),
    rowsOf<{ sessions: string; mm: string; mq: string }>(sql`${sessionGroups(r)}
      SELECT count(*) AS sessions,
        coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM b - a) / 60), 0) AS mm,
        coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY n), 0) AS mq FROM g`),
  ]);
  const t = tot[0]!, f = fb[0]!, s = sess[0]!;
  // nearestCovered: the most frequent label in the group; a tie goes to the one seen first.
  const groups = new Map<string, { topic: string; count: number; nearest: Map<string, { n: number; first: Date }> }>();
  for (const g of gaps) {
    const e = groups.get(g.key) ?? { topic: g.topic, count: 0, nearest: new Map() };
    // COLLATE "C" ordering: the capitalised spelling is the display name.
    if (g.topic < e.topic) e.topic = g.topic;
    e.count += num(g.n);
    if (g.nearest != null) e.nearest.set(g.nearest, { n: num(g.n), first: g.first });
    groups.set(g.key, e);
  }
  const gapTopics = [...groups.values()]
    .map(e => ({ topic: e.topic, count: e.count, nearestCovered: [...e.nearest].sort((a, b) => b[1].n - a[1].n || (+a[1].first - +b[1].first))[0]?.[0] ?? null }))
    .sort((a, b) => b.count - a.count || (a.topic < b.topic ? -1 : 1)).slice(0, 20);
  return {
    answered: num(t.answered), activeStudents: num(t.active),
    studentsByModel: byModel.map(x => ({ modelId: x.model_id, students: num(x.students) })),
    sessions: num(s.sessions), sessionMedianMinutes: num(s.mm), sessionMedianQuestions: num(s.mq),
    ratings: num(f.ratings), helped: num(f.helped),
    notHelpedByReason: notHelped.map(x => ({ reason: x.reason!, count: num(x.count) })),
    reanswered: num(f.reanswered),
    reportsByReason: reports.map(x => ({ reason: x.reason!, count: num(x.count) })),
    costUsd: Math.round(num(t.cost) * 1e4) / 1e4,
    tokens: { input: num(t.i), output: num(t.o), cacheRead: num(t.cr), cacheWrite: num(t.cw) },
    gapTopics,
  };
}

export async function getAdminMetrics(range: AdminRange, now = new Date()) {
  const [days, matrix, cur, prior, weeks, spendUsd] = await Promise.all([
    dayRows(range),
    rowsOf<{ model_id: string; message_type: string | null; answered: string }>(sql`
      WITH b AS (${base(range)}) SELECT model_id, message_type, count(*) AS answered FROM b
      WHERE role = 'student' AND status = 'answered' GROUP BY 1, 2 ORDER BY 1, 2`),
    period(range), period(priorRange(range)),
    rowsOf<{ week: string; sessions: string; mm: string; mq: string }>(sql`${sessionGroups(range)}
      SELECT (date_trunc('week', a AT TIME ZONE 'America/Chicago'))::date::text AS week, count(*) AS sessions,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM b - a) / 60) AS mm,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS mq
      FROM g GROUP BY 1 ORDER BY 1`),
    monthlySpendUsd(now),
  ]);
  return {
    days,
    matrix: matrix.map(m => ({ modelId: m.model_id, messageType: m.message_type, answered: num(m.answered) })),
    period: cur, prior,
    sessionsByWeek: weeks.map(w => ({ weekStart: w.week, sessions: num(w.sessions), medianMinutes: num(w.mm), medianQuestions: num(w.mq) })),
    // Unfiltered by design: the cap is enforced on all spend, in a UTC month (spec §4.1).
    monthToDate: { spendUsd, capUsd: monthlyCapUsd(), month: now.toISOString().slice(0, 7) },
  };
}
