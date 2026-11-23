# Output Map Quick Fixes (OMQ) Implementation Plan

> **Execution:** agent-team dispatch per `AGENTS.md`, as in the Design Upgrade phases.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-omq-N -b omq-N-work <output-map-qf tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check (must print `omq-N-work`, else STOP). The lead fast-forwards or cherry-picks each commit onto `output-map-qf`.
> - **Roles:** OMQ-1, OMQ-2 and OMQ-3 are studio-only: `frontend-engineer` (karpathy + ponytail before code), reviewed by the lead on Opus with `ponytail-review`. OMQ-4: `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially, in listed order, and every task's commit is green on its own.
> - **Coordination:** the WatBot session shares this machine and uses the main checkout. No work happens in `/Users/shubhamkr/network-optimization-studio`. Before the merge, re-fetch and rebase `output-map-qf` onto the latest `origin/main`; message WatBot before any push or deploy.

**Goal:** three user-requested changes to the Workspace **Output Map** tab (2026-11-23), shipped ahead of Phase 6 (autosave) as their own plan, merge and deploy (user decision).

1. A **bounds box** on the map: upper bound, lower bound and gap of the displayed solve.
2. The **route (lane) hover tooltip** must be solid; the user sees it as see-through.
3. Output-panel chrome: the footer summary moves behind an **info icon** popover; the "Open warehouses" caption line is **dropped**; **Download** and **Copy** become icon buttons.

**Architecture:** studio only. No API, solver, DB or codegen change: the bound fields already exist on `SolveResult` (`solverIncumbentObjective`, `solverBestBound`, `achievedGap`, generated `lib/api-client-react/src/generated/api.schemas.ts:733-743`) and are read for the first time.

**Tech stack:** React + Vite + Tailwind v4, react-leaflet 4.2.1 / Leaflet 1.9.4, shadcn `Popover` (`components/ui/popover.tsx`, installed, Radix), `lucide-react` icons, vitest + RTL, Playwright.

## Global Constraints

- **Studio only.** Files under `artifacts/studio/**` and `docs/**`. No change to `lib/api-spec`, generated code, `artifacts/api-server/**` or `solvers/**`. So `e2e_accuracy.py`/`e2e_journey.py` are not gates here; `pnpm gate` still runs pytest.
- **PNG capture:** the bounds box sits inside `mapRef` (`OutputMapTab.tsx:433`), so Download and Copy include it (user decision). The info popover is outside `mapRef` and is never captured. Don't change the eager-capture pattern in `lib/copyMapToClipboard.ts:3-10` (Safari).
- **Both themes.** Every new surface uses tokens (`bg-card`, `text-muted-foreground`, `border`), never raw colours, so `themeSurfaceGuard.test.ts` stays green and dark mode works.
- **Accessibility:** icon-only buttons carry `aria-label` + `title` with the old visible text ("Download PNG", "Copy to clipboard", "About this result"), a ≥ 32 px hit area (`size-8`, the `WatBotPanel.tsx:51` pattern) and a visible focus ring. Existing `data-testid`s stay.
- **Per-task obligations:** sweep `artifacts/studio/src` and `artifacts/studio/e2e/` for every changed testid/string and fix all hits in the same commit (sibling-spec rule, root `CLAUDE.md` Gotchas). Append `### OMQ-N — …` to `docs/CHANGELOG-implementation.md` in the same commit. Gate per task: `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, with zero concurrent vitest (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || exit 1`), never `pkill`. Close-out: `pnpm gate` and `E2E_BASE_URL=http://localhost:<port> pnpm e2e:gate`.
- **Commit:** guard `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`; stage an explicit path list `P`, check `git diff --cached --name-only` equals `P`; `git commit --only ${=P} -m "[OMQ-N] …"`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo (PRIV-1):** no emails, IPs, production ids or screenshots of real accounts in commits or docs.

## Decisions (user, 2026-11-23)

| ID | Decision | Task |
|---|---|---|
| D1 | Bounds = the **solver's** bounds and gap (not capacities or band limits). | OMQ-1 |
| D2 | A **separate box**, also captured in the PNG/clipboard image. Placement default: **top-left** of the map (top-right holds the metric box, bottom-right the legend; the zoom control is off, `zoomControl={false}`). | OMQ-1 |
| D3 | **Proven optimal ⇒ Lower = Upper, "Gap: 0% (proven optimal)"**, even though CBC usually reports no bound on such solves. Measured 2026-11-23 on local `nos_dev`: 0 of 46 stored results carry `solverBestBound`/`achievedGap`; CBC's parser deliberately never synthesises bound = incumbent (`cbc_termination.py:321,352`), so the studio derives it from `solutionStatus === "optimal"`. An early stop shows the reported bound and gap; anything unknown shows "—". | OMQ-1 |
| D4 | The see-through box is the **route (lane) hover tooltip**. Its CSS is already solid (`index.css:24-30`: opaque `hsl(var(--card))`, `opacity: 1`; react-leaflet passes `opacity={1}`; Leaflet puts tooltips in `tooltipPane`, z 650, above markers). So the cause is **not yet known**: OMQ-2 diagnoses in a real browser before changing anything. | OMQ-2 |
| D5 | Summary text opens from an **ⓘ button, top-right** beside Download/Copy, as a **click popover** (keyboard and touch work). | OMQ-3 |
| D6 | **Drop the whole "Open warehouses: …" caption line** above the map. The full list stays in the Open Warehouses tab. | OMQ-3 |
| D7 | Download and Copy become **icon-only** (lucide `Download`, `Copy`) with hover title + aria-label. | OMQ-3 |
| D8 | **Two plans:** this one ships first (own merge/push/deploy); Phase 6 follows. | all |

### Bounds semantics (D1–D3)

`objective` is what the metric box shows, in display units. CBC's numbers are in raw LP units, and those can differ: in Chapter 4 coverage mode `objective` is a percentage while `solverIncumbentObjective` is covered demand (measured: `70.42` vs `54946145`). So **never print `solverBestBound` directly.** Derive the bound from the relative gap, which has no units (`achievedGap = |incumbent − bound| / |incumbent|`, `cbc_termination.py:223`):

| Case | Minimise (every mode except Ch4 `coverage`) | Maximise (`objectiveModeOfDetails(details) === "coverage"`) |
|---|---|---|
| `solutionStatus === "optimal"` | Upper = Lower = `objective`, gap 0, `provenOptimal: true` | same |
| incumbent + `achievedGap != null` | Upper = `objective`, Lower = `objective × (1 − gap)` | Lower = `objective`, Upper = `objective × (1 + gap)` |
| incumbent, no gap (feasible without evidence, legacy) | Upper = `objective`, Lower = null | Lower = `objective`, Upper = null |
| no incumbent (`!hasIncumbent`) | box not rendered | same |

---

### Task OMQ-1: Bounds box on the Output Map

**Files:**
- Create: `artifacts/studio/src/lib/solveBounds.ts`, `artifacts/studio/src/__tests__/solveBounds.test.ts`
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` (new box inside `mapRef`; extract the existing objective formatter to a local `fmtObjective(v)` so both boxes format identically), `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces — Produces:** `solveBounds(result: SolveResult): SolveBounds | null`, `type SolveBounds = { upper: number | null; lower: number | null; gap: number | null; provenOptimal: boolean }`.

- [ ] **Step 1: failing unit tests** (`solveBounds.test.ts`), one per table row above, for both senses, plus: a no-incumbent result (`solutionStatus: "infeasible"`) returns `null`; the Ch4 coverage case with `objective: 70.42, achievedGap: 0.01` gives `lower 70.42`, `upper ≈ 71.1242` (never `54946145`-scale numbers); a legacy result (`solutionStatus` absent, `status` ok) gives one bound and nulls.
- [ ] **Step 2:** run `pnpm --filter studio exec vitest run src/__tests__/solveBounds.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: implement**

```ts
import type { SolveResult } from "@workspace/api-client-react";
import { objectiveModeOfDetails } from "@/lib/formatObjective";
import { classifyResultOutcome, hasIncumbent } from "@/lib/resultOutcome";

export type SolveBounds = { upper: number | null; lower: number | null; gap: number | null; provenOptimal: boolean };

// OMQ-1 — upper/lower bound of the displayed solve, in the SAME units as
// result.objective. Derived from the unitless relative gap, never from
// solverBestBound directly: CBC's raw LP objective can differ from the
// displayed one (Ch4 coverage: % vs covered demand). Proven optimal means
// bound == objective (D3), although CBC rarely prints a bound then.
export function solveBounds(result: SolveResult): SolveBounds | null {
  const outcome = classifyResultOutcome(result);
  if (!hasIncumbent(outcome)) return null;
  const obj = result.objective;
  if (outcome === "optimal") return { upper: obj, lower: obj, gap: 0, provenOptimal: true };
  const gap = result.achievedGap ?? null;
  const maximise = objectiveModeOfDetails(result.details) === "coverage";
  const other = gap == null ? null : maximise ? obj * (1 + gap) : obj * (1 - gap);
  return maximise
    ? { upper: other, lower: obj, gap, provenOptimal: false }
    : { upper: obj, lower: other, gap, provenOptimal: false };
}
```

- [ ] **Step 4: render the box** in `OutputMapTab.tsx`, inside `mapRef`, next to the metric overlay, only when `bounds != null`:

```tsx
{bounds && (
  <div
    data-testid="output-map-bounds"
    className="absolute top-2 left-2 z-[1000] pointer-events-none bg-card rounded-md border shadow px-2.5 py-1.5 text-xs leading-tight"
  >
    <div><span className="text-muted-foreground">Upper bound: </span><span className="font-medium font-mono" data-testid="output-map-bound-upper">{bounds.upper == null ? "—" : fmtObjective(bounds.upper)}</span></div>
    <div><span className="text-muted-foreground">Lower bound: </span><span className="font-medium font-mono" data-testid="output-map-bound-lower">{bounds.lower == null ? "—" : fmtObjective(bounds.lower)}</span></div>
    <div><span className="text-muted-foreground">Gap: </span><span className="font-medium font-mono" data-testid="output-map-bound-gap">{bounds.gap == null ? "—" : `${(bounds.gap * 100).toFixed(2)}%`}{bounds.provenOptimal && " (proven optimal)"}</span></div>
  </div>
)}
```

`fmtObjective(v)` is the current inline expression at `OutputMapTab.tsx:449-451` with `result.objective` replaced by `v`, and the metric box calls it too (no behaviour change there).
- [ ] **Step 5: RTL tests** in `OutputMapTab.test.tsx`: optimal result shows equal upper/lower and "0.00% (proven optimal)"; feasible + gap shows both bounds and the gap; an infeasible result renders no `output-map-bounds`; the box is a descendant of the captured container (the element `downloadMapAsPng` receives, via the existing mock).
- [ ] **Step 6:** gate, sweep, changelog, commit `[OMQ-1] show solver upper/lower bound and gap on the Output Map`.

### Task OMQ-2: Route hover tooltip renders solid

**Files (expected):** `artifacts/studio/src/components/NetworkMap.tsx` and/or `artifacts/studio/src/index.css`, one regression test, `docs/CHANGELOG-implementation.md`. The fix location is decided by Step 1.

- [ ] **Step 1: diagnose, no edits** (`superpowers:systematic-debugging`). Start the local servers (`artifacts/studio/e2e/CLAUDE.md` recipe), solve a seeded p-median-us scenario, open the Output Map, hover a lane, in **both themes**. Record for the live `.leaflet-tooltip.nos-map-tooltip`: computed `background-color`, `opacity`, ancestor-chain `opacity`/`filter`/`mix-blend-mode`, and its pane. Take a screenshot of the hover over a dense area. Also check the CSS cascade order for the `.dark .leaflet-tooltip:not(.nos-map-tooltip)` rule (`index.css:37-42`) and anything in `leaflet.css` that applies after `index.css`.
- [ ] **Step 2: decide.** If any measured value is not fully opaque, fix the cause at its root (one rule or prop) and add a test that pins it (Playwright computed-style assertion in OMQ-4's spec, or a unit pin on the CSS string as `designTokens.test.ts` does). If every value is fully opaque, **STOP and report** to the lead with the screenshot and numbers. The lead then asks the user what they see; don't guess a change.
- [ ] **Step 3:** also fix the stale comment at `NetworkMap.tsx:847` ("Translucent"), which contradicts the solid tooltip.
- [ ] **Step 4:** gate, changelog, commit `[OMQ-2] …` (message names the root cause found).

### Task OMQ-3: Output panel chrome (info popover, no caption, icon buttons)

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` (`copyDownloadButtons` `:287-308`, caption `:428-431`, narrative `:533`), `artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx` (becomes the popover)
- Delete: `artifacts/studio/src/components/workspace/OpenSitesCaption.tsx`, `artifacts/studio/src/__tests__/OpenSitesCaption.test.tsx`
- Modify: `artifacts/studio/src/lib/openSites.ts` (remove `OPEN_SITE_NOUN`/`OPEN_SITE_NOUN_FALLBACK`, which have no other consumer; `openSiteIds` stays for `resultNarrative.ts:6`), `artifacts/studio/src/__tests__/openSites.test.ts` (drop the noun block)
- Modify: `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.OutputMap.test.tsx`, `artifacts/studio/e2e/quick-fixes.spec.ts` (QFX-8 caption checks), `artifacts/studio/e2e/design-upgrade-p2.spec.ts:767` and `design-upgrade-p3.spec.ts:783` (narrative reads go through a helper that opens the popover first), `design-upgrade-p5.spec.ts` (any hit from the sweep)
- Modify: `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: tests first.** RTL: the caption testid `output-map-open-sites` is gone; `button-download-map-png` and `button-copy-map-clipboard` have accessible names "Download PNG" / "Copy to clipboard", no visible text, and still call the download/copy handlers; `button-output-map-info` (accessible name "About this result") is present only when a narrative exists, and clicking it shows `output-map-narrative-summary` with the narrative text; Escape closes it and returns focus to the button.
- [ ] **Step 2: implement.**

```tsx
// OutputMapNarrative.tsx — NAR-1 text, now behind an ⓘ popover (OMQ-3).
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ResultNarrative } from "@/lib/resultNarrative";

export function OutputMapNarrative({ narrative }: { narrative: ResultNarrative }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="button-output-map-info" aria-label="About this result" title="About this result" className={ICON_BUTTON}>
          <Info className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="output-map-narrative" aria-label="About this result" className="w-96 max-h-80 overflow-y-auto text-xs leading-relaxed">
        <p data-testid="output-map-narrative-summary">{narrative.text}</p>
      </PopoverContent>
    </Popover>
  );
}
```

`ICON_BUTTON = "grid size-8 place-items-center rounded border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"`, exported from `OutputMapNarrative.tsx` and reused for Download (`<Download className="size-4" aria-hidden="true" />`, `aria-label`/`title` "Download PNG") and Copy (`<Copy …/>`, "Copy to clipboard"). Render order inside the existing `ml-auto` group: Info, Download, Copy. Remove the `<OpenSitesCaption …/>` line, its import, the bottom `{narrative && <OutputMapNarrative …/>}`, and the QFX-8 comment.
- [ ] **Step 3: e2e helper.** In each e2e spec that reads the narrative, add `async function readNarrative(page)` that clicks `button-output-map-info` and reads `output-map-narrative-summary`, then presses Escape. p3's filter-aware narrative test re-opens after each map click (an outside click closes the popover). Replace the QFX-8 caption assertions in `quick-fixes.spec.ts` with "caption absent".
- [ ] **Step 4:** gate (incl. `typecheck:e2e`), sweep, changelog, commit `[OMQ-3] Output Map: summary behind an info popover, icon buttons, drop the open-sites caption`.

### Task OMQ-4: Real-browser QA (qa-sdet)

New spec `artifacts/studio/e2e/output-map-quick-fixes.spec.ts`, plus running the rewritten sibling specs green. Cover, in **light and dark**:
- the bounds box on an optimal solve (Upper = Lower = the metric box's Objective, "0.00% (proven optimal)"), and on a seeded `feasible` + `achievedGap` result for one minimise and the Ch4 coverage (maximise) model; absent on an infeasible result;
- the downloaded PNG contains the bounds box (pixel or size diff against a capture with the box hidden is acceptable; assert the box is inside the captured node at minimum);
- the lane tooltip's computed background/opacity per OMQ-2's finding, with a screenshot over a dense area;
- the info button opens/closes the summary with mouse, Enter and Escape; Download/Copy icon buttons work with keyboard and carry their names; the caption is gone;
- phone width (390 px): the toggle row wraps without horizontal scroll and the icon buttons stay reachable.

Seed solver results rather than running real CBC (`e2e/CLAUDE.md`). Commit `[OMQ-4] …` with the changelog entry.

## Close-out

1. `superpowers:finishing-a-development-branch` once OMQ-1–4 are green, then **STOP for merge approval**.
2. On approval: re-fetch, rebase `output-map-qf` onto `origin/main`, merge to local `main`, whole-branch review on the merged state (Opus + `ponytail-review`), fixes go back on the branch (Step 5a).
3. `/harness-retro OMQ`.
4. Push: separate approval, after the PRIV-1 scan (`git log origin/main..HEAD -p | grep -i -E '<pattern>'`).
5. Deploy `nos-studio` only: separate approval with `pnpm deploy:preflight -- <deployed-sha>..HEAD`. Re-fetch `origin/main` right before `trigger_deploy` (Render builds the tip). `nos-api` is untouched by this range.
