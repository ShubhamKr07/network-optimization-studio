# Runbook — WatBot corpus, schema push, smoke and test-set run

Order matters. Nothing here is run without explicit approval for that step;
steps 4, 7, 8 and 9 touch production or spend money.

## 0. Schema push (before the nos-api deploy)

Follow [`schema-push-before-deploy.md`](schema-push-before-deploy.md) for the four
tables `course_passages`, `watbot_conversations`, `watbot_messages`,
`watbot_reports` and the `watbot_sessions` view. Then confirm the view exists:

```bash
psql "$PROD_DATABASE_URL" -c "\dv watbot_sessions"
```

If it is missing (drizzle-kit may not create views), run this right after the push.
It is copied verbatim from the `.as(...)` template in `lib/db/src/schema/watbot.ts`
and is safe to re-run:

```sql
CREATE OR REPLACE VIEW watbot_sessions AS

  with m as (
    select wm.user_id, wc.model_id, wm.created_at,
           case when lag(wm.created_at) over w is null
                  or wm.created_at - lag(wm.created_at) over w > interval '30 minutes'
                then 1 else 0 end as is_new
    from watbot_messages wm
    join watbot_conversations wc on wc.id = wm.conversation_id
    where wm.role = 'student' and wm.status = 'answered'
    window w as (partition by wm.user_id, wc.model_id order by wm.created_at)
  ), s as (
    select user_id, model_id, created_at,
           sum(is_new) over (partition by user_id, model_id order by created_at
                             rows between unbounded preceding and current row) as session_no
    from m
  )
  select user_id, model_id, session_no::int as session_no,
         min(created_at) as started_at, max(created_at) as ended_at,
         count(*)::int as messages, max(created_at) - min(created_at) as duration
  from s
  group by user_id, model_id, session_no
;
```

## 1. Corpus preparation (in `nos-ops-private`, never this repo)

Extract the licensed EPUB into one passage per printed page. Split on the
`id="page_N"` anchors, with `label` = `Ch {chapter} · p.{N}`, and drop front matter
and the index. Replace each formula image with `$$…$$` LaTeX from a vision-model
transcription.

- **Hand-check every formula** against the book page before commit.
- Notebook passages: markdown cells plus code cells under 5,000 characters, with
  `label` = `NB {chapter} · cell {index}`.
- Output is `corpus.json` in the v1 format from plan Task 3.

## 2. Dry run locally

```bash
DATABASE_URL=<local> pnpm --filter api-server watbot-ingest-corpus --file <path>/corpus.json
```

Check that the bundle report lists all 8 models under 100,000 tokens.

## 3. Local load

Same command plus `--execute`.

## 4. Production load

Needs explicit approval and happens after the schema push (step 0).

```bash
DATABASE_URL=<prod> pnpm --filter api-server watbot-ingest-corpus --file <path>/corpus.json --execute --confirm-host <prod-host>
```

## 5. Spot check

Pick 10 random passages containing `$$`; compare each against the book page.

## 6. Anthropic Console

Set an organization spend limit of $10/month. Confirm the usage tier on the Rate
limits page; Haiku 5.5 Start tier is 4,000 requests/min, 2,000,000 input tokens/min
and 400,000 output tokens/min.

## 7. Env vars

Set `ANTHROPIC_API_KEY` on nos-api (declared in `render.yaml` with `sync: false`;
the other three have defaults there). This is an env change on a live service: ask first.

## 8. Smoke test

Spends real money. Run only with explicit approval of the spend; the script refuses
without `--confirm-spend`:

```bash
DATABASE_URL=<db with corpus> ANTHROPIC_API_KEY=<key> pnpm --filter api-server watbot-smoke --confirm-spend
```

It prints one JSON line per question (type, blocks, cited, searches, gap topic, cost)
and a total. It writes nothing to the database.

## 9. Test-set run (ship-blocking, spec §8 step 6, D15)

Needs its own spend approval; estimated well under $1 a run, and the script prints
the measured cost.

- Preconditions: the project owner has approved
  `artifacts/api-server/src/watbot/eval/testSet.json` and `personas.json` (their
  `status` is `"approved"`, with `approvedBy` and `approvedOn` filled); a database
  with the **real** corpus loaded (local `nos_dev` after step 3); `answerKeys.json`
  regenerated if any solver or default input changed
  (`pnpm --filter api-server watbot-test-set keys --base-url http://localhost:<api-port>`
  against a local API).
- Run: `DATABASE_URL=<db with corpus> ANTHROPIC_API_KEY=<key> pnpm --filter api-server watbot-test-set run --confirm-spend`.
- Pass: exit 0, meaning 0 leaks on `stuck_or_wants_answer`, `incorrect_attempt` and
  replies with no recorded type, and at most 5% (owner-confirmed) on the other types.
  Exit 1 blocks the ship: tighten the instructions and re-run. Paste the printed
  per-type table into the deploy record.
- Re-run before any change to `SYSTEM_PROMPT`, `REPLY_RULES` or `TOOLS` ships, not
  only before the first ship.
