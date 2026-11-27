# Admin role: schema rollout, grant, revoke

The `admin` role unlocks `/admin` (the WatBot and site-feedback dashboard). Spec: `docs/superpowers/specs/2026-11-27-admin-dashboard-design.md`. Every step below that touches production needs its own explicit owner approval (root `CLAUDE.md`, Branch discipline step 7). Run them **in this order**.

Commands use `render psql <nos-postgres id>`. The id comes from `mcp__render__list_postgres_instances` and is kept out of this repo. The machine's current IP must be on the database allowlist; the CLI error names it.

## 1. Audit existing roles (read-only)

```bash
render psql <db> --output text --command "BEGIN READ ONLY; SELECT role, count(*) FROM users GROUP BY role ORDER BY role; ROLLBACK;"
```

Expect only `student` (and possibly `instructor`). Any other value stops the rollout: the `CHECK` below would fail, and the owner decides what the value should be. Never edit rows here.

## 2. Schema, applied by hand, BEFORE the nos-api deploy

Don't run a blind `drizzle-kit push` against production. Apply these statements one at a time through `render psql`:

```sql
SET lock_timeout = '5s';
ALTER TABLE users ADD CONSTRAINT "CK_users_role" CHECK (role IN ('student','instructor','admin')) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT "CK_users_role";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_watbot_messages_role_created" ON watbot_messages (role, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_watbot_feedback_created" ON watbot_feedback (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_watbot_reports_created" ON watbot_reports (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_watbot_reports_message" ON watbot_reports (message_id, id);
```

- **Locks:** `NOT VALID` takes only a brief lock and does no scan. `VALIDATE` scans under a weaker lock and fails if any row is invalid. `CONCURRENTLY` builds the indexes without blocking writes, and can't run inside a transaction block, so run each one as its own command.
- **Verify:**

```sql
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'CK_users_role';   -- convalidated = t
SELECT indexname FROM pg_indexes WHERE indexname IN ('IDX_watbot_messages_role_created','IDX_watbot_feedback_created','IDX_watbot_reports_created','IDX_watbot_reports_message');   -- 4 rows
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;   -- 0 rows
```

- **Failure:**
  - If `VALIDATE` fails, a row holds an unexpected role. Run `ALTER TABLE users DROP CONSTRAINT "CK_users_role";` and stop for an owner decision.
  - A failed `CONCURRENTLY` build leaves an INVALID index. Run `DROP INDEX CONCURRENTLY <name>;` and retry it.
- **No data changes,** so there's nothing to restore. Render's daily snapshot is the backstop.

See also `docs/ops/schema-push-before-deploy.md`: the deploy carrying this code must not go out before this step.

## 3. Deploy nos-api, then nos-studio

Each deploy needs its own approval, and `pnpm deploy:preflight -- <deployed-sha>..HEAD` goes with the request. nos-api carries the widened `AuthUser.role` enum.

## 4. Grant admin, ONLY after the new nos-api is live

**The ordering trap (spec §3.1):** register, log-in, `GET /auth/user` and password-reset responses are parsed with the generated Zod schemas. An `admin` account on the old API fails every one of them with a 500. So grant only after step 3.

The email is typed by the owner into a shell variable. Never write it in this repo or a commit:

```bash
read -r ADMIN_EMAIL
render psql <db> --output text --command "
DO \$\$
DECLARE n int;
BEGIN
  UPDATE users SET role = 'admin' WHERE lower(email) = lower('$ADMIN_EMAIL');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 row, got %', n; END IF;
END \$\$;
SELECT count(*) AS admins FROM users WHERE role = 'admin';"
```

The `DO` block is one transaction: zero or several matches raise, and nothing is written. Paste the address only, with no quotes; a quote in it breaks the statement, which then fails without writing anything. Expect `admins = 1`.

## Revoke

Use the same command with `SET role = 'student'` and the same one-row check.

## Verify in the app

The owner signs in and opens `https://app.networkdesignbook.com/admin`. A student account opening the same URL sees the not-found page.
