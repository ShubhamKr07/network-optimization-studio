import { eq, inArray } from "drizzle-orm";
import { roundForFile, assignBandOrOverflow, OVERFLOW_BAND } from "@workspace/units";
import { db, pool, scenariosTable } from "@workspace/db";

// One-off backfill of persisted override precision (WF-8, completing WF-7 /
// FU-2 / D5 of docs/superpowers/specs/2026-10-09-write-failure-feedback-design.md).
// Running it against production is a separate, human-gated operation -- see the
// "Override-precision backfill" section of docs/ops/ch4-miles-migration-runbook.md.
//
// WF-7 made import store `roundForFile(fromDisplay(...))`, so stored == exported
// for every NEW write. Rows written before it still hold the full-precision
// converted double and therefore differ from their own 4 dp export, which makes
// a re-import of an untouched export report a changed row nobody edited. This
// rounds those rows.

export interface RoundReport {
  rounded: number[];
  refused: Array<{ id: number; reason: string }>;
  alreadyRounded: number[];
  dryRun: boolean;
}

type Db = typeof db;

interface Override { fromId?: string; toId?: string; [k: string]: unknown }

// The three distance-bearing import entities WF-7 rounded (`distances`,
// `laneCosts`, `legDistances`) persist into only TWO `inputs` keys. There is no
// `legDistanceOverrides` key anywhere in the repo -- services/import.ts's
// `legDistances` branch diffs and writes `distanceOverrides` (the same key
// p-median's `distances` uses), so that entity is covered by the first entry
// here and a third entry would match nothing. Hard rule #8: the plan listed a
// `legDistanceOverrides` key, the repo does not have one, the repo wins. Both
// value fields are canonical distances in the model's canonical unit --
// transport-coal's lane "cost" is literally geographic miles (templates.ts), not
// a $/unit-distance rate, which is why it rounds through the same helper.
const OVERRIDE_FIELDS = [
  { key: "distanceOverrides", value: "distance" },
  { key: "laneCostOverrides", value: "cost" },
] as const;

/**
 * The band boundary VALUE a band index names, or `null` for the overflow
 * sentinel. `assignBandOrOverflow` sorts `bands` itself on every call, so
 * sorting again here just re-derives the same order to index into.
 */
function bandValue(idx: number, bands: number[]): number | null {
  return idx === OVERFLOW_BAND ? null : ([...bands].sort((a, b) => a - b)[idx] ?? null);
}

/**
 * Does rounding `v` change which band it is REPORTED IN?
 *
 * Delegates the membership test itself to `lib/units/src/bands.ts`'s
 * `assignBandOrOverflow` -- the one authority `bandCoverage` is computed
 * from -- rather than re-deriving the same "<=", numeric-sort, overflow-
 * sentinel semantics here. A hand-rolled copy would not follow if that
 * authority's comparison ever changed, and this guard's entire purpose is to
 * match it.
 *
 * Membership, not an interval. An interval test (`min < band <= max`) is wrong
 * in both directions and was corrected here after being checked:
 *   - 449.99996 -> 450.0 : interval says "crosses 450"; membership says NO,
 *     because both are <= 450 and therefore both inside that band. False
 *     positive, and it was this plan's original test fixture.
 *   - 450.00004 -> 450.0 : interval says nothing; membership says YES -- the
 *     value moves from the overflow bucket INTO the 450 band. This is the real
 *     case and the interval test missed it.
 */
function crossesBand(v: number, bands: number[]): { from: number | null; to: number | null } | null {
  const r = roundForFile(v);
  if (r === v) return null;
  const before = assignBandOrOverflow(v, bands);
  const after = assignBandOrOverflow(r, bands);
  if (before === after) return null;
  return { from: bandValue(before, bands), to: bandValue(after, bands) };
}

/**
 * Rounds over-precise override values to roundForFile's 4 dp so stored ==
 * exported (FU-2, D5). Deliberately does NOT clear `result` or bump the solve
 * epoch: distance bands are a reporting lens, not model constraints, so a
 * rounded value changes no solve -- PROVIDED it does not cross a band
 * boundary, which would change `result.metrics.bandCoverage` in the cached
 * envelope and make it disagree with a client-side recompute. Such a row is
 * REFUSED and reported rather than decided for the operator, because the
 * choice between a changed band attribution and forcing a re-solve of a
 * student's saved work is theirs.
 *
 * WF-8 deviation from the brief, second refusal reason: rounding can take a
 * positive value to exactly 0 (`0.00004 -> 0`). Most override schemas in
 * validation/inputs/** require `positive()`, where writing that produces a
 * row the running server can no longer load -- ch4ToMiles.ts's documented
 * lesson ("integer rounding turns valid persisted rows invalid") reached by a
 * different route. Two schemas (jadeInputs.ts's distance, delivery.ts's
 * laneCost) use `nonnegative()` instead and would accept it, but a real
 * value rounding to exactly free/zero-distance is a semantic change either
 * way, so it's refused regardless of which schema the row's model uses: the
 * operator decides.
 *
 * `dryRun` performs the FULL analysis -- selects every row in scope,
 * classifies each -- and simply does not write. A dry run that cannot predict
 * its own effect has no purpose.
 *
 * `scenarioIds` narrows the scan. Unlike ch4ToMiles.ts this migration has NO
 * model scope (over-precision is model-independent), so an unfiltered call is
 * a whole-`scenarios`-table rewrite: every test MUST pass its own fixture ids,
 * or a plain `pnpm --filter api-server test` runs the production backfill
 * against whatever `DATABASE_URL` happens to be pointed at.
 */
export async function roundAll(
  database: Db = db,
  dryRun = false,
  scenarioIds?: number[],
): Promise<RoundReport> {
  const report: RoundReport = { rounded: [], refused: [], alreadyRounded: [], dryRun };
  // An explicit empty filter means "no rows in scope", not "every row".
  if (scenarioIds != null && scenarioIds.length === 0) return report;

  const rows = await database
    .select({ id: scenariosTable.id, inputs: scenariosTable.inputs })
    .from(scenariosTable)
    .where(scenarioIds == null ? undefined : inArray(scenariosTable.id, scenarioIds));

  for (const row of rows) {
    const inputs = row.inputs as Record<string, unknown> | null;
    if (inputs == null) continue;
    const bands = Array.isArray(inputs.distanceBands)
      ? (inputs.distanceBands as unknown[]).filter((b): b is number => typeof b === "number")
      : [];

    let changed = false;
    const refusals: string[] = [];
    const next: Record<string, unknown> = { ...inputs };

    for (const { key, value } of OVERRIDE_FIELDS) {
      const list = inputs[key];
      if (!Array.isArray(list)) continue;
      const updated = (list as Override[]).map((o) => {
        const v = o[value];
        if (typeof v !== "number") return o;
        const r = roundForFile(v);
        if (r === v) return o;
        const where = `${key}[${o.fromId}->${o.toId}]`;
        if (r <= 0) {
          // Not every schema actually forbids this -- jadeInputs.ts's distance
          // and delivery.ts's laneCost both use nonnegative(), where 0 is
          // legal. Refused anyway: turning a real distance/cost into exactly
          // 0 is a semantic model change (a free lane, a coincident pair),
          // not a precision no-op, so the operator decides either way.
          refusals.push(`${where} ${v} rounds to 0, which most override schemas forbid (positive()) and which, even where legal, changes a real value to free -- refused rather than decided`);
          return o;
        }
        const moved = crossesBand(v, bands);
        if (moved !== null) {
          refusals.push(
            `${where} ${v} rounds to ${r}, moving it from band ${moved.from ?? "overflow"} to band ${moved.to ?? "overflow"}`,
          );
          return o;
        }
        changed = true;
        return { ...o, [value]: r };
      });
      next[key] = updated;
    }

    // Refusal is per-ROW, and this `continue` is what makes it so: a row with
    // one crossing value and one safe value is written NOT AT ALL, rather than
    // left half-backfilled and matching neither report line.
    if (refusals.length > 0) { report.refused.push({ id: row.id, reason: refusals.join("; ") }); continue; }
    if (!changed) { report.alreadyRounded.push(row.id); continue; }
    report.rounded.push(row.id);
    if (dryRun) continue;
    // `inputs` ONLY. No result/solvedAt/resultRunId/solveInputRevision/
    // inputsUpdatedAt change -- see the header. This is the one deliberate
    // difference from the epoch-bumping write ch4ToMiles.ts is allow-listed
    // for in __tests__/maxCoverageWriteGuard.test.ts, and the band guard above
    // is what earns it: the rounded value is indistinguishable from the stored
    // one at every display and reporting precision. Not literally nothing at
    // full precision -- the cached envelope's objective was computed from the
    // unrounded value, so a fresh solve could differ by roughly 1e-4 x demand
    // on the affected pair -- but immaterial enough (the optimum cannot
    // realistically flip on a perturbation that small) that no epoch bump is
    // warranted.
    await database.update(scenariosTable).set({ inputs: next }).where(eq(scenariosTable.id, row.id));
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const report = await roundAll(db, dryRun);
  console.log(JSON.stringify(report, null, 2));
  // A refusal needs a human decision (see the runbook) -- surface it to a
  // piping/grepping operator via the exit code too, not only the printed
  // report.
  process.exitCode = report.refused.length > 0 ? 1 : 0;
  await pool.end();
}
