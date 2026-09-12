// Standalone script (see run.ts) — not part of any shipped app package.
// Talks to PostHog's HogQL query API to pull the previous week's usage
// aggregates for the weekly product-insights report (POSTHOG-8/9).
//
// `toAggregates` is kept pure and dependency-free so it can be exercised
// against a fixture with zero network access (see queryPosthog.test.ts) —
// `queryHogQL`/`queryWeeklyAggregates` are the only impure boundaries in
// this file.

export type WeeklyAggregates = {
  funnelsByModel: Record<
    string,
    { created: number; solveTriggered: number; solveCompleted: number; exported: number }
  >;
  staleResolveRate: number;
  failuresByModel: Record<string, number>;
  rejectionsByModel: Record<string, number>;
  runtimeP50: number;
  runtimeP95: number;
  cacheHitRate: number;
};

// The shape PostHog's `/api/projects/@current/query/` endpoint returns for
// a HogQLQuery — a flat rectangular result set (rows of column values), not
// nested JSON. `toAggregates` treats each row as [event, model_id, count].
export type HogQLResponse = { results: unknown[][]; columns: string[] };

export interface QueryOpts {
  projectKey: string;
  personalApiKey: string;
  host: string;
}

// Per-model event counts, last 7 days. Covers every funnel/failure/
// rejection/stale-resolve field `toAggregates` derives per model_id. Event
// names match the 26-events-strong existing PostHog convention verbatim
// (see docs/product-insights/POSTHOG-AUDIT.md) — this script never renames
// or reinterprets them.
export const FUNNEL_HOGQL = `/* per-model event counts, last 7 days */
SELECT event, properties.model_id AS model_id, count() AS c
FROM events
WHERE timestamp >= now() - INTERVAL 7 DAY
  AND event IN ('scenario created','solve triggered','scenario solve completed',
                'scenario data exported','scenario solve failed','scenario solve rejected',
                'scenario stale resolved')
GROUP BY event, model_id`;

// Global (not per-model) runtime percentiles + cache-hit totals, last 7
// days. Emitted as synthetic "event" rows with model_id = NULL so the
// response can be merged into the same flat {results, columns} shape the
// funnel query returns and reduced by one shared `toAggregates` pass.
export const RUNTIME_CACHE_HOGQL = `/* runtime percentiles + cache-hit totals, last 7 days */
SELECT 'run_time_sec_p50' AS event, NULL AS model_id,
       quantile(0.5)(toFloat(properties.run_time_sec)) AS c
FROM events WHERE timestamp >= now() - INTERVAL 7 DAY AND event = 'scenario solve completed'
UNION ALL
SELECT 'run_time_sec_p95' AS event, NULL AS model_id,
       quantile(0.95)(toFloat(properties.run_time_sec)) AS c
FROM events WHERE timestamp >= now() - INTERVAL 7 DAY AND event = 'scenario solve completed'
UNION ALL
SELECT 'cache_hit_total' AS event, NULL AS model_id,
       toFloat(countIf(toString(properties.cache_hit) = 'true')) AS c
FROM events WHERE timestamp >= now() - INTERVAL 7 DAY AND event = 'scenario solve completed'
UNION ALL
SELECT 'cache_query_total' AS event, NULL AS model_id, toFloat(count()) AS c
FROM events WHERE timestamp >= now() - INTERVAL 7 DAY AND event = 'scenario solve completed'`;

export async function queryHogQL(query: string, opts: QueryOpts): Promise<HogQLResponse> {
  const res = await fetch(`${opts.host}/api/projects/@current/query/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.personalApiKey}` },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PostHog query failed: ${res.status} ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<HogQLResponse>;
}

// Pure — parses a raw HogQL response (or the test fixture) into typed
// aggregates. Rows are [event, model_id, count]; model_id is null on the
// global runtime/cache rows emitted by RUNTIME_CACHE_HOGQL. Unknown event
// values are ignored rather than thrown on, matching this codebase's
// "degrade, never throw" convention for auxiliary/reporting code (see the
// solver wrapper's own never-throw contract in CLAUDE.md's gotchas).
export function toAggregates(raw: HogQLResponse): WeeklyAggregates {
  const funnelsByModel: WeeklyAggregates["funnelsByModel"] = {};
  const failuresByModel: Record<string, number> = {};
  const rejectionsByModel: Record<string, number> = {};
  const staleResolvedByModel: Record<string, number> = {};

  let runtimeP50 = 0;
  let runtimeP95 = 0;
  let cacheHitTotal = 0;
  let cacheQueryTotal = 0;

  const ensureModel = (modelId: string) => {
    const existing = funnelsByModel[modelId];
    if (existing) return existing;
    const created = { created: 0, solveTriggered: 0, solveCompleted: 0, exported: 0 };
    funnelsByModel[modelId] = created;
    return created;
  };

  for (const row of raw.results) {
    const event = row[0] as string;
    const modelId = row[1] as string | null;
    const count = Number(row[2]);

    switch (event) {
      case "scenario created":
        if (modelId) ensureModel(modelId).created += count;
        break;
      case "solve triggered":
        if (modelId) ensureModel(modelId).solveTriggered += count;
        break;
      case "scenario solve completed":
        if (modelId) ensureModel(modelId).solveCompleted += count;
        break;
      case "scenario data exported":
        if (modelId) ensureModel(modelId).exported += count;
        break;
      case "scenario solve failed":
        if (modelId) failuresByModel[modelId] = (failuresByModel[modelId] ?? 0) + count;
        break;
      case "scenario solve rejected":
        if (modelId) rejectionsByModel[modelId] = (rejectionsByModel[modelId] ?? 0) + count;
        break;
      case "scenario stale resolved":
        if (modelId) staleResolvedByModel[modelId] = (staleResolvedByModel[modelId] ?? 0) + count;
        break;
      case "run_time_sec_p50":
        runtimeP50 = count;
        break;
      case "run_time_sec_p95":
        runtimeP95 = count;
        break;
      case "cache_hit_total":
        cacheHitTotal = count;
        break;
      case "cache_query_total":
        cacheQueryTotal = count;
        break;
      default:
        // Unknown event kind (e.g. schema drift on the PostHog side) —
        // ignore rather than throw. This is a reporting script, never a
        // request-path dependency; a bad row should degrade the report,
        // not crash the weekly job.
        break;
    }
  }

  const totalSolveTriggered = Object.values(funnelsByModel).reduce(
    (sum, m) => sum + m.solveTriggered,
    0,
  );
  const totalStaleResolved = Object.values(staleResolvedByModel).reduce((sum, v) => sum + v, 0);
  const staleResolveRate = totalSolveTriggered > 0 ? totalStaleResolved / totalSolveTriggered : 0;
  const cacheHitRate = cacheQueryTotal > 0 ? cacheHitTotal / cacheQueryTotal : 0;

  return {
    funnelsByModel,
    staleResolveRate,
    failuresByModel,
    rejectionsByModel,
    runtimeP50,
    runtimeP95,
    cacheHitRate,
  };
}

export async function queryWeeklyAggregates(opts: QueryOpts): Promise<WeeklyAggregates> {
  const [funnel, runtimeCache] = await Promise.all([
    queryHogQL(FUNNEL_HOGQL, opts),
    queryHogQL(RUNTIME_CACHE_HOGQL, opts),
  ]);
  return toAggregates({
    columns: funnel.columns,
    results: [...funnel.results, ...runtimeCache.results],
  });
}
