# WatBot metrics queries (FR-42, FR-45)

Read by the project owner only. Run read-only against production, with explicit
approval. Never paste `user_id`s or other identifying values from the results into
this public repo.

Column names were checked against `lib/db/src/schema/{auth,scenarios,watbot}.ts` on
2026-11-20: `users(id, role)`, `scenarios(user_id, model_id)`, and the WatBot tables
and `watbot_sessions` view in `watbot.ts`. Each query was executed against a local
database, and queries 1, 3 and 4 were shown to return non-zero rows on a temporary
fixture.

## 1. Sessions per student, per model

`watbot_sessions` = answered student messages, new session after a 30-minute gap.

```sql
select s.model_id,
       count(*)                                                          as sessions,
       count(distinct s.user_id)                                         as students,
       round(count(*)::numeric / nullif(count(distinct s.user_id), 0), 2) as sessions_per_student
from watbot_sessions s
join users u on u.id = s.user_id
where u.role = 'student'
group by s.model_id
order by s.model_id;
```

## 2. Engagement

Share of students with at least one WatBot message per model, out of students with a
scenario for that model. Any student message counts, including cancelled and
turned-away ones (the student still reached for WatBot).

```sql
with with_scenario as (
  select distinct sc.model_id, sc.user_id
  from scenarios sc join users u on u.id = sc.user_id
  where u.role = 'student'
), with_watbot as (
  select distinct c.model_id, m.user_id
  from watbot_messages m join watbot_conversations c on c.id = m.conversation_id
  where m.role = 'student'
)
select ws.model_id,
       count(*)                                         as students_with_scenario,
       count(wb.user_id)                                as students_with_watbot,
       round(100.0 * count(wb.user_id) / count(*), 1)   as pct
from with_scenario ws
left join with_watbot wb on wb.model_id = ws.model_id and wb.user_id = ws.user_id
group by ws.model_id
order by ws.model_id;
```

## 3. Session duration per model

A one-message session has duration 0; it is kept, not dropped.

```sql
select s.model_id,
       count(*)                                                                              as sessions,
       round(avg(extract(epoch from s.duration)) / 60, 1)                                    as avg_minutes,
       round((percentile_cont(0.5) within group (order by extract(epoch from s.duration)) / 60)::numeric, 1) as median_minutes
from watbot_sessions s
join users u on u.id = s.user_id
where u.role = 'student'
group by s.model_id
order by s.model_id;
```

## 4. Messages by type per model

Where students struggle (FR-37 types; "(not recorded)" = the model skipped
`record_message_type`).

```sql
select c.model_id,
       coalesce(m.message_type, '(not recorded)') as message_type,
       count(*)                                   as messages
from watbot_messages m
join watbot_conversations c on c.id = m.conversation_id
join users u on u.id = m.user_id
where m.role = 'student' and m.status = 'answered' and u.role = 'student'
group by c.model_id, coalesce(m.message_type, '(not recorded)')
order by c.model_id, messages desc;
```

## 5. Gap topics (FR-27)

What the course materials do not cover, most frequent first.

```sql
select c.model_id, m.gap_topic, count(*) as times, max(m.created_at) as last_seen
from watbot_messages m
join watbot_conversations c on c.id = m.conversation_id
where m.role = 'tutor' and m.gap_topic is not null
group by c.model_id, m.gap_topic
order by times desc, last_seen desc;
```

## 6. Questions that did not count, per day

Cancelled (stopped before reaching the model), unavailable and limit_reached
(turned away). For tuning `WATBOT_MONTHLY_USD` and the student limit.

```sql
select date_trunc('day', m.created_at) as day, m.status, count(*) as messages
from watbot_messages m
where m.role = 'student' and m.status <> 'answered'
group by 1, 2
order by 1 desc, 2;
```

**Leak rate** is not SQL: it is the per-type table printed by the latest
`watbot-test-set run` (Task 11), pasted into the deploy record. **The
correct-formulation share** arrives with Spec 2.
