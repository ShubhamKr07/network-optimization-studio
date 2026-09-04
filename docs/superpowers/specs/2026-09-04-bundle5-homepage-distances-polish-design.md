# Bundle 5 — Homepage polish + Distances pagination

**Date:** 2026-09-04
**Status:** Design — written-spec review resolved (see resolutions log)

## Written-spec review — resolutions (2026-09-04)

Seven findings; all resolved inline:

1. **[P1] Distances "jump to row" across pagination.** With 50/page, a
   `focusEntityId` target can live on a later page, so the DOM-only scroll finds
   nothing. **Resolved (item 6/T5):** on `focusEntityId`, clear the From/To
   filters first (so the target isn't filtered out), locate its index in the
   full overrides list, set `ovPage` to that row's page, then scroll after the
   page renders. Regression test targets a row beyond the first 50.
2. **[P1] Preserve `data-testid="auth-credit"`.** The item-5 wrapper dropped it;
   Login/Register tests assert it. **Resolved (item 5):** AuthShell's wrapper
   around `<DeveloperCredit />` keeps `data-testid="auth-credit"`; the homepage
   footer uses its own testid.
3. **[P2] Clamp page state when the filtered set shrinks (not just on filter
   text).** Deleting/importing overrides or toggling inactive/excluded can
   invalidate a page. **Resolved (item 6):** derive `pageCount = max(1,
   ceil(n/50))`, clamp each page into `[1, pageCount]` via an effect on the
   filtered length; zero rows → the existing empty/no-match body + a pager
   reading "Page 1 of 1" (never "Page 1 of 0" / "Page 2 of 1"). Tests: delete
   the sole row on the last page; reference status-filter while on a later page.
4. **[P2] Keep `/solve-history` bounded in SQL.** Fetching all jobs + JS dedupe
   grows with lifetime solve count. **Resolved (item 3/T4):** select the newest
   row per scenario in SQL (`DISTINCT ON (scenario_id)` in a subquery ordered
   `scenario_id, queuedAt DESC, id DESC`), then outer-order `queuedAt DESC, id
   DESC` and apply the SQL `LIMIT`. `id DESC` is the stable tiebreaker. No index
   added — the existing `IDX_solve_jobs_user_id` covers the user scope at pilot
   scale; the "no schema change" constraint holds. (If a real query plan later
   shows pain, add a composite index and revise this line explicitly.)
5. **[P2] Update the OpenAPI contract.** **Resolved (T4):** `openapi.yaml`'s
   `/solve-history` summary + `limit` description change to "latest job per
   scenario"; Orval regen in the same commit (response fields unchanged).
6. **[P2] "Homepage only" vs AppShell-wide.** AppShell wraps homepage AND authed
   not-found. **Resolved (item 5):** gate the credit footer on the existing
   `hero` prop — `hero` is passed **only** by the `/` route (App.tsx), so
   not-found (no `hero`) keeps `<AppFooter/>`. No new prop / no App.tsx change
   needed; homepage-only is honored by construction.
7. **[P3] Clip the card footer to the radius.** `Card` is `rounded-xl` without
   `overflow-hidden`, so the sunken footer paints square corners. **Resolved
   (item 2):** add `overflow-hidden` to the card wrapper; covered in the test.

## Goal

Six user-requested refinements: book-cover branding (hero icon + favicon),
chapter-card restyle to the provided mockup, recent-solves deduped to the
latest solve per scenario, a Log-out hover state, the login-page developer
credit on the homepage footer, and pagination + global filtering in the
Distances tab.

## Scope / non-goals

- Presentation-only **except** item 3 (a `/solve-history` backend change) and
  item 6 (no backend — pure frontend paging/filter).
- Light theme only; tokens strictly from `artifacts/studio/src/index.css`
  (`designTokens.contract.test.ts` stays green — no new tokens).
- No `Studio.tsx` / `.studio-lab` / `--arc-*` changes. Never hand-edit
  generated code.

## Decisions (locked via Q&A)

- Book-cover icon: **both** in-page hero band + browser favicon.
- Recent solves: **dedupe** to the most-recent solve job per scenario (any
  status), newest first, top 5 (`/solve-history` backend change).
- Homepage footer credit: **homepage only** (AppShell); Workspace keeps its
  `AppFooter`. Extract a shared component reused by login + homepage.
- Distances: paginate **both** reference + overrides at **50/page**; From/To
  filters stay **live** and now apply to **both** tables across all pages.

---

## Item 1 — Book-cover icon (hero band + favicon)

**Files:** `artifacts/studio/src/components/AppShell.tsx` (hero band img);
`artifacts/studio/index.html` (favicon link); `artifacts/studio/public/book-cover.png`
(new, copied from `docs/design-system/assets/book-cover.png`).

- **Hero band:** in `AppShell`'s `hero` branch, add a `~48px` book-cover
  thumbnail as the first child of the band's flex row, left of the kicker+title
  block: `import coverUrl from "@/assets/book-cover.jpg"` →
  `<img src={coverUrl} alt="" className="h-12 w-auto rounded-sm flex-shrink-0" style={{ boxShadow: "0 4px 12px rgba(0,0,0,.4)" }} />`.
  Compact (non-hero) band unchanged.
- **Favicon:** copy `book-cover.png` into `public/`; in `index.html` replace
  the `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` line with
  `<link rel="icon" type="image/png" href="/book-cover.png" />`. Title
  untouched.

**Note:** this item shares `AppShell.tsx` with items 4 + 5 — they land as one
task (T1) to avoid a three-way merge on that file.

## Item 2 — Chapter card = mockup

**Files:** `artifacts/studio/src/pages/Landing.tsx` (+ `Landing.test.tsx`).

Match the provided screenshot: white card body (kicker + title + description),
then a **full-bleed sunken footer strip** at the bottom.

- Card wrapper: add `flex flex-col overflow-hidden` so the footer pins to the
  bottom of an `h-full` card AND the sunken strip is clipped to the card's
  `rounded-xl` corners (Card has no `overflow-hidden` of its own — without it the
  full-width footer paints square bottom corners). Title size up: `CardTitle`
  `text-base` → `text-lg`. Assert `overflow-hidden` in the card-restyle test.
- Replace the current `<CardContent>{footer}</CardContent>` with a footer
  `<div>` that is a **sibling** of `CardHeader` (so it spans full card width;
  `Card` has no horizontal padding of its own — the children do):
  `className="mt-auto flex items-center justify-between gap-2 border-t px-6 py-3"`
  with `style={{ background: "var(--surface-sunken)" }}` and
  `borderColor: "var(--line)"`. Keep `data-testid="landing-card-footer-<modelId>"`.
- Inside: green number (`scnd-display font-bold`, `fontSize:"15px"`,
  `color:"var(--green-700)"` — the deeper green in the mockup) + mono status
  text (`--text-muted`) on the left; the `active` badge (unchanged green
  outline) OR `start →` (mono, `--text-faint`) on the right.
- All status/active/start logic (from Bundle 4 T4) is unchanged — only the
  container styling + title size + number shade change.

## Item 3 — Recent solves: latest per scenario

**Files:** `artifacts/api-server/src/routes/solveHistory.ts` (+ its test in
`routes.test.ts`); `lib/api-spec/openapi.yaml` + Orval regen
(`lib/api-zod`/`lib/api-client-react` generated); `artifacts/studio/src/pages/Landing.tsx`
(subtitle copy).

- **Backend (bounded in SQL — resolution #4):** `/solve-history` currently
  orders by `queuedAt desc` + SQL `.limit(limit)`, so a re-solved scenario
  appears multiple times. Change to a two-level SQL query so the DB (not the app)
  does the dedupe and the row set stays bounded:
  1. Inner: `SELECT DISTINCT ON (solve_jobs.scenario_id) <cols>` from the
     `solve_jobs ⋈ scenarios` join, `WHERE solve_jobs.user_id = req.userId`,
     `ORDER BY solve_jobs.scenario_id, solve_jobs.queued_at DESC, solve_jobs.id DESC`
     — one newest row per scenario (`id DESC` is the stable tiebreaker for equal
     `queued_at`).
  2. Outer: select from that subquery, `ORDER BY queued_at DESC, id DESC`,
     `LIMIT limit`.
  Use Drizzle's `selectDistinctOn([...], {...})` for the inner query and a
  subquery (`.as("latest")`) for the outer (fall back to a raw `sql` fragment
  only if the Drizzle API can't express `DISTINCT ON` cleanly). Response shape
  and every field unchanged; `limit` now means "N scenarios" (default 5).
  Ownership scoping unchanged. No index added — `IDX_solve_jobs_user_id` covers
  the user scope at pilot scale; "no schema change" holds.
- **OpenAPI (resolution #5):** update `openapi.yaml`'s `/solve-history` operation
  `summary` and the `limit` param description to "latest solve job per scenario"
  semantics; regenerate with Orval, committing spec + generated output together.
  Response schema (`SolveHistoryEntry`) is unchanged.
- **Frontend:** update the recent-solves subtitle copy from "Recent solve
  attempts — click to open one." to **"Most recent solve per scenario — click
  to open one."** No other Landing change (rows already render one per entry).
- **Test:** seed a user whose (mocked) inner-query result already reflects the
  `DISTINCT ON` dedupe — scenario A's newest job + scenario B's — and assert the
  route returns exactly those 2 rows in `queuedAt DESC, id DESC` order, limited.
  Assert the query is built with `selectDistinctOn` partitioned on
  `scenariosTable`/`solveJobsTable`'s `scenarioId` and both `queuedAt`/`id`
  orderings (query-shape assertion, since `routes.test.ts` mocks Drizzle and
  runs no SQL).

## Item 4 — Log out hover

**Files:** `artifacts/studio/src/components/AppShell.tsx` (shared with items 1,
5 — same task T1).

- The Log-out ghost `Button` sits on the dark band; shadcn's default ghost
  hover (`hover:bg-accent`, a light bg) reads wrong there. Add a
  band-appropriate hover to **both** band branches' Log-out button:
  `className="hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]"`.
  Keep `variant="ghost"`, `data-testid="button-logout"`, and the existing
  `--ink-300` resting color.

## Item 5 — Homepage footer = developer credit

**Files:** `artifacts/studio/src/components/DeveloperCredit.tsx` (new, shared);
`artifacts/studio/src/components/auth/AuthShell.tsx` (use the shared component);
`artifacts/studio/src/components/AppShell.tsx` (swap footer — same task T1).

- Extract `AuthShell.tsx`'s inline `AuthCredit` markup **verbatim** into
  `components/DeveloperCredit.tsx` exporting `DeveloperCredit()` — the inner
  content only (the "Developed by Shubham" line, "Facing issues?", "Reach me out
  at" + LinkedIn/email icon links, mockup values unchanged). No outer
  border/margin in the component itself.
- `AuthShell.tsx`: replace the inline `AuthCredit` with its existing wrapper
  around `<DeveloperCredit />`, **keeping `data-testid="auth-credit"` on that
  wrapper** (resolution #2 — Login/Register tests assert it):
  `<div data-testid="auth-credit" className="mt-4 pt-3 border-t text-center" style={{ borderColor: "var(--line)" }}><DeveloperCredit /></div>`.
  Login/register render byte-identically (their tests still pass).
- `AppShell.tsx`: **gate the footer on the `hero` prop** (resolution #6) — the
  `/` route is the only caller that passes `hero`, so not-found (no `hero`) keeps
  the plain `AppFooter`, honoring the "homepage only" decision without an App.tsx
  change:
  `{hero ? <footer data-testid="homepage-credit-footer" className="flex-shrink-0 border-t bg-background px-6 py-3 text-center" style={{ borderColor: "var(--line)" }}><DeveloperCredit /></footer> : <AppFooter />}`.
  Keep the `AppFooter` import (still used in the non-hero branch and by
  Workspace). The homepage footer uses its own testid, NOT `auth-credit`.

## Item 6 — Distances tab: pagination + global filter

**Files:** `artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx`
(+ `DistancesTab.test.tsx` if present, else add coverage).

- **Pagination (both tables, 50/page):** add `PAGE_SIZE = 50` and two 1-based
  page states (`refPage`, `ovPage`). For each table derive
  `pageCount = Math.max(1, Math.ceil(filteredLen / PAGE_SIZE))`; slice the
  filtered set to the current page; render a pager under each table: Prev / Next
  (disabled at ends) + a "Page X of Y" indicator + total count. Testids:
  `button-ref-prev`/`button-ref-next`/`ref-page-indicator` and
  `button-ov-prev`/`button-ov-next`/`ov-page-indicator`.
- **Clamp on shrink (resolution #3):** resetting only on filter-text change is
  insufficient — deleting/importing overrides, or toggling
  `inactiveWarehouseIds`/`excludedCustomerIds`, can shrink a filtered set and
  strand a page. Clamp each page into `[1, pageCount]` via a `useEffect` that
  runs whenever the corresponding **filtered length** (not just the filter text)
  changes: `if (refPage > refPageCount) setRefPage(refPageCount)` (same for
  `ovPage`). A filter-text change additionally resets to page 1. Zero filtered
  rows → `pageCount = 1`, the pager reads "Page 1 of 1" (never "Page 1 of 0" or
  "Page 2 of 1") and the table body shows the existing empty/no-match message.
- **Drop the reference virtualizer:** remove `useVirtualizer` + the scroll ref +
  the absolute-positioned virtual rows; render the current page's rows as a
  plain list (react-virtual is used nowhere else — stop importing it here; leave
  it in `package.json`). Keep `row-reference-distance-<from>-<to>` testids.
- **Global From/To filter:** the existing `fromFilter`/`toFilter` inputs
  currently filter only the overrides grid. Extend them to **also** filter the
  reference pairs (match `fromCode`/`toCode` case-insensitively, same as the
  overrides match on `fromId`/`toId`). Filters stay **live** (no button).
- **`focusEntityId` across pages (resolution #1):** the post-Save "jump to it"
  effect currently scrolls to a DOM row, which fails if the target override sits
  on a later page or is hidden by an active filter. Rework it: when
  `focusEntityId` is set, (a) clear `fromFilter`/`toFilter` so the target can't
  be filtered out; (b) find the first index in the FULL `distanceOverrides`
  (unfiltered) whose `fromId` or `toId` equals `focusEntityId`; (c)
  `setOvPage(Math.floor(idx / PAGE_SIZE) + 1)`; (d) scroll to its
  `row-distance-…` testid in a follow-up effect after the target page has
  rendered (e.g. depend on `[focusEntityId, ovPage]`, scroll once the row exists
  in the DOM). If no override matches, no-op (unchanged). Regression test: a
  target override beyond the first 50 rows → correct page selected + scrolled.
- Empty/loading/error states preserved. The "Base distances (reference)" total
  count reflects the filtered set.
- **Tests (resolutions #1/#3):** pagination slices + Prev/Next + indicator for
  both tables; From/To filters both tables live; page clamps when the sole row on
  the last override page is deleted; reference status-filter (`inactiveWarehouseIds`)
  while on a later page clamps correctly; `focusEntityId` beyond row 50 selects
  the right `ovPage` and scrolls.

---

## Global constraints (bind every item)

- Presentation-only except item 3's `/solve-history` change. No schema/DB/solver
  change. Tokens only from `index.css`; `designTokens.contract.test.ts` green;
  light theme only.
- Preserve every `data-testid`, `aria-*`, and all mutation/logout logic.
- Never hand-edit generated code. One commit per task; message
  `[bundle5-T<n>] <summary>`.

## Execution (5 tasks, file-disjoint → parallelizable)

- **T1** — AppShell cluster (items 1-hero, 4, 5): `AppShell.tsx`, new
  `DeveloperCredit.tsx`, `AuthShell.tsx`, `AppShell.test.tsx`.
- **T2** — favicon (item 1): `index.html`, `public/book-cover.png`.
- **T3** — Landing card restyle + recent-solves subtitle (items 2, 3-frontend):
  `Landing.tsx`, `Landing.test.tsx`.
- **T4** — solve-history dedupe (item 3-backend): `solveHistory.ts`,
  `routes.test.ts`, `lib/api-spec/openapi.yaml` + Orval-regenerated
  `lib/api-zod`/`lib/api-client-react` (spec + generated in the same commit).
- **T5** — Distances pagination + global filter (item 6): `DistancesTab.tsx`
  (+ its test).

All five edit disjoint files → run in parallel isolated worktrees; controller
cherry-picks each onto main and re-gates. (T3 subtitle copy is accurate only
once T4 lands, but they're code-independent and ship together.)
