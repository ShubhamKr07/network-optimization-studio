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

**MINOR #5 — that ordering advice is one-sided; the window is symmetric, not
free, in BOTH directions:**
- Migrate first, deploy second: between the two, the OLD (km-era) server is
  still live and its validator **rejects every migrated row** — a save or
  solve against a Chapter 4 scenario 422s under the old code until the
  deploy lands.
- Deploy first, migrate second: between the two, the NEW (mile-era) server
  is live against an unmigrated database — every pre-existing scenario
  422s, as described above.

Either way, **some window of broken saves/solves for Chapter 4 is
unavoidable** — there is no ordering that makes it free. Minimise the window
(run the migration and trigger the deploy back-to-back, not hours apart) and
treat it as the same operational window that makes Important Finding #1(a)
below reachable: an in-flight kilometre-era solve can only straddle the
migration if some window exists at all.

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

## Concurrency and consistency guarantees (Important Finding #1)

Review finding, fixed before merge. Each migrated row's `UPDATE` now also
bumps `solve_input_revision` (`+ 1`), advances `inputs_updated_at` to
`now()`, and nulls `result_run_id` alongside `result`/`solved_at` — not just
`inputs`. Three concrete hazards this closes:

**(a) An in-flight kilometre-era solve can no longer invisibly publish onto
a migrated row.** `jobRunner.ts`'s publication CAS requires BOTH
`latest_solve_job_id = jobId` AND `solve_input_revision =
enqueued_solve_input_revision`. Before this fix, a job enqueued just before
the migration ran would complete *after* it, its CAS would still match
(the migration touched neither column), and it would publish a kilometre-era
`result` onto the now-miles row — invisibly, because `is_stale()` compares
`inputs_updated_at > solved_at`, and the old code left `inputs_updated_at`
untouched too, so the fresh `solved_at` always won. The revision bump makes
that job's CAS fail instead: it returns `superseded` and publishes nothing,
which is precisely the designed response to "inputs changed under a running
job" — and that is literally what this migration does.

**(b) `result_run_id` can no longer disagree with a null `result`.**
`lib/db/src/schema/scenarios.ts` states the invariant that `result_run_id`
is written in the same transaction as `result`, so the two can never
disagree. The migration now nulls both together.

**(c) Operational mitigation for the lost-update window that remains.**
There is still no `SELECT ... FOR UPDATE` on each row's read-then-write, so
a concurrent `PATCH` landing between this migration's `SELECT` and its
`UPDATE` is overwritten by the migration's converted snapshot — a classic
lost update. This was judged acceptable to leave as a procedural mitigation
rather than a code-level lock, because the fix for (a)/(b) above is a code
guarantee that holds on every future run, while this window is narrow (one
`UPDATE` per row, no network round-trip to a solver in between) and already
falls inside the broken-saves window Minor Finding #5 above describes.
**Mitigation: run the migration with the API suspended** (or, if that is
not feasible, accept that a save landing in the same few minutes as the
migration can be lost, and tell affected students to re-save).

---

## Backup and rollback (Important Finding #2)

Review finding, fixed before merge. This migration **destroys the
kilometre values in place**: it overwrites `inputs`, nulls
`result`/`solved_at`/`result_run_id`, and deletes every `max-coverage-us`
`result_cache` row. Idempotency (above) protects against running it
*twice*; it does nothing to protect against the run having been *wrong* —
unlike every other runbook in `docs/ops/` (`timestamptz-migration.md`,
`ch4-two-step-rollout.md`, `v2-write-activation.md`, `shutdown-budget.md`,
`ch4-migration-runbook.md`, the sibling this document opens by
distinguishing itself from), this one previously had no rollback section at
all.

### Pre-run capture (mandatory, before step 2 below)

```sql
CREATE TABLE scenarios_ch4_km_backup AS
SELECT id, inputs, result, solved_at, result_run_id, solve_input_revision,
       inputs_updated_at
FROM scenarios WHERE model_id = 'max-coverage-us';
```

Also take (or confirm Render already took, per its own retention schedule) a
`nos-postgres` snapshot immediately before the real run — see the
`render-postgres` skill for how to trigger/verify one. The backup table
above is the faster, finer-grained restore path for this migration
specifically; the snapshot is the whole-database fallback if something else
goes wrong in the same window.

### Rollback IS restore-from-backup — there is no inverse script

**Restoring `scenarios_ch4_km_backup`'s rows is the rollback.** There is
deliberately no `ch4ToMilesToKm.ts` inverse-migration script, because the
arithmetic cannot be made exactly reversible:

```sql
UPDATE scenarios s
SET inputs = b.inputs, result = b.result, solved_at = b.solved_at,
    result_run_id = b.result_run_id,
    solve_input_revision = b.solve_input_revision,
    inputs_updated_at = b.inputs_updated_at
FROM scenarios_ch4_km_backup b
WHERE s.id = b.id AND s.model_id = 'max-coverage-us';
```

**The 2 dp rounding means `toMi`'s inverse is NOT bit-exact.** `toMi(km) =
round((km / 1.609344) * 100) / 100` discards precision below 0.01 mi on the
way in; running a km-recovery formula on the *output* of `toMi` reproduces
the original km value only up to that same rounding, not exactly (e.g.
`601.894656` km → `374.00` mi → naively recovered as `374.00 * 1.609344 =
602.0947...` km, not the original `601.894656`). This is why the backup
table captures the ORIGINAL km-era row, not merely "a row to invert" — the
restore path reads a value that was never rounded, rather than trying to
undo rounding that already happened.

Drop `scenarios_ch4_km_backup` only after the deploy has been confirmed
stable for the retention period your operational policy requires (this
repo has no fixed number for this migration specifically — use the same
judgment as any other pre-destructive-migration backup).

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

**If `skipped` is non-empty:** each entry is `{ id, reason }`. `reason` is
EITHER `"missing required field(s): <names>"` — the row has no
`highServiceDistKm` and/or `maxDistKm` at all, named explicitly rather than
surfacing as an opaque Zod "expected number, received nan" — OR
`maxCoverageInputsSchema`'s own Zod error message for every other
validation failure. Either way, this is the migration refusing to write a
row it cannot make valid rather than writing something that will 422
forever with no indication why. Fix that scenario's `inputs` by hand (via a
direct `UPDATE` informed by the reason string, or by walking the student
through re-entering the scenario) and re-run the dry run until `skipped` is
empty, **before** proceeding to the real run.

**If `objectiveFlipped` is non-empty:** these ids had an old `min_distance`
row with `coverageFloorDemand: 0` — a state the pre-overhaul schema allowed
but `deriveMaxCoverageObjective` always maps to `"coverage"`, so the
migration is about to flip which ILP runs for that scenario with no other
signal. The flip itself is correct and forced (Task 5 deliberately removed
that state's expressibility) — this list exists so an operator can tell a
student their scenario's objective changed, rather than them discovering it
silently.

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
cache slot) and, on every migrated scenario row, nulls `result`/`solved_at`/
`result_run_id`, bumps `solve_input_revision` by 1, and advances
`inputs_updated_at` to `now()` (see "Concurrency and consistency
guarantees" above for why those last three matter, not just `inputs`). Each
migrated scenario re-solves under the new mile schema rather than
displaying a kilometre-era cached result. `solve_jobs` rows are
deliberately left as history — nothing deletes them.

**MINOR #4 — this run is not transactional.** Each row's `UPDATE` commits
individually inside the loop; a process crash mid-run leaves some rows
converted and others not, and the trailing `result_cache` delete unrun.
**This is safe to just re-run.** Idempotency (above) means a second run
only touches the rows the first run never reached — already-converted rows
report under `alreadyMigrated` and are left untouched — so if the process
dies mid-run, simply re-run step 3 to completion.

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

**Note (review round 2):** the JSON below predates this round's fixes —
`MigrateReport` has since gained a fourth key, `objectiveFlipped: number[]`
(Minor Finding #2), and each migrated row's `UPDATE` now also bumps
`solve_input_revision`/`inputs_updated_at` and nulls `result_run_id`
(Important Finding #1). The `migrated`/`skipped`/`alreadyMigrated` id sets
shown below are unaffected by either change and remain accurate as a record
of that run.

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

None of these 5 local rows carried a populated `distanceOverrides` array, so
this particular 5-row run alone does not demonstrate the override
conversion through a real `migrateAll` round trip. That gap is now closed
two ways: `ch4ToMiles.test.ts`'s `"converts EVERY
distanceOverrides[].distance"` case asserts a real before/after value
(`601.894656` km → `374.00` mi) rather than just the array's length against
the pure `migrateInputs` function, and (review round 2, Minor Finding #1)
`migrateAllIntegration.test.ts` exercises the SAME conversion through a
real Postgres row inserted with a non-empty `distanceOverrides` array,
running the real `migrateAll(db)` and reading the converted value back off
the actual jsonb column — not from the report's own in-memory `inputs`.
That test also seeds a deliberately-unmigratable row and asserts
`solve_input_revision`/`inputs_updated_at` move, which this 5-row local run
never needed to (all 5 rows were cleanly migratable on the first attempt).

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
