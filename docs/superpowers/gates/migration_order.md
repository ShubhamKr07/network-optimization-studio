# Gate proposal: migration_order

**Symptom:** Drizzle-declared schema (columns / sequences / constraints) is absent from the *actual target database* → runtime 500s or a boot-crash loop. Compounded on Render Postgres, where `drizzle-kit push` is unusable (it tries to drop the pre-enabled `pg_stat_statements` extension views and aborts).

**Occurrences (2×, recurred — prior proposal never accepted):**
- **2026-09-22 · chen-bands-units** — `scenarios.result_run_id` + `solve_jobs.result` were declared in Drizzle but never pushed to the shared `nos_dev`. Every real GET/solve 500'd (`column ... does not exist`); invisible to `pnpm --filter api-server test` (mocks the DB), so it blocked all real-browser QA until found via `information_schema`. A gate was proposed then — **never accepted** (`gate_accepted` empty).
- **2026-09-24 · scnd-measurement** — prod `nos-api` boot-crashed repeatedly on missing `solve_jobs_claim_generation_seq`; `drizzle-kit push` was blocked by `pg_stat_statements`; a one-off migration job **self-reported success but never committed the A columns to the app's DB**. Prod stayed safe on old code throughout. Resolved with an idempotent additive explicit-SQL migration, verified by querying the app's DB. Same class, now with **production impact**.

**Proposed automated gate:** before QA and before any deploy, assert that **every Drizzle-declared column / sequence / constraint exists in the TARGET database** (query `information_schema.columns` + `pg_sequences` + `pg_constraint` for `$DATABASE_URL`), failing closed on any missing object. On Render Postgres specifically: apply schema via an **idempotent additive explicit-SQL migration** (never `drizzle-kit push` — it drops `pg_stat_statements` views), and **verify against the app's `$DATABASE_URL`, never a migration runner's self-report**.

**How to enable:** add `scripts/harness/schema-sync-check.ts` (compares `lib/db` schema vs live `information_schema` of `$DATABASE_URL`, exit non-zero on drift); wire it into the pre-deploy step (and CI once a DB is reachable there).

**Status:** proposed — **RECURRED 2026-09-24 with prod impact; the 2026-09-22 proposal was never accepted.** Awaiting human approval to enable (not enabled).
