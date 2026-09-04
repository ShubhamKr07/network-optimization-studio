# Bundle 5 — Homepage polish + Distances pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six homepage/Distances refinements — book-cover branding, chapter-card restyle, recent-solves deduped per scenario, Log-out hover, homepage developer-credit footer, Distances pagination + global filter.

**Architecture:** Presentation-only except item 3 (`/solve-history` bounded-SQL dedupe + OpenAPI regen). Five file-disjoint tasks run in parallel isolated worktrees; controller cherry-picks each onto main and re-gates.

**Tech Stack:** React + Vite + Tailwind v4 + shadcn + wouter + TanStack Query (frontend); Express 5 + Drizzle (drizzle-orm 0.45.2, has `selectDistinctOn`) + orval/OpenAPI (backend); vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-04-bundle5-homepage-distances-polish-design.md` (review-resolved). Read its resolutions log — T4/T5 encode resolutions #1/#3/#4/#5, T1 encodes #2/#6, T3 encodes #7.

## Plan review — resolutions (2026-09-04)

Six plan-review findings; all fixed inline:

1. **[P1] Existing solve-history tests break under the two-query shape.** The
   rewritten route calls `selectDistinctOn` (inner) THEN `select` (outer); the
   existing `/solve-history` tests (routes.test.ts ~2163, incl. the oversized-
   limit test at ~2204 asserting `chain.limit`) configure only `mockDb.select`
   and would crash on the un-mocked `selectDistinctOn`. Fixed (T4 Step 3): a
   shared `configureSolveHistoryMocks(rows)` helper wires BOTH the inner
   `selectDistinctOn(...).as("latest")` chain and the outer `select()` chain;
   every existing history test uses it; the limit test asserts the OUTER chain's
   `.limit`; the mocked `solveJobsTable` gains concrete `queuedAt`/`resultSummary`
   markers so query-shape assertions don't compare `undefined`.
2. **[P1] Focus/filter page-reset race.** The focus effect cleared the filters
   and set `ovPage`, but a general `useEffect([fromFilter,toFilter])` page-reset
   would then observe the programmatic clear and snap `ovPage` back to 1. Fixed
   (T5 Steps 3/7): move the "reset to page 1 on filter change" INTO the From/To
   input `onChange` handlers (user-driven only), so a programmatic clear doesn't
   reset the page; the focus regression test now starts on a NON-EMPTY filter.
3. **[P2] "Bounded SQL scan" overclaimed.** `DISTINCT ON` bounds the RESPONSE to
   Node, but Postgres still filters+sorts the user's jobs (only a `user_id`
   index). Fixed (spec resolution #4 + T4 route comment): described accurately as
   **database-side dedupe with a bounded response** — NOT a bounded scan. No
   index at pilot scale; add a composite index only if a real `EXPLAIN` shows
   pain.
4. **[P2] Obsolete virtualization test + wrong mock claim.** Fixed (T5 Step 8):
   the Distances test mocks `global.fetch` (`fetchMock`) + `renderWithQueryClient`
   — NOT the `useGetReferenceDistances` hook; Step 8 now reuses that real pattern,
   and any virtualization-specific assertion (offsetHeight/scroll-window) is
   removed/renamed to assert exact first-page size + pager state.
5. **[P2] Favicon verification must actually build.** Fixed (T2 Step 3): run
   `pnpm --filter studio build` and confirm `dist/public/book-cover.png` + the
   emitted favicon `<link>` exist before committing (typecheck alone never
   processes `index.html`/`public/`).
6. **[P3] OpenAPI 200-response description.** Fixed (T4 Step 2): the `200`
   response description also changes to "at most one latest solve job per
   scenario, newest first."

## Global Constraints

- Presentation-only except T4's `/solve-history` change. No schema/DB/solver change. Tokens ONLY from `artifacts/studio/src/index.css`; `designTokens.contract.test.ts` stays green; light theme only.
- Preserve every `data-testid`, `aria-*`, and all mutation/logout logic. Never delete a behavioral test.
- Never hand-edit generated code (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`); regenerate via `pnpm --filter @workspace/api-spec run codegen`, commit spec + output together.
- Do NOT touch `Studio.tsx`, `.studio-lab`, `--arc-*`.
- One commit per task, message `[bundle5-T<n>] <summary>`. Each task runs from its own isolated worktree root; repo-relative paths. Commit with an explicit pathspec; re-check `git status` before committing.
- Book-cover contact/credit values stay the mockup verbatim (LinkedIn `shubhamkumarcse`, mailto `shubham.shubham4995@gmail.com`).

---

## Task T1 — AppShell cluster: hero cover icon + logout hover + credit footer (`[bundle5-T1]`)

Items 1-hero, 4, 5. Resolutions #2 (`auth-credit` testid) + #6 (hero-gated footer).

**Files:**
- Create: `artifacts/studio/src/components/DeveloperCredit.tsx`
- Modify: `artifacts/studio/src/components/auth/AuthShell.tsx`
- Modify: `artifacts/studio/src/components/AppShell.tsx`
- Test: `artifacts/studio/src/__tests__/AppShell.test.tsx`

**Interfaces:**
- Produces: `DeveloperCredit()` — the inner credit content (no outer border/margin), reused by AuthShell (wrapped, keeps `data-testid="auth-credit"`) and AppShell (homepage footer, `data-testid="homepage-credit-footer"`).

- [ ] **Step 1: Create `DeveloperCredit.tsx`**

The inner content extracted verbatim from AuthShell's `AuthCredit` (the three lines + links), minus the outer wrapper div (that stays in AuthShell for the `auth-credit` testid):

```tsx
const MONO = "var(--app-font-mono)";

export function DeveloperCredit() {
  return (
    <>
      <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Developed by Shubham</div>
      <div className="mt-2" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Facing issues?</div>
      <div className="mt-1 flex items-center justify-center gap-1.5" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        <span>Reach me out at</span>
        <a href="https://www.linkedin.com/in/shubhamkumarcse/" target="_blank" rel="noopener" title="LinkedIn" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <a href="mailto:shubham.shubham4995@gmail.com" title="Email" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Email"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
        </a>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Point `AuthShell.tsx` at the shared component**

Delete the local `AuthCredit` function. Add `import { DeveloperCredit } from "@/components/DeveloperCredit";`. Replace the `<AuthCredit />` call site with the wrapper that keeps the testid (resolution #2):

```tsx
<div className="mt-4 pt-3 text-center border-t" style={{ borderColor: "var(--line)" }} data-testid="auth-credit">
  <DeveloperCredit />
</div>
```
(The `MONO` const in AuthShell is still used by the kicker/labs styles — leave it. Only the `AuthCredit` function is removed.)

- [ ] **Step 3: `AppShell.tsx` — hero cover icon + logout hover + credit footer**

Add imports:
```tsx
import coverUrl from "@/assets/book-cover.jpg";
import { DeveloperCredit } from "@/components/DeveloperCredit";
```
Keep the `AppFooter` import (still used in the non-hero footer branch).

In the **`hero` header branch**, add the cover thumbnail as the first child of the inner flex row (before the `flex-1` title block):
```tsx
<div className="max-w-[860px] mx-auto px-6 py-[30px] flex items-start gap-4">
  <img src={coverUrl} alt="" className="h-12 w-auto rounded-sm flex-shrink-0" style={{ boxShadow: "0 4px 12px rgba(0,0,0,.4)" }} />
  <div className="flex-1 min-w-0">
    ...unchanged kicker/title/tagline...
  </div>
  ...unchanged email + logout...
</div>
```

Add the hover to the Log-out `Button` in **both** header branches (append to className; keep everything else):
```tsx
<Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout"
  className="hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]"
  style={{ color: "var(--ink-300)" }}>Log out</Button>
```

Replace the single `<AppFooter />` at the bottom with a hero-gated footer (resolution #6 — `hero` is passed only by the `/` route, so not-found keeps `AppFooter`):
```tsx
{hero
  ? <footer data-testid="homepage-credit-footer" className="flex-shrink-0 border-t bg-background px-6 py-3 text-center" style={{ borderColor: "var(--line)" }}>
      <DeveloperCredit />
    </footer>
  : <AppFooter />}
```

- [ ] **Step 4: Update `AppShell.test.tsx`**

Keep all existing tests (logout, email/children, band classes, heroTitle, wordmark fallback, hero-variant tagline, layout). Add:
```tsx
it("renders the book-cover icon in the hero band", () => {
  render(<AppShell userEmail="a@b.edu" heroTitle="Network Design Labs" hero><div>c</div></AppShell>);
  const header = screen.getByTestId("text-user-email").closest("header") as HTMLElement;
  expect(header.querySelector("img")).toBeInTheDocument();
});

it("shows the developer-credit footer in hero mode and the plain footer otherwise", () => {
  const { rerender } = render(<AppShell userEmail="a@b.edu" heroTitle="X" hero><div>c</div></AppShell>);
  expect(screen.getByTestId("homepage-credit-footer")).toHaveTextContent("Developed by Shubham");
  expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
  rerender(<AppShell userEmail="a@b.edu"><div>c</div></AppShell>);
  expect(screen.queryByTestId("homepage-credit-footer")).not.toBeInTheDocument();
  expect(screen.getByTestId("app-footer")).toBeInTheDocument();
});

it("gives the log-out button a hover-highlight class", () => {
  render(<AppShell userEmail="a@b.edu" hero><div>c</div></AppShell>);
  expect(screen.getByTestId("button-logout").className).toContain("hover:bg-white/10");
});
```
Note: the existing `AppShell.test.tsx` "mounts the app footer" assertions that render WITHOUT `hero` still see `app-footer` (non-hero branch) — unchanged. Any existing test that rendered WITH `hero` and asserted `app-footer` must switch to `homepage-credit-footer` (check and update only those).

- [ ] **Step 5: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle5-T1] AppShell hero cover icon, logout hover, credit footer" -- \
  artifacts/studio/src/components/DeveloperCredit.tsx \
  artifacts/studio/src/components/auth/AuthShell.tsx \
  artifacts/studio/src/components/AppShell.tsx \
  artifacts/studio/src/__tests__/AppShell.test.tsx
```

---

## Task T2 — Book-cover favicon (`[bundle5-T2]`)

Item 1-favicon.

**Files:**
- Create: `artifacts/studio/public/book-cover.png` (copied)
- Modify: `artifacts/studio/index.html`

- [ ] **Step 1: Copy the favicon asset**

```bash
cp docs/design-system/assets/book-cover.png artifacts/studio/public/book-cover.png
ls -l artifacts/studio/public/book-cover.png   # ~151KB
```

- [ ] **Step 2: Point the favicon at it**

In `artifacts/studio/index.html`, replace:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```
with:
```html
<link rel="icon" type="image/png" href="/book-cover.png" />
```
(Title line untouched. Leave `favicon.svg` in place — just no longer referenced.)

- [ ] **Step 3: Actually build + verify the asset ships (resolution #5)**

`typecheck` never processes `index.html` or `public/` — build for real:
```bash
pnpm run typecheck
PORT=5183 BASE_PATH=/ pnpm --filter studio run build
ls -l artifacts/studio/dist/public/book-cover.png            # asset copied to the build output
grep -o 'href="[^"]*book-cover.png"' artifacts/studio/dist/public/index.html   # favicon link emitted
```
Both must exist. (If the build fails on a native-binary issue — the documented lightningcss/oxide darwin-arm64 gotcha — resolve per CLAUDE.md before trusting the result.)

- [ ] **Step 4: Commit**

```bash
git commit -m "[bundle5-T2] book-cover favicon" -- artifacts/studio/index.html artifacts/studio/public/book-cover.png
```

---

## Task T3 — Chapter card restyle + recent-solves subtitle (`[bundle5-T3]`)

Items 2 + 3-frontend. Resolution #7 (radius clip).

**Files:**
- Modify: `artifacts/studio/src/pages/Landing.tsx`
- Test: `artifacts/studio/src/__tests__/Landing.test.tsx`

- [ ] **Step 1: Restyle the chapter card**

In `Landing.tsx`, change the card wrapper class and title size, and replace the `<CardContent>…footer…</CardContent>` with a full-bleed sunken footer that is a sibling of `CardHeader`. New card markup:

```tsx
<Card className="cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col overflow-hidden">
  <CardHeader>
    <p className="scnd-kicker">{c.chapter}</p>
    <CardTitle className="scnd-display text-lg">{c.title}</CardTitle>
    <CardDescription>{c.description}</CardDescription>
  </CardHeader>
  {(() => {
    const entry = byModel.get(c.modelId);
    const status = !ready
      ? null
      : !entry || entry.scenarioCount === 0
        ? "no scenarios yet"
        : entry.lastSucceededSolveAt
          ? `${entry.scenarioCount} scenarios · solved ${formatRelativeTime(entry.lastSucceededSolveAt)}`
          : `${entry.scenarioCount} scenarios`;
    const isActive = ready && c.modelId === activeModelId;
    return (
      <div
        className="mt-auto flex items-center justify-between gap-2 border-t px-6 py-3"
        style={{ background: "var(--surface-sunken)", borderColor: "var(--line)" }}
        data-testid={`landing-card-footer-${c.modelId}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="scnd-display font-bold flex-shrink-0" style={{ fontSize: "15px", color: "var(--green-700)" }}>{chapterNumber(c.chapter)}</span>
          {status && <span className="truncate" style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-muted)" }}>{status}</span>}
        </span>
        {isActive
          ? <Badge variant="outline" className="text-[10px] text-[color:var(--success)] border-[color:var(--success-border)] bg-[color:var(--success-bg)]">active</Badge>
          : <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>start →</span>}
      </div>
    );
  })()}
</Card>
```
Remove the now-unused `CardContent` import if nothing else uses it (check the file — Landing imports `CardContent`; after this change it's unused, drop it from the import).

- [ ] **Step 2: Recent-solves subtitle copy (item 3-frontend)**

Change the subtitle line:
```tsx
<p className="text-xs text-muted-foreground mb-3">Most recent solve per scenario — click to open one.</p>
```

- [ ] **Step 3: Update `Landing.test.tsx`**

Existing footer tests (chapter number "03", "start", status branches, active badge, stats line) still pass — the testid and text logic are unchanged. Add the radius-clip + sunken-strip assertions:
```tsx
it("clips the card and gives the footer a sunken full-bleed strip", () => {
  mockUseGetLandingSummary.mockReturnValue({ data: { perChapter: [], totals: { scenarios: 0, solvedScenarios: 0 } }, isPending: false, isError: false });
  renderLanding();
  const footer = screen.getByTestId("landing-card-footer-p-median-us");
  const card = footer.closest("[class*='overflow-hidden']");
  expect(card).not.toBeNull();
  expect(footer.className).toContain("border-t");
});
```
If any existing test asserted the old subtitle text ("Recent solve attempts…"), update it to the new copy.

- [ ] **Step 4: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle5-T3] Landing chapter-card restyle + recent-solves copy" -- \
  artifacts/studio/src/pages/Landing.tsx artifacts/studio/src/__tests__/Landing.test.tsx
```

---

## Task T4 — solve-history: latest per scenario, bounded in SQL (`[bundle5-T4]`)

Item 3-backend. Resolutions #4 (bounded SQL) + #5 (OpenAPI).

**Files:**
- Modify: `artifacts/api-server/src/routes/solveHistory.ts`
- Modify: `lib/api-spec/openapi.yaml` + Orval-regenerated `lib/api-zod`/`lib/api-client-react`
- Test: `artifacts/api-server/src/__tests__/routes.test.ts`

- [ ] **Step 1: Rewrite the query (DISTINCT ON + subquery)**

Replace `solveHistory.ts`'s query. Full file:

```ts
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);

// Bundle 5 — one row per scenario: the newest solve job (any status) per
// scenario, newest-first, limited. The dedupe runs in SQL (DISTINCT ON) — the
// DB does the dedupe and the RESPONSE to Node is bounded to `limit` rows
// (never fetch-all-then-dedupe in the app). Note: Postgres still filters+sorts
// the user's jobs under the `user_id` index; that scan is O(user's jobs), which
// is fine at pilot scale. Add a composite index only if a real EXPLAIN shows
// pain — no schema change here.
router.get("/solve-history", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);

  // Inner: DISTINCT ON (scenario_id) keeps the first row per scenario under the
  // ORDER BY, so scenario_id must lead the ordering; queued_at DESC then id DESC
  // (stable tiebreaker for equal timestamps) picks that scenario's newest job.
  const latest = db
    .selectDistinctOn([solveJobsTable.scenarioId], {
      id: solveJobsTable.id,
      scenarioId: solveJobsTable.scenarioId,
      status: solveJobsTable.status,
      resultSummary: solveJobsTable.resultSummary,
      queuedAt: solveJobsTable.queuedAt,
      finishedAt: solveJobsTable.finishedAt,
      scenarioName: scenariosTable.name,
      modelId: scenariosTable.modelId,
    })
    .from(solveJobsTable)
    .innerJoin(scenariosTable, eq(solveJobsTable.scenarioId, scenariosTable.id))
    .where(eq(solveJobsTable.userId, req.userId!))
    .orderBy(solveJobsTable.scenarioId, desc(solveJobsTable.queuedAt), desc(solveJobsTable.id))
    .as("latest");

  const rows = await db
    .select()
    .from(latest)
    .orderBy(desc(latest.queuedAt), desc(latest.id))
    .limit(limit);

  res.json(rows.map((r) => {
    const summary = r.resultSummary as { objective?: number; weightedAvgDistanceMi?: number; runTimeSec?: number } | null;
    return {
      id: r.id,
      scenarioId: r.scenarioId,
      scenarioName: r.scenarioName,
      modelId: r.modelId,
      status: r.status,
      objective: summary?.objective ?? null,
      weightedAvgDistanceMi: summary?.weightedAvgDistanceMi ?? null,
      runTimeSec: summary?.runTimeSec ?? null,
      queuedAt: r.queuedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    };
  }));
});

export default router;
```

- [ ] **Step 2: OpenAPI + regen**

In `lib/api-spec/openapi.yaml`, update the `/solve-history` operation:
```yaml
      summary: The caller's most recent solve job per scenario (latest per scenario, newest first)
```
the `limit` param description:
```yaml
          description: Max number of scenarios to return (one row each = that scenario's latest solve job)
```
and the `200` response description (resolution #6) — currently "Recent solve jobs, newest first":
```yaml
          description: At most one latest solve job per scenario, newest first
```
Then:
```bash
pnpm --filter @workspace/api-spec run codegen
```
Response schema `SolveHistoryEntry` is unchanged; commit whatever generated files change (verify with `git status`) alongside the spec.

- [ ] **Step 3: Adapt the mocks + all existing solve-history tests, add the dedupe test (resolution #1)**

In `artifacts/api-server/src/__tests__/routes.test.ts`:
- Add `selectDistinctOn` to the hoisted `mockDb`: `selectDistinctOn: vi.fn(),`.
- Add `as` to `makeChain`'s method list so the inner subquery chains:
```ts
  ["select","from","where","orderBy","insert","values",
   "returning","update","set","delete","innerJoin","limit","groupBy","as"].forEach(m => {
```
- Give the mocked `solveJobsTable` the columns the new query references (add `scenarioId`/`queuedAt`/`resultSummary`; keep the rest):
```ts
  solveJobsTable: { id: "solve_jobs.id", scenarioId: "solve_jobs.scenario_id", userId: "solve_jobs.user_id", status: "solve_jobs.status", finishedAt: "solve_jobs.finished_at", queuedAt: "solve_jobs.queued_at", resultSummary: "solve_jobs.result_summary" },
```
- **Shared helper** (define once, near `makeChain`) that wires BOTH queries the route now issues — the inner `selectDistinctOn(...).as("latest")` and the outer `select().from(latest)...limit()` — and returns the outer chain so a test can assert `.limit`/`.orderBy` on it:
```ts
function configureSolveHistoryMocks(rows: unknown[]) {
  const inner = makeChain([]);
  const sub = { __sub: "latest", queuedAt: "latest.queued_at", id: "latest.id" };
  (inner.as as ReturnType<typeof vi.fn>).mockReturnValue(sub);
  mockDb.selectDistinctOn.mockReturnValueOnce(inner);
  const outer = makeChain(rows);
  mockDb.select.mockReturnValueOnce(outer);
  return { inner, outer, sub };
}
```
- **Update every existing `GET /api/solve-history` test** (the describe at ~line 2163: the unauthenticated case is unchanged; the authed happy-path and the oversized-limit case both currently do `mockDb.select.mockReturnValueOnce(chain)` and one asserts `chain.limit`). Replace each authed setup with `const { outer } = configureSolveHistoryMocks([...])` (clear `mockDb.selectDistinctOn`/`mockDb.select` after `loginAs` as the other tests do), and change the oversized-limit assertion to `expect(outer.limit).toHaveBeenCalledWith(50)`.
- **Add the dedupe/query-shape test:**
```ts
describe("GET /api/solve-history (latest per scenario)", () => {
  beforeEach(() => { resetLoginRateLimiterForTests(); });

  it("dedupes to one row per scenario via a DISTINCT ON subquery, newest-first with id tiebreaker", async () => {
    const cookie = await loginAs("user-A");
    mockDb.selectDistinctOn.mockClear();
    mockDb.select.mockClear();
    const { inner, outer } = configureSolveHistoryMocks([
      { id: 10, scenarioId: 1, status: "succeeded", resultSummary: { objective: 5, runTimeSec: 1 }, queuedAt: new Date("2026-09-04T12:00:00Z"), finishedAt: new Date("2026-09-04T12:00:01Z"), scenarioName: "A", modelId: "p-median-us" },
      { id: 8, scenarioId: 2, status: "failed", resultSummary: null, queuedAt: new Date("2026-09-04T11:00:00Z"), finishedAt: null, scenarioName: "B", modelId: "transport-coal" },
    ]);

    const res = await request(app).get("/api/solve-history").set("Cookie", cookie);
    expect(res.status).toBe(200);

    // dedupe is in SQL: selectDistinctOn partitioned on scenario_id
    expect(mockDb.selectDistinctOn).toHaveBeenCalledWith([solveJobsTable.scenarioId], expect.any(Object));
    // inner ordering leads with the distinct column, then the newest tiebreaker
    expect(inner.orderBy).toHaveBeenCalledWith(solveJobsTable.scenarioId, { desc: solveJobsTable.queuedAt }, { desc: solveJobsTable.id });
    // outer newest-first + id tiebreaker + the requested limit
    expect(outer.limit).toHaveBeenCalledWith(5);

    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ scenarioId: 1, scenarioName: "A", status: "succeeded", objective: 5 });
    expect(res.body[1]).toMatchObject({ scenarioId: 2, scenarioName: "B", status: "failed", objective: null });
  });
});
```
(`desc(x)` is mocked to `{ desc: x }`; `solveJobsTable.scenarioId`/`queuedAt`/`id` are the mocked marker strings.)

- [ ] **Step 4: Gate + commit**

```bash
pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
git commit -m "[bundle5-T4] solve-history: latest job per scenario (bounded SQL) + OpenAPI" -- \
  artifacts/api-server/src/routes/solveHistory.ts \
  artifacts/api-server/src/__tests__/routes.test.ts \
  lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
```
(Stage only the generated paths that actually changed — verify with `git status`.)

---

## Task T5 — Distances tab: pagination + global filter (`[bundle5-T5]`)

Item 6. Resolutions #1 (cross-page jump) + #3 (clamp on shrink).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx`
- Test: `artifacts/studio/src/__tests__/DistancesTab.test.tsx`

- [ ] **Step 1: State + constants + drop the virtualizer**

Remove `import { useVirtualizer } from "@tanstack/react-virtual";` and `useRef` if now unused (a `referenceScrollRef` is being removed; keep `useRef` only if still referenced elsewhere — it isn't after this, so drop it from the React import too). Add near the top of the component:
```tsx
const PAGE_SIZE = 50;
const [refPage, setRefPage] = useState(1);
const [ovPage, setOvPage] = useState(1);
```
Delete the `referenceScrollRef` + `referenceVirtualizer` block entirely.

- [ ] **Step 2: Global From/To filter over the reference pairs**

`visibleReferencePairs` already excludes inactive/excluded endpoints. Add the From/To match on top (case-insensitive on `fromCode`/`toCode`):
```tsx
const visibleReferencePairs = useMemo(
  () =>
    referencePairs.filter(
      p =>
        !inactiveWarehouseIdSet.has(p.fromId) &&
        !excludedCustomerIdSet.has(p.toId) &&
        p.fromCode.toLowerCase().includes(fromFilter.toLowerCase()) &&
        p.toCode.toLowerCase().includes(toFilter.toLowerCase()),
    ),
  [referencePairs, inactiveWarehouseIdSet, excludedCustomerIdSet, fromFilter, toFilter],
);
```

- [ ] **Step 3: Page counts + clamp effect (resolution #3)**

```tsx
const refPageCount = Math.max(1, Math.ceil(visibleReferencePairs.length / PAGE_SIZE));
const ovPageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

// Clamp DOWN whenever the filtered length shrinks (delete/import overrides,
// toggle inactive/excluded) so we never strand on a now-empty page. This only
// ever reduces the page; it never fights the focus jump (which sets a valid
// in-range page).
useEffect(() => { if (refPage > refPageCount) setRefPage(refPageCount); }, [refPage, refPageCount]);
useEffect(() => { if (ovPage > ovPageCount) setOvPage(ovPageCount); }, [ovPage, ovPageCount]);

const pagedReferencePairs = visibleReferencePairs.slice((refPage - 1) * PAGE_SIZE, refPage * PAGE_SIZE);
const pagedRows = visibleRows.slice((ovPage - 1) * PAGE_SIZE, ovPage * PAGE_SIZE);
```
(`visibleRows` is the existing filtered overrides array — keep its definition; render `pagedRows` instead of `visibleRows` in the table body.)

**Reset-to-page-1 lives in the input handlers, NOT an effect (resolution #2).** A
general `useEffect([fromFilter,toFilter])` reset would fire on the focus effect's
*programmatic* filter clear and snap `ovPage` back to 1, undoing the jump. Instead,
edit the `toolbar`'s From/To `<Input>`s so the RESET happens only on real user
typing:
```tsx
<Input placeholder="Filter from ID…" value={fromFilter}
  onChange={e => { setFromFilter(e.target.value); setRefPage(1); setOvPage(1); }}
  className="h-7 text-xs w-36" data-testid="input-filter-from" />
<Input placeholder="Filter to ID…" value={toFilter}
  onChange={e => { setToFilter(e.target.value); setRefPage(1); setOvPage(1); }}
  className="h-7 text-xs w-36" data-testid="input-filter-to" />
```
The focus effect (Step 7) clears the filters via `setFromFilter("")`/`setToFilter("")`
directly — with no filter-watching effect, that clear does not reset the page.

- [ ] **Step 4: A reusable pager**

Add a small inline helper inside the component (or JSX blocks) rendering Prev/Next + indicator:
```tsx
function Pager({ page, pageCount, onPrev, onNext, idPrefix }: { page: number; pageCount: number; onPrev: () => void; onNext: () => void; idPrefix: string }) {
  return (
    <div className="flex items-center justify-end gap-2 mt-1 text-xs">
      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={page <= 1} onClick={onPrev} data-testid={`button-${idPrefix}-prev`}>Prev</Button>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid={`${idPrefix}-page-indicator`}>Page {page} of {pageCount}</span>
      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={page >= pageCount} onClick={onNext} data-testid={`button-${idPrefix}-next`}>Next</Button>
    </div>
  );
}
```
Define it at module scope (above `DistancesTab`) to avoid re-creation per render.

- [ ] **Step 5: Render the reference page + pager (replaces the virtual list)**

In `referenceSection`, replace the virtualized `<div ref=… >…virtualizer…</div>` with a plain paged list + pager:
```tsx
<div className="max-h-[220px] overflow-y-auto" data-testid="distances-reference-scroll">
  {pagedReferencePairs.map(pair => (
    <div
      key={`${pair.fromId}|${pair.toId}`}
      data-testid={`row-reference-distance-${pair.fromId}-${pair.toId}`}
      className="flex items-center text-xs px-2 border-b"
    >
      <div className="w-1/3 font-mono">{pair.fromCode}</div>
      <div className="w-1/3 font-mono">{pair.toCode}</div>
      <div className="w-1/3 font-mono">{pair.distance} {referenceQuery.data?.distanceUnit ?? ""}</div>
    </div>
  ))}
</div>
<Pager page={refPage} pageCount={refPageCount} onPrev={() => setRefPage(p => Math.max(1, p - 1))} onNext={() => setRefPage(p => Math.min(refPageCount, p + 1))} idPrefix="ref" />
```
The reference total (`distances-reference-total`) already reads `visibleReferencePairs.length` — now the filtered count. Good.

- [ ] **Step 6: Render the overrides page + pager**

In the overrides table, map `pagedRows` instead of `visibleRows` in `<TableBody>`. Keep the "No rows match the current filter" empty row keyed on `visibleRows.length === 0` (unchanged). After the `</Table>` (inside the scroll div or just below it), add:
```tsx
<Pager page={ovPage} pageCount={ovPageCount} onPrev={() => setOvPage(p => Math.max(1, p - 1))} onNext={() => setOvPage(p => Math.min(ovPageCount, p + 1))} idPrefix="ov" />
```

- [ ] **Step 7: Rework `focusEntityId` across pages (resolution #1)**

Replace the existing `focusEntityId` effect with one that clears filters, selects the target's page, then scrolls after render:
```tsx
useEffect(() => {
  if (!focusEntityId) return;
  // Clear filters so the target can't be filtered out of view.
  setFromFilter("");
  setToFilter("");
  const idx = distanceOverrides.findIndex(o => o.fromId === focusEntityId || o.toId === focusEntityId);
  if (idx < 0) return; // not an override row — nothing to jump to
  setOvPage(Math.floor(idx / PAGE_SIZE) + 1);
}, [focusEntityId, distanceOverrides]);

// Scroll once the target page has rendered (runs after ovPage updates above).
useEffect(() => {
  if (!focusEntityId) return;
  const prefix = "row-distance-";
  for (const row of Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`))) {
    const suffix = (row.getAttribute("data-testid") ?? "").slice(prefix.length);
    if (suffix.startsWith(`${focusEntityId}-`) || suffix.endsWith(`-${focusEntityId}`)) {
      row.scrollIntoView({ block: "center" });
      break;
    }
  }
}, [focusEntityId, ovPage, pagedRows]);
```

- [ ] **Step 8: Update `DistancesTab.test.tsx` (resolutions #1/#4)**

This suite mocks `global.fetch` (`fetchMock`) and renders via `renderWithQueryClient` — it does NOT mock `useGetReferenceDistances`. Reuse that exact pattern for every new/changed test (the reference table's data still arrives through the `/reference-distances` fetch the existing `fetchMock.mockImplementation` already serves). Keep existing tests green (rows now come from `pagedRows`/`pagedReferencePairs` — the existing fixtures are under 50 rows, unaffected).

- **Remove/replace any virtualization-specific assertion.** If a test asserts the old windowed behavior (an `offsetHeight`/scroll-window/absolute-transform setup, or that not all 5200 reference rows mount), delete that setup and replace it with an explicit **first-page-size + pager-state** assertion (the existing `fetchMock` returns 5200 pairs → 104 pages of 50; page 1 mounts exactly 50 `row-reference-distance-*` rows, `ref-page-indicator` reads "Page 1 of 104", `button-ref-prev` disabled). If no such test exists, add this as a new case.

- **Add concrete cases:**
  - Overrides pagination: render with a 120-row `distanceOverrides` fixture → `ov-page-indicator` "Page 1 of 3", first 50 rows shown, `button-ov-prev` disabled; click `button-ov-next` → "Page 2 of 3" showing override rows 51–100.
  - Global filter + re-page: typing in `input-filter-from` filters BOTH the overrides table and the reference rows, and resets `ov-page-indicator`/`ref-page-indicator` to "Page 1 of …".
  - Clamp on delete: on the last override page with a single row, remove it (`button-remove-distance-…`) → the page clamps to the new last page (no empty page, no "Page N of N-1").
  - Reference clamp: with a later `refPage` selected, tighten `inactiveWarehouseIds` (rerender prop) so the filtered reference set shrinks below that page → `ref-page-indicator` clamps into range.
  - **Focus across pages, starting filtered (resolution #2):** render 120 overrides, set a non-empty `fromFilter` first (type into `input-filter-from`), then rerender with `focusEntityId` = the id of override #75's endpoint → assert the filters cleared AND `ov-page-indicator` shows "Page 2 of 3" (`Math.floor(74/50)+1 = 2`), i.e. the programmatic clear did NOT snap back to page 1.

- [ ] **Step 9: Gate + commit**

```bash
pnpm run typecheck && pnpm --filter studio test
git commit -m "[bundle5-T5] Distances tab pagination + global From/To filter" -- \
  artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx \
  artifacts/studio/src/__tests__/DistancesTab.test.tsx
```

---

## Final gate (after all tasks land + are cherry-picked)

```bash
pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all green. Bundle 5 touches no Python — pytest is a no-regression confirmation. If `resultEnvelope.test.ts`'s p-median-brazil case times out under the parallel run, confirm the documented environmental flake in isolation. If studio files transiently fail dependency resolution while parallel agent installs are settling, re-run after installs quiesce (documented Bundle 4 env gotcha).

## Execution order

T1 ∥ T2 ∥ T3 ∥ T4 ∥ T5 — all five edit disjoint file sets, run in parallel isolated worktrees. Controller cherry-picks each onto the branch + main and re-gates. No cross-task dependency (T3's subtitle copy is accurate once T4 lands; both ship together).

## Self-review

- Spec coverage: T1↔items 1-hero/4/5 (+#2/#6), T2↔item 1-favicon, T3↔items 2/3-fe (+#7), T4↔item 3-be (+#4/#5), T5↔item 6 (+#1/#3). All six items + all seven resolutions mapped.
- Type consistency: `DeveloperCredit` signature matches both call sites; `selectDistinctOn`/`.as("latest")`/`latest.queuedAt` chain consistent; `PAGE_SIZE`/`refPage`/`ovPage`/`pagedRows`/`pagedReferencePairs` names consistent across steps; `Pager` prop names match call sites.
- No placeholders; every code step shows full code or a precise replacement. `book-cover.png` copied (not referenced from docs).
