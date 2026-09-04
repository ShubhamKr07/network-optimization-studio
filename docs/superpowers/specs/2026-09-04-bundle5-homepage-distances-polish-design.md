# Bundle 5 — Homepage polish + Distances pagination

**Date:** 2026-09-04
**Status:** Design (pending written-spec review)

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

- Card wrapper: add `flex flex-col` so the footer pins to the bottom of an
  `h-full` card. Title size up: `CardTitle` `text-base` → `text-lg`.
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
`routes.test.ts`); `artifacts/studio/src/pages/Landing.tsx` (subtitle copy).

- **Backend:** `/solve-history` currently orders by `queuedAt desc` and applies
  a SQL `.limit(limit)`, so a re-solved scenario appears multiple times. Change
  to: drop the SQL limit, fetch the user's jobs ordered `queuedAt desc`, then
  **dedupe by `scenarioId` in JS** (first occurrence = newest wins), then take
  the top `limit`. Response shape and every field are unchanged; `limit` now
  means "N scenarios" (default 5). Ownership scoping (`eq(userId)`) unchanged.
- **Frontend:** update the recent-solves subtitle copy from "Recent solve
  attempts — click to open one." to **"Most recent solve per scenario — click
  to open one."** No other Landing change (rows already render one per entry).
- **Test:** seed a user with scenario A having 3 jobs (different `queuedAt`) and
  scenario B with 1 job; assert the response has exactly 2 rows — A's newest job
  and B's — in `queuedAt desc` order. (`routes.test.ts` mocks Drizzle, so the
  dedupe runs on the mocked ordered rows the `.orderBy` chain returns; assert
  the JS dedupe/limit output for a mocked row set.)

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
  around `<DeveloperCredit />` (`<div className="mt-4 pt-3 border-t text-center" style={{ borderColor: "var(--line)" }}><DeveloperCredit /></div>`) — login/register render byte-identically (their tests still pass).
- `AppShell.tsx`: replace `<AppFooter />` with
  `<footer className="flex-shrink-0 border-t bg-background px-6 py-3 text-center" style={{ borderColor: "var(--line)" }}><DeveloperCredit /></footer>`.
  This affects only AppShell-wrapped routes (homepage + not-found); Workspace
  mounts its own `AppFooter` and is untouched. Drop the now-unused `AppFooter`
  import from `AppShell.tsx` (keep the `AppFooter` component — Workspace still
  uses it).

## Item 6 — Distances tab: pagination + global filter

**Files:** `artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx`
(+ `DistancesTab.test.tsx` if present, else add coverage).

- **Pagination (both tables, 50/page):** add `PAGE_SIZE = 50` and two 1-based
  page states (`refPage`, `ovPage`). Slice the filtered reference pairs and the
  filtered override rows to the current page; render a pager under each table:
  Prev / Next buttons (disabled at ends) + a "Page X of Y" indicator + the total
  count. Testids: `button-ref-prev`/`button-ref-next`/`ref-page-indicator` and
  `button-ov-prev`/`button-ov-next`/`ov-page-indicator`.
- **Drop the reference virtualizer:** remove `useVirtualizer` + the scroll ref +
  the absolute-positioned virtual rows; render the current page's rows as a
  plain list (react-virtual is used nowhere else — stop importing it here; leave
  it in `package.json`). Keep `row-reference-distance-<from>-<to>` testids.
- **Global From/To filter:** the existing `fromFilter`/`toFilter` inputs
  currently filter only the overrides grid. Extend them to **also** filter the
  reference pairs (match `fromCode`/`toCode` case-insensitively, same as the
  overrides match on `fromId`/`toId`). Filters stay **live** (no button). A
  filter change resets **both** page states to 1 (`useEffect` on
  `[fromFilter, toFilter]`).
- Empty/loading/error states preserved. The "Base distances (reference)" total
  count now reflects the filtered set (already does — it reads
  `visibleReferencePairs.length`).

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
  `routes.test.ts`.
- **T5** — Distances pagination + global filter (item 6): `DistancesTab.tsx`
  (+ its test).

All five edit disjoint files → run in parallel isolated worktrees; controller
cherry-picks each onto main and re-gates. (T3 subtitle copy is accurate only
once T4 lands, but they're code-independent and ship together.)
