import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

// D0.2: collapses the old per-model flat columns (problem_type, p_value,
// distance_bands, solver, gap, time_limit_sec, capacity_mode,
// uniform_capacity, warehouse_statuses, capacity_factor, single_source,
// capacity_inactive) into model_id + an opaque inputs jsonb blob. Idempotent —
// safe to run against an environment that already migrated (guarded by
// information_schema checks) or one still on the old schema.

async function columnExists(column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scenarios' AND column_name = ${column}
  `);
  return result.rows.length > 0;
}

async function main() {
  const hasOldSchema = await columnExists("problem_type");

  if (!hasOldSchema) {
    console.log("problem_type column absent — old schema already migrated, nothing to do.");
    return;
  }

  console.log("Migrating scenarios: problem_type/flat columns -> model_id/inputs...");

  if (!(await columnExists("model_id"))) {
    await db.execute(sql`ALTER TABLE scenarios ADD COLUMN model_id text`);
  }
  if (!(await columnExists("inputs"))) {
    await db.execute(sql`ALTER TABLE scenarios ADD COLUMN inputs jsonb NOT NULL DEFAULT '{}'`);
  }
  if (!(await columnExists("inputs_version"))) {
    await db.execute(sql`ALTER TABLE scenarios ADD COLUMN inputs_version integer NOT NULL DEFAULT 1`);
  }
  if (!(await columnExists("solved_at"))) {
    await db.execute(sql`ALTER TABLE scenarios ADD COLUMN solved_at timestamp`);
  }
  if (!(await columnExists("inputs_updated_at"))) {
    await db.execute(sql`ALTER TABLE scenarios ADD COLUMN inputs_updated_at timestamp NOT NULL DEFAULT now()`);
  }

  await db.execute(sql`
    UPDATE scenarios SET model_id = CASE problem_type
      WHEN 'p_median' THEN 'p-median-us'
      WHEN 'transport' THEN 'transport-coal'
      WHEN 'capacitated_pmedian' THEN 'p-median-brazil'
      ELSE problem_type
    END
    WHERE model_id IS NULL
  `);

  await db.execute(sql`
    UPDATE scenarios SET inputs = jsonb_build_object(
      'capacityFactor', capacity_factor,
      'singleSource', single_source,
      'capacityInactive', capacity_inactive,
      'distanceBands', distance_bands,
      'gap', gap,
      'timeLimitSec', time_limit_sec
    )
    WHERE model_id = 'transport-coal' AND inputs = '{}'::jsonb
  `);

  await db.execute(sql`
    UPDATE scenarios SET inputs = jsonb_build_object(
      'p', p_value,
      'capacityMode', CASE WHEN uniform_capacity IS NULL THEN 'none' ELSE 'uniform' END,
      'uniformCapacity', uniform_capacity,
      'warehouseOverrides', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', ws->>'warehouseId',
          'status', CASE ws->>'status' WHEN 'potential' THEN 'active' ELSE ws->>'status' END
        )), '[]'::jsonb)
        FROM jsonb_array_elements(warehouse_statuses) ws
      ),
      'customerOverrides', '[]'::jsonb,
      'distanceBands', distance_bands,
      'gap', gap,
      'timeLimitSec', time_limit_sec
    )
    WHERE model_id IN ('p-median-us', 'p-median-brazil') AND inputs = '{}'::jsonb
  `);

  await db.execute(sql`ALTER TABLE scenarios ALTER COLUMN model_id SET NOT NULL`);

  await db.execute(sql`
    ALTER TABLE scenarios
      DROP COLUMN IF EXISTS problem_type,
      DROP COLUMN IF EXISTS p_value,
      DROP COLUMN IF EXISTS distance_bands,
      DROP COLUMN IF EXISTS solver,
      DROP COLUMN IF EXISTS gap,
      DROP COLUMN IF EXISTS time_limit_sec,
      DROP COLUMN IF EXISTS capacity_mode,
      DROP COLUMN IF EXISTS uniform_capacity,
      DROP COLUMN IF EXISTS warehouse_statuses,
      DROP COLUMN IF EXISTS capacity_factor,
      DROP COLUMN IF EXISTS single_source,
      DROP COLUMN IF EXISTS capacity_inactive
  `);

  console.log("Migration complete.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
