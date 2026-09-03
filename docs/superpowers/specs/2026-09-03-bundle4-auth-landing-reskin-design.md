# Bundle 4 — Auth split-screen + Landing hero reskin + live Landing stats

**Date:** 2026-09-03
**Status:** Design (approved direction; pending written-spec review)

## Goal

Reskin Login, Register, and Landing to the book-cover design-system mockups
(`docs/design-system/ui_kits/studio/{login.html,Landing.jsx}`), and back the
Landing hero's per-chapter footers + header stats with a real aggregate
endpoint so the numbers are live, not omitted.

## Scope / non-goals

- **Presentation-only for T1/T2/T4-frontend.** No behavior/logic change to auth
  flows, routing, or existing queries beyond adding one new query on Landing.
- **T3 is the only backend/contract change**: one new read-only, auth-scoped
  aggregate endpoint + its generated client. No schema/DB change (both tables
  already exist), no solver/Python touch.
- Light theme only. Tokens strictly from `artifacts/studio/src/index.css`
  (`designTokens.contract.test.ts` must stay green — no new tokens).
- Do **not** touch `Studio.tsx`, `.studio-lab`, or `--arc-*` legacy CSS.
- Never edit generated code by hand (`lib/api-zod/src/generated/`,
  `lib/api-client-react/src/generated/`) — regenerate via orval.

## Token mapping (mockup → app)

The mockups (built against `docs/design-system/styles.css`) reference a few
token names the app's `index.css` does not define. Use the app equivalents:

| Mockup token            | App token to use                     |
|-------------------------|--------------------------------------|
| `--surface-page`        | `--background` (page bg) / `bg-background` |
| `--surface-card`        | `--card` / `bg-card`                  |
| `--border-default`      | `--line`                              |
| `--tracking-caps-wide`  | hardcode `0.14em` (matches `.scnd-kicker`) |
| `--tracking-caps`       | hardcode `0.1em`                      |
| `--font-display`        | `--app-font-display`                  |
| `--font-mono`           | `--app-font-mono`                     |
| `--font-sans`           | `--app-font-sans`                     |
| `--text-muted`/`--text-faint`/`--line`/`--link`/`--green-400/600/700`/`--ink-300`/`--surface-band`/`--surface-band-fg`/`--radius-md` | already defined — use directly |

---

## Task T1 — Auth split-screen (`[bundle4-T1]`)

**Files:** `artifacts/studio/src/pages/auth/Login.tsx`,
`artifacts/studio/src/pages/auth/Register.tsx` (+ their tests);
`artifacts/studio/src/assets/book-cover.jpg` (new, copied from
`docs/design-system/assets/book-cover.jpg` — docs are not served by Vite).

**Layout** (replaces today's band-strip + centered `Card`):

- Root: `flex min-h-screen` (two columns on ≥ md, stacked on narrow).
- **Left cover panel** — `flex:0 0 44%` (`md:basis-[44%]`), `bg
  var(--surface-band)`, right border `2px solid var(--green-400)`, centered
  column: book-cover `<img>` (imported URL, `max-w-[290px] w-[72%]`, drop
  shadow), then mono caption `THE TEXTBOOK BEHIND THE LABS` in `--ink-300`
  between two 5px `var(--green-400)` diamonds (`rotate-45`). On narrow
  screens the panel collapses to a slim top band (`basis-auto`, reduced
  padding, smaller cover) — form still fully usable.
- **Right form panel** — `flex-1 bg-background`, form content directly on the
  page (**no `Card` wrapper**), max width ~360px, vertically centered:
  1. mono kicker `BY PROF. MICHAEL WATSON` (`.scnd-kicker` or inline, `--text-muted`)
  2. 32px green serif heading `Optimization Studio` (`--app-font-display`,
     `--green-600`) — matches mockup, not "SCND Optimization Studio"
  3. tagline (`--text-muted`, 13px): Login "Log in to continue your labs…",
     Register "Register to start solving labs…"
  4. **`Alert`** (destructive) — unchanged error logic/testids
  5. shadcn `Label` + `Input` for Email and Password — **preserve every
     `id`/`data-testid`/`type`/`required`/`autoComplete`/`value`/`onChange`
     and Register's `minLength`/`passwordTooShort` hint**
  6. full-width green `Button` (submit) — unchanged `disabled`/pending text/testid
  7. OR divider (two `--line` rules + mono `or`)
  8. cross-link (`Link` to `/register`|`/login`) — unchanged
  9. **inline dev-credit block**: mono "Developed by Shubham", "Facing
     issues?", "Reach me out at" + LinkedIn + email SVG icon links.
     **Contact values verbatim from login.html**: LinkedIn
     `https://www.linkedin.com/in/shubhamkumarcse/`, mailto
     `shubham.shubham4995@gmail.com`. Icons `--green-600`.
  10. bottom **labs footer strip**: 4 mono chapter labels
      `Ch 3 · p-median`, `Ch 5 · transport LP`, `Ch 5 · capacitated`,
      `Ch 10 · two-echelon` on `bg-card`, `--line` top border.

**Remove** the global `<AppFooter/>` from Login and Register only (the inline
dev-credit block replaces it here; AppFooter stays on every other shell).
Drop the now-unused `AppFooter` import from these two files.

**Preserve exactly:** `handleSubmit`, `loginUser`/`registerUser` mutations,
the `queryClient.setQueryData(...)`-before-`navigate` pattern and its
comment, `passwordTooShort` guard, all `data-testid`s
(`auth-band` may be removed since the band is gone — update tests
accordingly), `aria`/roles on Alert/inputs.

**Verify:** `pnpm run typecheck && pnpm --filter studio test` green. Update
only cosmetic/structural snapshot + testid assertions (e.g. tests asserting
the old `auth-band`/`Card` layout); never delete a behavioral test (submit,
error render, password hint, navigate-on-success).

**Commit:** `[bundle4-T1] auth split-screen`.

---

## Task T2 — Landing hero shell (`[bundle4-T2]`)

**Files:** `artifacts/studio/src/components/AppShell.tsx`,
`artifacts/studio/src/App.tsx`, `artifacts/studio/src/pages/Landing.tsx`
(+ AppShell/Landing tests).

**AppShell** gains `hero?: boolean`. When `hero` (only `/`):
- band grows to the mockup hero: ~30px vertical padding, inner content
  constrained to an 860px centered container.
- kicker `Optimization Studio by Prof. Michael Watson` (`.scnd-band .scnd-kicker`)
- 32px green serif title = `heroTitle` (stays "Network Design Labs"),
  `--green-400`.
- tagline line under it (`--ink-300`, 13px): "Build a scenario on the map,
  solve it with a real optimizer, compare the results."
- email + Log out stay top-right (unchanged logout logic/testids).

When `hero` is falsy (all other routes) the band renders exactly as today
(compact). `App.tsx`'s `/` route passes `hero` (keeps `heroTitle="Network
Design Labs"`).

**Landing body:**
- container `max-w-3xl` → `max-w-[860px]`.
- each chapter `Card` gains a footer row: big green serif chapter number
  (`03/05/05/10`, derived from `c.chapter` — parse the trailing number, zero-pad
  to 2) + a badge on the right. **T2 baseline (no summary data yet):** badge is
  always `start →`; no per-card status text; no header stats line. (T4 fills
  these in.)
- Recent-solves section: add subtitle "Last completed solve per chapter —
  click to open it." and a mono `Chapter N ·` prefix per row (derive `N` from
  `chapterForModelId(h.modelId)?.chapter`).

**Preserve:** all existing `data-testid`s (`link-<path>`,
`link-solve-history-<id>`), the solve-history query, chapter filtering
(`!hiddenFromLanding`).

**Verify:** `pnpm run typecheck && pnpm --filter studio test` green.

**Commit:** `[bundle4-T2] landing hero`.

---

## Task T3 — `GET /landing-summary` aggregate endpoint (`[bundle4-T3]`)

**Files:** new `artifacts/api-server/src/routes/landingSummary.ts`; register in
`artifacts/api-server/src/routes/index.ts`; `lib/api-spec/openapi.yaml`
(new path + `LandingSummary` schema, mirroring `/solve-history` +
`SolveHistoryEntry` exactly); regenerate via existing orval
(`lib/api-spec/orval.config.ts`) so `lib/api-zod` + `lib/api-client-react`
expose a typed `useGetLandingSummary` hook. Tests in
`artifacts/api-server/src/__tests__/` (routes suite).

**Response contract** (`operationId: getLandingSummary`, `requireAuth`,
`200`/`401`):

```json
{
  "perChapter": [
    { "modelId": "p-median-us", "scenarioCount": 3, "lastSucceededSolveAt": "2026-09-03T12:00:00.000Z" }
  ],
  "totals": { "scenarios": 5, "solves": 4 }
}
```

- `lastSucceededSolveAt`: ISO string | null — MAX(`finished_at`) over the
  user's `status='succeeded'` solve_jobs for that modelId, else null.
- `perChapter` includes only modelIds the user has scenarios for (any solve
  implies a scenario via FK, so a scenarios-driven `GROUP BY` covers both).
  Zero-row chapters are simply absent (frontend renders "no scenarios yet").
- `totals.scenarios`: COUNT of the user's scenarios across **all** models
  (honest global total, incl. hidden Ch 10).
- `totals.solves`: COUNT(DISTINCT `scenario_id`) among the user's
  `status='succeeded'` solve_jobs (a scenario solved N times counts once),
  across **all** models.

**Query discipline (hard):**
- **Constant query count.** Exactly: (1) one `GROUP BY model_id` over
  `scenarios WHERE user_id = req.userId` for `scenarioCount` + the totals'
  scenario count; (2) one `GROUP BY scenarios.model_id` over
  `solve_jobs JOIN scenarios` filtered `solve_jobs.user_id = req.userId AND
  status='succeeded'`, selecting `MAX(finished_at)` and
  `COUNT(DISTINCT scenario_id)` for per-chapter `lastSucceededSolveAt` +
  distinct-solve totals. No per-chapter loops, no N+1. Merge the two grouped
  results in JS by modelId.
- **Security-critical scoping.** Every query filters by `req.userId`,
  copying `solveHistory.ts`'s style. `solve_jobs` carries its own `user_id`
  (filter on it directly, as solveHistory does) — the join to `scenarios` is
  for `model_id` only, not for ownership.

**Tests (api-server routes suite):**
- empty user → `{perChapter: [], totals: {scenarios:0, solves:0}}`.
- seeded user → correct `scenarioCount` per model, correct
  `lastSucceededSolveAt` (latest succeeded `finished_at`), `totals.scenarios`
  = all rows, `totals.solves` = distinct succeeded scenarios (re-solve counts
  once).
- **isolation**: user A's summary never includes user B's scenarios or
  solves (seed both; assert A's counts/perChapter exclude B's rows). This is
  the worst-possible-bug guard — mandatory.
- `401` when unauthenticated.

**Verify:** `pnpm run typecheck && pnpm --filter api-server test` green;
regenerated codegen committed with the spec change (hard rule #4).

**Commit:** `[bundle4-T3] landing-summary endpoint + client regen`.

---

## Task T4 — Landing consumes the summary (`[bundle4-T4]`)

**Files:** `artifacts/studio/src/pages/Landing.tsx` (+ its test).

- Fetch via the new `useGetLandingSummary()` alongside the existing
  `useGetSolveHistory({limit:5})`.
- Build a `Map<modelId, {scenarioCount, lastSucceededSolveAt}>` from
  `perChapter`.
- **Per-card footer** (replaces T2's baseline):
  - big green serif chapter number — unchanged from T2.
  - status text: `"{scenarioCount} scenarios · solved {relative} ago"` when
    `lastSucceededSolveAt` exists; `"{scenarioCount} scenarios"` when
    scenarios but no succeeded solve; `"no scenarios yet"` when the modelId is
    absent / count 0.
  - relative time formatted client-side, m/h/d granularity (e.g. `2m`,
    `3h`, `5d`; ≥ ~1min). Pure helper, no dependency.
  - **`active` badge**: the chapter with the single most-recent
    `lastSucceededSolveAt` across **all** perChapter rows (incl. hidden);
    a rendered card shows `active` iff its modelId is that global winner,
    else `start →`. If no succeeded solve exists anywhere, all cards show
    `start →`.
- **Header stats line** (new): mono, right-aligned, in the Landing body header
  row (mockup places it opposite the "Labs" heading):
  `"{CHAPTERS_visible.length} labs · {totals.scenarios} scenarios ·
  {totals.solves} solves"`. `labs` = count of non-hidden chapters (matches
  rendered cards); scenarios/solves = the honest global totals from T3.
  `data-testid="landing-stats-line"`.
- **Loading / error fallback:** while `useGetLandingSummary` is pending or
  errored, render exactly the T2 state — chapter number + `start →`, no
  per-card status text, and **no stats line at all**. Never a half-filled or
  broken footer.
- Keep every existing `data-testid`.

**Verify:** `pnpm run typecheck && pnpm --filter api-server test &&
pnpm --filter studio test` green.

**Commit:** `[bundle4-T4] landing consumes landing-summary`.

---

## Global constraints (bind every task)

- Presentation-only except T3 (new read endpoint) and T4's one added query.
  No API/DB/solver/behavior change beyond that.
- Tokens only from `index.css`; `designTokens.contract.test.ts` stays green;
  light theme only.
- Preserve every `data-testid`, `aria-*`, `role`, and all form/mutation logic
  (incl. `setQueryData`-before-`navigate`). Never delete a behavioral test.
- Ownership: `requireAuth` + `req.userId` filter on every T3 query; a
  cross-user leak is the worst bug — the isolation test is mandatory.
- Never hand-edit generated code; regenerate with orval and commit spec +
  output together.
- One commit per task, messages exactly `[bundle4-T<n>] <summary>` above.

## Execution

Agent-team dispatch (per project convention), one task per commit, gate green
before each commit. T1 & T2 are frontend-disjoint from T3 (backend) and can
run in parallel; T4 depends on T3 (needs the generated hook) and on T2 (edits
the same `Landing.tsx`) — so T4 is last. Order: T1 ∥ T2 ∥ T3, then T4.
