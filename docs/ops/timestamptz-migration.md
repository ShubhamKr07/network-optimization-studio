# `timestamp` → `timestamptz` migration (HND-B)

Converts ten columns across three tables from `timestamp without time zone` to
`timestamp with time zone`. **Not applied to production yet** — see
[Production apply](#production-apply).

The visible symptom was the solve overlay reading `Solving 25200s`. The cause was
not `useElapsed` and not any arithmetic; it was the column type.

---

## The bug, measured

Drizzle writes *and reads* a naked `timestamp` as **UTC wall-clock**. But
`defaultNow()` and `sql`now()`` store the **database session's local
wall-clock**. So every value written DB-side read back wrong by the database's
UTC offset.

Probed through the real ORM against local `nos_dev` on 2026-10-01:

```
pg session TimeZone = America/Los_Angeles,  node offset = +05:30
true now                                  = 2026-10-01T13:21:37.929Z

stored via sql`now()`     = 2026-10-01 06:21:37   read back = 06:21:37Z   ← 7h early
stored via new Date()     = 2026-10-01 13:21:37   read back = 13:21:37Z   ← correct
stored via timestamptz    = 2026-10-01 06:21:37-07 read back = 13:21:37Z  ← correct
skew (new Date() − now()) = 25200 s
```

`timestamptz` is correct regardless of either zone. The naked column is correct
only when the database happens to run in UTC — which is exactly why this can
pass in CI and fail on a developer machine or a Pacific-region database.

**In the data, not just in theory:** of 160 `solve_jobs` rows in `nos_dev`,
**131 had `finished_at − started_at` = exactly `25200`**, with another 14 within
a minute of it. Queue waits (`started_at − queued_at`) were a sane 0–2s, because
*both* of those columns were written DB-side and the error cancelled.

Three consequences, in descending order of how much they mattered:

1. **The running clock.** `queued_at`/`started_at` read 7h early, so
   `Date.now() − queuedAt` was the real elapsed time plus 25200.
2. **`landingSummary.ts:27` computes `max(finished_at)`** over rows written by
   *two different clocks* (`sql`now()`` on the failure paths, `new Date()` in
   `markFailed`/`markSucceeded`). That is a wrong value, not merely a shifted
   one — the max is biased toward whichever rows the UTC-writing path produced.
3. **`scenarios.created_at` was wrong for every row's whole life.** The INSERT
   (`routes/scenarios.ts:235`) supplies no timestamps and falls through to
   `defaultNow()`, while every UPDATE writes `new Date()` — so `updated_at`
   silently corrected itself on a row's first edit and `created_at` never did.

### What was NOT broken

The stale-lease takeover (`jobRunner.ts:617`,
`owner_heartbeat_at < now() - interval '60 seconds'`) compares two DB-side
values, so it was always consistent. Job recovery was never affected. Worth
stating because it is the one place where a 7-hour error would have been
dangerous rather than merely wrong.

---

## Columns converted

| Table | Columns |
|---|---|
| `solve_jobs` | `queued_at`, `started_at`, `finished_at`, `claimed_at`, `owner_heartbeat_at` |
| `scenarios` | `solved_at`, `inputs_updated_at`, `created_at`, `updated_at` |
| `result_cache` | `created_at` |

**`session.expire` is deliberately excluded.** That table belongs to
`connect-pg-simple`, which writes it directly on its own schema assumptions;
changing its type is a separate decision with its own compatibility question.
`users.created_at`/`updated_at` were already `timestamptz` (`auth.ts:22-23`) —
the precedent this migration follows.

---

## The migration

**Do not use `drizzle-kit push` for this.** Its generated `ALTER ... TYPE
timestamptz` has no `USING` clause, so Postgres interprets each existing naked
value in the **session's** time zone. On a Pacific session that shifts every
stored row by 7 hours — the opposite of the chosen policy below. Run this script
first; afterwards `push` sees no difference and is safe again.

```sql
BEGIN;
ALTER TABLE solve_jobs
  ALTER COLUMN queued_at          TYPE timestamptz USING queued_at          AT TIME ZONE 'UTC',
  ALTER COLUMN started_at         TYPE timestamptz USING started_at         AT TIME ZONE 'UTC',
  ALTER COLUMN finished_at        TYPE timestamptz USING finished_at        AT TIME ZONE 'UTC',
  ALTER COLUMN claimed_at         TYPE timestamptz USING claimed_at         AT TIME ZONE 'UTC',
  ALTER COLUMN owner_heartbeat_at TYPE timestamptz USING owner_heartbeat_at AT TIME ZONE 'UTC';
ALTER TABLE scenarios
  ALTER COLUMN solved_at          TYPE timestamptz USING solved_at          AT TIME ZONE 'UTC',
  ALTER COLUMN inputs_updated_at  TYPE timestamptz USING inputs_updated_at  AT TIME ZONE 'UTC',
  ALTER COLUMN created_at         TYPE timestamptz USING created_at         AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at         TYPE timestamptz USING updated_at         AT TIME ZONE 'UTC';
ALTER TABLE result_cache
  ALTER COLUMN created_at         TYPE timestamptz USING created_at         AT TIME ZONE 'UTC';
COMMIT;
```

One transaction. It takes an `ACCESS EXCLUSIVE` lock and rewrites each table, so
run it during a quiet window; on pilot-sized data (hundreds of rows) it is
effectively instant. Column defaults (`now()`) and the indexes on these columns
are preserved automatically — verified on `nos_dev`.

### Backfill policy: deliberately none

`AT TIME ZONE 'UTC'` **keeps each stored wall-clock unchanged** and labels it
UTC. Chosen (2026-10-01) over trying to recover historical instants, for a
reason that is not laziness:

**`finished_at` cannot be attributed per row.** It had two writers — `sql`now()``
on the failure paths (`jobRunner.ts:612`, `:784`, `:808`) and `new Date()` in
`markFailed`/`markSucceeded` — so a given historical row's zone is not
recoverable from the row. A heuristic (classify by whether `finished − started
≈ 25200`) was considered and rejected: it is inference presented as a record, and
it would silently mis-convert any genuinely 7-hour solve.

So: **new rows are correct; historical rows keep displaying exactly what they
displayed before.** Nothing gets worse, nothing is invented. If historical solve
timings ever matter, the honest statement is that pre-migration values are
unreliable by up to the writing database's UTC offset.

---

## Verification

```sql
-- all ten rows must read 'timestamp with time zone'
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('solve_jobs', 'scenarios', 'result_cache')
  AND data_type LIKE 'timestamp%'
ORDER BY table_name, column_name;

-- defaults must have survived the type change
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND column_default = 'now()'
ORDER BY table_name, column_name;

-- no new row may land anywhere near the old skew
SELECT count(*) AS implausible
FROM solve_jobs
WHERE finished_at IS NOT NULL AND started_at IS NOT NULL
  AND finished_at - started_at > interval '10 minutes';
```

The last query will still return the pre-migration rows — that is the no-backfill
decision, not a failure. Scope it with `AND queued_at > '<migration timestamp>'`
to check only new rows.

The automated equivalent is
`artifacts/api-server/src/__tests__/timestampClock.test.ts`, which asserts the
column types **and** round-trips a real `now()`-written value against the client
clock. Both halves are needed: the round-trip alone passes on a naked column
whenever the database runs in UTC, which would make it green in CI while the bug
is live in production.

---

## Rollback

```sql
BEGIN;
ALTER TABLE solve_jobs
  ALTER COLUMN queued_at          TYPE timestamp USING queued_at          AT TIME ZONE 'UTC',
  ALTER COLUMN started_at         TYPE timestamp USING started_at         AT TIME ZONE 'UTC',
  ALTER COLUMN finished_at        TYPE timestamp USING finished_at        AT TIME ZONE 'UTC',
  ALTER COLUMN claimed_at         TYPE timestamp USING claimed_at         AT TIME ZONE 'UTC',
  ALTER COLUMN owner_heartbeat_at TYPE timestamp USING owner_heartbeat_at AT TIME ZONE 'UTC';
ALTER TABLE scenarios
  ALTER COLUMN solved_at          TYPE timestamp USING solved_at          AT TIME ZONE 'UTC',
  ALTER COLUMN inputs_updated_at  TYPE timestamp USING inputs_updated_at  AT TIME ZONE 'UTC',
  ALTER COLUMN created_at         TYPE timestamp USING created_at         AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at         TYPE timestamp USING updated_at         AT TIME ZONE 'UTC';
ALTER TABLE result_cache
  ALTER COLUMN created_at         TYPE timestamp USING created_at         AT TIME ZONE 'UTC';
COMMIT;
```

`AT TIME ZONE 'UTC'` on the way back too — it is the exact inverse, so the stored
wall-clock is unchanged in both directions and the conversion is lossless.

**The code rollback is the separate lever**, and this is the ordering that
matters: the schema change and the application are *not* independent here (unlike
the Chapter 4 index — see [`ch4-two-step-rollout.md`](ch4-two-step-rollout.md)).
Reverting the DDL while the new code is deployed is harmless; reverting the
*code* while the columns are `timestamptz` is also harmless, because drizzle
reads `timestamptz` correctly whatever the schema file claims. What you must not
do is revert the DDL and expect the overlay to be fixed — the type IS the fix.

### Code changes that accompany this

Reverting the DDL does not require reverting these, and they are correct under
either column type:

- `jobRunner.ts` `markFailed`/`markSucceeded` `finished_at` writes changed from
  `new Date()` to `sql`now()``, so `finished_at` has **one** clock. This is what
  makes `max(finished_at)` meaningful.
- `jobRunner.ts`'s publication update and `scenarioInputWrite.ts` changed
  `solved_at`/`inputs_updated_at`/`updated_at` to `sql`now()`` — **required, not
  tidying.** `isStale()` (`routes/scenarios.ts:116`) is a bare
  `inputsUpdatedAt > solvedAt` with no tolerance, and `inputs_updated_at` can
  originate from the INSERT's `defaultNow()` (the database's clock). With
  `solved_at` written from the application host, any clock skew between the two
  hosts marks a scenario stale the instant it finishes solving. The old naked
  columns *masked* this (`inputs_updated_at` read back offset into the past, so
  it could never win the comparison); converting to `timestamptz` removes that
  accident. Both sides of that comparison must come from `now()`.

---

## Production apply

**Not done.** As of 2026-10-01 this is applied to local `nos_dev` only.
`nos-postgres` restricts external connections to allow-listed IPs and the agent
session that wrote this could not reach it, so the statements above have never
run against production and production's current column types are **unverified**
— run the first verification query before assuming either state.

Production DDL needs explicit human consent (CLAUDE.md). When it runs, record the
date and the operator here, so the next person does not have to infer it from a
changelog entry.
