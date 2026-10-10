# Runbook — push the schema to production BEFORE the `nos-api` deploy

**Applies to:** any branch that changes `lib/db/src/schema/**`.

**The rule:** production Postgres must have the new shape **before, or at the
same time as**, the `nos-api` deploy that ships code depending on it. Never
after. This repo has no migration files — `drizzle-kit push` is the mechanism,
and nothing in `render.yaml` runs it, so it is a manual step that is easy to
forget entirely.

## Why this exists (PWR, 2026-10-10)

The password-reset bundle added two nullable columns to `users`. `drizzle-kit
push` was run against the local `nos_dev` database during implementation and
**never against production**. The deploy then shipped code whose
`db.select().from(usersTable)` enumerates every column in the Drizzle schema —
including the two that did not exist.

The result was **not** a broken password-reset feature. It was every `users`
query failing for ~13 minutes:

| Endpoint | Sentry | Events |
|---|---|---|
| `POST /api/auth/login` | NOS-API-8 | 5 |
| `GET /api/auth/user` | NOS-API-5 | 6 |

`GET /api/auth/user` runs on every page load, so the whole app was returning
500s to anyone using it, from 10:56:30 until a manual push at ~11:10.

**That blast radius is the part worth internalising.** The instinct is "the new
feature will be broken until I migrate", which sounds survivable and is wrong:
Drizzle's `select()` names all columns, so a missing column breaks *every* read
of that table, including paths the branch never touched. A schema push that
lags its deploy is a full outage of everything that reads the table, not a
degraded new feature.

## Procedure

1. **Confirm your IP is on the database allowlist.** `curl -s https://api.ipify.org`
   gives it; add it in the Render Dashboard under the database's Networking
   section. Note the hosted Render MCP server cannot do this work — it connects
   from its own address, which you cannot allowlist, so `query_render_postgres`
   is not a route to DDL.
2. **Back up first if the change is anything other than adding a nullable
   column.** A `NOT NULL` addition, a type change, a rename or a drop needs its
   own runbook under `docs/ops/`, written before it runs.
3. **Apply the schema:**
   ```bash
   DATABASE_URL="<production connection string>?sslmode=require" \
     pnpm --filter @workspace/db push
   ```
   `sslmode=require` is not optional — the server refuses a plaintext
   connection with `FATAL: SSL/TLS required`.
4. **Verify the columns exist, by querying — never by trusting the push's
   output:**
   ```bash
   psql "<production connection string>?sslmode=require" -c \
     "SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name='<table>' AND column_name LIKE '<prefix>%' ORDER BY column_name;"
   ```
5. **Then** deploy `nos-api`.
6. **Remove the allowlist entry** afterwards if you added one, and prune stale
   ones while you are there.

## Pre-deploy check

Before any `nos-api` deploy, ask whether the range being deployed touches the
schema:

```bash
git diff --stat <deployed-sha>..HEAD -- lib/db/src/schema/
```

Non-empty output means step 3 must have happened already. Empty output means
this runbook does not apply.

## If you skipped it and the deploy is already live

The symptom is `error: column "<name>" does not exist` wrapped inside a
`Failed query: select …` error, on **every** endpoint reading that table — not
only the new feature's. Apply the schema immediately (step 3); no rollback or
redeploy is needed, because the code is already correct and the next query
succeeds as soon as the column exists.
