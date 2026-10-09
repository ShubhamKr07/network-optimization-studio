# Chapter 4 km → mi scenario migration runbook (CH4O-9)

Operator runbook for `artifacts/api-server/src/migrations/ch4ToMiles.ts`, the
one-off migration that converts persisted `max-coverage-us` scenario `inputs`
from the pre-CH4O-8 kilometre schema to the post-CH4O-8 mile schema (§3.4 of
`docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md`).
Not to be confused with `ch4-migration-runbook.md` (MIG-16), which was the
earlier dataset *cutover* (`chens-cosmetics-cn` → `max-coverage-us`) — this
document is strictly about the unit conversion of rows already on
`max-coverage-us`.

**Do not run any of this against production from an agent session.**
Everything below has been executed against local `nos_dev` only. Running it
against production is a separate, separately-approved operation performed by
a human operator with `psql` access.

---

## Why this has to happen before (or with) the `nos-api` deploy

Tasks 5 and 8 made `coverageFloorDemand`, `avgServiceDistCapMi` required and
renamed the three distance fields to their `Mi` suffix, with `objective`
server-derived. Every pre-existing `max-coverage-us` scenario row was written
under the old schema — it has `highServiceDistKm`/`maxDistKm`/
`avgServiceDistCapKm` (or no cap at all, for an old min-distance row) and no
`coverageFloorDemand`. The new validator (`maxCoverageInputsSchema`) rejects
that shape outright.

**Deploying the new `nos-api` code against an unmigrated database 422s on
save and refuses to solve every pre-existing Chapter 4 scenario.** This
migration must run *before or in the same deploy window as* the `nos-api`
deploy that ships Tasks 5/8's validator changes — never after.

---

## This migration IS idempotent — unlike `timestamptz-migration.md`

`docs/ops/timestamptz-migration.md` documents a migration that **silently
double-converts** every value if run twice, because `v AT TIME ZONE 'UTC'`
on an already-`timestamptz` column re-interprets it in the session zone.

**This migration does not have that hazard.** `migrateInputs()` keys
idempotency on the renamed field's own presence (`"highServiceDistMi" in
raw`) and returns an already-migrated row unchanged rather than
re-converting it. `migrateAll()` applies the same check per row before ever
calling `migrateInputs`, and reports such rows under `alreadyMigrated`
rather than `migrated`. Running it any number of times after the first
real run is a safe no-op: expect `migrated: []` and the full set of
previously-migrated ids under `alreadyMigrated` every time. Confirmed
locally — see "Local dry-run / real-run output" below, where a second real
run reported exactly that.

---

## Production Chapter 4 row count — unmeasurable from an agent session

`query_render_postgres` (the hosted MCP tool) connects to `nos-postgres` from
its own address, observed as `35.227.164.209` (Google Cloud) — not from this
machine — and that address is **not** on `nos-postgres`'s IP allowlist.
Allowlisting a local developer IP does nothing for the hosted MCP tool,
because it never originates traffic from that IP.

**Do not guess production's `max-coverage-us` row count.** It can only be
measured by an operator running `psql` from a machine that is itself on the
`nos-postgres` allowlist. If that number is needed for a go/no-go decision,
get it that way — do not substitute the local `nos_dev` count (5, as of
this writing) or any other estimate.

---

## Procedure

### 1. Pre-check — count affected rows

From an allowlisted host:

```sql
SELECT count(*) FROM scenarios WHERE model_id = 'max-coverage-us';
```

Record this number. It is the upper bound on what the dry run should report
under `migrated` + `skipped` (anything already on the new schema reports
under `alreadyMigrated` instead and should be 0 on a first run against a
database that has never had Tasks 5/8's code deployed to it).

### 2. Dry run

```bash
DATABASE_URL="<production connection string>" \
  pnpm --filter api-server run migrate-ch4-to-miles -- --dry-run
```

This performs the **full** analysis — selects every `max-coverage-us` row,
runs `migrateInputs` on each, classifies it — and simply does not write.
Nothing is written to `scenarios` or `result_cache` in this step, regardless
of outcome.

Expect `"dryRun": true`, every row's id under `migrated`, and `skipped: []`.

**If `skipped` is non-empty:** each entry is `{ id, reason }`, where `reason`
is `maxCoverageInputsSchema`'s own Zod error message. This is the migration
refusing to write a row it cannot make valid rather than writing something
that will 422 forever with no indication why. Fix that scenario's `inputs`
by hand (via a direct `UPDATE` informed by the reason string, or by walking
the student through re-entering the scenario) and re-run the dry run until
`skipped` is empty, **before** proceeding to the real run.

### 3. Real run

```bash
DATABASE_URL="<production connection string>" \
  pnpm --filter api-server run migrate-ch4-to-miles
```

Expect the same `migrated` id set as the dry run, `skipped: []`. This also
deletes every `result_cache` row with `model_id = 'max-coverage-us'` (that
table is not an FK child of `scenarios` — primary key is `inputs_hash` plus a
plain `model_id` column — so a kilometre-era cached result would otherwise
strand there forever, unreachable by any scenario but still occupying a
cache slot) and nulls `result`/`solved_at` on every migrated scenario row, so
each one re-solves under the new mile schema rather than displaying a
kilometre-era cached result. `solve_jobs` rows are deliberately left as
history — nothing deletes them.

### 4. Post-check

```sql
SELECT count(*) FROM scenarios
WHERE model_id = 'max-coverage-us' AND NOT (inputs ? 'highServiceDistMi');
```

Expect `0`. Every `max-coverage-us` row must now carry `highServiceDistMi`.

### 5. Re-run to confirm idempotency (optional, but cheap)

```bash
DATABASE_URL="<production connection string>" \
  pnpm --filter api-server run migrate-ch4-to-miles
```

Expect `migrated: []`, `skipped: []`, and every id from step 3 now under
`alreadyMigrated`. If this instead re-reports ids under `migrated`, stop and
escalate — that would mean the presence-key guard failed, which is not an
expected failure mode of this script.

---

## Local dry-run / real-run output (nos_dev, 2026-10-09)

Dry run — 5 rows, nothing written:

```json
{
  "dryRun": true,
  "migrated": [17909, 17910, 17911, 17912, 17913],
  "skipped": [],
  "alreadyMigrated": []
}
```

Real run — same 5 rows converted:

```json
{
  "dryRun": false,
  "migrated": [17909, 17910, 17911, 17912, 17913],
  "skipped": [],
  "alreadyMigrated": []
}
```

Second real run — idempotent, nothing re-converted:

```json
{
  "dryRun": false,
  "migrated": [],
  "skipped": [],
  "alreadyMigrated": [17909, 17910, 17911, 17912, 17913]
}
```

None of the 5 local rows carried a populated `distanceOverrides` array, so
the local run alone does not demonstrate the override conversion. That is
covered instead by `ch4ToMiles.test.ts`'s `"converts EVERY
distanceOverrides[].distance"` case, which asserts a real before/after value
(`601.894656` km → `374.00` mi) rather than just the array's length — see
that test for the executed proof.

---

## Deviation from the migration convention (hard rule #8)

This migration is hosted at `artifacts/api-server/src/migrations/
ch4ToMiles.ts`, not under `scripts/src/` where this repo's other migration
scripts (e.g. `migrate-scenario-inputs.ts`, `migrate-delete-chens-scenarios.ts`)
live. §3.4's requirement that every migrated row be re-validated against the
real schema before its UPDATE commits needs
`artifacts/api-server/src/validation/inputs/maxCoverage.ts`'s
`maxCoverageInputsSchema`, and `@workspace/api-server` has no `main` and no
`exports` in its `package.json` — it is a private app, not an importable
library. `@workspace/scripts` depends only on `@workspace/db` and
`drizzle-orm`, so a `scripts/`-hosted migration could not reach the
validator and would have had to re-implement the very invariants it exists
to satisfy. This is a deliberate, one-off deviation for this migration only.
