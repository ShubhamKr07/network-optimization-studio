# Chapter 4 floor-0 objective clear — runbook (CH4OS-4)

Operator runbook for `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts`
(spec `docs/superpowers/specs/2026-10-10-ch4-objective-selector-design.md` §8).

**Do not run this against production from an agent session.** It is a separate,
separately-approved operation performed by a human operator with `psql` access.
Approving the branch merge, the push, or the deploy does NOT approve this run.

## What it does

For every `max-coverage-us` scenario with `coverageFloorDemand = 0` that still
carries the pre-CH4OS server-derived `objective`, it removes the key and bumps the
solve epoch (`updated_at`, `inputs_updated_at` = now(), `solve_input_revision + 1`).
The cached `result` stays and shows as stale; `result_cache` is untouched. The
student must choose Max coverage or Min distance before re-solving.
Idempotent: a second run matches nothing.

## Order — deploy first, migrate second

1. Deploy `nos-api`, then `nos-studio`, **back to back**. Both directions of skew
   are user-visible, so minimise the window:
   - *New studio + old API*: the new studio sends `objective`; the old API's
     write guard 422s every Chapter 4 save ("objective is derived …").
   - *Old studio + new API*: the old studio strips `objective` before saving, so
     any floor-0 row it saves becomes unselected, and it has no selector to fix
     that — Solve 422s with `objective_required` until the new studio is live.
     No data is lost; the student re-chooses once the new studio loads.
   This branch changes `solve.py` and the API, so `nos-api` must be
   redeployed, not just `nos-studio`. Check `list_deploys`
   after any push — the commit webhook has not been observed to fire.
2. Only after both are live: run the migration (below). Until then, rows still
   holding `"coverage"` keep solving as Model 1, which is a valid choice.

## Procedure

1. **Snapshot / backup** the production database (Render Dashboard → nos-postgres
   → Backups, or `pg_dump` of `scenarios`). Record the backup id.
2. **Count before** (from an allowlisted host):
   ```sql
   SELECT count(*) FROM scenarios
   WHERE model_id = 'max-coverage-us'
     AND (inputs->>'coverageFloorDemand')::int = 0
     AND inputs ? 'objective';
   ```
3. **Dry run** — writes nothing, prints the ids and the count:
   ```bash
   DATABASE_URL=<production URL> pnpm --filter api-server run clear-floor-zero-objective -- --dry-run
   ```
   The dry-run count must equal step 2's. **That count, taken at run time, is the
   number quoted for approval.** No figure is assumed in this document.
4. **Explicit human approval** citing the dry-run count and the backup id.
5. **Run:**
   ```bash
   DATABASE_URL=<production URL> pnpm --filter api-server run clear-floor-zero-objective
   ```
   `count` must equal the approved number.
6. **Verify:** re-run step 2's query — it must return `0`. Spot-check one cleared
   row: `inputs ? 'objective'` is false and `solve_input_revision` went up by 1.

## Rollback

Restore `inputs.objective = 'coverage'` for the ids the run printed:
```sql
UPDATE scenarios SET inputs = inputs || '{"objective":"coverage"}'::jsonb
WHERE id = ANY(ARRAY[<ids>]) AND model_id = 'max-coverage-us';
```
(The epoch bump is not reverted: results stay stale, which is safe.)

## Local verification (nos_dev, dry run only)

2026-10-11, `nos_dev` (5 `max-coverage-us` rows, all floor-0 with `objective`):

```
{ "matched": [17909, 17910, 17911, 17912, 17913], "dryRun": true, "count": 5 }
```

Independent `psql` count of the Step 2 query: `5` (ids 17909-17913).
