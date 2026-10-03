# Cosmetic UI Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five cosmetic/UX changes — remove the workspace tab strip, move Chapter 4's step toggle beside Save, swap the favicon, add a feedback widget whose rows carry no identity, and animate a network background behind the homepage.

**Architecture:** Four of the five are frontend-only edits in `artifacts/studio`. The feedback widget is contract-first and spans four packages: the OpenAPI spec generates the Zod validator and the React Query hook, a new Drizzle table stores body + timestamp only, and a new Express route authenticates the caller purely to rate-limit them. Each item is one commit and one rollback point.

**Tech Stack:** React 18 + Vite + Tailwind + Radix (studio), Express 5 + Drizzle + Postgres (api-server), Orval codegen from `lib/api-spec/openapi.yaml`, vitest + RTL (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-03-cosmetic-ui-bundle-design.md` — read it before Task 1. It is the normative contract; this plan is the execution order.

## Global Constraints

- **Branch:** all work lands on `cosmetic-ui` in worktree `/Users/shubhamkr/nos-cosmetic`. Before every `git commit`, assert you are not on `main`:
  `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
- **One task = one commit.** Message format `[<task-id>] <imperative summary>`, ending with the line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Never edit generated code.** Anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` comes from Orval. Change `lib/api-spec/openapi.yaml`, re-run codegen, commit spec + output together.
- **Never delegate to GLM in this repo** (`.claude/glm-delegation-disabled.md`).
- **Do not touch** `attached_assets/`, `.replit`, `replit.md`, `push-to-github.mjs`.
- **Every timestamp column is `timestamptz`** — `timestamp(name, { withTimezone: true })`. A naked `timestamp` reads back skewed by the database's UTC offset.
- **Local dev DB:** no `DATABASE_URL` in the environment by default. Pass it inline per command: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.
- **Studio vitest is load-sensitive.** Before trusting a full-suite result, require zero concurrent runs: `ps aux | grep "[v]itest" | grep -v "zsh -c"` — read the rows; a bare `grep -c` also matches the agent's own wrapper and reports 2 when the answer is 0.
- **Playwright results come from `artifacts/studio/e2e/report/results.json`** (`stats.unexpected`, `stats.flaky`), never the console tail, which folds retried failures away silently.
- **No merge, push, or deploy.** Those are three separate human approvals and none is in scope for this plan.

---

## File Structure

**Task 1 — tab strip**
- Delete: `artifacts/studio/src/components/workspace/TabBar.tsx`, `artifacts/studio/src/__tests__/TabBar.test.tsx`, `artifacts/studio/src/lib/workspaceTabs.ts`, `artifacts/studio/src/__tests__/workspaceTabs.test.ts`
- Create: `artifacts/studio/src/lib/workspaceView.ts` — the `WorkspaceView` type and its id helper, the only survivors of the deleted reducer module
- Modify: `artifacts/studio/src/pages/Workspace.tsx`, `artifacts/studio/src/__tests__/Workspace.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx`, `artifacts/studio/e2e/bundle6-ui-tweaks.spec.ts`, `artifacts/studio/e2e/jade-transport-costs.spec.ts`, `docs/design-system/*`

**Task 2 — step toggle**
- Modify: `artifacts/studio/src/components/workspace/StepToggle.tsx`, `artifacts/studio/src/pages/Workspace.tsx`, `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (note the `tabs/` segment), `artifacts/studio/src/__tests__/StepToggle.test.tsx`, `artifacts/studio/src/__tests__/Workspace.test.tsx`, `artifacts/studio/e2e/max-coverage.spec.ts`

**Task 3 — favicon**
- Add: `artifacts/studio/public/global-network.png` (already present, untracked)
- Modify: `artifacts/studio/index.html`

**Task 4 — feedback**
- Create: `lib/db/src/schema/feedback.ts`, `artifacts/api-server/src/routes/feedback.ts`, `artifacts/api-server/src/__tests__/feedback.test.ts`, `artifacts/studio/src/components/FeedbackWidget.tsx`, `artifacts/studio/src/__tests__/FeedbackWidget.test.tsx`, `artifacts/studio/e2e/feedback.spec.ts`
- Modify: `lib/db/src/schema/index.ts`, `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/__tests__/timestampClock.test.ts`, `artifacts/api-server/src/__tests__/schemaColumns.test.ts`, `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/__tests__/AppShell.test.tsx`
- Regenerated: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`
- **Not** modified: `Landing.test.tsx` / `Landing.lockedRendering.test.tsx`. Both render `<Landing />` directly, not through `AppShell`, and `Landing.tsx` imports only the two landing hooks — so neither suite ever instantiates the widget. `AppShell.test.tsx` is the suite that does.

**Task 5 — background**
- Create: `artifacts/studio/src/components/NetworkBackground.tsx`, `artifacts/studio/src/__tests__/NetworkBackground.test.tsx`
- Modify: `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/__tests__/AppShell.test.tsx` (adds one assertion only — Task 4 already repaired this suite)

**Dependency edges:** Task 4 introduces the `relative` wrapper in `AppShell` that Task 5 mounts into; Task 5 must not re-create it, and there is **no reverse-order fallback** — Task 4 patches the exact original `<main>` at `AppShell.tsx:83`, a target Task 5 would destroy if it went first. Run 4 before 5. Task 4's order within itself is schema → API → codegen → frontend. Tasks 1, 2, 3 are independent of everything else.

---

## Task 1: Remove the workspace tab strip

**Files:**
- Create: `artifacts/studio/src/lib/workspaceView.ts`
- Delete: `artifacts/studio/src/lib/workspaceTabs.ts`, `artifacts/studio/src/__tests__/workspaceTabs.test.ts`, `artifacts/studio/src/components/workspace/TabBar.tsx`, `artifacts/studio/src/__tests__/TabBar.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (lines 44, 99-105, 2364-2368, 2515-2529, 4616-4621, 4676)
- Test: `artifacts/studio/src/__tests__/Workspace.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx`, `artifacts/studio/e2e/bundle6-ui-tweaks.spec.ts`, `artifacts/studio/e2e/jade-transport-costs.spec.ts`

**Interfaces:**
- Produces: `artifacts/studio/src/lib/workspaceView.ts` exports `type WorkspaceViewKind = "input" | "output" | "report"`, `interface WorkspaceView { id: string; kind: WorkspaceViewKind; entity: string; label: string }`, and `function workspaceViewId(kind: WorkspaceViewKind, entity: string): string`. Nothing outside `Workspace.tsx` consumes these.
- Consumes: nothing from other tasks.

### Preflight — two blockers that must be resolved before any code

- [ ] **Step 1: Resolve the PostHog event dependency**

Deleting `handleActivateTab` retires the `"scenario tab viewed"` event. Static search finds it only in code and historical docs, which does **not** prove no live insight consumes it.

Run the repo's standing PostHog workflow:

```bash
posthog-cli api --agent-help
posthog-cli api skill list
```

Install any matching skill, then schema-discover `system.insights` before querying it, search saved insight definitions for the exact string `scenario tab viewed`, and resolve each match's dashboard consumers.

**Decision gate — pick one and record it in the commit body:**
- No live consumer → delete the event with `handleActivateTab` (the default path this plan assumes).
- Live consumer exists → **STOP and ask the user** whether to retire the insight, migrate to a new view-navigation event, or keep the name. Do not proceed on your own judgement.

**If `POSTHOG_CLI_API_KEY`/`POSTHOG_CLI_PROJECT_ID` are not configured**, this check cannot run. Do not guess — report that to the user and ask how to proceed.

Do **not** move the event into `openTab` as a workaround: that silently changes its meaning from "reactivated an already-open tab" to "opened a view from the sidebar" and corrupts historical trends.

- [ ] **Step 2: Confirm `StaleOutputBanner` keeps a reachable caller — it does; this is a confirmation, not an open question**

This was resolved during review. `Workspace.tsx:4071-4076` states the contract in its own comment:

> blank this tab's real content behind the stale banner whenever the scenario's outputs aren't trustworthy (unsolved or stale), **even if the tab was already open+active from before the scenario transitioned to stale**

and `:4084-4085` acts on it:

```tsx
      if (!stepState.isMaxCoverage && !hasFreshSolvedRun) {
        return <StaleOutputBanner onRunOptimizer={openSolveDialog} />;
      }
```

The banner **replaces** the output content rather than annotating it. So the spec's "stale outputs are unreachable" is satisfied by two mechanisms that both survive this task: the sidebar refuses navigation *to* a stale output, and this branch refuses to render stale *content* in a view that was already active. No redirect effect, no `useEffect` clearing `activeView`, and no new derived boolean are needed — adding one would be redundant with a guard that already works.

**Therefore: leave `StaleOutputBanner.tsx` and `StaleOutputBanner.test.tsx` completely untouched.** Confirm with the two commands below that the branches still read as quoted, then move on. If they do not, stop and re-open the question.

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
sed -n 4070,4086p src/pages/Workspace.tsx
sed -n 4236,4248p src/pages/Workspace.tsx
```

### Implementation

- [ ] **Step 3: Create the surviving type module**

Create `artifacts/studio/src/lib/workspaceView.ts`:

```ts
// COSM-1 — the active-view type, all that survives of the deleted
// workspaceTabs reducer. Workspace.tsx holds one active view at a time in
// plain useState; there is no tab strip and no multi-view state.

export type WorkspaceViewKind = "input" | "output" | "report";

export interface WorkspaceView {
  id: string;
  kind: WorkspaceViewKind;
  /** Model-specific entity slug this view shows, e.g. "warehouses", "flows". */
  entity: string;
  label: string;
}

/** Deterministic id for a (kind, entity) pair. */
export function workspaceViewId(kind: WorkspaceViewKind, entity: string): string {
  return `${kind}:${entity}`;
}
```

- [ ] **Step 4: Write the failing test for single-view navigation**

Add to `artifacts/studio/src/__tests__/Workspace.test.tsx`, inside the existing top-level `describe` (match the file's existing render helper and mock setup — read the file first and reuse them verbatim rather than inventing a new harness):

```tsx
it("renders no tab strip and swaps the content region on sidebar navigation", async () => {
  renderWorkspace(); // reuse this file's existing helper
  const user = userEvent.setup();

  // The strip and its empty-state placeholder are both gone for good.
  expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("tab-bar-empty")).not.toBeInTheDocument();

  // Input Map is the seeded initial view — assert its OWN content testid,
  // not the generic region wrapper.
  expect(await screen.findByTestId("input-map-tab")).toBeInTheDocument();
  expect(screen.getByTestId("sidebar-input-input-map")).toHaveAttribute("aria-current", "true");

  // Clicking another sidebar entry swaps the CONTENT, not just the sidebar
  // highlight. Asserting aria-current alone would pass even if the content
  // region never changed, because the highlight derives straight from
  // activeEntityId (SidebarTree.tsx:104-114) — independently of what renders.
  await user.click(screen.getByTestId("sidebar-input-warehouses"));
  await waitFor(() => expect(screen.queryByTestId("input-map-tab")).not.toBeInTheDocument());
  expect(screen.getByTestId("sidebar-input-warehouses")).toHaveAttribute("aria-current", "true");
});
```

Before writing it, confirm the warehouses view's own content testid and use it as a positive assertion too:

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
grep -rn 'data-testid="warehouse' src/components/workspace/tabs/ | head -5
```

- [ ] **Step 5: Run it and confirm it fails**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm --filter studio test -- Workspace.test.tsx -t "renders no tab strip"
```

Expected: FAIL — `tab-bar-empty` or `tab-bar` is found in the document.

- [ ] **Step 6: Replace the reducer with active-view state**

In `artifacts/studio/src/pages/Workspace.tsx`, replace the import block at lines 100-105:

```tsx
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";
```

with:

```tsx
import { workspaceViewId, type WorkspaceView } from "@/lib/workspaceView";
```

Replace lines 2364-2368:

```tsx
  const [tabState, dispatch] = useReducer(workspaceTabsReducer, initialWorkspaceTabState);
  const activeTab = useMemo(
    () => tabState.tabs.find(t => t.id === tabState.activeTabId) ?? null,
    [tabState.tabs, tabState.activeTabId],
  );
```

with:

```tsx
  // COSM-1 — one active view at a time. The tab strip is gone, so there is no
  // multi-view state to reconcile: the sidebar is the only navigator and
  // openTab() below simply replaces what is on screen.
  const [activeTab, setActiveTab] = useState<WorkspaceView | null>(null);
```

Replace `openTab` and `handleActivateTab` (lines 2515-2529) with:

```tsx
  function openTab(kind: WorkspaceView["kind"], entry: SidebarEntry) {
    setActiveTab({ id: workspaceViewId(kind, entry.id), kind, entity: entry.id, label: entry.label });
  }
```

The seven existing `openTab(...)` call sites (`:2542`, `:2745`, `:2783`, `:2827`, `:3228`, `:4608`, `:4609`) need no change — the signature is unchanged.

- [ ] **Step 7: Remove the TabBar mount and import**

Delete line 44 of `Workspace.tsx`:

```tsx
import { TabBar } from "@/components/workspace/TabBar";
```

Delete the mount at lines 4616-4621:

```tsx
          <TabBar
            tabs={tabState.tabs}
            activeTabId={tabState.activeTabId}
            onActivate={handleActivateTab}
            onClose={id => dispatch({ type: "close", id })}
          />
```

Update the empty-state copy at line 4676 from:

```tsx
                  <span className="text-muted-foreground">Pick an item from the sidebar to open it as a tab.</span>
```

to:

```tsx
                  <span className="text-muted-foreground">Pick an item from the sidebar to view it.</span>
```

- [ ] **Step 8: Delete the dead modules**

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
rm src/components/workspace/TabBar.tsx src/__tests__/TabBar.test.tsx
rm src/lib/workspaceTabs.ts src/__tests__/workspaceTabs.test.ts
```

- [ ] **Step 9: Rename `activeTab` to `activeView`**

Only now, after `activeTabId` no longer exists anywhere in the file — a rename done earlier would corrupt `activeTabId`, which contains `activeTab` as a prefix.

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
grep -c "activeTabId" src/pages/Workspace.tsx   # must print 0 before proceeding
perl -pi -e 's/\bactiveTab\b/activeView/g' src/pages/Workspace.tsx
grep -c "activeView" src/pages/Workspace.tsx     # expect ~59
```

Also rename `setActiveTab` → `setActiveView` (the `\b` boundary above leaves it alone because `setActiveTab` is one word):

```bash
perl -pi -e 's/\bsetActiveTab\b/setActiveView/g' src/pages/Workspace.tsx
```

**Two manual repairs the rename cannot do for itself:**

1. **It corrupts a comment that quotes a *different* file's variable.** `Workspace.tsx:4064-4066` reads `mirrors Studio.tsx's \`activeTab === "output" ? result : null\` guard, Studio.tsx:1544/1554`. That `activeTab` belongs to `Studio.tsx:267`, which this task does not touch, so rewriting it to `activeView` makes the comment describe a symbol that does not exist. Restore that one occurrence by hand after the rename:

```bash
grep -n 'Studio.tsx' src/pages/Workspace.tsx | grep -i activeview
```

   Any hit there is a false positive — put `activeTab` back.

2. **`useReducer` becomes an unused import.** Line 1 is `import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";` — drop `useReducer`, keep the rest (`useMemo` still has many consumers). `noUnusedLocals` is `false` in this repo, so neither typecheck nor lint will force this.

- [ ] **Step 10: Typecheck**

```bash
cd /Users/shubhamkr/nos-cosmetic && pnpm run typecheck
```

Expected: PASS. Any error naming `workspaceTabs`, `tabState`, or `dispatch` means a call site was missed — fix it before continuing.

- [ ] **Step 11: Run the new test and confirm it passes**

```bash
pnpm --filter studio test -- Workspace.test.tsx -t "renders no tab strip"
```

Expected: PASS.

### Rewrite the existing tests

- [ ] **Step 12: Rewrite the strip assertions in `Workspace.test.tsx`**

Four sites, each asserting the strip rather than the thing the test is actually about. Open each and rewrite:

- `:1797-1799` — solve success asserts the Output Map strip button and `aria-selected`. Replace with an assertion that the Output Map **content** rendered and that `sidebar-output-output-map` carries `aria-current="true"`.
- `:1819` — failed solve asserts **no** Output Map strip button. Replace with a positive assertion about what the content region shows after a failed solve (read the branch in `renderTabContent()` to get it right).
- `:2543-2556` — one-shot seed plus close-last-tab. Replace with a single positive assertion that Input Map content is the initial active view. **Delete the close-behavior case** — closing is gone.
- `:3469-3475` — solve overlay success asserts the strip button. Replace with the content-surface assertion, as `:1797`.

Rewrite against the content surface and the active sidebar row, not merely the absence of old testids — "the old testid is gone" passes trivially and proves nothing.

- [ ] **Step 13: Delete the reactivation analytics case**

In `artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx`, delete the case at `:234-251` covering `"scenario tab viewed"`. Only do this if Step 1's decision gate cleared it.

- [ ] **Step 14: Run the full studio suite**

```bash
cd /Users/shubhamkr/nos-cosmetic
ps aux | grep "[v]itest" | grep -v "zsh -c"   # must print nothing
pnpm --filter studio test
```

Expected: PASS. If unrelated shared components (`DistancesTab`, `JadeFlowsTab`, `CustomerTable`, …) time out at 5000ms, that is the known concurrent-run flake — re-check for other vitest processes and re-run before investigating.

- [ ] **Step 15: Rewrite `bundle6-ui-tweaks.spec.ts`**

Lines 142-188 cover title, seed, close, empty-strip, and no-reopen behavior. Rewrite to drive navigation from the sidebar. Delete the close and empty-strip assertions outright — that behavior no longer exists. Keep the title and seed assertions, re-expressed against `sidebar-*` testids and the content region.

- [ ] **Step 16: Rewrite the stale-output half of `jade-transport-costs.spec.ts`**

Lines 145-154 assert both halves of the stale-output contract. Keep the sidebar half, delete the strip half:

```ts
    // COSM-1 — the sidebar disablement is now the ONLY stale signal. The
    // open-tab strip that used to offer a second, still-clickable route back
    // to a stale Cost Summary (and its StaleOutputBanner) was removed by this
    // bundle; stale outputs are deliberately unreachable until a re-solve.
    await expect(page.getByTestId("sidebar-output-cost-summary")).toBeDisabled({ timeout: HEADER_TIMEOUT });
```

Delete the `tab-output:cost-summary` click and the `stale-output-banner` assertion that follow it. Leave the rest of the spec, including the post-re-solve assertions, untouched.

- [ ] **Step 17: Run the two rewritten e2e specs**

Start the servers first (two terminals, or background them):

```bash
cd /Users/shubhamkr/nos-cosmetic
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev
```

Then:

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
E2E_BASE_URL=http://localhost:5174 npx playwright test bundle6-ui-tweaks.spec.ts jade-transport-costs.spec.ts
```

Expected: PASS. `jade-transport-costs.spec.ts` is on the known-flaky list — if it fails, re-run it alone before treating it as a regression.

- [ ] **Step 18: Correct the design-system documentation**

```bash
cd /Users/shubhamkr/nos-cosmetic
rg -n 'TabBar|tab-bar' docs/design-system
```

Update `docs/design-system/DECISIONS.md`, `docs/design-system/readme.md`, and `docs/design-system/github.md` so the app-to-component mapping no longer claims the app uses `TabBar`. Check the docs-audit inventory's ownership before editing any generated file — if a file is generated, regenerate it rather than hand-editing. Leave historical material under `docs/superpowers/specs/**` and `plans/**` untouched. A standalone design-system `TabBar` example may remain as a library artifact.

- [ ] **Step 19: Run the dependency sweep**

```bash
cd /Users/shubhamkr/nos-cosmetic
rg -n 'TabBar|tab-bar|tab-close-|tab-input:|tab-output:|scenario tab viewed' artifacts/studio docs/design-system
rg -n 'workspaceTabsReducer|workspaceTabId|initialWorkspaceTabState' artifacts/studio/src
```

Expected: no hits in `artifacts/studio/src`, no hits in current design-system docs. Hits inside `artifacts/studio/e2e` are only acceptable if they are `tab-content-*` testids, which survive.

- [ ] **Step 20: Commit**

```bash
cd /Users/shubhamkr/nos-cosmetic
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/studio/src artifacts/studio/e2e docs/design-system
git status --short
git diff --cached --stat
```

Read the staged list before writing the message. Then commit with `[COSM-1] remove the workspace tab strip`, recording in the body: the PostHog decision and its evidence, the `StaleOutputBanner` reachability finding, and that stale outputs are now deliberately unreachable until re-solve.

---

## Task 2: Move Chapter 4's step toggle into the toolbar row

**Files:**
- Modify: `artifacts/studio/src/components/workspace/StepToggle.tsx`, `artifacts/studio/src/pages/Workspace.tsx` (lines ~2498, ~4544-4551, ~4622-4648), `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx`
- Test: also `artifacts/studio/e2e/max-coverage.spec.ts` — `:389` scopes Save by DOM ancestry inside the Layers row and breaks when this task moves it
- Test: `artifacts/studio/src/__tests__/StepToggle.test.tsx`, `artifacts/studio/src/__tests__/Workspace.test.tsx`

**Interfaces:**
- Consumes: Task 1's `activeView` state. Line numbers below shift by Task 1's deletions — locate by content, not by number.
- Produces: `InputMapTab` gains a `showInlineSave?: boolean` prop (default `true`); nothing else consumes it.

- [ ] **Step 1: Write the failing test for light-surface styling**

Add to `artifacts/studio/src/__tests__/StepToggle.test.tsx`. That file has **no render helper** — every case calls `render(<StepToggle .../>)` directly and reuses two module-level fixtures declared at its top:

```tsx
const unsolved = { solved: false, stale: false, jobId: null, summary: null };
const solved = { solved: true, stale: false, jobId: 1, summary: null };
```

Follow that style exactly (`onSelect` and `steps` are both required props):

```tsx
it("styles the inactive step for a light surface, not the dark band", () => {
  render(<StepToggle selected={1} onSelect={vi.fn()} solvedCount={1} steps={{ step1: solved, step2: unsolved }} />);
  const inactive = screen.getByTestId("step-toggle-2");
  // --ink-300 on --surface-sunken is 2.01:1 — unreadable. The light-surface
  // tokens must be used instead.
  expect(inactive.className).not.toMatch(/ink-300/);
  expect(inactive.className).not.toMatch(/hover:bg-white\/10/);
  expect(inactive.className).toMatch(/text-muted-foreground/);
  expect(inactive.className).toMatch(/hover:bg-muted/);
  expect(screen.getByTestId("text-steps-solved-counter").className).not.toMatch(/ink-300/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm --filter studio test -- StepToggle.test.tsx -t "light surface"
```

Expected: FAIL — the className still contains `ink-300`.

- [ ] **Step 3: Restyle `StepToggle` for the light toolbar**

In `artifacts/studio/src/components/workspace/StepToggle.tsx`, change the group wrapper's border from `border-[color:var(--ink-500)]` to `border-border`, the inactive button classes from:

```tsx
                  : "bg-transparent text-[color:var(--ink-300)] hover:bg-white/10"
```

to:

```tsx
                  : "bg-transparent text-muted-foreground hover:bg-muted"
```

and the counter's class from `text-[color:var(--ink-300)]` to `text-muted-foreground`. Leave the selected branch (`bg-primary text-white`), the lock icon, the stale marker, and every testid exactly as they are.

No surface-variant prop: there is one mount, so a variant would be speculative API.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter studio test -- StepToggle.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 5: Write the failing test for toolbar placement**

Add to `artifacts/studio/src/__tests__/Workspace.test.tsx`. Use the file's **existing** helpers: `renderCh4Workspace(scenarios, activeId?)` (`:250`) with the `ch4Scenario(...)` factory from `./helpers/ch4` (`:232`) for Chapter 4, and the parameterless `renderWorkspace()` (`:241`), which is hardcoded to `p-median-us`. There is no `renderWorkspace({ modelId })` overload — do not invent one.

```tsx
it("shows the Chapter 4 step toggle on an output view, where Save does not render", async () => {
  renderCh4Workspace([ch4Scenario({ steps: { step1: { solved: true }, step2: { solved: false } } })]);
  const user = userEvent.setup();

  await user.click(await screen.findByTestId("sidebar-output-output-map"));

  expect(screen.getByTestId("step-toggle")).toBeInTheDocument();
  expect(screen.getByTestId("text-steps-solved-counter")).toBeInTheDocument();
  expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
});

it("shows the Chapter 4 step toggle beside Save on the Input Map view", async () => {
  renderCh4Workspace([ch4Scenario({ steps: { step1: { solved: true }, step2: { solved: false } } })]);

  // Input Map is the seeded initial view; Save moves out of the Layers row
  // and into the shared toolbar for this model only.
  expect(await screen.findByTestId("step-toggle")).toBeInTheDocument();
  expect(screen.getByTestId("button-save")).toBeInTheDocument();
});

it("leaves p-median-us Save INSIDE the Layers row and shows no step toggle", async () => {
  renderWorkspace(); // parameterless — this helper is p-median-us

  // Containment, not mere presence. A bare getByTestId("button-save") would
  // still pass if p-median's Save accidentally moved into the shared toolbar
  // — exactly the regression this case exists to catch. Precedent:
  // Workspace.InputMapV2.test.tsx:153-166.
  const saveButton = await screen.findByTestId("button-save");
  expect(screen.getByTestId("pmedian-map-toolbar")).toContainElement(saveButton);
  expect(screen.queryByTestId("step-toggle")).not.toBeInTheDocument();
});
```

- [ ] **Step 5b: Rewrite the existing Chapter 4 inline-Save test, which would otherwise go false-green**

`Workspace.test.tsx:2867-2879` is titled "renders … an inline Save in its Layers row", but it only asserts that `pmedian-map-toolbar` exists and that exactly one global `button-save` is present. After this task relocates Chapter 4's Save, **it still passes while its name and comments have become false** — the worst failure mode for a regression test.

Rewrite it to assert containment explicitly: for `max-coverage-us`, the Save button must be present and **not** contained by `pmedian-map-toolbar`, and must sit in the same row as `step-toggle`.

Read `ch4Scenario`'s own signature in `./helpers/ch4` before writing the `steps` fixture — match its shape rather than the illustrative one above if they differ.

- [ ] **Step 6: Run and confirm they fail**

```bash
pnpm --filter studio test -- Workspace.test.tsx -t "step toggle"
```

Expected: FAIL — the toggle is still in the header, so it is absent from the toolbar row on an output view.

- [ ] **Step 7: Remove the header mount**

In `Workspace.tsx`, delete the whole block (currently `:4544-4551`, including its `ch4-2s-7` comment):

```tsx
            {stepState.isMaxCoverage && stepState.steps && (
              <StepToggle
                selected={selectedStep}
                onSelect={setSelectedStep}
                solvedCount={stepState.solvedCount}
                steps={stepState.steps}
              />
            )}
```

- [ ] **Step 8: Drop `max-coverage-us` from the Layers-row Save condition**

Change the `saveInLayersRow` definition (currently `:2497-2498`):

```tsx
  const saveInLayersRow =
    activeView?.kind === "input" && activeView.entity === "input-map" && (modelId === "p-median-us" || modelId === "p-median-brazil" || modelId === "max-coverage-us");
```

to:

```tsx
  // COSM-2 — max-coverage-us is deliberately NOT in this list any more. Its
  // Save moves into the shared toolbar row so it sits beside the step toggle
  // on every Chapter 4 view. p-median-us/p-median-brazil keep their inline
  // Layers-row Save unchanged; the condition is per-model and they are
  // untouched.
  const saveInLayersRow =
    activeView?.kind === "input" && activeView.entity === "input-map" && (modelId === "p-median-us" || modelId === "p-median-brazil");
```

- [ ] **Step 9: Suppress `InputMapTab`'s inline Save for Chapter 4**

`InputMapTab`'s Layers row is shared with `p-median-us` and `p-median-brazil`, so the inline Save must be suppressed by a prop, never deleted.

The file is `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` — note the **`tabs/`** segment; `Workspace.tsx:60` imports from `@/components/workspace/tabs/InputMapTab`. Its props are **not** an interface: `InputMapTabProps` is a discriminated union, one variant per model's map surface, declared at `InputMapTab.tsx:122`:

```tsx
export type InputMapTabProps =
  | {
      mode: "pmedian";
      …
```

So the new prop goes on the **`"pmedian"` variant only** (the variant `max-coverage-us` routes through), not on a shared interface:

```tsx
  | {
      mode: "pmedian";
      // …existing fields unchanged…
      /** COSM-2 — false for max-coverage-us, whose Save lives in the shared
          toolbar row beside the step toggle. Optional and defaulted true, so
          p-median-us and p-median-brazil are untouched. */
      showInlineSave?: boolean;
    }
```

Then destructure `showInlineSave = true` in the component that renders this variant (`PMedianInputMap`) and wrap the Layers-row Save control in `{showInlineSave && ( … )}`. At the `<InputMapTab mode="pmedian" …>` call site in `Workspace.tsx`, pass `showInlineSave={modelId !== "max-coverage-us"}`.

Confirm the variant and the inner component name before editing:

```bash
cd /Users/shubhamkr/nos-cosmetic/artifacts/studio
sed -n 122,145p src/components/workspace/tabs/InputMapTab.tsx
grep -n "function PMedianInputMap\|button-save" src/components/workspace/tabs/InputMapTab.tsx | head
```

- [ ] **Step 10: Render the toggle in the toolbar row**

Change the toolbar row's condition (currently `:4622`) from:

```tsx
          {isEditableInputTab && !saveInLayersRow && !saveInLayersRowTransport && !saveInLayersRowTwoEchelon && !saveInLayersRowJade && (
```

to:

```tsx
          {/* COSM-2 — on max-coverage-us this row renders on EVERY view so the
              step toggle is always present; Save still appears only where it
              is meaningful. Every other model keeps the original condition. */}
          {((stepState.isMaxCoverage && stepState.steps) ||
            (isEditableInputTab && !saveInLayersRow && !saveInLayersRowTransport && !saveInLayersRowTwoEchelon && !saveInLayersRowJade)) && (
```

Change the row's own container from:

```tsx
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-b flex-shrink-0 bg-muted/10">
```

to:

```tsx
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b flex-shrink-0 bg-muted/10">
              {stepState.isMaxCoverage && stepState.steps && (
                <StepToggle
                  selected={selectedStep}
                  onSelect={setSelectedStep}
                  solvedCount={stepState.solvedCount}
                  steps={stepState.steps}
                />
              )}
              <div className="flex items-center gap-2 ml-auto">
```

and close that inner `<div>` after the existing Save `<Button>`, before the row's closing `</div>`. The unsaved-changes `<span>` and the Save `<Button>` keep their existing conditions — on an output view with no editable input, both are simply absent and the inner wrapper renders empty.

- [ ] **Step 11: Run the tests**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm run typecheck
pnpm --filter studio test -- Workspace.test.tsx StepToggle.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Sweep for `button-save` paths this could have moved**

```bash
cd /Users/shubhamkr/nos-cosmetic
rg -n 'StepToggle|step-toggle|text-steps-solved-counter|button-save|saveInLayersRow' artifacts/studio/src artifacts/studio/e2e
```

Classify every `button-save` hit by model and active entity. Chapter 4's Input Map Save has moved from the Layers row to the shared toolbar — any e2e spec that locates it *within* the Layers row, or asserts the header contains the step toggle, must be updated. The testids themselves are unchanged, so specs that only locate by testid keep working.

**One confirmed casualty, already identified:** `e2e/max-coverage.spec.ts:389` scopes Save to the Layers row by DOM ancestry:

```ts
        const mapSave = page.locator('[data-testid="input-map-tab"] [data-testid="button-save"]');
```

After this task that descendant selector matches nothing, and the `toBeEnabled` on the next line fails. Rewrite it to locate the Save in the shared toolbar row instead, and update the comment above it (which currently explains the `saveInLayersRow` gate that no longer applies to this model).

- [ ] **Step 13: Run the full studio suite and the Chapter 4 e2e**

```bash
ps aux | grep "[v]itest" | grep -v "zsh -c"   # must print nothing
pnpm --filter studio test
cd artifacts/studio && E2E_BASE_URL=http://localhost:5174 npx playwright test max-coverage
```

Expected: PASS. **`E2E_BASE_URL` is not optional.** `playwright.config.ts:3-5` defaults to a remote Replit deployment and the config declares no `webServer`, so omitting it runs the spec against the OLD deployed UI — which still has Chapter 4's Save in the Layers row and would pass while never exercising this task at all.

- [ ] **Step 14: Browser-check at 375 px**

With the dev servers running, open Chapter 4 at a 375 px viewport and confirm: the toolbar row wraps rather than overflowing; the toggle and Save are both reachable; the inactive step label is legible against the light row.

- [ ] **Step 15: Commit**

```bash
cd /Users/shubhamkr/nos-cosmetic
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src artifacts/studio/e2e
git diff --cached --stat
```

Stage `artifacts/studio/e2e` too — the `max-coverage.spec.ts` rewrite from Step 12 lives there and would otherwise be left out of the commit that breaks it.

Commit as `[COSM-2] move chapter 4 step toggle into the always-visible toolbar row`, noting in the body that Chapter 4's Input Map Save relocated from the Layers row to the shared row and that p-median-us/p-median-brazil are unaffected.

---

## Task 3: Use the network mark as the browser tab icon

**Files:**
- Add: `artifacts/studio/public/global-network.png` (present, untracked)
- Modify: `artifacts/studio/index.html:15`

**Interfaces:** none — no code imports this asset.

- [ ] **Step 1: Verify the asset is the intended file**

```bash
cd /Users/shubhamkr/nos-cosmetic
shasum -a 256 artifacts/studio/public/global-network.png
file artifacts/studio/public/global-network.png
```

Expected exactly:
```
c34fa79ad77acb7bdad9bd114cd362be280f209559e6309ee7ecf9fd9793d864  artifacts/studio/public/global-network.png
PNG image data, 16 x 16, 8-bit/color RGBA, non-interlaced
```

If the SHA differs, STOP — the file was replaced and the user must confirm the new one.

- [ ] **Step 2: Repoint the favicon**

In `artifacts/studio/index.html`, change:

```html
    <link rel="icon" type="image/png" href="/book-cover.png" />
```

to:

```html
    <link rel="icon" type="image/png" href="/global-network.png" />
```

Leave `public/book-cover.png` in place (now unreferenced; removal is out of scope), and leave `favicon.svg`, `opengraph.jpg`, and every Open Graph meta tag untouched.

- [ ] **Step 3: Build and verify the asset ships**

`vite.config.ts:7-27` throws unless **both** `PORT` and `BASE_PATH` are set, so a bare `pnpm --filter studio build` fails before it reads a single file:

```bash
cd /Users/shubhamkr/nos-cosmetic
PORT=5174 BASE_PATH=/ pnpm --filter studio build
ls -l artifacts/studio/dist/public/global-network.png
grep -o '/global-network.png' artifacts/studio/dist/public/index.html
```

Expected: the file exists in `dist/public/`, and the grep prints `/global-network.png`. If `dist/` is laid out differently, locate the built `index.html` and assert against that path instead.

- [ ] **Step 4: Verify it serves over HTTP**

With the studio dev server running:

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:5174/global-network.png
```

Expected: `200 image/png`.

- [ ] **Step 5: Confirm in browser chrome**

Hard-reload the homepage (cache-bypassing) and confirm the tab shows the green network mark, not the book cover. This is the only check that proves the end result; the 16×16 source will look soft on a HiDPI display, which is expected and accepted.

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/nos-cosmetic
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/public/global-network.png artifacts/studio/index.html
git diff --cached --stat
```

Commit as `[COSM-3] use the network mark as the browser tab icon`, recording the SHA and that the 16×16 source was accepted as-is by explicit user decision.

---

## Task 4: Feedback widget on the homepage

**Files:**
- Create: `lib/db/src/schema/feedback.ts`, `artifacts/api-server/src/routes/feedback.ts`, `artifacts/api-server/src/__tests__/feedback.test.ts`, `artifacts/studio/src/components/FeedbackWidget.tsx`, `artifacts/studio/src/__tests__/FeedbackWidget.test.tsx`, `artifacts/studio/e2e/feedback.spec.ts`
- Modify: `lib/db/src/schema/index.ts`, `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/__tests__/timestampClock.test.ts` (inventory **and** the SQL table filter), `artifacts/api-server/src/__tests__/schemaColumns.test.ts`, `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/__tests__/AppShell.test.tsx` (mock the widget + rewrite two footer-topology assertions — without this the task cannot pass its own gate)

**Interfaces:**
- Produces: `feedbackTable` from `@workspace/db` with fields `id: number`, `body: string`, `createdAt: Date`. OpenAPI `operationId: submitFeedback` → Orval hook `useSubmitFeedback()`. Route `POST /api/feedback`. Test-only export `resetFeedbackRateLimiterForTests(): void` from `routes/feedback.ts`. `AppShell` gains the `relative` wrapper that Task 5 mounts into.
- Consumes: nothing from Tasks 1-3.

### Phase A — database

- [ ] **Step 1: Create the schema module**

Create `lib/db/src/schema/feedback.ts`:

```ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// COSM-4 — anonymous-at-rest feedback. The ABSENCE of an account/session/IP
// column is the privacy guarantee, not an oversight: the route authenticates
// the caller (to rate-limit them) but deliberately never persists who they
// are, which is what lets the UI say "Stored without your account ID".
// Adding a user column here silently breaks that promise — don't.
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  /** Trimmed by the route before insert; 1-4000 chars enforced server-side. */
  body: text("body").notNull(),
  // HND-B — timestamptz is load-bearing. Written only by defaultNow()
  // (DB-local wall-clock), so as a naked timestamp every row would be wrong
  // by the database's UTC offset. See docs/ops/timestamptz-migration.md.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedbackTable.$inferSelect;
export type InsertFeedback = typeof feedbackTable.$inferInsert;
```

**No CHECK constraint on body length.** The spec left this open; the decision is no. The route trims and validates before insert and is the only writer, so a CHECK would duplicate that rule in a second place where it can drift, and it buys nothing against the only realistic failure (a future second writer that should be validating anyway). If a second writer ever appears, add the constraint then.

- [ ] **Step 2: Export it from the schema barrel**

In `lib/db/src/schema/index.ts`, append:

```ts
export * from "./feedback.js";
```

The `.js` extension is required — every other line in that file uses it.

- [ ] **Step 3: Add the column to the gate's timestamptz inventory**

In `artifacts/api-server/src/__tests__/timestampClock.test.ts`, **two** edits are needed — the inventory alone makes the test fail.

Add to `EXPECTED_TIMESTAMPTZ` (currently ending `["result_cache", "created_at"],`):

```ts
  ["feedback", "created_at"],
```

**And** add `feedback` to the query's table filter at `:99`, which is currently a closed list:

```sql
        AND table_name IN ('solve_jobs', 'scenarios', 'result_cache', 'feedback')
```

Without the second edit, `feedback.created_at` can never enter the `actual` map, so its lookup returns `undefined`, the `wrong` array is non-empty, and the test fails — the opposite of the proof intended.

This is the proof that actually runs — there is no `lib/db` suite in the gate command, so a test placed there would exist and never execute.

- [ ] **Step 4: Write the failing schema-absence test**

Two complementary proofs in two different files, because the two files have different capabilities.

**(a) Declared-schema proof — `artifacts/api-server/src/__tests__/schemaColumns.test.ts`.** This file is pure Drizzle metadata: it imports `{ solveJobsTable, scenariosTable } from "@workspace/db/schema"` and `{ getTableConfig } from "drizzle-orm/pg-core"`, and has **no `db` and no `sql` import**. A raw `db.execute(sql\`…\`)` here would not compile. Match its real style, which also satisfies the spec's "Drizzle metadata assertion" requirement:

```ts
import { feedbackTable } from "@workspace/db/schema"; // add to the existing import

it("feedback declares no account, session, or IP column", () => {
  const names = getTableConfig(feedbackTable).columns.map(c => c.name).sort();
  expect(names).toEqual(["body", "created_at", "id"]);
  for (const banned of ["user_id", "userid", "session_id", "ip", "ip_address", "email"]) {
    expect(names).not.toContain(banned);
  }
});
```

**(b) Live-database proof — in `feedback.test.ts` (Step 9), which already has `db`.** The declared schema and the applied database can disagree; only querying the live catalog proves what actually exists:

```ts
it("the live feedback table has no account, session, or IP column", async () => {
  const rows = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'feedback'
  `);
  const columns = (rows.rows as Array<{ column_name: string }>).map(r => r.column_name).sort();
  expect(columns).toEqual(["body", "created_at", "id"]);
});
```

Asserting the exact column set is the point — checking that a selected row "lacks a user property" proves nothing, because a missing value and a missing column look identical through the ORM.

- [ ] **Step 5: Apply the schema and run the two tests**

```bash
cd /Users/shubhamkr/nos-cosmetic
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- timestampClock schemaColumns
```

Expected: PASS. **Read `drizzle-kit push`'s proposal before accepting it** — it reconciles the whole schema, not just `feedback`. If it proposes dropping or altering anything else, STOP and report it.

### Phase B — API contract and route

- [ ] **Step 6: Add the endpoint to the OpenAPI spec**

In `lib/api-spec/openapi.yaml`, add under `paths:` (alongside `/auth/login`, matching its indentation and quote style):

```yaml
  /feedback:
    post:
      tags: [Feedback]
      operationId: submitFeedback
      summary: Submit anonymous product feedback
      description: >-
        Requires a session, which is used only to rate-limit the caller. No
        account identifier, session identifier, or client IP is persisted with
        the row — the stored record is body + timestamp and nothing else.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/FeedbackRequest'
      responses:
        '204':
          description: Feedback stored.
        '400':
          description: Body missing, empty after trimming, or over 4000 characters.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '401':
          description: No valid session.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '429':
          description: Rate limit exceeded for this account.
          headers:
            Retry-After:
              description: Seconds to wait before retrying.
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
```

And under `components: schemas:` (alongside `LoginRequest`):

```yaml
    FeedbackRequest:
      type: object
      required: [body]
      properties:
        body:
          type: string
          minLength: 1
          maxLength: 4000
          description: >-
            Free-text feedback. Trimmed by the server before validation and
            before storage, so a whitespace-only body is rejected.
```

- [ ] **Step 7: Run codegen twice and require a stable second pass**

Orval writes **directly into the tracked generated directories** (`orval.config.ts:24-30`, `:50-56`), so a plain `git diff --exit-code` after two passes compares against `HEAD` and reports the intended new endpoint as a difference — it can never exit 0, no matter how deterministic the generator is. Compare the two passes against **each other** instead:

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm --filter @workspace/api-spec codegen
cp -R lib/api-zod/src/generated /tmp/cosm4-zod-pass1
cp -R lib/api-client-react/src/generated /tmp/cosm4-rq-pass1
pnpm --filter @workspace/api-spec codegen
diff -r /tmp/cosm4-zod-pass1 lib/api-zod/src/generated
diff -r /tmp/cosm4-rq-pass1 lib/api-client-react/src/generated
rm -rf /tmp/cosm4-zod-pass1 /tmp/cosm4-rq-pass1
```

Expected: both `diff -r` commands print nothing and exit 0. If the second pass differs from the first, the generator is non-deterministic — STOP and report.

- [ ] **Step 8: Review the generated diff**

```bash
git diff -- lib/api-zod/src/generated lib/api-client-react/src/generated
```

Confirm: the request schema matches `FeedbackRequest`; the hook is named `useSubmitFeedback`; the URL is `/feedback`; the error types reference `ErrorEnvelope`; `credentials` behavior is unchanged; barrel exports include the new symbols. Never hand-edit any of it — if something is wrong, fix `openapi.yaml` and regenerate.

- [ ] **Step 9: Write the failing route tests**

Create `artifacts/api-server/src/__tests__/feedback.test.ts`, following `jadeCoefficientPrecheckIntegration.test.ts`'s convention: real HTTP app, real Postgres, **no `vi.mock`** of `db` anywhere in the file. Requires a live `DATABASE_URL`.

Three things differ from the obvious guesses, all verified: `app` is a **default** export (`import app from "../app.js"`); `routes.test.ts`'s `loginAs` is file-local, db-mocked, and returns a **cookie string**, so it cannot be reused here; and supertest has no persistent agent in this codebase's style — every call sets the cookie explicitly.

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { db, usersTable, feedbackTable } from "@workspace/db";
import app from "../app.js";
import { resetFeedbackRateLimiterForTests } from "../routes/feedback.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

const MARKER = "cosm4-test-";
const registeredUserIds: string[] = [];

// Mirrors jadeCoefficientPrecheckIntegration.test.ts:34 — register a fresh
// user and return its session cookie.
async function registerAndGetCookie(): Promise<string> {
  const email = `cosm4-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

afterAll(async () => {
  await db.delete(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
  for (const id of registeredUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("POST /api/feedback", () => {
  beforeEach(async () => {
    resetFeedbackRateLimiterForTests();
    resetLoginRateLimiterForTests();
    await db.delete(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/api/feedback").send({ body: `${MARKER}hello` });
    expect(res.status).toBe(401);
  });

  it("stores a trimmed row carrying no identity", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app).post("/api/feedback").set("Cookie", cookie)
      .send({ body: `  ${MARKER}real feedback  ` });
    expect(res.status).toBe(204);

    const rows = await db.select().from(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(`${MARKER}real feedback`); // trimmed
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0]).sort()).toEqual(["body", "createdAt", "id"]);
  });

  it("rejects empty, whitespace-only, and over-length bodies with 400", async () => {
    const cookie = await registerAndGetCookie();
    for (const body of ["", "   ", "x".repeat(4001)]) {
      const res = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body });
      expect(res.status).toBe(400);
    }
    const rows = await db.select().from(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
    expect(rows).toHaveLength(0);
  });

  it("rate-limits the sixth submission in a window and sets Retry-After", async () => {
    const cookie = await registerAndGetCookie();
    for (let i = 0; i < 5; i++) {
      const ok = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}${i}` });
      expect(ok.status).toBe(204);
    }
    const blocked = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}6` });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("does not let a malformed body consume quota", async () => {
    const cookie = await registerAndGetCookie();
    for (let i = 0; i < 10; i++) {
      const bad = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: "" });
      expect(bad.status).toBe(400);
    }
    const ok = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}still allowed` });
    expect(ok.status).toBe(204);
  });
});
```

Each case registers its own user, so the per-user limiter cannot leak across cases.

`resetLoginRateLimiterForTests()` is kept as cheap insurance, **not** because registration needs it: the login limiter is 20 attempts (`auth.ts:52`), not 10, and `isRateLimited` is called only from `/auth/login` (`auth.ts:128-142`) — `/auth/register` never consumes it. Harmless to call; the earlier justification for it was simply wrong.

- [ ] **Step 10: Run them and confirm they fail**

```bash
cd /Users/shubhamkr/nos-cosmetic
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- feedback
```

Expected: FAIL — `routes/feedback.js` does not exist.

- [ ] **Step 11: Implement the route**

Create `artifacts/api-server/src/routes/feedback.ts`:

```ts
import { Router } from "express";
import { db, feedbackTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
// Generated from openapi.yaml by Orval. Confirm the exact exported symbol
// name after Step 7's codegen (`rg "submitFeedback" lib/api-zod/src/generated`)
// and import it the same way routes/auth.ts:5-13 imports its validators.
import { submitFeedbackBody } from "@workspace/api-zod";

const router = Router();

// Kept only for the human-readable 400 message; the LENGTH RULE itself lives
// in the generated schema above, not here, so the two cannot disagree.
const MAX_BODY_CHARS = 4000;
const FEEDBACK_RATE_LIMIT = 5;
const FEEDBACK_RATE_WINDOW_MS = 60 * 1000;

// COSM-4 — keyed by authenticated user id, NOT req.ip. This app sets no
// Express `trust proxy` policy and Render terminates TLS at its load
// balancer, so req.ip is the proxy's address: an IP key would collapse into
// one shared bucket and let a single abuser block every user. The key is
// transient — it lives only in this map, ages out with the window, and is
// never written to the database.
// In-memory and single-instance, so it does not survive a restart and is not
// shared across instances. Acceptable for a feedback box behind auth.
const attempts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  // Lazy prune: without this, a dormant user id stays in the map until the
  // process restarts, because the branch below only replaces an expired
  // entry when THAT SAME user submits again. The spec says entries age out
  // with the window; this is what makes that literally true.
  for (const [key, e] of attempts) {
    if (now - e.windowStart > FEEDBACK_RATE_WINDOW_MS) attempts.delete(key);
  }
  const entry = attempts.get(userId);
  if (!entry) {
    attempts.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > FEEDBACK_RATE_LIMIT;
}

/** Test-only: the map above otherwise persists for the process lifetime. */
export function resetFeedbackRateLimiterForTests(): void {
  attempts.clear();
}

router.use(requireAuth);

// NOTE: never log `body` here, and never log this request alongside user
// context — doing so would reconstruct exactly the attribution the schema
// deliberately omits.
router.post("/feedback", async (req, res) => {
  // Trim FIRST, then validate against the generated contract schema: the
  // OpenAPI minLength/maxLength are defined post-trim, so validating the raw
  // body would accept "   " and reject a 4000-char body with trailing space.
  const raw: unknown = (req.body as { body?: unknown } | undefined)?.body;
  const trimmed = typeof raw === "string" ? raw.trim() : raw;

  // Contract-first: the generated Zod validator is the single source of the
  // length rule, so openapi.yaml and this route cannot drift. Precedent:
  // routes/auth.ts:5-13 imports generated validators and safeParses at :91-99.
  const parsed = submitFeedbackBody.safeParse({ body: trimmed });
  if (!parsed.success) {
    res.status(400).json({ error: `Feedback must be between 1 and ${MAX_BODY_CHARS} characters.` });
    return;
  }
  const body = parsed.data.body;

  if (isRateLimited(req.userId!)) {
    res.setHeader("Retry-After", String(Math.ceil(FEEDBACK_RATE_WINDOW_MS / 1000)));
    res.status(429).json({ error: "Too many submissions, try again shortly" });
    return;
  }

  await db.insert(feedbackTable).values({ body });
  res.status(204).end();
});

export default router;
```

- [ ] **Step 12: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add the import alongside the others:

```ts
import feedbackRouter from "./feedback.js";
```

and the registration alongside the other `router.use(...)` lines (before `scenariosRouter`, matching the file's existing order):

```ts
router.use(feedbackRouter);
```

Register here, **not** in `app.ts` — this repo's convention is that `app.ts` mounts one combined router at `/api`, which is why the path is `POST /api/feedback`.

- [ ] **Step 13: Run the route tests**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- feedback
```

Expected: PASS, all five cases.

### Phase C — frontend widget

- [ ] **Step 14: Write the failing widget tests**

Create `artifacts/studio/src/__tests__/FeedbackWidget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackWidget } from "@/components/FeedbackWidget";

const mutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useSubmitFeedback: () => ({ mutateAsync, isPending: false }),
}));

describe("FeedbackWidget", () => {
  beforeEach(() => { mutateAsync.mockReset().mockResolvedValue(undefined); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("opens, submits, and thanks the user", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "the map is great");
    await user.click(screen.getByTestId("feedback-send"));
    expect(mutateAsync).toHaveBeenCalledWith({ data: { body: "the map is great" } });
    expect(await screen.findByTestId("feedback-thanks")).toBeInTheDocument();
  });

  it("disables Send for whitespace-only input", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
    await user.type(screen.getByTestId("feedback-input"), "   ");
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
  });

  it("marks the launcher expanded and moves focus to the textarea", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    const launcher = screen.getByTestId("feedback-button");
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    await user.click(launcher);
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(screen.getByTestId("feedback-input")).toHaveFocus());
  });

  it("closes on Escape and returns focus to the launcher", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("feedback-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("feedback-button")).toHaveFocus();
  });

  it("keeps the typed text when the request fails", async () => {
    mutateAsync.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "keep me");
    await user.click(screen.getByTestId("feedback-send"));
    expect(await screen.findByTestId("feedback-error")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-input")).toHaveValue("keep me");
  });

  it("shows a distinct message for a 429", async () => {
    mutateAsync.mockRejectedValue({ status: 429 });
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "again");
    await user.click(screen.getByTestId("feedback-send"));
    expect(await screen.findByTestId("feedback-error")).toHaveTextContent(/too many/i);
  });

  it("resets to a fresh form after the success auto-close", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "first");
    await user.click(screen.getByTestId("feedback-send"));
    await screen.findByTestId("feedback-thanks");
    vi.advanceTimersByTime(2500);
    await waitFor(() => expect(screen.queryByTestId("feedback-thanks")).not.toBeInTheDocument());
    await user.click(screen.getByTestId("feedback-button"));
    expect(screen.getByTestId("feedback-input")).toHaveValue("");
  });

  it("cannot be submitted twice while a request is in flight", async () => {
    let resolveIt: () => void = () => {};
    mutateAsync.mockImplementation(() => new Promise<void>(r => { resolveIt = r; }));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "once only");
    await user.click(screen.getByTestId("feedback-send"));
    // Still pending — the button must be disabled, and a second click a no-op.
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
    await user.click(screen.getByTestId("feedback-send"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    resolveIt();
  });

  it("clears the auto-close timer on unmount", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const user = userEvent.setup();
    const { unmount } = render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "pending timer");
    await user.click(screen.getByTestId("feedback-send"));
    await screen.findByTestId("feedback-thanks");
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    // No "state update on unmounted component" warning should follow.
    vi.advanceTimersByTime(5000);
  });

  it("states the anonymity guarantee without overclaiming", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    const hint = screen.getByTestId("feedback-anonymity-hint");
    expect(hint).toHaveTextContent(/stored without your account id/i);
    // "we won't know who you are" is unsupportable — the server authenticates
    // the caller and infra logs exist. Guard against it regressing in.
    expect(hint.textContent ?? "").not.toMatch(/won't know who you are/i);
  });
});
```

- [ ] **Step 15: Run and confirm they fail**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm --filter studio test -- FeedbackWidget
```

Expected: FAIL — the module does not exist.

- [ ] **Step 16: Implement the widget**

Create `artifacts/studio/src/components/FeedbackWidget.tsx`. A non-modal popover — it does not trap focus or block the page, so no Radix Dialog.

```tsx
import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubmitFeedback } from "@workspace/api-client-react";

const AUTO_CLOSE_MS = 2000;
const MAX_BODY_CHARS = 4000;

// COSM-4 — positioned absolutely inside AppShell's content wrapper (NOT
// viewport-fixed), so it cannot overlap the always-visible homepage credit
// footer, which lives outside that wrapper.
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = useSubmitFeedback();

  function clearTimer() {
    if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null; }
  }
  useEffect(() => clearTimer, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function close() {
    clearTimer();
    setOpen(false);
    setBody("");
    setStatus("idle");
    setErrorText("");
    launcherRef.current?.focus();
  }

  async function handleSend() {
    if (body.trim().length === 0 || status === "sending") return;
    setStatus("sending");
    setErrorText("");
    try {
      await submit.mutateAsync({ data: { body: body.trim() } });
      setStatus("sent");
      clearTimer();
      timerRef.current = setTimeout(close, AUTO_CLOSE_MS);
    } catch (err) {
      setStatus("error");
      const status429 = (err as { status?: number } | null)?.status === 429;
      setErrorText(status429 ? "Too many submissions — try again in a minute." : "Couldn't send that. Try again.");
    }
  }

  return (
    <div className="absolute bottom-4 right-4 z-20" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {open && (
        <div
          id="feedback-panel"
          role="group"
          aria-label="Send feedback"
          className="mb-2 w-[min(20rem,calc(100vw-2rem))] rounded border bg-background p-3 shadow-lg"
          onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
        >
          {status === "sent" ? (
            <p className="text-sm" data-testid="feedback-thanks">Thanks — got it.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <label htmlFor="feedback-body" className="text-sm font-medium">Send feedback</label>
                <button type="button" aria-label="Close feedback" onClick={close} className="opacity-60 hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" data-testid="feedback-anonymity-hint">
                Stored without your account ID — we don't save who sent this. Please avoid personal details.
              </p>
              <textarea
                id="feedback-body"
                ref={inputRef}
                data-testid="feedback-input"
                value={body}
                maxLength={MAX_BODY_CHARS}
                onChange={e => setBody(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded border p-2 text-sm"
                placeholder="What's on your mind?"
              />
              {status === "error" && (
                <p className="mt-1 text-xs text-destructive" data-testid="feedback-error">{errorText}</p>
              )}
              <div className="mt-2 flex justify-end">
                <Button size="sm" data-testid="feedback-send" onClick={handleSend}
                  disabled={body.trim().length === 0 || status === "sending"}>
                  {status === "sending" ? "Sending…" : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <Button
        ref={launcherRef}
        size="sm"
        variant="outline"
        data-testid="feedback-button"
        aria-expanded={open}
        aria-controls="feedback-panel"
        aria-label="Send feedback"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded-full shadow"
      >
        <MessageSquare className="w-4 h-4" />
      </Button>
    </div>
  );
}
```

If `Button` does not forward refs, use a plain `<button>` for the launcher rather than changing the shared `Button` component.

- [ ] **Step 17: Run the widget tests**

```bash
pnpm --filter studio test -- FeedbackWidget
```

Expected: PASS, all eight cases. Iterate on the component — not the tests — until they do.

- [ ] **Step 18: Mount it in `AppShell` and introduce the shared wrapper**

In `artifacts/studio/src/components/AppShell.tsx`, replace:

```tsx
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
```

with:

```tsx
      {/* COSM-4/COSM-5 — one relative wrapper owns the scroll area's stacking
          context. The footer stays outside it, so the feedback launcher cannot
          overlap the always-visible homepage credit footer. */}
      <div className="flex-1 min-h-0 relative">
        <main className="absolute inset-0 overflow-y-auto z-10">{children}</main>
        {hero && <FeedbackWidget />}
      </div>
```

and add the import. Gating on `hero` scopes the widget to the homepage: `App.tsx:62` is the only route that passes `hero`.

- [ ] **Step 19: Repair `AppShell.test.tsx` — this task breaks it two different ways**

**Not** the Landing suites. `Landing.test.tsx` and `Landing.lockedRendering.test.tsx` both render `<Landing />` directly, and `Landing.tsx` imports only `useGetSolveHistory`/`useGetLandingSummary` — neither suite ever mounts `AppShell`, so neither can instantiate the widget. `AppShell.test.tsx` is the one that does, and it is currently absent from this task's file list. Fixing it here is mandatory: Step 21 runs the full studio suite, so leaving it to Task 5 means Task 4 cannot go green.

**Break 1 — missing hook.** `AppShell.test.tsx:16-19` mocks `@workspace/api-client-react` wholesale, exporting only `useLogoutUser` and `getGetCurrentAuthUserQueryKey`. Every hero-mode render (`:97-105`, `:180-188`, `:195-198`) will now mount the real widget and crash on an undefined `useSubmitFeedback`. Add the component mock:

```tsx
vi.mock("@/components/FeedbackWidget", () => ({
  FeedbackWidget: () => <div data-testid="feedback-button" />,
}));
```

**Break 2 — changed DOM topology.** Two tests assert the footer is a *sibling of `<main>`*:

```tsx
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    expect(footer.parentElement).toBe(main.parentElement);
```

at `:137-152` and again at 375 px at `:154-174`. The new wrapper nests `<main>` inside it while the footer stays outside, so `main.parentElement` becomes the wrapper and both assertions fail **by design**. Rewrite them to express the invariant that actually matters — the footer is outside the scroll area and reserves its own strip:

```tsx
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    const scrollWrapper = main.parentElement as HTMLElement;
    // The footer must be a sibling of the WRAPPER, not of <main>: <main> is
    // now the scrolling element inside it, and nesting the footer in there
    // would let it scroll out of view.
    expect(footer.parentElement).toBe(scrollWrapper.parentElement);
    expect(scrollWrapper).not.toContainElement(footer);
```

- [ ] **Step 20: Write the intercepted e2e**

Create `artifacts/studio/e2e/feedback.spec.ts`. Intercept the POST so no durable row survives — the global teardown purges test users and their FK-owned data, and an anonymous row has no user FK, so a real submission would accumulate on every run.

There is **no** `e2e/helpers/auth` module — `e2e/helpers/` contains only `modelLock.ts` and `solvedAt.ts`. Every spec declares its own registration helper and imports `test`/`expect` from `./fixtures`, not from `@playwright/test`. Follow that:

```ts
import { test, expect, type Page } from "./fixtures";

const TIMEOUT = 10_000;

// Same shape as bundle6-ui-tweaks.spec.ts:49 — each spec owns this helper.
async function registerFreshAccount(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  return email;
}

test("homepage feedback widget submits and thanks the user", async ({ page }) => {
  await registerFreshAccount(page, "feedback");

  let posted: unknown = null;
  await page.route("**/api/feedback", async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await page.getByTestId("feedback-button").click({ timeout: TIMEOUT });
  await page.getByTestId("feedback-input").fill("e2e feedback");
  await page.getByTestId("feedback-send").click({ timeout: TIMEOUT });

  await expect(page.getByTestId("feedback-thanks")).toBeVisible({ timeout: TIMEOUT });
  expect(posted).toEqual({ body: "e2e feedback" });
});
```

Every interaction carries an explicit `timeout` — an unbounded `.click()` on a never-actionable target inherits the whole remaining test budget and surfaces the failure at an unrelated later line.

- [ ] **Step 21: Run the full gates for this task**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
ps aux | grep "[v]itest" | grep -v "zsh -c"   # must print nothing
pnpm --filter studio test
cd artifacts/studio && E2E_BASE_URL=http://localhost:5174 npx playwright test feedback.spec.ts
```

Expected: PASS. Known load flakes (`cors`, `jobRunnerDispatcher`, `resultEnvelope`, `routes`, …) re-run clean in isolation — check before treating one as a regression.

- [ ] **Step 22: Commit**

```bash
cd /Users/shubhamkr/nos-cosmetic
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add lib/db lib/api-spec lib/api-zod lib/api-client-react artifacts/api-server artifacts/studio/src artifacts/studio/e2e
git diff --cached --stat
```

Confirm the regenerated Orval output is staged **in this same commit** as the spec change. Commit as `[COSM-4] add a feedback widget to the homepage`, recording in the body that the row carries no account/session/IP column by design, and that the limiter keys on user id because `req.ip` is Render's load balancer absent a `trust proxy` policy.

---

## Task 5: Animated network background behind the homepage

**Files:**
- Create: `artifacts/studio/src/components/NetworkBackground.tsx`, `artifacts/studio/src/__tests__/NetworkBackground.test.tsx`
- Modify: `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/__tests__/AppShell.test.tsx`
- Reference: `docs/superpowers/specs/assets/2026-10-03-network-bg.html` (committed; SHA `df9efa66c1f18207cbc058b17c714aa8465b8b1c1ee14488214c4f6e3d034e44`)

**Interfaces:**
- Consumes: the `relative` wrapper added to `AppShell` in Task 4, Step 18, and the `FeedbackWidget` mock plus rewritten footer assertions Task 4 added to `AppShell.test.tsx`. **Do not create a second wrapper, and do not run this task before Task 4.** The earlier draft offered a "if Task 4 hasn't run, create the wrapper here" fallback; it is removed as unsafe — Task 4's Step 18 patches the exact original `<main className="flex-1 min-h-0 overflow-y-auto">` at `AppShell.tsx:83`, and that target no longer exists once this task has wrapped it. If Task 4 has not landed, stop and run it first.
- Produces: `NetworkBackground` — a no-prop component.

- [ ] **Step 1: Read the committed source**

```bash
cat /Users/shubhamkr/nos-cosmetic/docs/superpowers/specs/assets/2026-10-03-network-bg.html
```

Port its behavior exactly: 26 nodes, the first 5 are square hubs with `r=7` (others circles, `r=4`), velocities `(Math.random()-0.5)*0.00022`, positions normalized 0-1 and reflected at the bounds, `lineWidth = 1.6`, an edge only when at least one endpoint is a hub and pixel distance `< 340`, stroke alpha `0.16 * (1 - d/340)`, hub fill alpha `0.28`, node fill alpha `0.2`, edges drawn before nodes.

- [ ] **Step 2: Write the failing tests**

Create `artifacts/studio/src/__tests__/NetworkBackground.test.tsx`. This file owns its browser-API mocks: the shared `src/__tests__/setup.ts` stubs `ResizeObserver` only — there is no canvas 2D context, no `matchMedia`, and no rAF control.

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkBackground } from "@/components/NetworkBackground";

let observed: Array<() => void> = [];
const disconnect = vi.fn();

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

const ctx = {
  clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  lineWidth: 0, strokeStyle: "", fillStyle: "",
};

beforeEach(() => {
  observed = [];
  disconnect.mockReset();
  // MUST clear every ctx mock: `ctx` is module-level and vitest.config.ts
  // does not enable clearMocks, so without this the reduced-motion case's
  // `expect(ctx.fill).toHaveBeenCalled()` is satisfied by the PREVIOUS
  // test's frame and stays green even if this render draws nothing at all.
  for (const fn of Object.values(ctx)) {
    if (typeof fn === "function" && "mockClear" in fn) (fn as ReturnType<typeof vi.fn>).mockClear();
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: () => void) { observed.push(cb); }
    observe() {} unobserve() {} disconnect = disconnect;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("NetworkBackground", () => {
  it("renders a non-interactive, hidden canvas", () => {
    mockMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    const el = screen.getByTestId("network-background");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toMatch(/pointer-events-none/);
  });

  it("never starts the animation loop under prefers-reduced-motion", () => {
    mockMatchMedia(true);
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    expect(raf).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled(); // one static frame was drawn
  });

  it("redraws after a resize under reduced motion, so the canvas is not left blank", () => {
    mockMatchMedia(true);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    ctx.fill.mockClear();
    observed.forEach(cb => cb());
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("starts the loop when motion is allowed", () => {
    mockMatchMedia(false);
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    expect(raf).toHaveBeenCalled();
  });

  it("cancels the frame and disconnects the observer on unmount", () => {
    mockMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<NetworkBackground />);
    unmount();
    expect(cancel).toHaveBeenCalledWith(42);
    expect(disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run and confirm they fail**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm --filter studio test -- NetworkBackground
```

Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement the component**

Create `artifacts/studio/src/components/NetworkBackground.tsx`:

```tsx
import { useEffect, useRef } from "react";

// COSM-5 — React port of docs/superpowers/specs/assets/2026-10-03-network-bg.html
// (SHA df9efa66c1f18207cbc058b17c714aa8465b8b1c1ee14488214c4f6e3d034e44).
// Constants below are that file's, unchanged.
const NODE_COUNT = 26;
const HUB_COUNT = 5;
const EDGE_RANGE_PX = 340;
const FALLBACK_RGB = "128,132,122";

function readInkRgb(el: HTMLElement): string {
  // --ink-400 (#83887A) is the token this animation was authored against.
  // Read ONCE at mount: the app has no runtime theme switcher (index.css
  // defines .dark but nothing in src/ ever applies it), so there is nothing
  // to react to. If a toggle is ever added, this is the one place to change.
  const hex = getComputedStyle(el).getPropertyValue("--ink-400").trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return FALLBACK_RGB;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

export function NetworkBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgb = readInkRgb(wrap);
    const reduced = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, raf: number | null = null;

    const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00022,
      vy: (Math.random() - 0.5) * 0.00022,
      hub: i < HUB_COUNT,
      r: i < HUB_COUNT ? 7 : 4,
    }));

    function resize() {
      w = canvas!.width = canvas!.offsetWidth;
      h = canvas!.height = canvas!.offsetHeight;
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineWidth = 1.6;
      for (let a = 0; a < NODE_COUNT; a++) {
        for (let b = a + 1; b < NODE_COUNT; b++) {
          if (!nodes[a].hub && !nodes[b].hub) continue;
          const dx = (nodes[a].x - nodes[b].x) * w;
          const dy = (nodes[a].y - nodes[b].y) * h;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= EDGE_RANGE_PX) continue;
          ctx!.strokeStyle = `rgba(${rgb},${(0.16 * (1 - d / EDGE_RANGE_PX)).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.moveTo(nodes[a].x * w, nodes[a].y * h);
          ctx!.lineTo(nodes[b].x * w, nodes[b].y * h);
          ctx!.stroke();
        }
      }
      for (const m of nodes) {
        ctx!.fillStyle = `rgba(${rgb},${m.hub ? 0.28 : 0.2})`;
        if (m.hub) {
          ctx!.fillRect(m.x * w - m.r, m.y * h - m.r, m.r * 2, m.r * 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(m.x * w, m.y * h, m.r, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    function step() {
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    resize();
    draw();
    if (!reduced) raf = requestAnimationFrame(step);

    // ResizeObserver, not window.resize: Landing's Recent Solves section
    // arrives asynchronously and changes this container's height, which a
    // window listener never observes. Resizing resets canvas.width, which
    // CLEARS the bitmap — so a reduced-motion canvas must redraw here or it
    // goes permanently blank after the first resize.
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(wrap);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      data-testid="network-background"
      className="absolute inset-0 z-0 pointer-events-none"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
```

- [ ] **Step 5: Run the component tests**

```bash
pnpm --filter studio test -- NetworkBackground
```

Expected: PASS, all five cases.

- [ ] **Step 6: Mount it in the shared wrapper**

In `AppShell.tsx`, add `NetworkBackground` as the **first** child of the wrapper Task 4 created, so it paints beneath both the scroll area and the feedback launcher:

```tsx
      <div className="flex-1 min-h-0 relative">
        {hero && <NetworkBackground />}
        <main className="absolute inset-0 overflow-y-auto z-10">{children}</main>
        {hero && <FeedbackWidget />}
      </div>
```

Layer order is explicit and must stay that way: background `z-0`, scroll area `z-10`, feedback `z-20`. Normal flow is not a stacking contract — the original demo positioned every direct child, and this mount does not.

- [ ] **Step 7: Add the AppShell mount assertions**

In `artifacts/studio/src/__tests__/AppShell.test.tsx` — already repaired by Task 4, so this adds only a mock and one case. Mock the component (the real one needs canvas APIs this suite does not provide) and assert the hero gate:

```tsx
vi.mock("@/components/NetworkBackground", () => ({
  NetworkBackground: () => <div data-testid="network-background" />,
}));

it("renders the network background only on the homepage hero shell", () => {
  const { rerender } = render(<AppShell userEmail="a@b.c" hero>{<div />}</AppShell>);
  expect(screen.getByTestId("network-background")).toBeInTheDocument();

  rerender(<AppShell userEmail="a@b.c">{<div />}</AppShell>);
  expect(screen.queryByTestId("network-background")).not.toBeInTheDocument();
});
```

Use this file's own `renderShell` helper if the surrounding cases do. No change to `Landing.test.tsx` or `Landing.lockedRendering.test.tsx`: both render `<Landing />` directly and never mount `AppShell`, so neither can reach this component.

- [ ] **Step 8: Run typecheck and the full studio suite**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm run typecheck
ps aux | grep "[v]itest" | grep -v "zsh -c"   # must print nothing
pnpm --filter studio test
```

Expected: PASS. A jsdom "not implemented: HTMLCanvasElement.getContext" error anywhere outside `NetworkBackground.test.tsx` means a suite is rendering the real component — add the mock there.

- [ ] **Step 9: Browser-check layering and hit-testing**

With the dev servers running, on the homepage confirm: the animation covers the whole scroll area between header and footer; chapter cards and Recent Solves links are still clickable (the canvas must never be the hit target); the feedback launcher sits above the canvas and clear of the footer; scrolling leaves the background stable rather than scrolling with the content. Then toggle OS reduced motion on, reload, and confirm a static frame renders and stays visible after a window resize.

A component-presence test cannot detect a canvas painted over content — this step is the only check that can.

- [ ] **Step 10: Commit**

```bash
cd /Users/shubhamkr/nos-cosmetic
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src
git diff --cached --stat
```

Commit as `[COSM-5] animate a network background behind the homepage`.

---

## Final: whole-branch gate

- [ ] **Step 1: Re-run the dependency sweep**

```bash
cd /Users/shubhamkr/nos-cosmetic
rg -n 'TabBar|tab-bar|tab-close-|tab-input:|tab-output:|scenario tab viewed' artifacts/studio docs/design-system
rg -n 'workspaceTabsReducer|workspaceTabId|initialWorkspaceTabState' artifacts/studio/src
rg -n 'StepToggle|step-toggle|button-save|saveInLayersRow' artifacts/studio/src artifacts/studio/e2e
rg -n 'book-cover\.png|global-network' .
```

Classify every remaining hit as: live consumer to update, current documentation to update, historical record to retain, or generated artifact to regenerate.

- [ ] **Step 2: Full gate**

```bash
cd /Users/shubhamkr/nos-cosmetic
pnpm run typecheck \
  && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test \
  && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
PORT=5174 BASE_PATH=/ pnpm --filter studio build
```

Expected: all PASS. `PORT` and `BASE_PATH` are mandatory — `vite.config.ts:7-27` throws without them. No solver code changed, so a `test_transport.py::TestSingleSource` failure is the known 60-second-timeout flake — re-run that class alone.

- [ ] **Step 3: E2E gate**

With both dev servers running (api-server on 3001, studio on 5174):

```bash
cd /Users/shubhamkr/nos-cosmetic
E2E_BASE_URL=http://localhost:5174 pnpm e2e:gate
cat artifacts/studio/e2e/report/results.json | python3 -c "import json,sys; s=json.load(sys.stdin)['stats']; print(s['unexpected'], s['flaky'])"
```

Require `0 0`. The console tail folds retried failures away — a gate that is green only because retries absorbed failures is not green.

`E2E_BASE_URL` is mandatory here too: `playwright.config.ts:3-5` otherwise targets a remote Replit deployment and the config has no `webServer`, so the gate would grade an unrelated build — failing on changes it does not have, or passing on behavior this branch replaced.

- [ ] **Step 4: Browser QA matrix**

Cover: 375 px and desktop; reduced motion on and off; fresh and stale outputs; Chapter 4 Input Map and an output view; feedback success, 400, 429, and network failure; footer collision; canvas layering and hit-testing; favicon after a cache-bypassing reload.

- [ ] **Step 5: Changelog and retro**

The changelog belongs **in COSM-5, not a sixth commit** — the spec fixes the bundle at exactly five commits and says the record lands in the final one. So write the entry before committing Task 5, and stage it with that task:

```bash
cd /Users/shubhamkr/nos-cosmetic
git add docs/CHANGELOG-implementation.md artifacts/studio/src
```

The entry records what landed, the commit SHAs available at that point, gate numbers, and the deliberate behavior change (stale outputs unreachable until re-solve). COSM-5's own SHA cannot be in its own message — reference the others and name COSM-5 by title.

If Task 5 is already committed by the time you reach this step, amend it rather than adding a sixth commit:

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add docs/CHANGELOG-implementation.md
git commit --amend --no-edit
```

Then run `/harness-retro cosmetic-ui`.

- [ ] **Step 6: Stop for merge approval**

Do not merge. Do not push. Do not deploy. Report the gate results and the changed behavior, and wait for the user's explicit merge approval — which is not push approval, which is not deploy approval.

**When deploy approval does eventually come**, Task 4's new table makes the order matter: `drizzle-kit push` does not run automatically on a Render API deploy, so the route can reach production before `feedback` exists and 500 on every submission. The seven-step sequence — inspect the push proposal, rehearse on a disposable database, create the table under its own approval, prove the column types, deploy API, deploy frontend, roll back code without dropping the table — is in the spec's "Production rollout" section. Follow it there; it is deliberately not duplicated here.
