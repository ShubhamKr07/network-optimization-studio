# Admin Dashboard (Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, execution is **agent-team waves** (owner's standing preference, `AGENTS.md`): one locked worktree per task, the lead cherry-picks.

**Goal:** an owner-only `/admin` page in the studio showing WatBot usage, quality, cost and reliability, plus flagged answers and anonymous site feedback, behind a new `admin` role.

**Architecture:**
- **Contract first:** three read-only `GET /api/admin/*` endpoints in `openapi.yaml`, with Orval-generated Zod and React Query.
- **Access gate:** an `adminRouter` registered right after `authRouter`, behind a `requireAdmin` gate that answers 404 to everyone else.
- **Queries:** aggregate SQL over existing tables, bucketed by `America/Chicago` days.
- **Studio:** one page in the "numbers and voices side by side" layout, with recharts for line and bar charts and a CSS-grid heatmap.

**Tech Stack:** Express + Drizzle (Postgres), Orval, vitest + supertest (real Postgres), React + React Query + recharts + Tailwind tokens, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-admin-dashboard-design.md` (branch `admin-dash-spec`, `fa358232`). **Visual reference:** `docs/superpowers/specs/assets/2026-11-27-admin-dashboard-prototype.html`. Open it in a browser. It has passed Impeccable's finish review; its markup, CSS tokens, copy and chart rules are the target. Its data is made up.

## Global Constraints

- Day boundary **`America/Chicago`** for days, weeks and date filters. The one exception is the spending cap, which is a **UTC** month (`watbot/limits.ts`), labelled as such (spec D8).
- WatBot numbers count only users with `role IN ('student','instructor')`, an allowlist and never `<> 'admin'` (D9). Site feedback is unfiltered (anonymous).
- No email, user id, conversation id or message id in any admin response (D4, §7). Tests pin exact key sets.
- Every non-admin request to `/api/admin/*` gets **404** `{ error: "Not found" }`, including signed-out requests and a failed lookup. Never 401 or 403.
- `from`/`to` are Chicago calendar dates `YYYY-MM-DD`, inclusive. The span is at most 90 days, `from <= to`, and neither is after today in Chicago. `modelId` is optional and must be known. Any violation is a **422** with a plain sentence.
- Charts follow D7:
  - no categorical colour: single olive, the olive band ramp for magnitude, grey for context, amber only for the cap;
  - one axis per chart;
  - a Table toggle on every chart;
  - rates show n, with "–" when n < 5.
- **Hard rule #1:** never edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` by hand. Run `pnpm --filter @workspace/api-spec codegen` and commit the output with its spec change.
- **Hard rule #12:** backend and frontend roles invoke `andrej-karpathy-skills:karpathy-guidelines` **and** `ponytail:ponytail` before writing code; qa-sdet is exempt.
- **Commits:** branch only. Guard: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1`. Message format `[ADM-T<n>] <imperative>`, committed with an explicit pathspec.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`, inline per command. After any schema change: `DATABASE_URL=… pnpm --filter @workspace/db push`.
- **Drop-notice wording changed on 2026-11-25.** Count both texts:
  - `"One claim was removed — I couldn't support it with a course source."` (20–25 Nov);
  - `CLAIM_REMOVED_NOTICE` (current).
  - `REFUSED_NOTICE`, `STOPPED_NOTICE` and `FAILED_NOTICE` never changed (verified with `git log -S`).

## Waves and roles

| Wave | Task | Role | Depends on |
|---|---|---|---|
| 1 | T1 Role invariant (contract + DB `CHECK` + `parseRole`) | backend-engineer | – |
| 2 | T2 Admin contract, gate, site-feedback endpoint | backend-engineer | T1 |
| 3 | T3 Metrics endpoint + indexes + performance test | backend-engineer | T2 |
| 3 | T4 Flagged-answers endpoint | backend-engineer | T2 |
| 3 | T5 Studio `/admin` page | frontend-engineer | T2 (generated hooks) |
| 4 | T6 Playwright e2e + real-browser QA | qa-sdet (fable review) | T3, T4, T5 |
| 4 | T7 Runbook + changelog | lead | T3, T4, T5 |

Each task gets an Opus review before cherry-pick. T6 gets a fable review. Then: `pnpm gate` on the branch, an Opus whole-branch review, and `/harness-retro ADM`.

## File map

| File | Created / modified | Responsibility |
|---|---|---|
| `artifacts/api-server/src/lib/roles.ts` | create | `ROLES`, `type Role`, `parseRole(raw)` |
| `artifacts/api-server/src/routes/auth.ts:114-116` | modify | `toAuthUser` uses `parseRole` |
| `lib/db/src/schema/auth.ts:15-36` | modify | `CHECK (role IN …)` on `users` |
| `lib/api-spec/openapi.yaml` | modify | role enum + 3 admin paths + schemas |
| `artifacts/api-server/src/middlewares/auth.ts` | modify | `requireAdmin` |
| `artifacts/api-server/src/routes/admin.ts` | create | router, query validation, 3 handlers |
| `artifacts/api-server/src/services/adminRange.ts` | create | parse/validate `from`, `to`, `modelId`; Chicago bounds |
| `artifacts/api-server/src/services/adminMetrics.ts` | create | metrics SQL |
| `artifacts/api-server/src/services/adminFlagged.ts` | create | flagged SQL + shaping |
| `artifacts/api-server/src/routes/index.ts:29-30` | modify | register `adminRouter` after `authRouter` |
| `lib/db/src/schema/watbot.ts` | modify | indexes on messages (role, created_at), feedback and reports (created_at) |
| `artifacts/studio/src/lib/adminMetrics.ts` | create | pure helpers: presets, weekly buckets, n-rule, heatmap bins, deltas |
| `artifacts/studio/src/pages/admin/AdminDashboard.tsx` | create | page, filters, queries |
| `artifacts/studio/src/components/admin/*.tsx` | create | AttentionStrip, Tiles, ChartCard, LineCard, BarListCard, Heatmap, VoiceColumn |
| `artifacts/studio/src/App.tsx` | modify | `/admin` route |
| `artifacts/studio/src/components/AppShell.tsx` | modify | admin-only "Admin" link |
| `artifacts/studio/e2e/admin-dashboard.spec.ts`, `e2e/helpers/adminDb.ts` | create | e2e |
| `docs/ops/admin-role.md` | create | grant, revoke and audit runbook |

---

### Task 1 (ADM-T1): Role invariant

**Files:**
- Create: `artifacts/api-server/src/lib/roles.ts`, `artifacts/api-server/src/__tests__/roles.test.ts`
- Modify: `artifacts/api-server/src/routes/auth.ts:114-116`, `lib/db/src/schema/auth.ts:15-36`, `lib/api-spec/openapi.yaml:1595-1597`, regenerated `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

**Interfaces:**
- Produces: `ROLES = ["student","instructor","admin"] as const`, `type Role`, `parseRole(raw: unknown): Role`. Later tasks import `ROLES`/`Role`; the admin gate compares `user.role === "admin"`, the raw DB value, not `parseRole`.

- [ ] **Step 1: Write the failing test** (`__tests__/roles.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { parseRole } from "../lib/roles.js";
import { logger } from "../lib/logger.js";

describe("parseRole", () => {
  it("keeps the three known roles", () => {
    expect(parseRole("student")).toBe("student");
    expect(parseRole("instructor")).toBe("instructor");
    expect(parseRole("admin")).toBe("admin");
  });
  it("maps unknown values to student and warns without the value's owner", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    for (const raw of ["Admin", "", "teacher", null, undefined, 7]) expect(parseRole(raw)).toBe("student");
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toMatch(/userId|email/);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module '../lib/roles.js'`)

Run: `cd artifacts/api-server && pnpm vitest run src/__tests__/roles.test.ts`

- [ ] **Step 3: Implement `lib/roles.ts`**

```ts
import { logger } from "./logger.js";

export const ROLES = ["student", "instructor", "admin"] as const;
export type Role = (typeof ROLES)[number];

// The DB CHECK keeps users.role inside ROLES; this is the belt to that brace, so a
// value written before the constraint (or by hand) can never 500 a log-in response.
export function parseRole(raw: unknown): Role {
  if (typeof raw === "string" && (ROLES as readonly string[]).includes(raw)) return raw as Role;
  logger.warn({ roleType: typeof raw }, "users.role holds an unknown value; treated as student");
  return "student";
}
```

- [ ] **Step 4: Use it in `toAuthUser`** (`routes/auth.ts:114-116`)

```ts
import { parseRole } from "../lib/roles.js";
function toAuthUser(user: { id: string; email: string | null; role: string }) {
  return { id: user.id, email: user.email ?? "", role: parseRole(user.role) };
}
```

- [ ] **Step 5: Widen the contract.** In `lib/api-spec/openapi.yaml`, the `AuthUser.role` enum (line ~1597) becomes `enum: [student, instructor, admin]`. Then run `pnpm --filter @workspace/api-spec codegen` and confirm the generated `role` enum includes `admin`.

- [ ] **Step 6: DB `CHECK`** (`lib/db/src/schema/auth.ts`): import `check` from `drizzle-orm/pg-core` and add the table's third argument.

```ts
}, (t) => [check("CK_users_role", sql`${t.role} IN ('student', 'instructor', 'admin')`)]);
```

- [ ] **Step 7: Live-catalog test**, appended to `roles.test.ts` and modelled on `feedback.test.ts`'s catalog check (real Postgres):

```ts
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
it("the users.role CHECK exists in the live database and rejects 'Admin'", async () => {
  const rows = await db.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CK_users_role'`);
  expect(String((rows.rows[0] as { def: string }).def)).toContain("'admin'");
  await expect(db.execute(sql`INSERT INTO users (id, email, role) VALUES ('ck-role-probe', 'ck@probe.test', 'Admin')`)).rejects.toThrow();
});
```

- [ ] **Step 8:** Push the schema locally (`DATABASE_URL=… pnpm --filter @workspace/db push`), then run `roles.test.ts` and `auth.test.ts`. Expect PASS. Then `pnpm run typecheck`.

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
git commit lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react lib/db/src/schema/auth.ts artifacts/api-server/src/lib/roles.ts artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/__tests__/roles.test.ts -m "[ADM-T1] add the admin role with a DB CHECK and a parseRole guard"
```

---

### Task 2 (ADM-T2): Admin contract, gate, and site-feedback endpoint

**Files:**
- Create: `artifacts/api-server/src/routes/admin.ts`, `artifacts/api-server/src/services/adminRange.ts`, `artifacts/api-server/src/__tests__/adminGate.test.ts`, `artifacts/api-server/src/__tests__/adminRouteGuards.test.ts`
- Modify: `artifacts/api-server/src/middlewares/auth.ts`, `artifacts/api-server/src/routes/index.ts:29-30`, `lib/api-spec/openapi.yaml`, regenerated output

**Interfaces:**
- Consumes: `Role` (T1).
- Produces:
  - `requireAdmin(req, res, next)`;
  - `type AdminRange = { from: string; to: string; modelId?: string }`;
  - `parseAdminRange(query, now?): { ok: true; range: AdminRange } | { ok: false; error: string }`;
  - `chicagoToday(now?)`, `chicagoStart(date): SQL`, `chicagoEnd(date): SQL`, `chicagoDay(col: SQL): SQL`, `priorRange(range): AdminRange`;
  - the default-exported `adminRouter`;
  - generated hooks `useGetAdminWatBotMetrics`, `useGetAdminWatBotFlagged`, `useGetAdminFeedback` and their Zod schemas `GetAdminWatBotMetricsResponse`, `GetAdminWatBotFlaggedResponse`, `GetAdminFeedbackResponse`.

- [ ] **Step 1: Contract.** Add to `openapi.yaml`, under `tags: [Admin]`, three paths with a shared query: `from` (required, `format: date`), `to` (required, `format: date`), `modelId` (optional; metrics and flagged only). Each has a 200 response, and 404 and 422 responses using `ErrorEnvelope`. Schemas:

```yaml
AdminWatBotMetrics:
  type: object
  required: [days, matrix, period, prior, monthToDate, sessionsByWeek]
  properties:
    days:
      type: array
      items:
        type: object
        required: [date, asked, answered, cancelled, unavailable, limitReached, ratings, helped, notices, refused, stopped, failedNotices, costUsd, latencyMedianMs, latencyP95Ms, estimated]
        properties:
          date: { type: string, format: date }
          asked: { type: integer }
          answered: { type: integer }
          cancelled: { type: integer }
          unavailable: { type: integer }
          limitReached: { type: integer }
          ratings: { type: integer }
          helped: { type: integer }
          notices: { type: integer }
          refused: { type: integer }
          stopped: { type: integer }
          failedNotices: { type: integer }
          costUsd: { type: number }
          latencyMedianMs: { type: number, nullable: true }
          latencyP95Ms: { type: number, nullable: true }
          estimated: { type: integer }
    matrix:
      type: array
      items:
        type: object
        required: [modelId, messageType, answered]
        properties:
          modelId: { type: string }
          messageType: { type: string, nullable: true }
          answered: { type: integer }
    period: { $ref: '#/components/schemas/AdminWatBotPeriod' }
    prior: { $ref: '#/components/schemas/AdminWatBotPeriod' }
    sessionsByWeek:
      type: array
      items:
        type: object
        required: [weekStart, sessions, medianMinutes, medianQuestions]
        properties:
          weekStart: { type: string, format: date }
          sessions: { type: integer }
          medianMinutes: { type: number }
          medianQuestions: { type: number }
    monthToDate:
      type: object
      required: [spendUsd, capUsd, month]
      properties:
        spendUsd: { type: number }
        capUsd: { type: number }
        month: { type: string, description: "UTC month, YYYY-MM" }
AdminWatBotPeriod:
  type: object
  required: [answered, activeStudents, studentsByModel, sessions, sessionMedianMinutes, sessionMedianQuestions, ratings, helped, notHelpedByReason, reanswered, reportsByReason, costUsd, tokens, gapTopics]
  properties:
    answered: { type: integer }
    activeStudents: { type: integer }
    studentsByModel: { type: array, items: { type: object, required: [modelId, students], properties: { modelId: { type: string }, students: { type: integer } } } }
    sessions: { type: integer }
    sessionMedianMinutes: { type: number }
    sessionMedianQuestions: { type: number }
    ratings: { type: integer }
    helped: { type: integer }
    notHelpedByReason: { type: array, items: { type: object, required: [reason, count], properties: { reason: { type: string }, count: { type: integer } } } }
    reanswered: { type: integer }
    reportsByReason: { type: array, items: { type: object, required: [reason, count], properties: { reason: { type: string }, count: { type: integer } } } }
    costUsd: { type: number }
    tokens: { type: object, required: [input, output, cacheRead, cacheWrite], properties: { input: { type: integer }, output: { type: integer }, cacheRead: { type: integer }, cacheWrite: { type: integer } } }
    gapTopics: { type: array, items: { type: object, required: [topic, count, nearestCovered], properties: { topic: { type: string }, count: { type: integer }, nearestCovered: { type: string, nullable: true } } } }
AdminFlaggedAnswers:
  type: object
  required: [items, truncated]
  properties:
    truncated: { type: boolean }
    items:
      type: array
      items:
        type: object
        additionalProperties: false
        required: [at, modelId, messageType, question, answer, rating, report, reanswer]
        properties:
          at: { type: string, format: date-time }
          modelId: { type: string }
          messageType: { type: string, nullable: true }
          question: { type: string }
          answer: { type: object, required: [text, citations], properties: { text: { type: string }, citations: { type: array, items: { type: string } } } }
          rating: { type: object, nullable: true, required: [reason, note], properties: { reason: { type: string, nullable: true }, note: { type: string, nullable: true } } }
          report: { type: object, nullable: true, required: [reason, note], properties: { reason: { type: string, nullable: true }, note: { type: string, nullable: true } } }
          reanswer: { type: object, required: [status, text], properties: { status: { type: string, enum: [answered, not_completed, none] }, text: { type: string, nullable: true } } }
AdminSiteFeedback:
  type: object
  required: [items, truncated]
  properties:
    truncated: { type: boolean }
    items:
      type: array
      items:
        type: object
        additionalProperties: false
        required: [id, body, createdAt]
        properties:
          id: { type: integer }
          body: { type: string }
          createdAt: { type: string, format: date-time }
```

operationIds: `getAdminWatBotMetrics` (`/admin/watbot/metrics`), `getAdminWatBotFlagged` (`/admin/watbot/flagged`), `getAdminFeedback` (`/admin/feedback`). Run codegen.

- [ ] **Step 2: Write the failing gate test** (`__tests__/adminGate.test.ts`, real Postgres). It uses `feedback.test.ts`'s `registerAndGetCookie` pattern, and sets a role directly with `db.update(usersTable).set({ role }).where(eq(usersTable.id, id))`.

```ts
const PATHS = ["/api/admin/watbot/metrics", "/api/admin/watbot/flagged", "/api/admin/feedback"];
const Q = "?from=2026-11-01&to=2026-11-27";
it.each(PATHS)("%s: signed out → 404 (not 401)", async (p) => {
  const res = await request(app).get(p + Q);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "Not found" });
});
it.each(PATHS)("%s: student, instructor, stale-terms admin and deleted admin → 404", async (p) => {
  for (const setup of [asStudent, asInstructor, asStaleTermsAdmin, asDeletedAdmin]) {
    const cookie = await setup();
    expect((await request(app).get(p + Q).set("Cookie", cookie)).status).toBe(404);
  }
});
it.each(PATHS)("%s: admin → 200", async (p) => {
  const cookie = await asAdmin();
  expect((await request(app).get(p + Q).set("Cookie", cookie)).status).toBe(200);
});
it("422s on a bad range, as plain sentences", async () => {
  const cookie = await asAdmin();
  for (const q of ["?from=2026-11-27&to=2026-11-01", "?from=2026-01-01&to=2026-11-27", "?from=2099-01-01&to=2099-01-02", "?from=2026-11-01&to=2026-11-27&modelId=nope", "?from=x&to=y"]) {
    const res = await request(app).get("/api/admin/watbot/metrics" + q).set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/^[A-Z][^[{]*\.$/);
  }
});
```

Define the helpers in the file:
- `asAdmin`: register, then set `role = 'admin'`.
- `asStudent`.
- `asInstructor`.
- `asStaleTermsAdmin`: set `role = 'admin'` and `terms_version = '2000-01-01'`.
- `asDeletedAdmin`: register, keep the cookie, set `role = 'admin'`, then delete the row.

The `afterAll` deletes every registered id.

- [ ] **Step 3: Write the failing site-feedback test** (same file)

```ts
it("GET /api/admin/feedback returns exactly {id, body, createdAt}, newest first, in range", async () => {
  const cookie = await asAdmin();
  await db.insert(feedbackTable).values([{ body: `${MARKER}old`, createdAt: new Date("2026-10-01T12:00:00Z") }, { body: `${MARKER}a`, createdAt: new Date("2026-11-20T12:00:00Z") }, { body: `${MARKER}b`, createdAt: new Date("2026-11-21T12:00:00Z") }]);
  const res = await request(app).get("/api/admin/feedback?from=2026-11-01&to=2026-11-27").set("Cookie", cookie);
  const mine = res.body.items.filter((i: { body: string }) => i.body.startsWith(MARKER));
  expect(mine.map((i: { body: string }) => i.body)).toEqual([`${MARKER}b`, `${MARKER}a`]);
  for (const i of res.body.items) expect(Object.keys(i).sort()).toEqual(["body", "createdAt", "id"]);
});
```

- [ ] **Step 4: Run, expect FAIL** (all 404 or route missing).

- [ ] **Step 5: Implement `requireAdmin`** (`middlewares/auth.ts`)

```ts
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  let user: Awaited<ReturnType<typeof sessionUser>>;
  try { user = await sessionUser(req); } catch {
    // No error binding (api-server/CLAUDE.md: drizzle errors carry their params).
    logger.error({ step: "admin-session-lookup" }, "admin session lookup failed");
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Exact raw value, not parseRole: an unknown role must never pass this gate.
  if (!user || user.role !== "admin") { res.status(404).json({ error: "Not found" }); return; }
  req.userId = user.id;
  next();
}
```

- [ ] **Step 6: Implement `services/adminRange.ts`**

```ts
import { sql, type SQL } from "drizzle-orm";
import { getManifest } from "../registry/modelRegistry.js";

const TZ = "America/Chicago";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const chicagoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1;

export type AdminRange = { from: string; to: string; modelId?: string };
export function parseAdminRange(q: Record<string, unknown>, now = new Date()): { ok: true; range: AdminRange } | { ok: false; error: string } {
  const { from, to, modelId } = q;
  if (typeof from !== "string" || typeof to !== "string" || !DATE.test(from) || !DATE.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to)))
    return { ok: false, error: "Choose a start and end date." };
  if (from > to) return { ok: false, error: "The start date must be on or before the end date." };
  if (to > chicagoToday(now)) return { ok: false, error: "The end date can't be in the future." };
  if (days(from, to) > 90) return { ok: false, error: "Choose a range of 90 days or fewer." };
  if (modelId !== undefined && (typeof modelId !== "string" || !getManifest(modelId))) return { ok: false, error: "That chapter model doesn't exist." };
  return { ok: true, range: { from, to, modelId: modelId as string | undefined } };
}
// Chicago midnight → instant. date::timestamp AT TIME ZONE tz reads the wall clock in tz.
export const chicagoStart = (d: string): SQL => sql`((${d})::date::timestamp AT TIME ZONE ${TZ})`;
export const chicagoEnd = (d: string): SQL => sql`(((${d})::date + 1)::timestamp AT TIME ZONE ${TZ})`;
export const chicagoDay = (col: SQL): SQL => sql`((${col}) AT TIME ZONE ${TZ})::date`;
export const priorRange = (r: AdminRange): AdminRange => {
  const n = days(r.from, r.to), f = new Date(Date.parse(r.from) - n * 86_400_000), t = new Date(Date.parse(r.from) - 86_400_000);
  return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10), modelId: r.modelId };
};
```

- [ ] **Step 7: Implement `routes/admin.ts` (site feedback now; metrics and flagged in T3 and T4)**

```ts
import { Router, type IRouter } from "express";
import { and, desc, gte, lt } from "drizzle-orm";
import { db, feedbackTable } from "@workspace/db";
import { GetAdminFeedbackResponse } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth.js";
import { parseAdminRange, chicagoStart, chicagoEnd } from "../services/adminRange.js";

const router: IRouter = Router();
router.use("/admin", requireAdmin);

router.get("/admin/feedback", async (req, res) => {
  const p = parseAdminRange(req.query as Record<string, unknown>);
  if (!p.ok) { res.status(422).json({ error: p.error }); return; }
  try {
    const rows = await db.select({ id: feedbackTable.id, body: feedbackTable.body, createdAt: feedbackTable.createdAt }).from(feedbackTable)
      .where(and(gte(feedbackTable.createdAt, chicagoStart(p.range.from)), lt(feedbackTable.createdAt, chicagoEnd(p.range.to))))
      .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id)).limit(501);
    res.json(GetAdminFeedbackResponse.parse({ truncated: rows.length > 500, items: rows.slice(0, 500).map(r => ({ ...r, createdAt: r.createdAt.toISOString() })) }));
  } catch { res.status(500).json({ error: "Could not load site feedback." }); }
});

export default router;
```

Register it in `routes/index.ts`: import `adminRouter from "./admin.js"` and add `router.use(adminRouter);` **immediately after** `router.use(authRouter);`, with a comment citing spec §3.2.

- [ ] **Step 8: Guard test** (`__tests__/adminRouteGuards.test.ts`, source-reading, following `lockedModelGuards.test.ts`)

```ts
import { readFileSync } from "node:fs";
const admin = readFileSync(new URL("../routes/admin.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
it("every admin route sits behind requireAdmin, mounted before any route", () => {
  const gate = admin.indexOf('router.use("/admin", requireAdmin)');
  const routes = [...admin.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)];
  expect(routes.length).toBeGreaterThan(0); // non-vacuity
  expect(gate).toBeGreaterThan(-1);
  for (const r of routes) { expect(r[2]!.startsWith("/admin/")).toBe(true); expect(r.index!).toBeGreaterThan(gate); }
});
it("adminRouter is registered right after authRouter, before any router that mounts requireAuth", () => {
  const order = [...index.matchAll(/router\.use\((\w+)\)/g)].map(m => m[1]);
  expect(order.indexOf("adminRouter")).toBe(order.indexOf("authRouter") + 1);
});
```

- [ ] **Step 9:** Run `adminGate.test.ts`, `adminRouteGuards.test.ts`, `feedback.test.ts` and `watbotRoutes.test.ts` (no regression); expect PASS. Then show the guard is non-vacuous: temporarily delete the `router.use("/admin", requireAdmin)` line, see both tests FAIL, and restore it. Run `pnpm run typecheck`.

- [ ] **Step 10: Commit** `[ADM-T2] add the admin API contract, the 404 admin gate and the site-feedback endpoint` (pathspec: the files above plus the generated directories).

---

### Task 3 (ADM-T3): WatBot metrics endpoint, indexes, performance

**Files:**
- Create: `artifacts/api-server/src/services/adminMetrics.ts`, `artifacts/api-server/src/__tests__/adminMetrics.test.ts`, `artifacts/api-server/src/__tests__/adminPerf.test.ts`
- Modify: `routes/admin.ts`, `lib/db/src/schema/watbot.ts`

**Interfaces:**
- Consumes: `parseAdminRange`, `chicagoStart`, `chicagoEnd`, `chicagoDay`, `priorRange` (T2); `monthlySpendUsd`, `monthlyCapUsd` (`watbot/limits.ts`); `CLAIM_REMOVED_NOTICE`, `REFUSED_NOTICE`, `STOPPED_NOTICE`, `FAILED_NOTICE` (`watbot/engine.ts`).
- Produces: `getAdminMetrics(range: AdminRange, now?: Date): Promise<AdminWatBotMetrics>`.

- [ ] **Step 1: Indexes** (`lib/db/src/schema/watbot.ts`). Add to the `watbot_messages` index list:

```ts
index("IDX_watbot_messages_role_created").on(t.role, t.createdAt),
```

Give `watbot_feedback` an index list `(t) => [uniqueIndex(...existing), index("IDX_watbot_feedback_created").on(t.createdAt)]`, and the same for `watbot_reports` (`IDX_watbot_reports_created`). Push locally.

- [ ] **Step 2: Write the failing metrics test** (`adminMetrics.test.ts`, real Postgres). Seed through Drizzle, with a dedicated marker conversation title and teardown by user id:
  - **Users:** student S1, instructor S2 (who must be counted), and admin A1 (who must be excluded). A malformed role can't be inserted once T1's `CHECK` exists, so the admin exclusion is the allowlist's test.
  - **Conversations:** two for model `p-median-us`, one for `max-coverage-us`.
  - **Rows with fixed `createdAt`:**
    - S1, day 2026-11-10 (Chicago): student answered, then tutor (costUsd 0.03, latency 3000, gap_topic `"Lagrangian relaxation (nearest covered: Facility location)"`), then notice `CLAIM_REMOVED_NOTICE`.
    - S1, same conversation, 12:20 the same day: student answered, then tutor (latency 5000), then notices `REFUSED_NOTICE` and `"One claim was removed — I couldn't support it with a course source."` (the old wording).
    - S2, 2026-11-11 **05:30 UTC**: student answered, then tutor. This is Chicago 2026-11-10 23:30, so it must land on the 10th.
    - S2, conversation 2, interleaved ids: a student row, then a FAILED_NOTICE with no tutor row. It counts as `failedNotices`, not `notices`.
    - A1 (admin), 2026-11-10: student answered, then tutor (costUsd 9.99). It must not appear anywhere.
    - A student `status = 'unavailable'` row for S2 on the 10th.
    - Feedback on S1's first tutor row, `helped = false`, reason `still_stuck`, `repair_message_id` set; feedback on the second, `helped = true`.
    - A report on S2's tutor row, reason `citation_unsupported`.
    - Gap topics `"lagrangian relaxation (nearest covered: Duality)"` and `"Lagrangian relaxation (nearest covered: Facility location)"`; they group as one topic, count 2, nearest `Facility location`. Plus an unparseable gap `"Stochastic demand"`, grouped whole.

  Assert, for `{ from: "2026-11-10", to: "2026-11-11" }`, day 2026-11-10:
  - `asked: 4, answered: 3, unavailable: 1`;
  - `notices: 2` (both tutor rows of S1: one with the current text, one with the old text);
  - `refused: 1, failedNotices: 1`;
  - `costUsd` excludes A1's 9.99;
  - `latencyMedianMs` is the median of S1/S2 latencies only;
  - `ratings: 2, helped: 1`.

  Period-level:
  - `activeStudents: 2`;
  - `reanswered: 1`;
  - `reportsByReason` holds `citation_unsupported: 1`;
  - `gapTopics[0]` equals `{ topic: "Lagrangian relaxation", count: 2, nearestCovered: "Facility location" }`, plus `"Stochastic demand"` at count 1;
  - `sessions: 2`. S1's two questions 20 min apart make one session, and S2 one more. The admin's session is excluded.

  Day 2026-11-11 is zero-filled (`asked: 0`). `matrix` carries `p-median-us`. With `modelId: "max-coverage-us"`, S1's rows disappear.

- [ ] **Step 3: Run, expect FAIL** (`getAdminMetrics` missing).

- [ ] **Step 4: Implement `services/adminMetrics.ts`.** Every query starts from this CTE:

```ts
const allow = sql`u.role IN ('student', 'instructor')`;
const scope = (r: AdminRange) => sql`
  m.created_at >= ${chicagoStart(r.from)} AND m.created_at < ${chicagoEnd(r.to)}
  ${r.modelId ? sql`AND c.model_id = ${r.modelId}` : sql``}`;
const DROP_TEXTS = [CLAIM_REMOVED_NOTICE, "One claim was removed — I couldn't support it with a course source."];
```

- **Days:**

```sql
WITH d AS (SELECT generate_series(:from::date, :to::date, interval '1 day')::date AS date),
base AS (
  SELECT m.*, c.model_id, ((m.created_at) AT TIME ZONE 'America/Chicago')::date AS day
  FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.user_id
  WHERE <allow> AND <scope>),
-- A notice belongs to the nearest earlier tutor row in its conversation when no student row sits between (spec §4.1).
note AS (
  SELECT n.blocks->0->>'text' AS text, n.day, t.id AS tutor_id
  FROM base n
  LEFT JOIN LATERAL (SELECT max(id) AS id FROM watbot_messages WHERE conversation_id = n.conversation_id AND role = 'tutor' AND id < n.id) t ON true
  LEFT JOIN LATERAL (SELECT max(id) AS id FROM watbot_messages WHERE conversation_id = n.conversation_id AND role = 'student' AND id < n.id) s ON true
  WHERE n.role = 'notice' AND (t.id > coalesce(s.id, 0) OR n.blocks->0->>'text' = :failed))
SELECT d.date,
  count(*) FILTER (WHERE b.role = 'student') AS asked,
  count(*) FILTER (WHERE b.role = 'student' AND b.status = 'answered') AS answered,
  count(*) FILTER (WHERE b.role = 'student' AND b.status = 'cancelled') AS cancelled,
  count(*) FILTER (WHERE b.role = 'student' AND b.status = 'unavailable') AS unavailable,
  count(*) FILTER (WHERE b.role = 'student' AND b.status = 'limit_reached') AS limit_reached,
  coalesce(sum((b.usage->>'costUsd')::numeric) FILTER (WHERE b.role = 'tutor'), 0) AS cost_usd,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY b.latency_ms) FILTER (WHERE b.role = 'tutor') AS latency_median_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY b.latency_ms) FILTER (WHERE b.role = 'tutor') AS latency_p95_ms,
  count(*) FILTER (WHERE b.role = 'tutor' AND (b.usage->>'estimated')::boolean) AS estimated
FROM d LEFT JOIN base b ON b.day = d.date GROUP BY d.date ORDER BY d.date
```

  Then, in separate small queries keyed by day, merged in TS:
  - `notices`, `refused`, `stopped`: `count(DISTINCT tutor_id)` per text set, from `note`;
  - `failedNotices`: `count(*)` where text is `FAILED_NOTICE`;
  - `ratings`/`helped`: `watbot_feedback f JOIN watbot_messages t ON t.id = f.message_id JOIN conversations JOIN users` with `<allow>`, bucketed by `chicagoDay(f.created_at)` and filtered on `f.created_at` in range.

- **Matrix:** student answered rows grouped by `c.model_id, m.message_type`.

- **Period** (run for `range` and `priorRange(range)`):
  - `answered`, and `activeStudents = count(DISTINCT m.user_id)` over answered student rows;
  - `studentsByModel`;
  - ratings and `notHelpedByReason` (helped = false), `reanswered` (`repair_message_id IS NOT NULL`);
  - `reportsByReason` (`watbot_reports` in range, allowlisted user);
  - `costUsd`; tokens (sums of `usage` fields);
  - **Gap topics:**

```sql
SELECT coalesce(lower(trim(p[1])), lower(trim(g))) AS key, min(coalesce(trim(p[1]), trim(g))) AS topic, count(*) AS count,
       mode() WITHIN GROUP (ORDER BY trim(p[2])) AS nearest_covered
FROM (SELECT m.gap_topic AS g, regexp_match(m.gap_topic, '^(.*) \(nearest covered: (.*)\)$') AS p FROM base m WHERE m.role = 'tutor' AND m.gap_topic IS NOT NULL) x
GROUP BY 1 ORDER BY count DESC, topic LIMIT 20
```

  - **Sessions:** inline, the view's rule, on allowlisted answered student rows in range:

```sql
WITH m AS (SELECT m.user_id, c.model_id, m.created_at,
  CASE WHEN lag(m.created_at) OVER w IS NULL OR m.created_at - lag(m.created_at) OVER w > interval '30 minutes' THEN 1 ELSE 0 END AS is_new
  FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.user_id
  WHERE m.role = 'student' AND m.status = 'answered' AND <allow> AND <scope>
  WINDOW w AS (PARTITION BY m.user_id, c.model_id ORDER BY m.created_at)),
s AS (SELECT *, sum(is_new) OVER (PARTITION BY user_id, model_id ORDER BY created_at ROWS UNBOUNDED PRECEDING) AS sn FROM m),
g AS (SELECT user_id, model_id, sn, min(created_at) AS a, max(created_at) AS b, count(*) AS n FROM s GROUP BY 1, 2, 3)
SELECT count(*) AS sessions,
  coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM b - a) / 60), 0) AS median_minutes,
  coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY n), 0) AS median_questions FROM g
```

  - `sessionsByWeek`: the same `g`, grouped by `date_trunc('week', a AT TIME ZONE 'America/Chicago')::date`.

- **Month to date:** `{ spendUsd: await monthlySpendUsd(now), capUsd: monthlyCapUsd(), month: now.toISOString().slice(0, 7) }`. This one is unfiltered by design (spec §4.1).

Convert numeric strings with `Number(...)`, round cost to 4 dp, and return the object. Wire it in `routes/admin.ts`:

```ts
router.get("/admin/watbot/metrics", async (req, res) => {
  const p = parseAdminRange(req.query as Record<string, unknown>);
  if (!p.ok) { res.status(422).json({ error: p.error }); return; }
  try { res.json(GetAdminWatBotMetricsResponse.parse(await getAdminMetrics(p.range))); }
  catch { res.status(500).json({ error: "Could not load WatBot metrics." }); }
});
```

- [ ] **Step 5: Run `adminMetrics.test.ts`, expect PASS.** If a number disagrees, fix the SQL, never the expected value. The expectations are hand-computed from the seed.

- [ ] **Step 6: Performance test** (`adminPerf.test.ts`)
  - **Volume:** `PERF_SCALE` defaults to 10× the production counts measured read-only during planning. When unknown, use 10× of 20,000 student rows: 200,000 student, 200,000 tutor and 20,000 feedback rows over 180 days for 150 users. Seed with `INSERT … SELECT generate_series`.
  - **Assert:** each endpoint for a 90-day range answers in under 1000 ms (median of 3).
  - **Record:** `EXPLAIN (ANALYZE, BUFFERS)` of the days query, written to `.harness/adm-explain.txt` (gitignored) and pasted into the task report.
  - **Cleanup:** tear down by marker title.
  - **Tagging:** describe it with `.skipIf(!process.env.ADMIN_PERF)`, so the normal gate doesn't spend minutes on it. The lead runs it once with `ADMIN_PERF=1` before merge. If it misses, stop and report; don't tune silently (spec §4.4).

- [ ] **Step 7: Commit** `[ADM-T3] add the WatBot metrics endpoint with indexes and a 10x performance check`.

---

### Task 4 (ADM-T4): Flagged-answers endpoint

**Files:**
- Create: `artifacts/api-server/src/services/adminFlagged.ts`, `artifacts/api-server/src/__tests__/adminFlagged.test.ts`
- Modify: `routes/admin.ts`

**Interfaces:**
- Consumes: T2 range helpers.
- Produces: `getAdminFlagged(range: AdminRange): Promise<AdminFlaggedAnswers>`.

- [ ] **Step 1: Write the failing test** (real Postgres). Seed:
  - **Conversation 1 (S1):** student Q1, then tutor T1 (blocks `[{ text: "Answer one.", citations: [{ passageId: 1, label: "Ch 3 · p.71", citedText: "BOOK TEXT" }] }]`).
    - Feedback on T1: helped = false, reason `still_stuck`, note "still lost", `repair_message_id` = student R1.
    - R1 (the repair marker) is followed by tutor T1b ("Re-answer text."), so its status is **answered**.
  - **Conversation 2 (S2), interleaved ids with conversation 1:** student Q2, then tutor T2. Feedback on T2: helped = false, reason `hard_to_follow`, repair R2 with **no** tutor row after it, so its status is **not_completed**.
  - **Conversation 3 (S1):** tutor T3 with a report, reason `wrong_or_misleading`, note "wrong".
  - **Admin A1:** a flagged tutor row that must be excluded.
  - Every user's email contains `adm-flag-secret`.

  Assert:
  - the items are T3, T2, T1, newest first;
  - T1: `question === Q1 text` (not R1, not conversation 2's), `answer.citations` equals `["Ch 3 · p.71"]`, and `reanswer` equals `{ status: "answered", text: "Re-answer text." }`;
  - T2: `reanswer.status === "not_completed"` and `text === null`;
  - T3: `rating === null`, and `report` equals `{ reason: "wrong_or_misleading", note: "wrong" }`;
  - every item's keys equal exactly `["answer", "at", "messageType", "modelId", "question", "rating", "reanswer", "report"]`;
  - `JSON.stringify(res.body)` contains neither `adm-flag-secret`, nor any seeded user id, conversation id or message id as a value, nor `"BOOK TEXT"` (no `citedText`).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `services/adminFlagged.ts`**

```sql
SELECT t.id, t.created_at AS at, c.model_id, t.blocks,
  (SELECT s.message_type FROM watbot_messages s WHERE s.conversation_id = t.conversation_id AND s.role = 'student' AND s.id < t.id ORDER BY s.id DESC LIMIT 1) AS message_type,
  (SELECT s.blocks FROM watbot_messages s WHERE s.conversation_id = t.conversation_id AND s.role = 'student' AND s.id < t.id ORDER BY s.id DESC LIMIT 1) AS question_blocks,
  f.helped, f.reason AS rating_reason, f.note AS rating_note, f.repair_message_id,
  r.reason AS report_reason, r.note AS report_note,
  (SELECT rt.blocks FROM watbot_messages rt WHERE f.repair_message_id IS NOT NULL AND rt.conversation_id = t.conversation_id AND rt.role = 'tutor' AND rt.id > f.repair_message_id ORDER BY rt.id LIMIT 1) AS reanswer_blocks
FROM watbot_messages t
JOIN watbot_conversations c ON c.id = t.conversation_id JOIN users u ON u.id = t.user_id
LEFT JOIN watbot_feedback f ON f.message_id = t.id
LEFT JOIN LATERAL (SELECT reason, note FROM watbot_reports WHERE message_id = t.id ORDER BY id DESC LIMIT 1) r ON true
WHERE t.role = 'tutor' AND u.role IN ('student', 'instructor')
  AND t.created_at >= :start AND t.created_at < :end [AND c.model_id = :modelId]
  AND (f.helped = false OR r.reason IS NOT NULL)
ORDER BY t.created_at DESC, t.id DESC LIMIT 101
```

Shape in TS:
- `text = blocks.map(b => b.text).join(" ").trim()`;
- `citations = [...new Set(blocks.flatMap(b => b.citations.map(c => c.label)))]`;
- `rating = f.helped === false ? { reason, note } : null`;
- `report = report_reason ? { reason, note } : null`;
- `reanswer = repair_message_id == null ? { status: "none", text: null } : reanswer_blocks ? { status: "answered", text } : { status: "not_completed", text: null }`;
- `truncated = rows.length > 100`.

Never put `id` in the output object; select it only for ordering. Wire `GET /admin/watbot/flagged` the same way as metrics, using `GetAdminWatBotFlaggedResponse.parse`.

- [ ] **Step 4: Run, expect PASS**, plus `adminGate.test.ts` and `adminRouteGuards.test.ts`.
- [ ] **Step 5: Commit** `[ADM-T4] add the flagged-answers endpoint with re-answer status and no identities`.

---

### Task 5 (ADM-T5): Studio `/admin` page

**Files:**
- Create:
  - `artifacts/studio/src/lib/adminMetrics.ts` and `src/__tests__/adminMetrics.test.ts`;
  - `src/pages/admin/AdminDashboard.tsx`;
  - `src/components/admin/{AttentionStrip,Tiles,ChartCard,LineCard,BarListCard,Heatmap,VoiceColumn}.tsx`;
  - `src/__tests__/AdminDashboard.test.tsx`.
- Modify: `src/App.tsx`, `src/components/AppShell.tsx`.

**Interfaces:**
- Consumes: the T2 generated hooks `useGetAdminWatBotMetrics(params)`, `useGetAdminWatBotFlagged(params)`, `useGetAdminFeedback(params)`, and their response types; `useGetCurrentAuthUser` (role now includes `admin`).
- Produces: route `/admin`, and `AppShell` prop `isAdmin?: boolean`.

- [ ] **Step 1: Pure helpers, failing tests first** (`src/__tests__/adminMetrics.test.ts`)

```ts
import { chicagoToday, presetRange, weekly, rateOrDash, heatBins, delta } from "@/lib/adminMetrics";
it("chicagoToday uses Chicago, not UTC", () => expect(chicagoToday(new Date("2026-11-11T05:30:00Z"))).toBe("2026-11-10"));
it("presetRange(30) ends today and spans 30 days", () => expect(presetRange(30, new Date("2026-11-27T18:00:00Z"))).toEqual({ from: "2026-10-29", to: "2026-11-27" }));
it("weekly sums counts Monday-first and keeps n", () => {
  const w = weekly([{ date: "2026-11-09", n: 3, k: 1 }, { date: "2026-11-15", n: 2, k: 2 }, { date: "2026-11-16", n: 4, k: 4 }], ["n", "k"]);
  expect(w).toEqual([{ weekStart: "2026-11-09", n: 5, k: 3 }, { weekStart: "2026-11-16", n: 4, k: 4 }]);
});
it("rateOrDash hides rates under n = 5", () => { expect(rateOrDash(2, 4)).toBeNull(); expect(rateOrDash(3, 5)).toBe(0.6); });
it("heatBins: 0 → -1, others into 5 quantile steps", () => expect(heatBins([0, 1, 2, 3, 4, 5, 100])).toEqual([-1, 0, 1, 2, 3, 4, 4]));
it("delta: percent and points, null without a base", () => { expect(delta(110, 100)).toBeCloseTo(10); expect(delta(5, 0)).toBeNull(); });
```

Implement `src/lib/adminMetrics.ts` to pass:
- `presetRange(days, now)`;
- `weekly(days, keys)`, Monday-start on Chicago dates;
- `rateOrDash(num, n)`, which is null when n < 5;
- `heatBins(values)`: 0 maps to -1; otherwise 5 bins at the 20/40/60/80% quantiles of the non-zero values;
- `delta(a, b)` in percent, null when b is 0.

- [ ] **Step 2: Route and header, failing test first** (`AdminDashboard.test.tsx`). Mock the generated hooks with fixtures in the existing studio test style (`vi.mock("@workspace/api-client-react", …)`). Assert:
  - `role: "student"`: rendering `/admin` (wouter memory location, as in `App.test.tsx`) shows the NotFound page and no "Admin" link in the header;
  - `role: "admin"`: the page renders tiles ("Questions answered"), the tab list, and the voice column heading "What students said", and the header shows "Admin";
  - the Table toggle on "Questions per day" shows the fixture's daily counts as table rows;
  - in a week with 4 ratings the helped-rate table shows "–";
  - choosing a model shows "Site feedback has no chapter, so it shows for every chapter.";
  - expanding a flagged item shows its re-answer text, and `reanswer.status === "not_completed"` shows "Re-answer didn't finish".

- [ ] **Step 3: Implement**, porting markup, tokens and copy from `docs/superpowers/specs/assets/2026-11-27-admin-dashboard-prototype.html`:
  - **`App.tsx`:** inside the single `<Switch>`, before the catch-all:

```tsx
<Route path="/admin">{authedOnly(user?.role === "admin" ? <AdminDashboard /> : <NotFound />)}</Route>
```

    Pass `isAdmin={user?.role === "admin"}` to `AppShell` in `authedOnly`.
  - **`AppShell.tsx`:** when `isAdmin`, render `<Link href="/admin" data-testid="link-admin">Admin</Link>` before the email, styled like the Log out button.
  - **`AdminDashboard.tsx`:** state `{ preset: 7 | 30 | 90 | "custom", from, to, modelId }` (default 30 days). Call the three hooks with `{ from, to, modelId }` and site feedback with `{ from, to }`. Use `placeholderData: keepPreviousData`, and dim at `opacity: .6` while fetching (no skeleton flash). Layout grid `minmax(0,1fr) 440px`, stacking below 1100px.
  - **`AttentionStrip`:** spend vs cap (amber only when `spendUsd / capUsd >= 0.8`, label "UTC month"); not answered in the last 7 days against 4%; flagged count this week; site feedback count this week; the jump link `#voice` below 1100px. All as in the prototype.
  - **`Tiles`:** four tiles, with deltas from `period` vs `prior` (neutral ink, olive only for improvements).
  - **`LineCard`/`BarListCard`:** recharts `LineChart`/`BarChart` with `accessibilityLayer`, `ResponsiveContainer` and one series in `hsl(var(--chart-1))`, plus the grey context line in `hsl(var(--chart-5))`. Axis text 11–12px. A tooltip lists every series with its n where relevant. A "Table" toggle renders the same rows.
  - **`Heatmap`:** a CSS grid of `<button>` cells (focusable, `aria-label` "Ch N, Type: K questions"), colours `var(--band-0…4)` by `heatBins`, a `var(--zero)`-style empty cell, and a "None · fewer → more" key. Rows are models (label from `/api/models` names); columns are the five types plus "Unrecorded" when present.
  - **`VoiceColumn`:** tabs All / Flagged answers / Site feedback with counts, a search box, and newest-first ordering.
    - A flagged item is a `<details>` with the summary: tags, quote in Source Serif, and a one-line WatBot reply. The body holds the answer with citation chips, the note or report, and the re-answer by status ("Re-answer didn't finish" for `not_completed`).
    - Site feedback items carry "anonymous", clamp to 3 lines, and have "Show more".
  - **Errors** show a plain sentence ("Couldn't load the dashboard. Try again.") with a Retry button, never `err.message` (studio gotcha).
  - **Empty:** "Nothing in this range."

- [ ] **Step 4:** Run `pnpm --filter studio test`, expect PASS, and `pnpm run typecheck`.
- [ ] **Step 5: Commit** `[ADM-T5] add the admin dashboard page and the admin-only header link`.

---

### Task 6 (ADM-T6): Playwright e2e + real-browser QA (qa-sdet)

**Files:**
- Create: `artifacts/studio/e2e/admin-dashboard.spec.ts`, `artifacts/studio/e2e/helpers/adminDb.ts`
- Modify: any sibling e2e spec that hard-codes the AppShell header layout (grep `text-user-email`, `button-logout`)

- [ ] **Step 1: Helper** (`helpers/adminDb.ts`), using the same `psql` pattern as `termsDb.ts`:

```ts
export function setRole(email: string, role: "student" | "instructor" | "admin"): void {
  const id = psql("UPDATE users SET role = :'role' WHERE email = :'email' RETURNING id;\n", { email, role });
  if (!id) throw new Error(`no users row for ${email}`);
}
// One flagged exchange for a fresh student, dated "now" so every preset includes it.
export function seedAdminFixture(studentEmail: string, tag: string, modelId = "p-median-us"): void {
  psql(`WITH u AS (SELECT id FROM users WHERE email = :'email'),
c AS (INSERT INTO watbot_conversations (user_id, model_id, title) SELECT id, :'model', :'tag' FROM u RETURNING id, user_id),
s AS (INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, message_type, status)
      SELECT c.id, c.user_id, 'student', jsonb_build_array(jsonb_build_object('text', :'tag' || ' why is the far warehouse open?', 'citations', '[]'::jsonb)), 'concept_question', 'answered' FROM c RETURNING id),
t AS (INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, usage, latency_ms)
      SELECT c.id, c.user_id, 'tutor', jsonb_build_array(jsonb_build_object('text', 'Capacity limits can fill the nearest site.', 'citations', jsonb_build_array(jsonb_build_object('passageId', 1, 'label', 'Ch 3 · p.71', 'citedText', 'x')))),
             '{"inputTokens":100,"outputTokens":50,"cacheReadTokens":0,"cacheWriteTokens":0,"costUsd":0.01}'::jsonb, 2500
      FROM c, s RETURNING id, conversation_id, user_id)
INSERT INTO watbot_feedback (conversation_id, message_id, user_id, helped, reason) SELECT conversation_id, id, user_id, false, 'still_stuck' FROM t;
`, { email: studentEmail, tag, model: modelId });
}
export function clearAdminFixture(tag: string): void {
  psql("DELETE FROM watbot_conversations WHERE title = :'tag';\n", { tag }); // messages and feedback cascade
}
```

Before running, check the `watbot_feedback` and `watbot_messages` columns this uses against `lib/db/src/schema/watbot.ts` (e.g. whether feedback carries `user_id`). Adjust the column list to the schema, never the schema to the helper.

- [ ] **Step 2: Spec cases**
  - **Admin sees the dashboard:** register, `setRole(admin)`, log in, open `/admin`. Tiles, the four tabs and "What students said" are visible, and the seeded flagged question appears and expands to show its answer.
  - **A student gets not-found:** a student at `/admin` sees the NotFound text, and the header has no "Admin" link.
  - **Filters re-scope everything together:** choosing the seeded model changes the voice count and the tile numbers together.
  - **Dark mode and 390px:** the same page at 390×844 in dark mode shows the jump link "Read what students said", and no element overflows horizontally (`document.documentElement.scrollWidth <= 390`).
  - **API gate from the browser context:** `request.get("/api/admin/feedback?from=…&to=…")` with a student session returns 404.
- [ ] **Step 3:** Run `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio test:e2e e2e/admin-dashboard.spec.ts`. The env var is mandatory (root `CLAUDE.md`).
- [ ] **Step 4: Real-browser QA** (claude-in-chrome) against the local servers:
  - click through every tab, the Table toggles and the keyboard focus on charts and heatmap cells;
  - check custom-range validation messages and the voice search;
  - check light, dark, 1440 and 390;
  - save screenshots to `.harness/adm-qa/`.
- [ ] **Step 5: Commit** `[ADM-T6] add admin dashboard e2e and real-browser QA evidence`. The commit holds the spec, the helper and the sibling-spec updates; screenshots stay in `.harness`.

---

### Task 7 (ADM-T7): Runbook and changelog (lead)

**Files:**
- Create: `docs/ops/admin-role.md`
- Modify: `docs/CHANGELOG-implementation.md` (append at the bottom)

- [ ] **Step 1:** Write `docs/ops/admin-role.md`:
  - **Audit (read-only):** `render psql <db> --output text --command "BEGIN READ ONLY; SELECT role, count(*) FROM users GROUP BY role; ROLLBACK;"`. Anything other than student or instructor stops the rollout.
  - **Schema push before the API deploy** (link `schema-push-before-deploy.md`): the CHECK plus the three indexes.
  - **Grant, only after the new API is live:** `BEGIN; UPDATE users SET role = 'admin' WHERE lower(email) = lower(:'email'); -- expect UPDATE 1, else ROLLBACK; COMMIT;`. The email is never written in the repo.
  - **Revoke:** `SET role = 'student'`.
  - **Verify:** `SELECT count(*) FROM users WHERE role = 'admin'` returns 1.
  - **The ordering trap** (spec §3.1).
- [ ] **Step 2:** Append a changelog section "ADM: admin dashboard (Spec 1)": what landed, commit SHAs per task, gate counts and deviations.
- [ ] **Step 3: Commit** `[ADM-T7] add the admin-role runbook and the changelog entry`.

---

## Finish

- `pnpm gate` on the bundle branch with 0 concurrent vitest. Exit 3 means re-run serially. Then `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`, which is unaffected but sacred.
- `ADMIN_PERF=1` run of `adminPerf.test.ts`; record the timings and EXPLAIN in the changelog.
- `E2E_BASE_URL=… pnpm e2e:gate`, and fix sibling specs per the repo gotcha.
- `superpowers:finishing-a-development-branch`, then **stop for merge approval**. Then the merge into local `main`, an Opus whole-branch review, the push, and deploys, each with its own approval. The order:
  1. read-only role audit;
  2. production schema push;
  3. nos-api;
  4. nos-studio;
  5. the admin `UPDATE`.
- `/harness-retro ADM`.
