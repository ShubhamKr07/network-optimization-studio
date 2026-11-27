# Admin dashboard (WatBot and site feedback) — design

Date: 2026-11-27 · Status: draft for owner review · Branch: `admin-dash-spec` (off `main` `8961e76f`)

Spec 1 of 2. Spec 2 (later, separate) adds classes, rosters, instructor accounts and the Privacy Notice change that would let an instructor see their own students. This spec builds the owner-only dashboard so Spec 2 can add an instructor scope without reworking it.

Approved inputs: the brainstorming decisions and the design page (2026-11-26), the dataviz review folded into it, and the interactive prototype (`.lavish/watbot-admin-dashboard-prototype.html`, local and uncommitted; made-up data) that passed Impeccable's finish review with verdict **ship** and that the owner approved for spec writing on 2026-11-27.

## 1. Goal and scope

An admin-only page in the studio, `/admin`, for a quick daily check ("is anything wrong?") and a weekly read of trends, without hiding what students wrote.

In scope:
- The `admin` role, a server-side admin gate, and two ways in for the owner: one production `UPDATE`, and an "Admin" link in the studio header shown only to admins.
- Three read-only API endpoints: WatBot metrics, flagged WatBot answers, and site feedback.
- One studio page in the "numbers and voices side by side" layout.

Out of scope: instructor access, classes and rosters, any Privacy Notice change (Spec 2); storing provider error causes or per-answer drop counts (today they exist only in logs); exports; deleting or marking items read.

## 2. Decisions (all owner-approved unless marked)

| # | Decision |
|---|---|
| D1 | Audience: the owner only. Instructors come in Spec 2. Students never see admin surfaces. |
| D2 | In the app, live queries, behind an `admin` role. No BI tool, no PostHog warehouse. |
| D3 | Metric groups: usage, quality, cost, reliability. |
| D4 | Drill-down: aggregates plus flagged answers. No student email, name, user id or conversation id is ever sent to the page. |
| D5 | Site feedback (the "Send feedback" pop-up) is included and kept separate from WatBot. It is anonymous and has no chapter. |
| D6 | Layout: numbers and voices side by side (§6). |
| D7 | Charts: no categorical colour. Single olive series, the validated olive band ramp for magnitude, grey for context lines, amber only for the spending cap (with icon and words). One axis per chart. Every chart has a Table view. Rates show their n and "–" below n = 5. |
| D8 | **Day boundary: UTC.** Recommended and used by the prototype; the owner has not chosen otherwise. Confirm in this review. |
| D9 | Admin accounts' own WatBot messages are left out of every WatBot number. Site feedback cannot be filtered this way (it is anonymous). |

## 3. Access gate (security-critical)

### 3.1 Role
- `users.role` is an existing `varchar NOT NULL DEFAULT 'student'` with no check constraint (`lib/db/src/schema/auth.ts:33`). The new value `admin` needs **no schema change**.
- OpenAPI `AuthUser.role` enum becomes `[student, instructor, admin]` (`lib/api-spec/openapi.yaml:1595`). Orval output is regenerated in the same commit (hard rule #1). `toAuthUser` in `routes/auth.ts:115` widens its cast to match.
- **Rollout trap:** register, log-in, `GET /auth/user` and password-reset responses go through the generated Zod schemas (`routes/auth.ts:175,245,276,512`). An account set to `admin` **before** the new enum is deployed would get a 500 on every log-in. So the production `UPDATE` (§9) runs only after the API carrying the new contract is live.

### 3.2 `requireAdmin`
- **Where it goes:** a new middleware in `middlewares/auth.ts`. It calls `sessionUser(req)` itself (so the terms-version and password-tag checks still apply) and lets a request through only when the user's `role === "admin"`.
- **Every other case gets 404** with the app's standard not-found body: signed out, a stale session, a student, an instructor, or a failed lookup. A failed lookup is logged without the error binding, per `api-server/CLAUDE.md`. An admin route never answers 401 or 403, so its existence is never revealed (rule #5's anti-enumeration).
- **It cannot ride on `requireAuth`.** Four path-less sub-routers that come before WatBot in `routes/index.ts:34-37` (solveHistory, landingSummary, feedback, watbot) attach `requireAuth`, and it answers 401. So the new `adminRouter` must be registered **immediately after `authRouter`** (`routes/index.ts:29`), with `requireAdmin` mounted path-scoped on `/admin`.
- The role is read on every request, so granting or removing `admin` takes effect on the next request.

### 3.3 Guard test
A source-reading test fails when:
- a route in `routes/admin.ts` is registered without `requireAdmin`, or
- `adminRouter` is registered after any router that mounts `requireAuth`.

It follows the pattern of `lockedModelGuards.test.ts`, and includes a non-vacuity case.

## 4. API (contract-first; `lib/api-spec/openapi.yaml`, Orval regenerated)

All three are `GET`, admin-only, and read-only.

**Query parameters:**
- `from` and `to` are UTC dates, inclusive. The span is at most 90 days, `from <= to`, and neither may be in the future. Anything else is a 422 with a plain sentence.
- `modelId` is optional and must be a known model id; an unknown id is a 422.

**WatBot rows** are restricted to users whose `role` is not `admin` (D9), via a join to `users`.

### 4.1 `GET /api/admin/watbot/metrics`
Returns counts, not rates, so the studio can bucket by week without losing n. Each block is for the period; `prior` is the same-length period immediately before it, for the tile deltas.

- `days[]`, one per UTC day in range, zero-filled. Each day carries:
  - `date`;
  - `asked`, plus `answered`, `cancelled`, `unavailable` and `limitReached` (`watbot_messages` role `student`, by `status`);
  - `ratings` and `helped` (`watbot_feedback`);
  - `notices` (tutor replies that were followed by the drop notice);
  - `refused`, `stopped` and `failedNotices` (notice rows, by their text constants in `engine.ts`/`routes/watbot.ts`);
  - `costUsd` (sum of tutor `usage.costUsd`);
  - `latencyMedianMs` and `latencyP95Ms` (`percentile_cont` over tutor `latency_ms`; null when there is no reply);
  - `estimated` (tutor `usage.estimated = true`).
- `matrix[]` holds `{ modelId, messageType, answered }`, with `messageType` null for unrecorded types, shown as "Unrecorded".
- `period` and `prior` each hold:
  - `answered`;
  - `activeStudents` (distinct users);
  - `studentsByModel[]`;
  - `sessions`, `sessionMedianMinutes` and `sessionMedianQuestions` (from the `watbot_sessions` view, by `started_at` in range);
  - `ratings`, `helped`, `notHelpedByReason[]` and `reanswered` (`repair_message_id` not null);
  - `reportsByReason[]` (`watbot_reports.reason`);
  - `costUsd`;
  - `tokens{ input, output, cacheRead, cacheWrite }`;
  - `gapTopics[]`, the top 20 `{ topic, count }` from tutor `gap_topic`.
- `monthToDate{ spendUsd, capUsd }` reuses `monthlySpendUsd` and `monthlyCapUsd` (`watbot/limits.ts`). It always covers the current UTC month and all models, whatever the filters. It is the one number not filtered by D9, because the cap is enforced on all spend.

### 4.2 `GET /api/admin/watbot/flagged`
- **What's included:** tutor replies in range that were rated not helped or were reported, newest first, at most 100, plus a `truncated` boolean.
- **Each item carries:**
  - `at`, `modelId` and `messageType`;
  - `question`: the text of the student message immediately before the reply in its conversation;
  - `answer`: the reply's block texts with citation labels only (`label`, not `citedText`);
  - `rating`: `{ reason, note }` or null;
  - `report`: `{ reason, note }` or null;
  - `reanswer`: the text of the reply that `repair_message_id` points to, or null.
- **Never included:** user ids, conversation ids, message ids or emails. A test asserts the exact key set, and that a seeded email appears nowhere in the body.

### 4.3 `GET /api/admin/feedback`
- Site feedback in range (no `modelId`), newest first, at most 500, plus `truncated`.
- Each item is `{ id, body, createdAt }` and nothing else. The table has no account column by design (COSM-4), and none is added.

### 4.4 Spec 2 hook
The WatBot queries take one internal "which students" condition, today "every non-admin user". Spec 2 adds an instructor scope ("students in my classes") at that single point. No other preparation is built now.

## 5. Metric presentation (dataviz-reviewed)

| Tab | Item | Form |
|---|---|---|
| (top) | Attention strip | Spend vs cap (amber at 80% or more, with icon and words; "· normal" below); not answered in the last 7 days (warning icon and "· above 4%", or check and "· normal"); flagged answers this week and new site feedback this week (bold count, no icon). Each chip jumps to its tab or voice view. Below 1100px, a "Read what students said (N)" link jumps to the voice column. |
| (top) | Tiles | Questions answered, active students, helped (with ratings n; "–" below 5), cost per question. Each shows its change vs the prior period, in neutral ink except improvements in olive. |
| Usage | Questions per day | Line, olive, crosshair tooltip |
| Usage | Model × message type | Heatmap on the olive band ramp, with a "None · fewer → more" key |
| Usage | Sessions per week | Columns; median minutes and questions per session in the subtitle; first and last weeks marked partial in the table |
| Usage | Students per model | Horizontal bars, one olive, sorted |
| Quality | Helped rate by week | Line, 0–100%; n in tooltip and table; "–" below 5 |
| Quality | Why answers didn't help | Horizontal bars, sorted; subtitle has not-helped count and re-answered count |
| Quality | Answers with a removed part | Weekly share line with n; "–" below 5 |
| Quality | Reports by reason | Horizontal bars, sorted |
| Quality | Coverage gaps | Table with an inline bar |
| Cost | Spend per day | Columns |
| Cost | This month vs cap | Meter; amber at 80% or more |
| Cost | Cost per question by week | Line |
| Cost | Tokens | Table, with the cache-read share in the subtitle; limit-reached count |
| Reliability | Time to answer | Two lines on one axis: slowest 5% in olive, median in grey, both labelled at the end |
| Reliability | Questions not answered | Daily share line with n, "–" below 5; y-axis scaled to the data; grey reference line "Attention at 4%" |
| Reliability | Outcomes | Table: answered, cancelled, unavailable and limit reached, which sum to "Total asked"; then an "Of answered" group: refused, stopped, usage estimated |

Rules carried from the review:
- Every chart has a **Table** toggle.
- Tooltips work on hover and on keyboard focus, with arrow keys on line charts. They add to the chart, and are never the only way to read a value.
- Labels are inserted as text, never as HTML.
- Chart text stays 11–12px at every width: charts draw at their container's width and redraw on resize.
- On refetch the previous render stays, dimmed; no skeleton flash.

## 6. Studio page

- **Route `/admin`:** inside the single `<Switch>` in `App.tsx` (studio gotcha). It renders only when `user.role === "admin"`; anyone else gets the existing `NotFound`. `AppShell` shows an "Admin" link only for admins.
- **Layout (desktop):**
  - top bar;
  - one filter row (date presets 7, 30 and 90 days, custom range, model select, and "Days in UTC");
  - left two-thirds: attention strip, tiles, tabs;
  - right, 440px: the sticky "What students said" column.
  - Below 1100px the column stacks under the charts. Dark mode follows the app's theme and uses the dark band ramp.
- **Voice column:**
  - tabs All, Flagged answers and Site feedback with counts;
  - a search box over the loaded items;
  - newest first;
  - student words set in Source Serif.
  - **A flagged item** shows the question, its tags (reason, model, type, date) and a one-line WatBot reply. It expands (`<details>`) to the whole exchange: the answer with citation chips, the student's note or report, and the re-answer.
  - **Site feedback** items are marked "anonymous", with long ones clamped to 3 lines and a "Show more" control. When a model is selected, a note says site feedback has no chapter and shows for every chapter.
- **Implementation:**
  - Generated React Query hooks for the three endpoints.
  - Charts use `recharts` (already installed) with `accessibilityLayer` for keyboard access. The heatmap is a CSS grid of focusable cells, not a chart library.
  - Colours come from the existing tokens: `--chart-*`, `--band-0…4`, `--warning`, `--chart-grid`, `--chart-axis-label`.
  - Error states use `describeWriteError`-style plain sentences, never the raw HTTP message (studio gotcha).
  - Empty states say "Nothing in this range."

## 7. Privacy

- **No identities:** no email, name, user id or conversation id reaches the browser, and the tests pin each response's key set.
- **Free text:** student-written notes and site feedback are shown as written. A student could type their own name; this is the one place identifying text can appear. It falls under the Notice's "find and fix errors" and "understand, in aggregate" purposes, and the owner is the only viewer (D1).
- **Aggregates:** active-student numbers are counts, never lists.
- **No new third-party flow:** nothing new goes to PostHog, Sentry or Anthropic.

## 8. Tests

**API (vitest, real Postgres):**
- **Gate:** signed out, student, instructor, stale terms version, and a deleted account → 404 on all three endpoints; admin → 200. Shown red by removing `requireAdmin`.
- **Ordering:** the gate also returns 404 for signed out, proving the router order.
- **Metrics:** seed rows with hand-computed expected values. At least one populated row per metric, a row outside the range, and an admin user's row that must be excluded. Never an empty set (repo gotcha on empty fixtures).
- **Flagged:** the exact key set; a seeded email and user id appear nowhere in the JSON; the question is the preceding student message, not another conversation's.
- **Site feedback:** the exact key set `{id, body, createdAt}`; the range is honoured.
- **Validation:** span over 90 days, `from > to`, a future date and an unknown `modelId` → 422.
- **Guard test (§3.3)** with its non-vacuity case.

**Studio (vitest + RTL):**
- The page renders tiles, charts and voice items from a fixture.
- A non-admin gets `NotFound`.
- The Table toggle shows the same numbers.
- n below 5 renders "–".
- Site feedback shows the no-chapter note under a model filter.

**Playwright, plus a real-browser QA task (qa-sdet, per the QA-default rule):**
- An admin sees the dashboard; a student gets not-found.
- Filters re-scope the charts and the voice column together.
- A flagged item expands.
- The checks run in dark mode and at 390px.
- Any sibling e2e spec that hard-codes the header is updated (repo gotcha).

## 9. Rollout

1. Merge and deploy **nos-api** first (new contract and endpoints), then **nos-studio** (page and header link), each with its own approval. No schema change: `git diff --stat <deployed>..HEAD -- lib/db/src/schema/` must be empty.
2. With **separate approval, and only after step 1 is live** (§3.1 trap): `render psql` runs `UPDATE users SET role = 'admin' WHERE lower(email) = lower('<owner email>')` in a transaction, checking one row changed. The email stays out of the repo; the runbook takes it as a parameter.
3. Runbook `docs/ops/admin-role.md`: grant, revoke (`SET role = 'student'`), and the ordering trap.
4. The owner opens `/admin` in production; verify by read-only query that no other account has `role = 'admin'`.

## 10. Open items for this review

- **D8:** confirm UTC as the day boundary, or pick US Central or India time.
- `PRODUCT.md` (`artifacts/studio/PRODUCT.md`, written during the Impeccable round) is committed with this spec. Keep it in the repo, or drop it?
