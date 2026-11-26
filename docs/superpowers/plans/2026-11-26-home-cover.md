# Home Page Cover Restyle (HCV) Implementation Plan

> **Execution:** agent-team dispatch per `AGENTS.md`. Never delegate to GLM (root hard rule #10).
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-hcv-N -b hcv-N-work <home-cover tip>`) and dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-hcv-N && git rev-parse --abbrev-ref HEAD` (must print `hcv-N-work`, else STOP). The lead fast-forwards each commit onto `home-cover`.
> - **Roles:** HCV-1 `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. HCV-2 `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run in order; every commit is green on its own. A stalled agent is resumed with `SendMessage`, never re-dispatched. Steps use checkbox (`- [ ]`) syntax.

**Status:** approved by the user 2026-11-26 after a Codex adversarial review (needs-attention, 3 findings, all folded into HCV-2: a home-specific contrast helper, the `e2e-` email prefix, the `./fixtures` import). The prototype it implements was approved the same day after four feedback rounds.

**Goal:** the signed-in home page (`/`, `Landing` inside the hero `AppShell`) carries the same book-cover world as the sign-in page — green band header and footer, mint graph-paper page with the washed world map, dots and arcs — in light and a night variant for dark mode, with the six labs as a 3-column card grid.

**Architecture:** the sign-in page's paper backdrop (grid, wash, dots, arcs) is extracted from `CoverShell` into one shared `CoverBackdrop` component and CSS file, themed by CSS variables; `CoverShell` and the hero `AppShell` both use it. A new scoped `home.css` (class `.home`, dark tokens under `.dark .home`) styles the hero header, footer, cards and recent solves; `Landing.tsx` swaps shadcn `Card`/`Badge` markup for plain elements with those classes. The non-hero shell (Workspace, Compare, legal pages) is unchanged. **No API, OpenAPI, codegen, DB or solver change.**

**Tech stack:** React 18 + Vite, wouter, TanStack Query v5 (Orval client), vitest + RTL (jsdom), Playwright.

## Global Constraints

- **Design source:** `docs/superpowers/specs/2026-11-26-home-cover-prototype.html` (approved; open it from the repo, its two assets load by relative path) and decisions H1–H12 below. Port, don't redesign.
- Never hand-edit `lib/api-zod/src/generated/**` or `lib/api-client-react/src/generated/**`. No task here needs a regen.
- **Every existing `data-testid` on the home page survives** (`text-user-email`, `button-logout`, `homepage-credit-footer`, `account-links`, `link-terms`, `link-privacy`, `link-delete-account`, `feedback-*`, `landing-stats-line`, `landing-card-<modelId>`, `landing-card-footer-<modelId>`, `landing-card-locked-<modelId>`, `link-<path>`, `locked-<path>`, `link-solve-history-<id>`, `locked-solve-history-<id>`, `badge-legacy-unverified-<id>`, `link-retry-solve-history-<id>`, `text-error-message-<id>`). The only one removed is `hero-tagline` (H1) and `network-background` (H3).
- `themeSurfaceGuard.test.ts` stays green: no `bg-white`/`text-white` classes and no raw `var(--ink-NNN)`/`var(--green-NNN)` in new TSX — colours live in `home.css` / `coverBackdrop.css`.
- Accessibility floor: every control keyboard-reachable with a visible focus ring; text ≥ 11 px; text contrast ≥ 4.5:1 in both themes (measured in the prototype: header muted `#CFDDD0` on `#17661B` 5.1:1; card status `#5E6B5D` on `#EFF6EC` 5.1:1; dark status `#8FA38F` on `#12201A` 6:1); the one animation (arcs) only under `prefers-reduced-motion: no-preference`.
- **Per-task obligations** (as in the Design Upgrade plans): karpathy + ponytail before code, ponytail-review before commit (qa-sdet exempt); sweep `artifacts/studio/src` and `artifacts/studio/e2e` for every changed testid/string; changelog `### HCV-N — …` in the same commit, numbers measured or `unknown`.
- **Gate (per task):** zero concurrent vitest (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt"`), then `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, one at a time, never `pkill`; check `docs/superpowers/flake-registry.md` before calling a failure a regression.
- **Commit:** assert not on `main`; static path list `P` (deletions included), `git add -A -- ${=P}`, check `git diff --cached --name-only` equals `P`, `git commit --only ${=P} -m "[HCV-N] …"` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions H1–H12

User-approved through the prototype rounds and the 2026-11-26 questions. The plan's only normative source for this page besides the prototype.

| ID | Decision |
|---|---|
| H1 | **Header:** one quiet row, min-height 60 px, background `--band-deep`, no bottom stripe. Left: book-cover thumbnail (30 px wide, kept by user choice), **Network Design Labs** (Source Serif 4, 700, 19 px) with **Offered by Michael Watson** as 12 px subtext under it. Right: email, 16 px gap, **Log out** button. The tagline "Build a scenario on the map…" is removed. Below 720 px the email is hidden; the subtext stays. |
| H2 | **Log out** and **Delete my account** are real outlined buttons on the band: 32 px tall, 1 px `rgba(255,255,255,.55)` border, 4 px radius, 14 px icon. Hover fills white with `#17661B` text (Log out) or `#A3261B` with white text (Delete); press nudges 1 px; focus ring `#F2E9A8`. Log out shows a spinner and "Logging out…" and is disabled while its mutation is pending. Delete opens the existing `DeleteAccountDialog` (unchanged). |
| H3 | **Page:** the sign-in page's paper — 48/192 px grid, washed world map, 70 seeded dots, two white arcs — shared via `CoverBackdrop`, fixed behind the scrolling content. Replaces `NetworkBackground` (deleted). |
| H4 | **Labs heading** keeps its copy ("Labs", "Pick a chapter to start or continue a scenario.") in Source Serif 4; the stats line stays at the right in mono. |
| H5 | **Lab cards:** 3 columns ≥ 1000 px, 2 columns ≥ 640 px, 1 below; 18 px gap. Each card: a large serif chapter numeral (44 px, `--numeral`) beside the title and description; the Super Model has a drawn network glyph instead of a numeral. The "CHAPTER 3" kicker and the footer's "03" are removed; screen readers get "Chapter 3: " (or "Super Model: ") before the title. Footer strip: status in mono at left; **Start** with a drawn arrow, or an **Active** chip, or a **Locked** chip with the lock icon, at right. Hover lifts 2 px and greens the border. Locked cards are dimmed (opacity .6, no hover) and still not links. |
| H6 | **Recent solves:** same panel surface as the cards; row = chapter label (mono), scenario name, status chip (succeeded/failed/running coloured), optional "unverified" chip, "Retry" with drawn arrow, figures in tabular mono. Below 640 px the chips and figures stack under the name. |
| H7 | **Footer band:** `--band-deep` with a 6 px `--band` top border. Left: "Developed by Shubham. Facing issues? Reach out at" + LinkedIn and email icon links. Right: Terms, Privacy, Delete my account (H2). Feedback launcher becomes a green pill labelled **Feedback** with the chat icon, still docked above the footer's top-right. |
| H8 | **Copy fix:** "1 scenarios" becomes "1 scenario" in the card status and the stats line ("6 labs · 1 scenario · 0 solved"). |
| H9 | **Themes:** light uses the sign-in palette; dark is a night version (paper `#101A12`, land `#1F3524`, cards `#16241A`, numerals/links `#9BD3B4`, band `#0F4A13`). Driven by the app's existing `html.dark` class (`lib/theme.ts`), not `prefers-color-scheme`. The sign-in page stays light-only (CSI L6). |
| H10 | **Scope:** only the hero shell (home `/`). The compact header on Workspace/Compare/legal keeps the ink `.scnd-band` (DU Q8 still holds there). The home band is green in both themes, which retires Q8 for the home page only. |
| H11 | Arcs reuse `CoverShell`'s geometry; the arcs' draw-in (1.8 s, ease-out-expo) is the page's one motion. |
| H12 | No locked chapter exists today; the locked style is built and covered by the existing `Landing.lockedRendering` tests. |

---

### Task HCV-1: Build the cover home page

**Files:**
- Create: `artifacts/studio/src/components/cover/CoverBackdrop.tsx`
- Create: `artifacts/studio/src/components/cover/coverBackdrop.css`
- Create: `artifacts/studio/src/components/home/home.css`
- Modify: `artifacts/studio/src/components/auth/CoverShell.tsx` (use `CoverBackdrop`)
- Modify: `artifacts/studio/src/components/auth/cover.css` (drop the moved paper/wash/bg rules)
- Modify: `artifacts/studio/src/components/AppShell.tsx` (hero branch)
- Modify: `artifacts/studio/src/components/DeveloperCredit.tsx`, `AccountLinks.tsx`, `FeedbackWidget.tsx` (launcher only)
- Modify: `artifacts/studio/src/pages/Landing.tsx`
- Delete: `artifacts/studio/src/components/NetworkBackground.tsx`, `artifacts/studio/src/__tests__/NetworkBackground.test.tsx`
- Test: `artifacts/studio/src/__tests__/AppShell.test.tsx`, `Landing.test.tsx`, `Landing.lockedRendering.test.tsx`, `AccountLinks.test.tsx`, `FeedbackWidget.test.tsx`
- Docs: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces: `CoverBackdrop(): JSX.Element` (renders `.wash` + `svg.bg`, both `aria-hidden`; parent must carry class `cover-paper`); `pluralScenarios(n: number): string` in `Landing.tsx` (not exported); CSS classes listed in `home.css`.
- Consumes: nothing new.

- [ ] **Step 1: Update the unit tests first (they must fail on `main`)**

`AppShell.test.tsx` — replace the `NetworkBackground` mock with nothing (the module is deleted), and replace these cases:

```tsx
// "AppShell hero variant" describe — replaces the tagline and network-background cases
it("renders the hero header as one row: thumbnail, name, Offered-by subtext, no tagline", () => {
  renderShell(<AppShell userEmail="a@b.edu" heroTitle="Network Design Labs" hero><div>c</div></AppShell>);
  const header = screen.getByTestId("text-user-email").closest("header") as HTMLElement;
  expect(header.className).toContain("home-top");
  expect(header.className).not.toContain("scnd-band");
  expect(header.querySelector("img")).toBeInTheDocument();
  expect(header).toHaveTextContent("Network Design Labs");
  expect(header).toHaveTextContent("Offered by Michael Watson");
  expect(screen.queryByTestId("hero-tagline")).not.toBeInTheDocument();
});

it("renders the cover backdrop only on the homepage hero shell", () => {
  const { container, rerender } = renderShell(<AppShell userEmail="a@b.edu" hero><div>c</div></AppShell>);
  expect(container.querySelector(".cover-paper .wash")).toBeInTheDocument();
  rerender(<UnitProvider><AppShell userEmail="a@b.edu"><div>c</div></AppShell></UnitProvider>);
  expect(container.querySelector(".cover-paper")).toBeNull();
});

it("makes Log out a band button that disables and says Logging out… while pending", () => {
  pendingLogout = true;
  renderShell(<AppShell userEmail="a@b.edu" hero><div>c</div></AppShell>);
  const btn = screen.getByTestId("button-logout");
  expect(btn.tagName).toBe("BUTTON");
  expect(btn.className).toContain("btn-band");
  expect(btn).toBeDisabled();
  expect(btn).toHaveTextContent("Logging out…");
});
```

Make the logout mock pending-aware (top of file): `let pendingLogout = false;` and `useLogoutUser: () => ({ mutate: mockLogoutMutate, isPending: pendingLogout })`; reset `pendingLogout = false` in `beforeEach`. Delete the old "renders the tagline…", "renders the network background…" and "gives the log-out button a hover-highlight class" cases (the class contract is replaced by the case above). In "AppShell band hero", scope "carries the .scnd-band class" to the non-hero shell (`<AppShell userEmail="a@b.edu">`) — it already is if it renders without `hero`; leave it otherwise.

`Landing.test.tsx` — edit these assertions:

```tsx
// "shows the Super Model card with an SM chapter number, not 00" → rename and replace body:
it("shows the Super Model card with a drawn glyph and a screen-reader label, not a number", () => {
  mockUseGetSolveHistory.mockReturnValue({ data: [] });
  renderLanding();
  const card = screen.getByTestId("landing-card-super-model");
  expect(card.querySelector(".num svg")).toBeInTheDocument();
  expect(card).toHaveTextContent("Super Model:");
  expect(screen.queryByText("SM")).not.toBeInTheDocument();
});

// "shows a chapter number and a start affordance on each card (baseline)"
it("shows a chapter numeral beside the title and a Start affordance on each card (baseline)", () => {
  mockUseGetSolveHistory.mockReturnValue({ data: [] });
  renderLanding();
  const card = screen.getByTestId("landing-card-p-median-us");
  expect(card.querySelector(".num")).toHaveTextContent(/^3$/);
  expect(card).toHaveTextContent("Chapter 3:");
  expect(screen.getByTestId("landing-card-footer-p-median-us")).toHaveTextContent("Start");
  expect(screen.queryByText("Chapter 3", { selector: ".scnd-kicker" })).toBeNull();
});

// "clips the card and gives the footer a sunken full-bleed strip"
it("gives each card the home-card surface with a separate footer strip", () => {
  mockUseGetLandingSummary.mockReturnValue({ data: { perChapter: [], totals: { scenarios: 0, solvedScenarios: 0 } }, isPending: false, isError: false });
  renderLanding();
  const footer = screen.getByTestId("landing-card-footer-p-median-us");
  expect(footer.className).toContain("card-foot");
  expect(footer.closest(".home-card")).toBe(screen.getByTestId("landing-card-p-median-us"));
});
```

In "falls back to the baseline…" replace `toHaveTextContent("03")` with `expect(screen.getByTestId("landing-card-p-median-us").querySelector(".num")).toHaveTextContent(/^3$/)` and the `start` check with `"Start"`. In "renders per-card status, the active badge…" change `toHaveTextContent("active")` to `toHaveTextContent("Active")`, keep the `not.toHaveTextContent` checks as `not.toHaveTextContent("Active")`. Add one case for H8:

```tsx
it("says '1 scenario', not '1 scenarios', on the card and in the stats line (H8)", () => {
  mockUseGetLandingSummary.mockReturnValue({
    data: { perChapter: [{ modelId: "p-median-us", scenarioCount: 1, solvedScenarioCount: 0, lastSucceededSolveAt: null }], totals: { scenarios: 1, solvedScenarios: 0 } },
    isPending: false, isError: false,
  });
  renderLanding();
  expect(screen.getByTestId("landing-card-footer-p-median-us")).toHaveTextContent(/^1 scenarioStart$/);
  expect(screen.getByTestId("landing-stats-line")).toHaveTextContent("6 labs · 1 scenario · 0 solved");
});
```

(Read the `perChapter` row shape from the existing "live summary (T4)" cases before pasting; use theirs if a field name differs.)

`Landing.lockedRendering.test.tsx` "is visibly greyed and shows a Locked badge": replace `className).toContain("opacity-60")` with `expect(card).toHaveAttribute("data-locked", "true")` and keep the Locked-text check.

`AccountLinks.test.tsx`: add `expect(screen.getByTestId("link-delete-account").className).toContain("btn-band")`. `FeedbackWidget.test.tsx`: add `expect(screen.getByTestId("feedback-button")).toHaveTextContent("Feedback")`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/AppShell.test.tsx src/__tests__/Landing.test.tsx src/__tests__/Landing.lockedRendering.test.tsx src/__tests__/AccountLinks.test.tsx src/__tests__/FeedbackWidget.test.tsx`
Expected: FAIL — `home-top`, `.cover-paper`, `btn-band`, `.num`, `card-foot`, `data-locked`, "Feedback" not found; AppShell fails to import the deleted mock target only after Step 3 deletes it (fine).

- [ ] **Step 3: Extract the shared backdrop**

`components/cover/coverBackdrop.css` (rules moved out of `cover.css`; colours become variables with the sign-in values as defaults):

```css
/* The book cover's paper: grid, washed world, dots, sweeping arcs. Shared by the sign-in
   page (.cover, light only) and the home page (.home, light + dark). The parent sets the tokens. */
.cover-paper{
  --paper:#EAF3E8;--paper-2:#DCEBD9;--land:#B9C9B8;
  --grid:rgba(52,84,52,.10);--grid-strong:rgba(52,84,52,.17);--dot:rgba(70,100,72,.10);--arc:rgba(255,255,255,.65);
  position:relative;overflow:hidden;isolation:isolate;
  background:
    linear-gradient(var(--grid-strong) 1px,transparent 1px) 0 0/192px 192px,
    linear-gradient(90deg,var(--grid-strong) 1px,transparent 1px) 0 0/192px 192px,
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/48px 48px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/48px 48px,
    radial-gradient(120% 80% at 50% 40%,var(--paper) 30%,var(--paper-2) 100%)}
.cover-paper > .wash{position:absolute;inset:-5% -15% -10%;z-index:-1;background:var(--land);opacity:.55;
  -webkit-mask:var(--land-url) center/contain no-repeat;mask:var(--land-url) center/contain no-repeat}
.cover-paper > .bg{position:absolute;inset:0;width:100%;height:100%;z-index:-1}
.cover-paper .bg .dot{fill:var(--dot)}
.cover-paper .bg .arc{fill:none;stroke:var(--arc);stroke-width:14;stroke-linecap:round;opacity:.5;vector-effect:non-scaling-stroke}
@media (prefers-reduced-motion:no-preference){
  .cover-paper .bg .arc{stroke-dasharray:240;animation:cover-sweep 1.8s cubic-bezier(.16,1,.3,1) .15s backwards}
  @keyframes cover-sweep{from{stroke-dashoffset:240}to{stroke-dashoffset:0}}
}
```

`components/cover/CoverBackdrop.tsx` (the DOTS/ARCS code moves here from `CoverShell.tsx`, same seed so the sign-in composition does not change):

```tsx
import type { CSSProperties } from "react";
import worldLand from "@/assets/world-land.svg";
import "./coverBackdrop.css";

// Deterministic, so the composition is stable between loads (seed shared with the sign-in page's
// original port; CoverShell's strip bubbles continue the same sequence via nextRandom()).
let seed = 7;
export const nextRandom = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const DOTS = Array.from({ length: 70 }, () => ({ cx: nextRandom() * 100, cy: nextRandom() * 100, r: 3 + nextRandom() * 16 }));
const ARCS = [[-.1, .78, .5, .35, 1.1, .62], [-.05, .3, .55, .9, 1.1, .45]].map(
  ([x0, y0, cx, cy, x1, y1]) => `M${x0 * 100},${y0 * 100} Q${cx * 100},${cy * 100} ${x1 * 100},${y1 * 100}`,
);

/** The paper's decoration. Render it as the first children of an element with class `cover-paper`. */
export function CoverBackdrop() {
  return (
    <>
      <div className="wash" aria-hidden="true" style={{ "--land-url": `url(${worldLand})` } as CSSProperties} />
      <svg className="bg" aria-hidden="true">
        {DOTS.map((d, i) => <circle key={i} className="dot" cx={`${d.cx}%`} cy={`${d.cy}%`} r={d.r} />)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
          {ARCS.map((d) => <path key={d} className="arc" d={d} pathLength={240} />)}
        </svg>
      </svg>
    </>
  );
}
```

`CoverShell.tsx`: delete its own `seed`/`rnd`/`DOTS`/`ARCS`, import `{ CoverBackdrop, nextRandom }` from `@/components/cover/CoverBackdrop`, use `nextRandom()` where `rnd()` built `BUBBLES`, change `<div className="paper">` to `<div className="paper cover-paper">`, and replace its wash `<div>` + `svg.bg` block with `<CoverBackdrop />`. Because `BUBBLES` previously consumed the generator after `DOTS`, and `DOTS` is now built at `CoverBackdrop`'s module load, the bubble positions stay identical as long as `CoverBackdrop.tsx` is imported before `BUBBLES` is computed — it is, by the import at the top of `CoverShell.tsx`. Verify with `cover-sign-in.spec.ts` in HCV-2 (its screenshots).

`cover.css`: delete the `/* paper: grid, washed world, dots, sweeping arcs */` block (`.cover .paper{…background…}`, `.cover .paper > .bg`, `.cover .wash`, `.cover .bg .dot`, `.cover .bg .arc`) and keep `.cover .paper{flex:1}` plus its `--link` rule. Sign-in arcs gain the draw-in (H11); that is the only visible change to the sign-in page.

- [ ] **Step 4: Write `home.css`**

Port from the prototype, scoped to `.home`; dark tokens under `.dark .home` (the app toggles `html.dark`). Full file:

```css
/* Signed-in home page in the book-cover world (HCV). Light = the sign-in palette; dark = the same
   world at night (H9). Only the hero AppShell carries .home. */
.home{
  --band:#1F7F24;--band-deep:#17661B;--band-ink:#FFFFFF;--band-ink-muted:#CFDDD0;
  --ink:#151A14;--ink-muted:#3D4A3C;--ink-faint:#5E6B5D;
  --card:#F9FCF7;--card-foot:#EFF6EC;--card-line:rgba(31,127,36,.20);--card-line-hover:#1F7F24;
  --numeral:#1F7F24;--link:#17661B;--focus-ring:#17661B;
  --ok:#17661B;--ok-bg:#DDF0DA;--bad:#A3261B;--bad-bg:#F8E1DD;--warn:#7A5A00;--warn-bg:#F6EBC8;
  --shadow:0 1px 2px rgba(20,40,22,.06),0 10px 24px -14px rgba(20,40,22,.30);
  --shadow-hover:0 2px 4px rgba(20,40,22,.08),0 18px 36px -16px rgba(20,40,22,.38);
  --serif:'Source Serif 4',Georgia,serif;--mono:var(--app-font-mono);
  color:var(--ink)}
.dark .home{
  --band:#1B6E20;--band-deep:#0F4A13;--band-ink-muted:#C7DCC8;
  --paper:#101A12;--paper-2:#0B140D;--land:#1F3524;
  --grid:rgba(155,211,180,.05);--grid-strong:rgba(155,211,180,.09);--dot:rgba(155,211,180,.05);--arc:rgba(155,211,180,.22);
  --ink:#E6EFE4;--ink-muted:#AFC2AF;--ink-faint:#8FA38F;
  --card:#16241A;--card-foot:#12201A;--card-line:rgba(155,211,180,.16);--card-line-hover:#9BD3B4;
  --numeral:#9BD3B4;--link:#9BD3B4;--focus-ring:#F2E9A8;
  --ok:#9BD3B4;--ok-bg:rgba(155,211,180,.12);--bad:#FFB4A8;--bad-bg:rgba(255,120,100,.12);--warn:#F2D27A;--warn-bg:rgba(242,210,122,.12);
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 24px -14px rgba(0,0,0,.6);
  --shadow-hover:0 2px 4px rgba(0,0,0,.35),0 18px 36px -16px rgba(0,0,0,.7)}
/* the backdrop's tokens are declared on .cover-paper itself, so dark overrides must reach it */
.dark .home .cover-paper{--paper:#101A12;--paper-2:#0B140D;--land:#1F3524;
  --grid:rgba(155,211,180,.05);--grid-strong:rgba(155,211,180,.09);--dot:rgba(155,211,180,.05);--arc:rgba(155,211,180,.22)}
.home ::selection{background:#9BD3B4;color:#151A14}
.home :focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px;border-radius:3px}
.home .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.home .wrap{width:100%;max-width:1120px;margin:0 auto;padding-inline:16px}
@media (min-width:640px){.home .wrap{padding-inline:28px}}

/* header (H1) */
.home-top{background:var(--band-deep);color:var(--band-ink);position:relative;z-index:20}
.home-top .wrap{display:flex;align-items:center;gap:14px;min-height:60px;padding-block:10px}
.home-top .brand{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
.home-top .thumb{width:30px;height:auto;border-radius:1px;box-shadow:0 2px 6px rgba(0,0,0,.35);flex:none}
.home-top .titles{min-width:0}
.home-top .name{margin:0;font:700 19px/1.2 var(--serif);letter-spacing:-.01em;white-space:nowrap}
.home-top .offered{margin:1px 0 0;font-size:12px;line-height:1.3;color:var(--band-ink-muted);white-space:nowrap}
.home-top .who{display:flex;align-items:center;gap:16px;font-size:13px;color:var(--band-ink-muted);min-width:0}
.home-top .email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:28ch}
@media (max-width:719px){.home-top .email{display:none}}

/* band buttons (H2) */
.home .btn-band{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border:1px solid rgba(255,255,255,.55);border-radius:4px;background:transparent;color:var(--band-ink);font:600 13px var(--app-font-sans);cursor:pointer;white-space:nowrap;
  transition:background-color .15s ease-out,color .15s ease-out,border-color .15s ease-out,transform .1s ease-out}
.home .btn-band:hover:not(:disabled){background:#FFFFFF;border-color:#FFFFFF;color:#17661B}
.home .btn-band:active:not(:disabled){transform:translateY(1px)}
.home .btn-band:focus-visible{outline:2px solid #F2E9A8;outline-offset:2px}
.home .btn-band:disabled{opacity:.7;cursor:progress}
.home .btn-band.danger:hover:not(:disabled){background:#A3261B;border-color:#A3261B;color:#FFFFFF}
.home .spin{animation:home-spin .8s linear infinite}
@keyframes home-spin{to{transform:rotate(360deg)}}

/* page */
.home-page{padding-block:clamp(28px,4.5vw,56px) clamp(40px,6vw,72px)}
.home-page .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:6px 24px;margin-bottom:clamp(20px,2.6vw,28px)}
.home-page h1{margin:0;font:700 clamp(2rem,3.6vw,2.75rem)/1.05 var(--serif);letter-spacing:-.02em}
.home-page .sub{margin:8px 0 0;font-size:16px;color:var(--ink-muted)}
.home-page .stats{font:12px var(--mono);color:var(--ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap}

/* lab cards (H5) */
.home-grid{list-style:none;margin:0;padding:0;display:grid;gap:18px;grid-template-columns:1fr}
@media (min-width:640px){.home-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1000px){.home-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.home-grid > li > a,.home-grid > li > div{display:block;height:100%;color:inherit;text-decoration:none}
.home-card{display:flex;flex-direction:column;height:100%;background:var(--card);border:1px solid var(--card-line);border-radius:4px;box-shadow:var(--shadow);overflow:hidden;
  transition:border-color .18s ease-out,box-shadow .25s cubic-bezier(.16,1,.3,1),transform .25s cubic-bezier(.16,1,.3,1)}
a:hover > .home-card{border-color:var(--card-line-hover);box-shadow:var(--shadow-hover);transform:translateY(-2px)}
.home-card[data-locked="true"]{opacity:.6;cursor:not-allowed}
.home-card .card-body{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto 1fr;align-content:start;gap:4px 14px;padding:20px 20px 18px;flex:1}
.home-card .num{grid-row:span 2;min-width:1.4ch;font:700 44px/.9 var(--serif);color:var(--numeral);letter-spacing:-.03em}
.home-card .num svg{display:block;width:40px;height:40px;margin-top:2px}
.home-card .title{margin:0;font:600 18px/1.25 var(--serif);text-wrap:balance}
.home-card .desc{margin:4px 0 0;font-size:14px;line-height:1.5;color:var(--ink-muted)}
.home-card .card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px;background:var(--card-foot);border-top:1px solid var(--card-line);min-height:44px}
.home-card .status{font:12px var(--mono);color:var(--ink-faint);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-card .go{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--link);flex:none}
.home-card .go svg{transition:transform .25s cubic-bezier(.16,1,.3,1)}
a:hover > .home-card .go svg{transform:translateX(3px)}
.home .chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;flex:none}
.home .chip.ok{color:var(--ok);background:var(--ok-bg)}
.home .chip.bad{color:var(--bad);background:var(--bad-bg)}
.home .chip.warn{color:var(--warn);background:var(--warn-bg)}
.home .chip.neutral{color:var(--ink-muted);box-shadow:inset 0 0 0 1px var(--card-line)}
.home .chip .dotm{width:6px;height:6px;border-radius:50%;background:currentColor}

/* recent solves (H6) */
.home-recent{margin-top:clamp(40px,5vw,56px)}
.home-recent h2{margin:0;font:600 22px/1.2 var(--serif);letter-spacing:-.01em}
.home-recent .sub{font-size:14px;margin:4px 0 14px;color:var(--ink-muted)}
.home-recent .rows{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--card-line);border-radius:4px;box-shadow:var(--shadow);overflow:hidden}
.home-recent .rows > li + li{border-top:1px solid var(--card-line)}
.home-recent .rows > li{display:flex;align-items:center}
.home-recent .rows > li[data-locked="true"]{opacity:.6;cursor:not-allowed}
.home-recent .row-link{flex:1;min-width:0;display:block;color:inherit;text-decoration:none;transition:background-color .15s ease-out}
.home-recent a.row-link:hover{background:var(--card-foot)}
.home-recent .row{display:grid;grid-template-columns:max-content minmax(0,1fr) auto auto;align-items:center;gap:6px 14px;padding:12px 18px}
.home-recent .ch{font:12px var(--mono);color:var(--ink-faint)}
.home-recent .sc{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-recent .tags{display:flex;gap:6px;align-items:center}
.home-recent .figs{display:flex;gap:16px;font:12.5px var(--mono);color:var(--ink-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.home-recent .err{grid-column:2 / -1;margin:0;font-size:13px;color:var(--ink-muted)}
.home-recent .retry{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--bad)}
@media (max-width:639px){
  .home-recent .row{grid-template-columns:max-content minmax(0,1fr)}
  .home-recent .tags,.home-recent .figs,.home-recent .err{grid-column:2}
  .home-recent .figs{flex-wrap:wrap;gap:4px 14px}
}

/* footer band (H7) */
.home-bottom{position:relative;background:var(--band-deep);color:var(--band-ink-muted);border-top:6px solid var(--band);font-size:13px}
.home-bottom .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;padding-block:18px}
.home-bottom a{color:var(--band-ink);font-weight:600;text-decoration:none;text-underline-offset:3px;text-decoration-thickness:1.5px}
.home-bottom a:hover,.home-bottom a:focus-visible{text-decoration-line:underline}
.home-bottom :focus-visible{outline-color:#F2E9A8}
.home-bottom .credit{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0}
.home-bottom .icons{display:inline-flex;gap:2px}
.home-bottom .ico{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%}
.home-bottom .ico:hover{background:rgba(255,255,255,.12)}
.home-bottom .legal{display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap}
.home .feedback-pill{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border:0;border-radius:999px;background:var(--band);color:#FFFFFF;font-weight:600;font-size:14px;cursor:pointer;
  box-shadow:0 8px 18px -8px rgba(0,0,0,.4);transition:background-color .15s ease-out,transform .2s cubic-bezier(.16,1,.3,1)}
.home .feedback-pill:hover{background:#238F29;transform:translateY(-1px)}
```

- [ ] **Step 5: Rewrite the hero branch of `AppShell.tsx`**

Replace the `hero ? (<header …>…</header>)` branch, the `{hero && <NetworkBackground />}` line and the hero footer. Keep `handleLogout` and the non-hero branch byte-for-byte. Remove the `NetworkBackground` import; add `import { CoverBackdrop } from "@/components/cover/CoverBackdrop";`, `import "@/components/home/home.css";` and `LogOut`, `Loader2` from `lucide-react`.

```tsx
  const logoutLabel = logoutUser.isPending
    ? <><Loader2 className="spin" size={14} aria-hidden="true" /><span>Logging out…</span></>
    : <><LogOut size={14} aria-hidden="true" /><span>Log out</span></>;

  if (hero) {
    return (
      <div className="home h-screen flex flex-col overflow-hidden">
        <header className="home-top flex-shrink-0">
          <div className="wrap">
            <div className="brand">
              <img src={coverUrl} alt="" className="thumb" />
              <div className="titles">
                <p className="name">{heroTitle ?? "Network Design Labs"}</p>
                <p className="offered">Offered by Michael Watson</p>
              </div>
            </div>
            {/* ch4-fixes item 1 — no UnitToggle on the homepage (see the non-hero branch). */}
            <div className="who">
              <span className="email" title={userEmail} data-testid="text-user-email">{userEmail}</span>
              <button type="button" className="btn-band" onClick={handleLogout} disabled={logoutUser.isPending} data-testid="button-logout">
                {logoutLabel}
              </button>
            </div>
          </div>
        </header>
        <div className="cover-paper flex-1 min-h-0">
          <CoverBackdrop />
          <main className="absolute inset-0 overflow-y-auto z-10 flex flex-col">
            <div className="flex-1">{children}</div>
            {/* DU-2.8 — the footer scrolls with the content; QF-B — it anchors the feedback launcher. */}
            <footer data-testid="homepage-credit-footer" className="home-bottom">
              <FeedbackWidget />
              <div className="wrap">
                <DeveloperCredit />
                <AccountLinks />
              </div>
            </footer>
          </main>
        </div>
      </div>
    );
  }
```

and the remaining `return` becomes the non-hero shell only (header `scnd-band` compact row, `<main>` without `NetworkBackground`, `<AppFooter />`). `text-user-email` is hidden by CSS below 720 px; e2e specs that wait on it as the login signal run at desktop width (verify in HCV-2).

- [ ] **Step 6: Footer components**

`DeveloperCredit.tsx` (only caller is the hero footer):

```tsx
export function DeveloperCredit() {
  return (
    <p className="credit">
      <span>Developed by Shubham. Facing issues? Reach out at</span>
      <span className="icons">
        <a className="ico" href="https://www.linkedin.com/in/shubhamkumarcse/" target="_blank" rel="noopener" aria-label="Shubham on LinkedIn (opens in a new tab)" title="LinkedIn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <a className="ico" href="mailto:shubham.shubham4995@gmail.com" aria-label="Email Shubham" title="Email">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
        </a>
      </span>
    </p>
  );
}
```

`AccountLinks.tsx` — keep state, dialog and testids; replace the wrapper and items:

```tsx
    <nav data-testid="account-links" className="legal" aria-label="Account and legal">
      <Link href="/terms" data-testid="link-terms">Terms</Link>
      <Link href="/privacy" data-testid="link-privacy">Privacy</Link>
      <button type="button" className="btn-band danger" onClick={() => setOpen(true)} data-testid="link-delete-account">
        <Trash2 size={14} aria-hidden="true" /><span>Delete my account</span>
      </button>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </nav>
```

(drop the `MONO`/`style` constants it no longer uses; import `Trash2` from `lucide-react`).

`FeedbackWidget.tsx` — only the launcher `Button` (currently `className="rounded-full shadow"` with the `MessageSquare` icon): render a plain `<button type="button" className="feedback-pill" …>` keeping its `data-testid`, `aria-*`, `onClick`, and add the visible label `Feedback` after the icon. Leave the panel and anchor as they are.

- [ ] **Step 7: Rewrite `Landing.tsx` markup**

Keep every helper, hook, the hidden/locked logic and all comments that explain them. Replace `chapterNumber` and the JSX. Remove the `Card*`/`Badge` imports; add `ArrowRight` from `lucide-react` (keep `Lock`).

```tsx
function chapterNumeral(chapterLabel: string): string | null {
  return chapterLabel.match(/\d+/)?.[0] ?? null;
}

function pluralScenarios(n: number): string {
  return `${n} ${n === 1 ? "scenario" : "scenarios"}`;
}

const NetworkGlyph = () => (
  <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M8 30 20 10 32 28 8 30M20 10v20" />
    <circle cx="8" cy="30" r="4" fill="currentColor" /><circle cx="20" cy="10" r="4" fill="currentColor" />
    <circle cx="32" cy="28" r="4" fill="currentColor" /><circle cx="20" cy="30" r="3" fill="var(--card)" />
  </svg>
);
```

Status strings use `pluralScenarios(entry.scenarioCount)`; the stats line becomes `{visibleLabs} labs · {pluralScenarios(visibleScenarios)} · {visibleSolved} solved`.

Page JSX:

```tsx
  return (
    <div className="home-page wrap">
      <div className="head">
        <div>
          <h1>Labs</h1>
          <p className="sub">Pick a chapter to start or continue a scenario.</p>
        </div>
        {ready && summary && (
          <span data-testid="landing-stats-line" className="stats">
            {visibleLabs} labs · {pluralScenarios(visibleScenarios)} · {visibleSolved} solved
          </span>
        )}
      </div>
      <ul className="home-grid">
        {CHAPTERS.filter((c) => !c.hiddenFromLanding).map((c) => {
          // ch4-lock comment stays here verbatim
          const locked = c.locked === true;
          const numeral = chapterNumeral(c.chapter);
          // status / isActive computed exactly as today, using pluralScenarios
          const card = (
            <article className="home-card" data-testid={`landing-card-${c.modelId}`} data-locked={locked ? "true" : undefined} aria-disabled={locked || undefined}>
              <div className="card-body">
                <span className="num" aria-hidden="true">{numeral ?? <NetworkGlyph />}</span>
                <h3 className="title"><span className="sr">{c.chapter}: </span>{c.title}</h3>
                <p className="desc">{c.description}</p>
              </div>
              <div className="card-foot" data-testid={`landing-card-footer-${c.modelId}`}>
                <span className="status">{status}</span>
                {locked ? (
                  <span className="chip neutral" data-testid={`landing-card-locked-${c.modelId}`}><Lock size={11} aria-hidden="true" />Locked</span>
                ) : isActive ? (
                  <span className="chip ok"><span className="dotm" />Active</span>
                ) : (
                  <span className="go">Start<ArrowRight size={14} aria-hidden="true" /></span>
                )}
              </div>
            </article>
          );
          return (
            <li key={c.path}>
              {locked ? (
                <div data-testid={`locked-${c.path}`} title="This chapter is locked.">{card}</div>
              ) : (
                <Link href={c.path} data-testid={`link-${c.path}`}>{card}</Link>
              )}
            </li>
          );
        })}
      </ul>
      {visibleHistory && visibleHistory.length > 0 && (
        <section className="home-recent" aria-labelledby="home-recent-h">
          <h2 id="home-recent-h">Recent solves</h2>
          <p className="sub">Most recent solve per scenario — click to open one.</p>
          <ul className="rows">{/* one <li> per row, below */}</ul>
        </section>
      )}
    </div>
  );
```

The `status` for an unlocked card with `!ready` stays `null` (render the `<span className="status" />` empty). Each recent-solve row keeps today's logic and comments; only the markup changes:

```tsx
const statusChip = h.status === "succeeded" ? "ok" : h.status === "failed" ? "bad" : "warn";
const row = (
  <div className="row">
    <span className="ch">{chapterForModelId(h.modelId)?.chapter ?? ""}</span>
    <span className="sc">{h.scenarioName}</span>
    <span className="tags">
      <span className={`chip ${statusChip}`}><span className="dotm" />{h.status}</span>
      {unverified && <span className="chip neutral" data-testid={`badge-legacy-unverified-${h.id}`}>unverified</span>}
      {isRetryable && <span className="retry" data-testid={`link-retry-solve-history-${h.id}`}>Retry<ArrowRight size={13} aria-hidden="true" /></span>}
    </span>
    <span className="figs">
      {h.objective != null && <span>{formatHistoryObjective({ ...h, objective: h.objective }, unit)}</span>}
      {h.weightedAvgDistance != null && <span>{formatHistoryDistance({ ...h, weightedAvgDistance: h.weightedAvgDistance }, unit)}</span>}
      {h.runTimeSec != null && <span>{h.runTimeSec.toFixed(2)}s</span>}
    </span>
    {h.status === "failed" && h.errorMessage && <p className="err" data-testid={`text-error-message-${h.id}`}>{h.errorMessage}</p>}
  </div>
);
const info = unverified ? <div className="pr-3 flex-shrink-0"><UnverifiedInfo /></div> : null;
return chapterPath && !rowLocked ? (
  <li key={h.id}>
    <Link href={`${chapterPath}?scenario=${h.scenarioId}`} data-testid={`link-solve-history-${h.id}`} className="row-link">{row}</Link>
    {info}
  </li>
) : (
  <li key={h.id} data-locked={rowLocked ? "true" : undefined} data-testid={rowLocked ? `locked-solve-history-${h.id}` : undefined} title={rowLocked ? "This chapter is locked." : undefined}>
    <div className="row-link">{row}</div>
    {info}
  </li>
);
```

The chapter label keeps today's string (`c.chapter`, e.g. "Chapter 3", "Super Model") minus the trailing " ·" — copy otherwise unchanged. Update `Landing.test.tsx:113` ("prefixes recent-solve rows with the chapter label"): `screen.getByText(/Chapter 3 ·/)` becomes `screen.getByText("Chapter 3", { selector: ".ch" })`.

- [ ] **Step 8: Delete `NetworkBackground` and sweep**

`git rm artifacts/studio/src/components/NetworkBackground.tsx artifacts/studio/src/__tests__/NetworkBackground.test.tsx`. Then:
`grep -rnE "NetworkBackground|network-background|hero-tagline|scnd-kicker" artifacts/studio/src artifacts/studio/e2e` — only e2e hits may remain (HCV-2 owns them); any `src` hit is a bug. `src/lib/__tests__/theme.test.ts:10` mentions `NetworkBackground.test.tsx` in a comment only; reword it to name the pattern without the deleted file.

- [ ] **Step 9: Run the focused tests, then the gate**

Run the Step 2 command: Expected PASS. Then the per-task gate (Global Constraints). Expected: typecheck clean, studio suite green apart from registered flakes, `typecheck:e2e` clean.

- [ ] **Step 10: Look at it**

Start the two local servers (root `CLAUDE.md` recipe; studio `E2E`-style env), register a user, and screenshot `/` at 1440×900, 820×1000, 390×844 in light and dark (set `localStorage["nos:theme-pref"]`). Compare with the prototype at the same sizes; fix differences before committing. Also screenshot `/login` at 1440 and compare with production: only the arcs' draw-in may differ.

- [ ] **Step 11: ponytail-review, changelog, commit**

Run `ponytail:ponytail-review` on the diff and apply what it cuts. Append `### HCV-1 — cover home page` to `docs/CHANGELOG-implementation.md` (what changed, gate numbers measured, H1–H12 pointer). Commit `[HCV-1] restyle the home page in the book-cover world` with the static path list.

---

### Task HCV-2: Real-browser QA and the sibling e2e sweep

**Files:**
- Create: `artifacts/studio/e2e/home-cover.spec.ts`, `artifacts/studio/e2e/helpers/homeContrast.ts`
- Modify (each where it asserts the old home): `e2e/bundle4-auth-landing.spec.ts` (`hero-tagline` at :109; "1 scenarios" at :190, :194, :219, :224; "active" at :123, :195, :225), `e2e/bundle5-homepage-distances.spec.ts` (`hover:bg-white/10` class at ~:126; card `border-t`/`overflow-hidden` at ~:129-140), `e2e/super-model.spec.ts` (`"SM"` at :137), `e2e/design-upgrade-p5.spec.ts` (Q8 ink-band assertion at :903-909), and any further hit of the sweep in Step 1
- Docs: `docs/CHANGELOG-implementation.md`, `docs/superpowers/flake-registry.md` (new sightings only)

**Interfaces:** consumes HCV-1's classes (`.home`, `.home-top`, `.cover-paper`, `.home-grid`, `.home-card`, `.btn-band`, `.feedback-pill`) and testids.

- [ ] **Step 1: Sweep**

`grep -rnE "hero-tagline|network-background|scnd-kicker|\"SM\"|1 scenarios|hover:bg-white/10|rgb\(24, 26, 21\)|toContainText\(\"active\"\)|start →|landing-card-footer" artifacts/studio/e2e` and list every hit with the HCV-1 behaviour it must now assert. Also run the whole e2e gate once on the HCV-1 tip (two local servers, `E2E_BASE_URL` set — never without it) to catch hits the grep misses.

- [ ] **Step 2: Rewrite the siblings**

- bundle4 :109 → assert the header shows "Offered by Michael Watson" and `hero-tagline` has count 0. "1 scenarios" → "1 scenario" (four places). `"active"` → `"Active"`.
- bundle5 → the header `img` stays; replace the `hover:bg-white/10` class check with `expect(await page.getByTestId("button-logout").evaluate(el => el.tagName)).toBe("BUTTON")` plus a real hover check: hover it and poll `getComputedStyle(el).backgroundColor` to `rgb(255, 255, 255)`. Replace the card strip check with `footer.className` containing `card-foot` and its parent `.home-card` having `overflow: hidden` computed.
- super-model :137 → `expect(page.getByTestId("landing-card-super-model").locator(".num svg")).toBeVisible()`.
- design-upgrade-p5 Q8 → the home band is `rgb(23, 102, 27)` (`#17661B`) in light and `rgb(15, 74, 19)` (`#0F4A13`) in dark; a Workspace page's `.scnd-band` is still `rgb(24, 26, 21)` in both (move the Q8 assertion there). Keep its legibility scan and "no white surfaces in dark" checks on `/` unchanged; they must pass on the new page.

- [ ] **Step 3: Write `e2e/home-cover.spec.ts`**

Each test registers its own user (`/api/auth/register` with `acceptTerms: true`, as the other specs do) and goes to `/`. Two repo rules this spec must follow (Codex review, 2026-11-26): **import from `./fixtures`**, never `@playwright/test` — the fixture stubs the PostHog and Sentry ingest hosts; and **generated emails start with `e2e-`** — `scripts/src/purge-test-users.ts` `TEST_LOCAL_PREFIXES` only collects listed prefixes, so any other prefix leaks a user per run.

```ts
import { test, expect, type Page } from "./fixtures";
import { measureHomeContrast } from "./helpers/homeContrast";

const T = 10_000;
async function home(page: Page, scheme: "light" | "dark" = "light") {
  await page.addInitScript(s => { try { localStorage.setItem("nos:theme-pref", s); } catch {} }, scheme);
  const email = `e2e-hcv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  expect((await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1", acceptTerms: true } })).status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("landing-card-p-median-us")).toBeVisible({ timeout: T });
}
const cols = (page: Page) => page.locator(".home-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);

test("H5: 3 columns at 1440, 2 at 820, 1 at 390", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await home(page);
  expect(await cols(page)).toBe(3);
  await page.setViewportSize({ width: 820, height: 1000 }); expect(await cols(page)).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await cols(page)).toBe(1);
});

test("H1: the header is one row ≤ 72 px tall at 1440 and 390, no horizontal overflow", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 }); await home(page);
    const box = await page.locator("header.home-top").boundingBox();
    expect(box!.height, `header height at ${width}`).toBeLessThanOrEqual(72);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`).toBe(true);
    await expect(page.locator("header.home-top")).toContainText("Offered by Michael Watson");
    await expect(page.getByTestId("button-logout")).toBeVisible();
    await page.context().clearCookies();
  }
});

test("H9: band and paper follow the app theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await home(page, "dark");
  const bg = (sel: string) => page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await bg("header.home-top")).toBe("rgb(15, 74, 19)");
  expect(await bg(".home-card")).toBe("rgb(22, 36, 26)");
});

test("H2: Delete my account is a button that opens the existing confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await home(page);
  const del = page.getByTestId("homepage-credit-footer").getByTestId("link-delete-account");
  expect(await del.evaluate(el => el.tagName)).toBe("BUTTON");
  await del.click({ timeout: T });
  await expect(page.getByRole("dialog")).toContainText("Delete your account?");
  await page.getByTestId("button-cancel-delete").click({ timeout: T });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("H5: keyboard reaches a lab card with a visible focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await home(page);
  const link = page.getByTestId("link-/chapter-3");
  await link.focus();
  expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
});
```

(`/chapter-3` is p-median-us's path, `src/lib/chapters.ts:43`.)

Contrast: `e2e/helpers/coverContrast.ts` cannot be reused — it throws without `[data-testid="cover-shell"]` and reads the sign-in strip's variables. p5's `legibilityScan` would skip every text node over the gradient paper (vacuous for the heading and stats). Add `e2e/helpers/homeContrast.ts`: every visible text node under `.home` is measured against its nearest ancestor with an opaque background colour; if none exists before `.cover-paper`, against whichever of `--paper` / `--paper-2` (read from `.cover-paper`'s computed style) gives the LOWER ratio — the pessimistic bound in either theme. Chips use their own background (`--ok-bg` etc. are translucent in dark: composite them over `--card` before measuring).

```ts
import type { Page } from "@playwright/test";

export interface HomeContrastResult {
  checked: number;
  findings: Array<{ text: string; ratio: number; fg: string; bg: string }>;
}

export async function measureHomeContrast(page: Page, min = 4.5): Promise<HomeContrastResult> {
  return page.evaluate((minRatio) => {
    const root = document.querySelector<HTMLElement>(".home");
    if (!root) throw new Error(".home not rendered");
    const paper = root.querySelector<HTMLElement>(".cover-paper");
    if (!paper) throw new Error(".cover-paper not rendered");
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgba = (c: string): number[] => { ctx.fillStyle = "#000"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v)); };
    const over = (top: number[], under: number[]) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const pcs = getComputedStyle(paper);
    const paperStops = [rgba(pcs.getPropertyValue("--paper").trim()), rgba(pcs.getPropertyValue("--paper-2").trim())];
    // Walk up collecting translucent layers until an opaque one (or the paper) is reached.
    const groundsFor = (el: Element): number[][] => {
      const layers: number[][] = [];
      for (let n: Element | null = el; n && n !== paper; n = n.parentElement) {
        const bg = rgba(getComputedStyle(n).backgroundColor);
        if (bg[3] === 0) continue;
        layers.push(bg);
        if (bg[3] === 1) return [layers.reduceRight((acc, l) => over(l, acc))];
      }
      return paperStops.map((p) => layers.reduceRight((acc, l) => over(l, acc), p));
    };
    const findings: HomeContrastResult["findings"] = [];
    let checked = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement!;
      const text = t.textContent!.trim();
      if (!text || el.closest(".sr, [aria-hidden='true']")) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0) continue;
      const fg = rgba(cs.color);
      const worst = Math.min(...groundsFor(el).map((g) => ratio(over(fg, g), g)));
      checked++;
      if (worst < minRatio) findings.push({ text: text.slice(0, 40), ratio: +worst.toFixed(2), fg: cs.color, bg: String(groundsFor(el)[0]) });
    }
    return { checked, findings };
  }, min);
}
```

Spec case (both themes, desktop and phone width, after `home()` and with a seeded Recent-solves row so the rows are measured — reuse `e2e/helpers/seedSolvedResult.ts` the way bundle4 does):

```ts
for (const scheme of ["light", "dark"] as const) {
  test(`contrast ≥ 4.5:1 on every home text node (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await home(page, scheme);
    const r = await measureHomeContrast(page);
    expect(r.checked, "text nodes measured — non-vacuous").toBeGreaterThan(40);
    expect(r.findings).toEqual([]);
  });
}
```

Before trusting it, prove the helper can fail: temporarily set `.home{--ink-faint:#B8C4B7}` via `page.addStyleTag` in a throwaway run and confirm `findings` is non-empty (record that run in the report; do not commit it).

- [ ] **Step 4: Run, screenshot, compare**

Run `home-cover.spec.ts`, the rewritten siblings, `cover-sign-in.spec.ts` (the backdrop extraction must leave it green) and `feedback.spec.ts` (launcher above the credit line), then the full `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate` and `python3 artifacts/api-server/src/solver/tests/e2e_journey.py <API_URL> auth`. Save light/dark screenshots at 1440/820/390 under `.harness/hcv/` and compare each against the prototype; list any difference in the report.

- [ ] **Step 5: Fable review, changelog, commit**

The lead dispatches a `fable` reviewer on the HCV-1..HCV-2 diff with the prototype path; fold its confirmed findings (fixes to `src` go back to a frontend-engineer on the branch). Append `### HCV-2 — QA` to the changelog with the measured gate numbers. Commit `[HCV-2] home cover e2e and sibling spec rewrites`.

---

## Close-out (lead)

1. `superpowers:finishing-a-development-branch` on `home-cover`, then `/harness-retro HCV`.
2. STOP for merge approval. Then merge → whole-branch review → push → deploy, each separately approved, with `pnpm deploy:preflight -- <deployed-sha>..HEAD` attached to the deploy ask. Frontend-only: nos-studio deploy only; diff the full range with no pathspec to confirm.
3. Message the WatBot peer before any merge or push to the shared checkout.
