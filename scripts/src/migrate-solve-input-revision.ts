import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

// A1 (SCND Correctness) — hard rule #3's three-step NOT NULL protocol for
// `scenarios.solve_input_revision` (Class 2 — live-row state, per that
// column's own schema-file header comment):
//   (a) add nullable            — via `drizzle-kit push` against a schema
//                                  revision with the column declared WITHOUT
//                                  `.notNull()`
//   (b) explicit backfill       — THIS SCRIPT: every existing row's revision
//                                  is conceptually 1 (its current state IS
//                                  its first revision)
//   (c) enforce NOT NULL        — via a second `drizzle-kit push` against the
//                                  final schema revision (`.notNull().default(1)`)
//
// Idempotent — the WHERE clause means re-running after (c) has already
// landed (column already NOT NULL, so no row can be null) is a harmless
// zero-row no-op, matching migrate-scenario-owners.ts's own convention.
async function main() {
  const result = await db.execute(sql`
    UPDATE scenarios SET solve_input_revision = 1 WHERE solve_input_revision IS NULL
  `);
  console.log(`Backfilled solve_input_revision = 1 on ${result.rowCount ?? 0} row(s) that had it NULL.`);

  const remaining = await db.execute(sql`
    SELECT count(*)::int AS n FROM scenarios WHERE solve_input_revision IS NULL
  `);
  const remainingCount = (remaining.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (remainingCount > 0) {
    throw new Error(`Backfill incomplete: ${remainingCount} row(s) still have solve_input_revision IS NULL.`);
  }
  console.log("Verified: zero rows remain with solve_input_revision IS NULL.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
