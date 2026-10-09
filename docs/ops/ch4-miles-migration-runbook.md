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

## Ordering: migration → `nos-api` → `nos-studio`

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

What does **not** happen in either direction is a silent wrong-unit answer:
both failures land on the validator, so they **fail closed** with a 422. And
the in-flight-solve hazard is genuinely closed by the migration's
`solve_input_revision + 1` bump — `jobRunner`'s publication CAS stops
matching, so a kilometre-era job that completes after the migration returns
`superseded` instead of publishing a stale result. That is the part that
would otherwise have been invisible.

### There are THREE moving parts, not two — and `nos-studio` is one of them

The ordering above reasons about the migration and `nos-api`. `nos-studio` is
a **separately deployed static site**, and root `CLAUDE.md`'s Branch
discipline records that a push to `main` can ship the frontend while leaving
the API on the previous build (`nos-api`'s commit webhook has not been
observed to fire). So the default outcome of a push is the one ordering
nobody wrote down:

> New studio + old API → the new frontend PATCHes
> `{highServiceDistMi, maxDistMi, avgServiceDistCapMi, coverageFloorDemand}`
> with no `objective`, at a server whose validator still requires the `...Km`
> names **and** `objective`. **Every Chapter 4 save 422s** — for a cause this
> runbook would not otherwise list, so it is easily misdiagnosed as a failed
> migration.

**The required order is: migration → `nos-api` → `nos-studio`.** `nos-studio`
must not land before `nos-api`. Since a single push arms both, verify with
`list_deploys` after pushing and trigger the two deploys explicitly in that
order rather than relying on webhook timing.

### Suspending the API is the recommended path, not one option among several

The mitigation offered further down for the lost-update sub-case — running
the migration with the API suspended — is in fact the only measure that
collapses **all** of the above to zero: no 422 window in either direction, no
in-flight solve to straddle the migration, and no lost update. Prefer it.
Treat "migrate live and minimise the window" as the fallback for when a brief
outage is unacceptable, not as the default.

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

The backup below captures all **seven** columns `migrateAll`'s `.set()`
writes — `inputs`, `result`, `solved_at`, `result_run_id`,
`inputs_updated_at`, `solve_input_revision`, and `updated_at`. The last of
those, `updated_at`, is a display-only "last edited" timestamp — it is not
read by any CAS check or by `isStale()` — captured here only so the
restore below is complete, not because it is load-bearing.

```sql
CREATE TABLE scenarios_ch4_km_backup AS
SELECT id, inputs, result, solved_at, result_run_id, solve_input_revision,
       inputs_updated_at, updated_at
FROM scenarios WHERE model_id = 'max-coverage-us';
```

> **If this errors with `relation "scenarios_ch4_km_backup" already exists`,
> the existing table IS your backup. Do NOT drop and recreate it.**
>
> This matters because MINOR #4 below tells you a crashed run is safe to
> re-run, so restarting this procedure from the top is an *expected* path —
> and at that point some rows are already in miles. Dropping and recreating
> the table captures those already-migrated **mile** rows under a name that
> says km. The rollback `UPDATE` would then restore miles over miles, with no
> error, no visible symptom, and no way to tell afterwards — and the original
> km values would be gone permanently. This is the same silent
> double-application shape as `timestamptz-migration.md`, the non-idempotent
> runbook this document opens by distinguishing itself from.
>
> If you genuinely need a fresh capture (e.g. the first attempt aborted
> before writing a single row and you want to be sure), verify that first:
> `SELECT count(*) FROM scenarios WHERE model_id = 'max-coverage-us' AND inputs ? 'highServiceDistMi';`
> must return `0`. Only then is dropping the table safe.

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
    inputs_updated_at = b.inputs_updated_at,
    updated_at = b.updated_at
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

**What the restore does NOT bring back, stated so the rollback is not
over-trusted:**

- **`result_cache` rows.** The backup captures seven `scenarios` columns;
  the migration also deletes every `max-coverage-us` row from
  `result_cache`, and the restore `UPDATE` above cannot undo that. Harmless
  in effect — the cache is derivable, and a miss simply re-solves — but
  "restoring the backup *is* the rollback" is true of `scenarios`, not of
  the cache.
- **`solve_jobs.result` envelopes.** The migration nulls these for
  `max-coverage-us` (see step 3), and they are not captured here. This is
  irreversible: pre-migration Chapter 4 solve history cannot be restored by
  rolling back. If that history matters to you, capture it *before* step 3:
  `CREATE TABLE solve_jobs_ch4_km_backup AS SELECT id, result FROM solve_jobs j JOIN scenarios s ON s.id = j.scenario_id WHERE s.model_id = 'max-coverage-us' AND j.result IS NOT NULL;`
  (the same already-exists warning above applies to that table too).

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

From an allowlisted host (see the warning below — this is not optional for
the `pnpm` steps either):

```bash
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
  pnpm --filter api-server run migrate-ch4-to-miles -- --dry-run
```

> **`NODE_ENV=production` is load-bearing, not decoration.** `lib/db/src/index.ts:15`
> enables TLS only when `NODE_ENV === "production"` (`ssl: { rejectUnauthorized: false }`,
> otherwise `undefined`). Render Postgres refuses non-TLS external connections, so
> without it this step fails to connect at all — typically `no pg_hba.conf entry for
> host …, SSL off` or `server does not support SSL connections`. Do **not** respond to
> that error by widening the database's IP allowlist or by hand-editing the connection
> string mid-window: the fix is the env var.
>
> **Every step below that runs `pnpm` needs an allowlisted host**, for the same reason
> step 1's SQL does. `nos-postgres` only accepts connections from allowlisted
> addresses, and these steps connect from *your* machine, not from Render.

This performs the **full** analysis — selects every `max-coverage-us` row,
runs `migrateInputs` on each, classifies it — and simply does not write.
Nothing is written to `scenarios`, `solve_jobs` or `result_cache` in this
step, regardless of outcome.

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

**`solveJobResultsCleared` on a dry run is the predicted deletion, and it is
the list to scrutinise before authorising the real run.** It names every
`solve_jobs.id` whose stored result envelope the real run will null —
irreversibly (see "What this migration destroys" above, including the backup
`CREATE TABLE AS` to take first if you want that history kept). The dry run
computes this by `SELECT`ing the same scope the real run `UPDATE`s, so the
two lists agree; it writes nothing to get it. Before FU-13 this key was
hard-`[]` under `--dry-run` and then listed 18 ids on the real production
run, so the one number an operator checks before an irreversible deletion
read as "nothing to lose" exactly when it was not.

### 3. Real run

```bash
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
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
displaying a kilometre-era cached result.

**It also nulls `solve_jobs.result` for `max-coverage-us`.** The job rows
themselves survive as history; their stored result envelopes do not. This is
deliberate and irreversible. Those envelopes hold kilometre distances, while
the export route reads the unit from the *current* manifest — now miles — and
nothing in an envelope distinguishes the two, so
`GET /api/scenarios/:id/export?…&runId=<pre-migration job>` would emit a
kilometre number labelled `mi` (601.89 where the truth is 374.0), and
`&unit=km` would convert it a second time to 968.6. Nulling the envelopes is
the chosen fix; the accepted cost is that Chapter 4 solve history from before
this migration is gone. Capture it first if you need it (see the rollback
section).

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
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
  pnpm --filter api-server run migrate-ch4-to-miles
```

Expect `migrated: []`, `skipped: []`, and every id from step 3 now under
`alreadyMigrated`. If this instead re-reports ids under `migrated`, stop and
escalate — that would mean the presence-key guard failed, which is not an
expected failure mode of this script.

### 6. Re-run once more AFTER the `nos-api` deploy — not optional

```bash
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
  pnpm --filter api-server run migrate-ch4-to-miles
```

**This step exists because the clone path can create a new kilometre-shaped
row during the window.** `routes/scenarios.ts`'s clone handler performs no
`validateInputsForModel` (pre-existing), and `deriveServerOwnedInputs`
returns the blob untouched when `coverageFloorDemand` is absent — so a
student clicking **Duplicate** on an unmigrated Chapter 4 scenario inserts a
fresh km-shaped row. If step 3 has already run by then, nothing revisits it
and that scenario **422s on every save and solve forever**.

Expect `migrated: []`. Any id reported under `migrated` here is exactly such
a row, and converting it is the fix. If you took the recommended path and ran
the migration with the API suspended, this step is a no-op — run it anyway,
it costs one command.

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

---

# Override-precision backfill (WF-8)

Operator runbook for `artifacts/api-server/src/migrations/roundOverridePrecision.ts`
(`pnpm --filter api-server run round-override-precision`). It lives in this
document because it shares every operational precondition with the migration
above, and **nothing else**: it is a different migration, on a different
schedule, against different rows.

**This is a SEPARATE operation needing its own approval.** Approval to run the
km → mi migration is not approval to run this, and vice versa. There is no
ordering dependency between them in either direction. Like everything above:
**do not run any of this against production from an agent session** — it has
been executed against local `nos_dev` only.

## What it does, and the one thing it refuses to do

WF-7 made CSV import store `roundForFile(fromDisplay(...))` — 4 decimal places,
matching what export emits — so for every write after that deploy, the stored
value equals its own export. Rows written *before* it still hold the
full-precision converted double, so re-importing an untouched export of such a
row reports a changed row nobody edited. This backfill rounds those stored
values to 4 dp, in two `inputs` keys:

- `distanceOverrides[].distance` — covers both the `distances` import entity
  (p-median, Chapter 4, JADE) and the `legDistances` entity (two-echelon), which
  persists into the same key.
- `laneCostOverrides[].cost` — the `laneCosts` entity (transport-coal). Its
  "cost" is literally geographic miles, not a `$/unit-distance` rate.

It is **not** model-scoped (over-precision is model-independent), so an
unfiltered run reads **every** row of `scenarios`. It writes `inputs` and
nothing else.

**It does NOT clear `result` and does NOT bump the solve epoch** — no
`result`/`solvedAt`/`resultRunId` nulling, no `solve_input_revision + 1`, no
`inputs_updated_at` advance. That is the deliberate opposite of the km → mi
migration above, and it is sound only because of what the rounding can and
cannot change: a 4 dp value is identical to the stored one at every display and
reporting precision, so no re-solve would produce a different answer, and no
`stale` badge should appear on a student's scenario for a change they cannot
see.

The one case where that is false is a value whose rounding changes which
**distance band** it is reported in. Bands are *upper bounds* ("within 450 mi"),
so `450.00004 → 450.0` moves a value out of the overflow bucket and **into** the
450 band, which would change `result.metrics.bandCoverage` in the already-cached
envelope and make it disagree with a client-side recompute. (The symmetric-
looking `449.99996 → 450.0` does **not**: both are `<= 450`, so both are already
inside that band.) **Such a row is REFUSED, not converted** — the choice between
a changed band attribution and forcing a re-solve of a student's saved work
belongs to you, not to the script. A value that would round to exactly `0`
(`0.00004 → 0`) is refused on the same principle: every override schema requires
`positive()`, so writing it would produce a row the running server can no longer
load.

**Any id under `refused` must be brought to the operator, not forced.** There is
no `--force` flag and none should be added. Resolve a refusal by deciding, per
row, either (a) leave it over-precise — the only cost is the spurious changed-row
on re-import that WF-7/WF-8 exist to remove, which is cosmetic; or (b) edit that
one value by hand and re-solve the scenario deliberately, so the cached envelope
and the inputs agree again.

## Preconditions — identical to the migration above

Same three, for the same reasons; the warnings in "### 2. Dry run" above apply
verbatim:

- **`NODE_ENV=production`** — `lib/db/src/index.ts` enables TLS only under that
  value, and Render Postgres refuses non-TLS external connections.
- **`?sslmode=require`** on the production external connection string.
- **An allowlisted host.** `nos-postgres` only accepts allowlisted addresses,
  and these steps connect from *your* machine.

Unlike the km → mi migration there is **no deploy-ordering constraint**: this
backfill neither depends on nor blocks any deploy, and it changes no schema. It
is also safe to run against a database with the current code live, though the
whole-blob `inputs` write means a concurrent save of the same scenario can be
lost — prefer a quiet window, same as above.

## Procedure

### 1. Pre-check — count affected values

From an allowlisted host:

```sql
SELECT s.id, s.model_id, o->>'distance' AS value
FROM scenarios s, jsonb_array_elements(COALESCE(s.inputs->'distanceOverrides','[]'::jsonb)) o
WHERE (o->>'distance')::numeric <> round((o->>'distance')::numeric, 4)
UNION ALL
SELECT s.id, s.model_id, o->>'cost'
FROM scenarios s, jsonb_array_elements(COALESCE(s.inputs->'laneCostOverrides','[]'::jsonb)) o
WHERE (o->>'cost')::numeric <> round((o->>'cost')::numeric, 4);
```

**Measured production state (2026-10-09, design doc §6):** exactly **one**
scenario — **id 40, `p-median-us`**, two values, `6.2137119223733395` and
`9.32056788356001`, under bands `[200, 400, 800, 1600]`. Neither is anywhere
near a band boundary, so the real run takes the no-refusal path and should
report `refused: []`. `laneCostOverrides` had **zero** affected rows (and there
is no `legDistanceOverrides` key — leg distances live in `distanceOverrides`).
If this query now returns anything else, stop and re-read the refusal section
above before continuing.

### 2. Dry run

```bash
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
  pnpm --filter api-server run round-override-precision -- --dry-run
```

This performs the **full** analysis — selects every row, classifies each — and
writes nothing, to any table, regardless of outcome. Expect `"dryRun": true`,
`"rounded": [40]`, `"refused": []`, and every other scenario id under
`alreadyRounded`. The real run rounds exactly the ids the dry run named.

If `refused` is non-empty, each entry is `{ id, reason }`, and `reason` names the
field, the pair, the value, the rounded value, and the two bands — e.g.
`distanceOverrides[ALN->C1] 450.00004 rounds to 450, moving it from band overflow
to band 450`. Take those ids to the operator decision above; do not proceed with
them unresolved. (A refused row is left **completely** unwritten, including any
other, safe over-precise value in the same row — so a refusal is never a
half-backfilled row.)

### 3. Real run

```bash
NODE_ENV=production \
DATABASE_URL="<production EXTERNAL connection string>?sslmode=require" \
  pnpm --filter api-server run round-override-precision
```

### 4. Post-check

Re-run step 1's SQL — it should return zero rows. Re-running the script is
cheap and idempotent: rounding an already-4 dp value is a no-op, so a second run
reports every id under `alreadyRounded` and `rounded: []`.

**Rollback is restore-from-backup, as above — there is no inverse script.** It is
also, uniquely for this migration, the one case where rollback is close to
unnecessary: the discarded information is the 5th decimal place onward of a
distance, and the pre-run value is reproducible by hand from the row's origin
(scenario 40's two values are exactly `10 / 1.609344` and `15 / 1.609344`). Take
the `scenarios` backup anyway if you are taking one for anything else in the
same window.

## Local dry-run output (nos_dev, 2026-10-10)

```
{ "rounded": [], "refused": [],
  "alreadyRounded": [17822, 5, 17909, 3, 4, 23083, 23106, 17910, 1, 2, 23110,
                     23077, 17911, 17912, 17913, 23103, 23081, 23090, 23085,
                     23072, 23070],
  "dryRun": true }
```

21 of 21 local scenarios already at 4 dp, nothing to round — which step 1's SQL
independently confirms (0 over-precise values in each of the two keys). Local
`nos_dev` therefore exercises the *empty* path only; the non-empty paths are
covered by `src/migrations/__tests__/roundOverridePrecision.test.ts`, a
real-Postgres suite that seeds production scenario 40's two exact values under
its real bands, plus the band-crossing, rounds-to-zero, dry-run-writes-nothing
and no-epoch-bump cases.
