# WQF Part C — Studio UI and Chapter 5 Implementation Plan

> **For agentic workers:** this repo does NOT execute plans with `superpowers:subagent-driven-development`. It executes them by **agent-team dispatch per `AGENTS.md`**: the lead pre-creates one **locked worktree per task** (`git worktree add --lock <path> -b <task>-work <base-sha>`), dispatches the named role **without** `isolation`, and the agent's **first Bash command** is `cd <that exact path> && git rev-parse --abbrev-ref HEAD` (must print `<task>-work`, else STOP and report) followed by the base guard `git merge-base --is-ancestor <base-sha> HEAD`. The lead reviews each task (Opus, plus `ponytail:ponytail-review` for engineering roles), then **cherry-picks** the task commit onto the bundle branch `wqf-c` and re-gates. Steps use checkbox (`- [ ]`) syntax for tracking. Never delegate to GLM (hard rule #10).

**Goal:** Ship spec Part C (C1–C6) of `docs/superpowers/specs/2026-11-25-watbot-qf-bundle-design.md`: the Output Map summary draws over the result cards, Save sits beside Filter on input tables, Chapter 5 is retitled, the Delivery Cost table shows names and 2-dp numbers, and a Base multiplier rewrites filtered costs in one save.

**Architecture:** Studio-only change (deploys `nos-studio` only; no API, contract, solver or schema change). C1 is one class in the shared `PopoverContent`. C2 hands the existing Workspace Save cluster to `DataTable` through a React context slot on an explicit model/tab list. C4/C6 are display changes inside `DeliveryCostsTab`, with two pure helpers in a new `lib/deliveryCosts.ts`. C5 adds a render-prop to `DataTable` that exposes the filtered rows across all pages, and reuses Workspace's existing whole-input save with a one-key patch.

**Tech Stack:** React 18 + Vite + Tailwind + Radix (studio), vitest + RTL (jsdom), Playwright (real browser), pnpm monorepo.

## Global Constraints

Copied from the spec (Part C, Testing) and the repo contract; every task implicitly includes this section.

- Spec C1: "Raise the shared `PopoverContent` (`components/ui/popover.tsx:22`) above the map overlays (`z-[1100]`), so every popover opened over a map draws on top."
- Spec C2: "Save moves only on tabs where it renders today (`showToolbarSave`) **and** whose content is a `DataTable`; no tab gains or loses Save, output tables are untouched, and the inline-Save exceptions (`saveInLayers*` on Input Map tabs) keep theirs." "When Filter is hidden (10 rows or fewer, `FILTER_ROW_THRESHOLD`), Save takes the same position. Behaviour, gating (`showToolbarSave`, `isEditableInputTab`) and the test id are unchanged."
- Spec C3: title "Network Design Fundamentals"; lab header "Network Design Fundamentals · Model Lab". "The manifest name served by `/api/models` is unchanged."
- Spec C4: "From and To show the ID with the place, e.g. `W8 · Chicago, IL`" — the real dataset row is `W8 · Atlanta, GA` (`solvers/delivery-teaching-us/dataset/warehouses.json`); the format is what binds, not the example city. "The ID stays first; filtering and sorting keep working on the ID."
- Spec C5: "Apply sets Cost = round2(Base × multiplier) for every row matching the current filter, across all pages (all 10,329 pairs when unfiltered), overwriting existing Cost, then saves as one scenario write (`laneCostOverrides`). The multiplier must be a positive number; Apply is disabled otherwise." "A failed save shows the server's sentence via `describeWriteError`."
- Spec C6: "Base and Cost display with normal rounding to 2 dp (1047.7157 → 1047.72). Costs written by C5 are stored at 2 dp; hand-typed costs are stored as typed."
- Spec Testing: "Every item gets a test that fails before the change. Layout items (… C1 stacking, C2 placement) get a real-browser assertion, since jsdom cannot see CSS." "Each part runs the full gate and the e2e gate with `E2E_BASE_URL` set before merge."
- Spec: Part C "Deploys nos-studio · Schema none". Out of scope: "changing how solves are priced or costed".
- Hard rules that bind here: never edit generated code (#1); `e2e_accuracy.py` untouched (#2; this part has no solver diff); one task = one commit, message `[WQF-C<n>] <imperative summary>` (#4); changelog entry appended to `docs/CHANGELOG-implementation.md` **in the same commit** (#9); never GLM (#10); overkill check first (#11); engineering roles invoke `andrej-karpathy-skills:karpathy-guidelines` **and** `ponytail:ponytail` before writing code, `ponytail:ponytail-review` on review (#12; qa-sdet exempt).
- Every write failure surfaces through `lib/describeWriteError.ts`; never render `err.message` (studio CLAUDE.md; guarded by `__tests__/mutationErrorSurface.test.ts` and `__tests__/rawErrorMessageSurface.test.ts`).
- jsdom loads no Tailwind and stubs `ResizeObserver`: anything whose behaviour is CSS (stacking, placement) gets a Playwright test. `elementFromPoint` answers "what would a click hit", not "what is painted" — a `pointer-events-none` overlay must be made hit-testable before using it (e2e CLAUDE.md).
- Commit guard, before every `git commit`: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. Commit with an explicit pathspec. Never pipe a git command whose exit code gates the next step.
- Public repo: no production ids, user emails, IPs or book text in any committed file (PRIV-1). Test emails are synthetic `@test.com`.
- Never fabricate a metric: a gate count you did not run this turn is the literal string `unknown`.

### Local two-server recipe (used by every Playwright step)

Run from **the worktree under test** (never the shared checkout), on ports no other session uses (check `lsof -i :<port>` first; the examples use 3101/5273):

```bash
# terminal A — API (shared local DB; every spec registers its own user)
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3101 pnpm --filter api-server run dev
# terminal B — studio; the two dummy VITE_ values are REQUIRED (e2e CLAUDE.md), the specs stub ingest
PORT=5273 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3101 \
  VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 \
  pnpm --filter studio run dev
# one spec (from the worktree root)
(cd artifacts/studio && E2E_BASE_URL=http://localhost:5273 npx playwright test e2e/<spec>.spec.ts)
```

**`E2E_BASE_URL` is mandatory** — without it Playwright tests a remote Replit deployment (`playwright.config.ts:3-5`). If WQF Part B (terms consent) has merged into the base before this part runs, `POST /api/auth/register` needs Part B's consent field: copy the register payload from Part B's own e2e helper rather than guessing it.

### Worktree prerequisites

A fresh worktree has no `node_modules`: run `pnpm install --frozen-lockfile` in it once before any test command.

---

## Spec-driven findings that shape this plan (read before Task 1)

### C1 — every overlay layer vs. the new `z-[1100]` popover

`PopoverContent` (`components/ui/popover.tsx:16-27`) portals to `<body>`, so it competes in the **root** stacking context. Radix copies the content's computed `z-index` onto its `[data-radix-popper-content-wrapper]`.

| `PopoverContent` caller | Where it opens | Does `z-[1100]` change its stacking? |
|---|---|---|
| `components/workspace/tabs/OutputMapNarrative.tsx:18` (ⓘ summary) | Output Map toolbar, drops over the map's result cards | **Yes — the fix.** The cards' wrapper is `absolute … z-[1000]` (`OutputMapTab.tsx:447`) inside `div.relative` (`:443`, no z-index, so no stacking context) — it competes at 1000 in the root context and beat the popover's 50. Now 1100 > 1000. |
| `components/tables/FilterMenu.tsx:77` | Every `DataTable` toolbar (`DataTable.tsx:329`), and twice inside `ImportDialog.tsx:222,257` | No. Inside `ImportDialog` it already drew over the dialog (both z-50 portals, popover later in DOM); it still does. |
| `components/data-table/DownloadMenu.tsx:54` | Every table toolbar; Workspace super Export (`Workspace.tsx:4781`) | No. Its Upload variant closes itself (`setOpen(false)`, `:62`) before `ImportDialog` opens, so it never sits under a dialog. |
| `components/UnverifiedInfo.tsx:18` | `CostSummaryTab.tsx:214,870`, `Landing.tsx:261` | No — no map or dialog under it. |
| `components/workspace/watbot/WatBotMessages.tsx:93` (citation) | WatBot side panel (no z-index of its own) | No. |

Other layers in the app, and why none relies on sitting above a popover:

- **Leaflet panes and controls** (tiles 200 … popups 700, `.leaflet-top/.leaflet-bottom` 1000, `NetworkMap.tsx:771` route pane 350): all inside `.leaflet-container { z-index: 0 }` (`index.css:16-18`), a stacking context that competes at 0. Unchanged (the popover was already above).
- **Map chrome** `MapDetailsCard.tsx:102` z-30, `MapActionMenu.tsx:161` z-40, `mapControls.tsx:101` z-40, `MapBulkEditToolbar.tsx:41` z-20, `MapLegend.tsx:316` z-10, `FeedbackWidget.tsx:61,67` z-20, `DataTable.tsx:194,285` sticky z-10, `AppShell.tsx:105,108` z-10: all below 50 already. Unchanged.
- **Sidebar** `SidebarTree.tsx:91,262,270,327` z-50 (nav, pills, flyout): previously a tie at 50 broken by DOM order (portal later → popover on top); now strictly above. Unchanged outcome.
- **`index.css:521` `.hover-elevate::after` z-999**: inside its own `position: relative; z-index: 0` context (`:507-508`). Unchanged.
- **Dialog / AlertDialog / Sheet / Drawer** (`ui/dialog.tsx:22,39`, `ui/alert-dialog.tsx:19,37`, `ui/sheet.tsx`, `ui/drawer.tsx`) z-50, including `SolveProgressOverlay` (AlertDialog) and every map/super dialog: Radix popovers dismiss on focus-outside, and every modal moves focus on open, so no popover is ever open *beneath* a dialog. Popovers opened *inside* a dialog (FilterMenu in ImportDialog) stay above. Unchanged.
- **Tooltip / Select / DropdownMenu / HoverCard / ContextMenu / Menubar** (z-50): `git grep` finds **no** studio component rendering any of them (only `App.tsx:6` mounts `TooltipProvider`), so nothing z-50 is ever nested inside a popover. Unchanged.
- **Toast viewport** `ui/toast.tsx:17` `z-[100]`: **the one other changed relationship** — an open popover now draws over a toast where they overlap (before, the toast drew over it). No caller relies on a toast covering a popover: toasts are transient and popovers close on any outside click. Accepted; recorded in the Task 1 changelog entry.

### C2 — model/tab pairs where Save moves beside Filter (derived, 31 pairs)

Rule: `showToolbarSave` true today (`Workspace.tsx:2545-2546`, from `isEditableInputTab` `:2410-2513` minus the four `saveInLayersRow*` gates `:2521-2538`) **and** `renderTabContent()` renders a `DataTable` for that tab.

| Model | Save moves beside Filter (component → `DataTable` line) | Save stays in the toolbar row (not a `DataTable`) | Inline in Layers row (unchanged) |
|---|---|---|---|
| p-median-us | customers (`CustomersTab.tsx:433`), warehouses (`WarehousesTab.tsx:340`), distances (`DistancesTab.tsx:588`) | optimization-parameters (`OptimizationParametersTab`, a form) | input-map |
| p-median-brazil | customers, warehouses, distances (same components) | optimization-parameters | input-map |
| max-coverage-us | customers, warehouses, distances (same components) | optimization-parameters | input-map |
| delivery-teaching-us | customers, warehouses, deliveryCosts (`DeliveryCostsTab.tsx:389`) | optimization-parameters | input-map |
| transport-coal | mines (`MinesTab.tsx:261`), stations (`StationsTab.tsx:267`), laneCosts (`LaneCostsTab.tsx:347`) | optimization-parameters | input-map |
| two-echelon-gold-au | refineries (`WarehousesTab`, `Workspace.tsx:3771`), customers, distances (`LegDistancesTab.tsx:353`) | optimization-parameters | input-map |
| two-echelon-jade-us | plants (`PlantsTab.tsx:184`), capability-matrix (`CapabilityMatrixTab.tsx:182`), warehouses, customers, distances (`JadeDistancesTab.tsx:683`), transportCosts (`TransportCostsTab.tsx:270`, 2 rows → Filter hidden) | optimization-parameters | input-map |
| super-model | products, plants, warehouses, customers, plantProducts, demand (`SuperTableTab.tsx:55`), transportCosts (`TransportCostsTab`, 2 rows) | input-map (`SuperInputMap`, super has no `saveInLayersRow*`), distances (`SuperDistancesTab`, its own markup), optimization-parameters | — |

Edge states (decided, see "Resolved ambiguities"): super-model with an empty network renders `SuperReadinessPanel` instead of the table (`Workspace.tsx:4816`), so Save stays in the row there; with no scenario (`create-first-scenario-cta`) Save stays in the row.

### C5 — measured write size vs. the scenario body limit

`MAX_IMPORT_BYTES = 2 * 1024 * 1024` = **2,097,152 bytes** (`lib/import-schema/src/index.ts:24`), applied to `PATCH /api/scenarios/:id` by `app.ts:97` (`scenarioWriteJsonBody`). Measured on 2026-11-25 with node over `solvers/delivery-teaching-us/dataset/costs.json` (10,329 pairs, Base 0 … 3268.8665), serialising `{"inputs":{"laneCostOverrides":[{fromId,toId,cost}…]}}` with `cost = round2(Base × m)`:

| multiplier | bytes | share of limit |
|---|---|---|
| 1 | 463,259 | 22.1 % |
| 1.37 | 464,845 | 22.2 % |
| 10 | 473,512 | 22.6 % |
| 123.45 | 484,892 | 23.1 % |
| every cost = `Number.MAX_VALUE` (longest JSON number, 23 chars) | 634,990 | 30.3 % |

The rest of the inputs blob adds at most a few tens of KB (313 customer overrides). An over-limit Apply is therefore not reachable with today's dataset, **but spec C5 requires the guard, so Task 5 ships it** (Codex adversarial review of the plans, 2026-11-25): before any state change, the Apply handler builds the exact PATCH body the save will send (`wholeInputsBody`, the one builder `saveWholeInputsAsync` also uses), measures its UTF-8 bytes (`new TextEncoder().encode(JSON.stringify(body)).length`, which is what `express.json`'s limit counts) against `MAX_IMPORT_BYTES`, and on overflow writes nothing and says "Filter to N rows or fewer, then apply again.", with N = floor((limit − bytes without the applied rows) / average bytes per applied row). The limit has one source: `MAX_IMPORT_BYTES` is already exported by the shared `@workspace/import-schema` (`lib/import-schema/src/index.ts:24`), which `app.ts:9` imports for the server's parser and the studio already depends on (`ImportDialog.tsx:7`), so the studio imports the same constant — no mirror, no drift test. The guard is tested with an injected small limit (Workspace's `writeLimitBytes` prop). The measured bound stays pinned too: a vitest fails if the dataset or row shape ever grows to half the limit (Task 5). A cost that overflows to `Infinity` serialises as `null`, the server's Zod (`validation/inputs/delivery.ts:13`, `z.number().finite().nonnegative()`) rejects it with a 422 sentence, and the Apply failure toast shows that sentence via `describeWriteError` — no client-side special case.

### C5 — how the filtered rows across pages are read

There is **no external API today**. `DataTable` computes them internally: `useTableFilters(rows, descriptors)` returns `filteredRows` (`DataTable.tsx:92-93`) — every row matching the filter, before sort (`:108-118`) and before `usePagedRows` slices 50 (`:121`). Only the count leaves the component (`:324-326`). Task 5 adds one optional prop, `renderToolbarAction?: (filteredRows: T[]) => ReactNode`, rendered in the toolbar after `toolbar.extra` and passed exactly that array.

### C5 — STOP: the spec's "Adjust Cost Table" premise does not match the solver

The spec says "Costs only change the solve when **Adjust Cost Table** is on (`solve.py:1728`); when it is off, the table shows a one-line note saying so". The code says otherwise: `solve_delivery` applies every `laneCostOverrides` entry to `cost` unconditionally (`solve.py:1828-1837`), and `_effective_delivery_costs` returns that overridden `cost` unchanged when the toggle is off (`:1728-1729`), so the objective (`:1753`) uses edited costs either way — the toggle only adds the per-mile rates. `tests/test_delivery.py:143-152` proves it: with `costAdjustEnabled: False` a zero-cost override lowers the objective by exactly `base_cost × demand`. A note saying costs do not matter while the toggle is off would be false. **Owner decision D1 is required before Task 5 Step 13** (see that step); every other step of Task 5 is independent of it. Recommended: **A — no note.**

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `artifacts/studio/src/components/ui/popover.tsx` (modify `:22`) | 1 | Shared popover z-index |
| `artifacts/studio/e2e/wqf-c1-popover-stacking.spec.ts` (create) | 1 | Real-browser paint-order proof |
| `artifacts/studio/src/components/data-table/ToolbarSaveSlot.ts` (create) | 2 | Context carrying the Workspace Save cluster into a `DataTable` |
| `artifacts/studio/src/components/data-table/DataTable.tsx` (modify `:9`, `:309-332`) | 2, 5 | Render the Save slot beside Filter (2); render-prop over filtered rows (5) |
| `artifacts/studio/src/components/data-table/types.ts` (modify `:113-138`) | 5 | `renderToolbarAction` prop |
| `artifacts/studio/src/pages/Workspace.tsx` (modify) | 2, 4, 5 | Save-beside-Filter list + placement (2); location map to the cost tab (4); Apply handler with the size guard, `wholeInputsBody`, `writeLimitBytes` prop (5) |
| `artifacts/studio/e2e/wqf-c2-save-beside-filter.spec.ts` (create) | 2 | Real-browser placement proof |
| `artifacts/studio/src/lib/chapters.ts` (modify `:94,:97`) | 3 | Chapter 5 title |
| `artifacts/studio/src/lib/deliveryCosts.ts` (create) | 4, 5 | `round2`, `formatCost2` (4); `pairKey`, `applyBaseMultiplier`, `parseMultiplier`, `jsonBytes`, `rowsThatFit` (5) |
| `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` (modify) | 4, 5 | Names + 2 dp (4); Base multiplier control (5) |
| `artifacts/studio/e2e/wqf-c5-base-multiplier.spec.ts` (create) | 5 | Real-browser Apply → persisted → reload |
| tests under `artifacts/studio/src/__tests__/`, `src/lib/*.test.ts` | 2–5 | listed per task |
| sibling e2e specs (rewritten only if they break) | 6 | `quick-fixes.spec.ts`, `delivery-teaching.spec.ts`, others found by the grep |
| `docs/CHANGELOG-implementation.md` (append) | every task | One entry per task commit |

## Task order and dispatch

| Task | Role | Base | Can run in parallel with |
|---|---|---|---|
| 0 | lead | — | — |
| 1 `[WQF-C1]` | frontend-engineer | `wqf-c` tip after Task 0 | 2, 3 |
| 2 `[WQF-C2]` | frontend-engineer | `wqf-c` tip after Task 0 | 1, 3 |
| 3 `[WQF-C3]` | frontend-engineer | `wqf-c` tip after Task 0 | 1, 2 |
| 4 `[WQF-C4]` (C4+C6) | frontend-engineer | `wqf-c` tip **after Task 2 is cherry-picked** | — |
| 5 `[WQF-C5]` | frontend-engineer | `wqf-c` tip **after Task 4 is cherry-picked** | — |
| 6 `[WQF-C6-QA]` | qa-sdet | `wqf-c` tip after Task 5 | — |
| 7 | lead | `wqf-c` | — |

Tasks 2, 4 and 5 all edit `Workspace.tsx`, and 4/5 both edit `DeliveryCostsTab.tsx` and `deliveryCosts.ts`, so they run in sequence on a freshly based worktree. Every task appends to the end of `docs/CHANGELOG-implementation.md`; a cherry-pick conflict there is expected and is resolved by keeping both entries in task order.

---

### Task 0: Bundle branch, worktrees, ledger (lead)

**Files:** none (git state only).

- [ ] **Step 1: Confirm local `main` is not stale and the plan commit exists**

```bash
cd /Users/shubhamkr/network-optimization-studio
git fetch origin
git rev-parse --abbrev-ref HEAD                       # expect: watbot-qf-spec
git merge-base --is-ancestor origin/main main; echo "main-has-origin=$?"   # expect 0
git log --oneline -1 -- docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md   # the plan commit; note its SHA as PLAN_SHA
```

Expected: `main-has-origin=0` and one log line. If the plan file is not committed yet, commit it on `watbot-qf-spec` first (`[WQF] plan: Part C studio and Chapter 5`), with the commit guard.

- [ ] **Step 2: Create the bundle branch and the three parallel worktrees**

```bash
git branch wqf-c <PLAN_SHA>
git worktree add --lock /Users/shubhamkr/nos-wqf-c1 -b wqf-c1-work wqf-c
git worktree add --lock /Users/shubhamkr/nos-wqf-c2 -b wqf-c2-work wqf-c
git worktree add --lock /Users/shubhamkr/nos-wqf-c3 -b wqf-c3-work wqf-c
git rev-parse wqf-c          # BASE_SHA for Tasks 1-3
```

Then `pnpm install --frozen-lockfile` in each worktree. Tasks 4, 5 and 6 get their worktrees later (`/Users/shubhamkr/nos-wqf-c4`, `…-c5`, `…-c6`, branches `wqf-c4-work` etc.), each based on the `wqf-c` tip at that moment.

- [ ] **Step 3: Seed the task ledger** — `TaskCreate` one entry per Task 1–7 plus the process gates (per-task Opus review + ponytail-review, cherry-pick + re-gate, full `pnpm gate`, e2e gate, sibling-spec grep, finishing skill, `/harness-retro WQF-C`, merge/review/push/deploy approval stops).

- [ ] **Step 4: Dispatch prompts name these docs** (AGENTS.md rule 7): this plan's task section; `artifacts/studio/CLAUDE.md` (describeWriteError, jsdom-cannot-see-CSS); `artifacts/studio/e2e/CLAUDE.md` (E2E_BASE_URL, two-server recipe, elementFromPoint); `docs/superpowers/flake-registry.md` (match failures by test name).

---

### Task 1: `[WQF-C1]` Output Map summary above the result cards

**Role:** frontend-engineer. **Worktree:** `/Users/shubhamkr/nos-wqf-c1`, branch `wqf-c1-work`, base `BASE_SHA`.

**Files:**
- Modify: `artifacts/studio/src/components/ui/popover.tsx:22`
- Create: `artifacts/studio/e2e/wqf-c1-popover-stacking.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append)

**Interfaces:** Consumes nothing. Produces nothing other tasks call (the class change is global; the caller audit above is the contract).

- [ ] **Step 1: Sanity check and skills**

```bash
cd /Users/shubhamkr/nos-wqf-c1 && git rev-parse --abbrev-ref HEAD   # must print wqf-c1-work, else STOP
git merge-base --is-ancestor <BASE_SHA> HEAD; echo $?               # must print 0, else STOP
```

Invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. (Overkill check: one class on the shared primitive is the smallest change that fixes every popover-over-map case; a per-caller `className="z-[1100]"` on `OutputMapNarrative` alone is equally small but leaves the next popover opened over a map broken, which the spec explicitly asks to prevent.)

- [ ] **Step 2: Write the failing real-browser test**

Create `artifacts/studio/e2e/wqf-c1-popover-stacking.spec.ts`:

```ts
/**
 * WQF-C1 — the Output Map summary popover (ⓘ) paints ABOVE the result cards.
 * Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md). The result is SEEDED; the solver never runs.
 *
 * The cards' wrapper is `pointer-events-none` (OutputMapTab.tsx:447), so a bare elementFromPoint
 * skips the card and "finds" the popover even when the card paints on top (e2e/CLAUDE.md). The test
 * first makes the card hit-testable — pointer-events never changes paint order — so the element
 * under the point is the painted one. It also asserts the boxes overlap, else "which is on top"
 * is not a question and the test could not fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";
import { seedSolvedResult } from "./helpers/seedSolvedResult";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const MODEL = "p-median-us";
const here = path.dirname(fileURLToPath(import.meta.url));
const solvedFixture = () => JSON.parse(fs.readFileSync(path.join(here, "fixtures/solved", `${MODEL}.json`), "utf8"));
const chapterPath = CHAPTERS.find(c => c.modelId === MODEL)!.path;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc1-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

test("WQF-C1: the Output Map summary popover paints above the Objective card", async ({ page }) => {
  await register(page);
  const create = await page.request.post("/api/scenarios", { data: { name: "E2E WQF-C1", modelId: MODEL, inputs: SOLVED_MODEL_INPUTS[MODEL] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  try {
    await seedSolvedResult(page, id, solvedFixture());
    await page.goto(`${chapterPath}?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
    await page.getByTestId("sidebar-output-output-map").click({ timeout: T });
    const card = page.getByTestId("output-map-metric-overlay");
    await expect(card).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("button-output-map-info").click({ timeout: T });
    const pop = page.getByTestId("output-map-narrative");
    await expect(pop).toBeVisible({ timeout: T });

    const a = (await pop.boundingBox())!;
    const b = (await card.boundingBox())!;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    expect(right - left, "popover and card overlap horizontally").toBeGreaterThan(4);
    expect(bottom - top, "popover and card overlap vertically").toBeGreaterThan(4);

    await page.addStyleTag({
      content: '[data-testid="output-map-metric-overlay"], [data-testid="output-map-metric-overlay"] * { pointer-events: auto !important; }',
    });
    const topmost = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid="output-map-narrative"], [data-testid="output-map-metric-overlay"]')?.getAttribute("data-testid") ?? null;
    }, [(left + right) / 2, (top + bottom) / 2] as [number, number]);
    expect(topmost, "the painted element at the overlap").toBe("output-map-narrative");

    // Stacking asserted as stacking: Radix copies the content's z-index onto its wrapper.
    const z = await pop.evaluate(el => Number(getComputedStyle(el.closest("[data-radix-popper-content-wrapper]")!).zIndex));
    expect(z).toBeGreaterThan(1000);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Start the two servers (Global Constraints recipe) from `/Users/shubhamkr/nos-wqf-c1`, then:

```bash
cd /Users/shubhamkr/nos-wqf-c1/artifacts/studio && E2E_BASE_URL=http://localhost:5273 npx playwright test e2e/wqf-c1-popover-stacking.spec.ts
```

Expected: FAIL at `the painted element at the overlap` — `Expected: "output-map-narrative"  Received: "output-map-metric-overlay"`. If it instead fails on an overlap assertion, the default viewport does not overlap the two boxes: STOP and report (do not loosen the overlap check).

- [ ] **Step 4: Implement**

In `artifacts/studio/src/components/ui/popover.tsx`, line 22, change the first class from `z-50` to `z-[1100]` and add a comment above the `cn(` call:

```tsx
      // WQF-C1 — above the Output Map's result cards (`z-[1000]`, OutputMapTab.tsx:447), which sit
      // outside the map's own stacking context. Caller audit: docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md.
      className={cn(
        "z-[1100] w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
```

- [ ] **Step 5: Run it to verify it passes**

Same command as Step 3. Expected: `1 passed`.

- [ ] **Step 6: Non-vacuity — remove the change, see red, restore**

Temporarily edit line 22 back to `z-50`, re-run Step 3's command → expect the same FAIL as Step 3. Restore `z-[1100]`, re-run → `1 passed`. Confirm `git diff artifacts/studio/src/components/ui/popover.tsx` shows only the intended change.

- [ ] **Step 7: Sibling popover specs still pass**

```bash
cd /Users/shubhamkr/nos-wqf-c1/artifacts/studio && E2E_BASE_URL=http://localhost:5273 npx playwright test e2e/output-map-quick-fixes.spec.ts e2e/watbot.spec.ts e2e/import.spec.ts
```

Expected: all pass (these open the narrative popover, WatBot citation popovers, and FilterMenu inside ImportDialog). A failure here is matched against `docs/superpowers/flake-registry.md` by test name and re-run twice in isolation before being treated as real.

- [ ] **Step 8: Typecheck + studio unit suite**

```bash
cd /Users/shubhamkr/nos-wqf-c1 && pnpm --filter studio run typecheck && pnpm --filter studio test
```

Expected: typecheck clean; vitest `Tests  N passed` with 0 failed (record N).

- [ ] **Step 9: Changelog entry and commit**

Append to `docs/CHANGELOG-implementation.md`:

```markdown
## WQF-C1 — Output Map summary above the result cards (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 1; spec Part C1.
- `components/ui/popover.tsx`: shared `PopoverContent` `z-50` → `z-[1100]`. The Output Map result cards (`OutputMapTab.tsx:447`, `z-[1000]`) sit outside `.leaflet-container`'s `z-index: 0` context, so they out-ranked every popover opened over the map.
- Caller audit (plan, "C1 — every overlay layer"): five `PopoverContent` callers; only the Output Map ⓘ changes stacking. The one other changed relationship: an open popover now draws over a toast (`z-[100]`) where they overlap — accepted, no caller relies on the reverse.
- Test: `e2e/wqf-c1-popover-stacking.spec.ts` (real browser; makes the click-through card hit-testable before `elementFromPoint`, asserts overlap first). Red before, green after; reverting to `z-50` turns it red again.
- Gate: studio typecheck clean; studio vitest <N from Step 8> passed; sibling e2e (output-map-quick-fixes, watbot, import) <result from Step 7>.
```

```bash
cd /Users/shubhamkr/nos-wqf-c1
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/ui/popover.tsx artifacts/studio/e2e/wqf-c1-popover-stacking.spec.ts docs/CHANGELOG-implementation.md
git commit artifacts/studio/src/components/ui/popover.tsx artifacts/studio/e2e/wqf-c1-popover-stacking.spec.ts docs/CHANGELOG-implementation.md \
  -m "[WQF-C1] raise the shared popover above the Output Map result cards"
```

(End the message with the Co-Authored-By trailer your session's attribution instruction specifies.)

---

### Task 2: `[WQF-C2]` Save beside Filter on input tables

**Role:** frontend-engineer. **Worktree:** `/Users/shubhamkr/nos-wqf-c2`, branch `wqf-c2-work`, base `BASE_SHA`.

**Files:**
- Create: `artifacts/studio/src/components/data-table/ToolbarSaveSlot.ts`
- Modify: `artifacts/studio/src/components/data-table/DataTable.tsx:9` (imports), `:309-332` (toolbar)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` — `:1288` (list), after `:2896` (`saveBesideFilter`), `:4618-4620` (`saveCluster`), `:4744-4789` (toolbar row), `:4801` (provider)
- Test: `artifacts/studio/src/__tests__/DataTable.test.tsx` (append), `src/__tests__/Workspace.TabCoverage.test.tsx` (`:125`, `:170-181`, seven call sites), `src/__tests__/Workspace.test.tsx` (delivery block `:1260`), `src/__tests__/Workspace.Super.test.tsx:276-291` (rewrite QFX-1)
- Create: `artifacts/studio/e2e/wqf-c2-save-beside-filter.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces `ToolbarSaveSlot: React.Context<ReactNode>` (default `null`) from `@/components/data-table/ToolbarSaveSlot`.
- Produces `export const SAVE_BESIDE_FILTER_TABS: Record<string, readonly string[]>` from `@/pages/Workspace`.
- DataTable renders the slot inside `<div className="contents" data-testid="data-table-save-slot">`; the Workspace cluster is `<div data-testid="workspace-save-cluster">` (same element in both locations). Task 6 and later tests locate Save by these two test ids.

- [ ] **Step 1: Sanity check and skills** — first Bash: `cd /Users/shubhamkr/nos-wqf-c2 && git rev-parse --abbrev-ref HEAD` (must print `wqf-c2-work`), then `git merge-base --is-ancestor <BASE_SHA> HEAD; echo $?` (must print 0). Invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail`. (Overkill check: threading a `save` prop through 13 tab components to their `DataTable` is the alternative; one context consumed by the one shared `DataTable` touches 2 files instead of 15 and keeps every tab's props unchanged. A static model/tab list is simpler than DataTables "claiming" the slot at runtime, which needs effects and state round-trips.)

- [ ] **Step 2: Write the failing DataTable tests**

Append to `artifacts/studio/src/__tests__/DataTable.test.tsx` (add the import at the top with the others):

```tsx
import { ToolbarSaveSlot } from "@/components/data-table/ToolbarSaveSlot";

describe("DataTable — Workspace Save slot (WQF-C2)", () => {
  const slot = <button type="button" data-testid="slot-save">Save</button>;
  const withSlot = (rows: Row[]) =>
    render(
      <ToolbarSaveSlot.Provider value={slot}>
        <DataTable<Row> rows={rows} rowKey={r => r.id} columns={columns} />
      </ToolbarSaveSlot.Provider>,
    );

  it("renders the slot immediately right of the Filter trigger", () => {
    withSlot(makeRows(11));
    const filter = screen.getByTestId("button-filter-menu-trigger");
    expect(filter.nextElementSibling).toBe(screen.getByTestId("data-table-save-slot"));
    expect(within(screen.getByTestId("data-table-save-slot")).getByTestId("slot-save")).toBeInTheDocument();
  });

  it("still renders the slot, and the toolbar, when Filter is hidden at 10 rows or fewer", () => {
    withSlot(makeRows(3));
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("slot-save")).toBeInTheDocument();
  });

  it("renders no slot without a provider", () => {
    renderTable({ rows: makeRows(11) });
    expect(screen.queryByTestId("data-table-save-slot")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd /Users/shubhamkr/nos-wqf-c2 && pnpm --filter studio exec vitest run src/__tests__/DataTable.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/data-table/ToolbarSaveSlot"`.

- [ ] **Step 4: Implement the slot**

Create `artifacts/studio/src/components/data-table/ToolbarSaveSlot.ts`:

```ts
import { createContext, type ReactNode } from "react";

/** WQF-C2 — the Workspace Save cluster, rendered by DataTable beside its Filter button.
 * `null` (the default) = this table shows no Save. Provided by Workspace.tsx only on the
 * model/tab pairs in `SAVE_BESIDE_FILTER_TABS`. */
export const ToolbarSaveSlot = createContext<ReactNode>(null);
```

In `DataTable.tsx`, line 9 becomes:

```tsx
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
```

add after line 17:

```tsx
import { ToolbarSaveSlot } from "./ToolbarSaveSlot";
```

add as the first line inside `DataTable(...) {` (before `const descriptors`):

```tsx
  const saveSlot = useContext(ToolbarSaveSlot);
```

replace lines 309-311 with:

```tsx
  const hasToolbar = Boolean(
    toolbar?.upload || toolbar?.download || toolbar?.add || toolbar?.extra || showFilter || saveSlot != null || testIds.count || testIds.toolbar,
  );
```

and replace line 329 with:

```tsx
            {showFilter && <FilterMenu descriptors={descriptors} tableFilters={tableFilters} triggerTestId={testIds.filterTrigger} />}
            {saveSlot != null && <div className="contents" data-testid="data-table-save-slot">{saveSlot}</div>}
```

- [ ] **Step 5: Run DataTable tests — expect PASS**

Same command as Step 3. Expected: all DataTable tests pass.

- [ ] **Step 6: Write the failing Workspace tests**

(a) `src/__tests__/Workspace.TabCoverage.test.tsx` — line 125 becomes:

```ts
import { Workspace, inputEntriesForModel, SAVE_BESIDE_FILTER_TABS } from "@/pages/Workspace";
```

Replace `runTabCoverage` (`:170-181`) with:

```ts
// WQF-C2 — where the shared Save rendered: beside Filter in a DataTable, in the toolbar row, or inline (Input Map Layers row).
function saveLocation(): "table" | "row" | "inline" | "none" {
  const save = screen.queryByTestId("button-save");
  if (!save) return "none";
  if (save.closest('[data-testid="data-table-save-slot"]')) return "table";
  if (save.closest('[data-testid="workspace-toolbar-row"]')) return "row";
  return "inline";
}

function runTabCoverage(inputs: TabCoverageEntry[], outputs: TabCoverageEntry[], modelId?: string) {
  for (const { sidebarId, tabTestId } of inputs) {
    fireEvent.click(screen.getByTestId(`sidebar-input-${sidebarId}`));
    expect(screen.getByTestId(tabTestId)).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    // WQF-C2 — a listed tab must really mount a DataTable (else Save would vanish: "none"); every other
    // tab keeps Save in the toolbar row. Input Map is skipped: its inline Save is not part of this change.
    if (modelId && sidebarId !== "input-map") {
      const expected = (SAVE_BESIDE_FILTER_TABS[modelId] ?? []).includes(sidebarId) ? "table" : "row";
      expect(saveLocation(), `${modelId}/${sidebarId}`).toBe(expected);
    }
  }
  for (const { sidebarId, tabTestId } of outputs) {
    fireEvent.click(screen.getByTestId(`sidebar-output-${sidebarId}`));
    expect(screen.getByTestId(tabTestId)).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  }
}
```

Pass the model id as the third argument at each of the seven `runTabCoverage(` calls (`:265` p-median-us, `:364` transport-coal, `:472` two-echelon-gold-au, `:587` two-echelon-jade-us, `:700` p-median-brazil, `:802` max-coverage-us, `:911` delivery-teaching-us): each call's closing `],\n    );` becomes `],\n      "<that model id>",\n    );`.

Append at the end of the file:

```ts
it("WQF-C2: every SAVE_BESIDE_FILTER_TABS entry names a real sidebar tab of its model (31 pairs)", () => {
  for (const [model, tabs] of Object.entries(SAVE_BESIDE_FILTER_TABS)) {
    const ids = inputEntriesForModel(model as Parameters<typeof inputEntriesForModel>[0]).map(e => e.id);
    for (const t of tabs) expect(ids, `${model}/${t}`).toContain(t);
  }
  expect(Object.values(SAVE_BESIDE_FILTER_TABS).flat()).toHaveLength(31);
});
```

(b) `src/__tests__/Workspace.test.tsx`, inside `describe("Workspace — delivery-teaching-us Delivery Costs tab (Task 11)"` (starts `:1260`), after the "shows a Save toolbar" test:

```ts
  it("WQF-C2: Delivery Costs' Save sits in the table toolbar and no toolbar row renders; Optimization Parameters keeps the row", () => {
    renderDeliveryWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
    expect(within(screen.getByTestId("delivery-costs-tab-toolbar")).getByTestId("button-save")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-toolbar-row")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(within(screen.getByTestId("workspace-toolbar-row")).getByTestId("button-save")).toBeInTheDocument();
  });
```

(c) `src/__tests__/Workspace.Super.test.tsx`, replace the test at `:276-291` (`"QFX-1: Import network + Export ▾ sit right of Save on every super input tab, never in the header"`) with:

```ts
  it("QFX-1 / WQF-C2: Save, Import network and Export ▾ stay one cluster on every super input tab — beside Filter on table tabs, in the toolbar row elsewhere", () => {
    renderWorkspace();
    for (const id of ["super-header-import", "super-header-export", "super-header-export-csv", "super-header-export-xlsx"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    const TABLE_TABS = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "transportCosts"];
    for (const tab of ["input-map", "products", "plants", "warehouses", "customers", "plantProducts", "demand", "distances", "transportCosts", "optimization-parameters"]) {
      fireEvent.click(screen.getByTestId(`sidebar-input-${tab}`));
      const cluster = screen.getByTestId("workspace-save-cluster");
      const trio = [...cluster.querySelectorAll("[data-testid]")]
        .map(e => e.getAttribute("data-testid"))
        .filter(id => id === "button-save" || id === "super-toolbar-import" || id === "super-toolbar-export");
      expect(trio, tab).toEqual(["button-save", "super-toolbar-import", "super-toolbar-export"]);
      const inTable = TABLE_TABS.includes(tab);
      expect(cluster.closest('[data-testid="data-table-save-slot"]') !== null, `${tab} in table`).toBe(inTable);
      expect(screen.queryByTestId("workspace-toolbar-row") !== null, `${tab} toolbar row`).toBe(!inTable);
    }
    expect(screen.getByTestId("super-toolbar-export")).toHaveTextContent("Export");
    expect(screen.getByTestId("super-readiness-ok")).toBeInTheDocument();   // last tab is Optimization Parameters (SM-9, unchanged)
  });
```

- [ ] **Step 7: Run to verify they fail**

```bash
cd /Users/shubhamkr/nos-wqf-c2 && pnpm --filter studio exec vitest run src/__tests__/Workspace.TabCoverage.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/Workspace.Super.test.tsx
```

Expected: FAIL — TabCoverage: `SAVE_BESIDE_FILTER_TABS` is undefined (TypeError on `Object.entries(undefined)` / `expected 'row' to be 'table'`); Workspace.test: `Unable to find an element by: [data-testid="button-save"]` inside `delivery-costs-tab-toolbar`; Super: `Unable to find … workspace-save-cluster`.

- [ ] **Step 8: Implement in Workspace.tsx**

(a) After `const SUPER_INPUT_TABS = …` (`:1288`):

```ts
// WQF-C2 (spec Part C2) — input tabs whose Save renders today (`showToolbarSave`) AND whose content is a
// DataTable: there Save moves into the table toolbar beside Filter. Derived per model/tab in
// docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md ("C2 — model/tab pairs"). A tab not listed keeps
// the toolbar row; Workspace.TabCoverage.test.tsx fails if a listed tab stops mounting a DataTable.
export const SAVE_BESIDE_FILTER_TABS: Record<string, readonly string[]> = {
  "p-median-us": ["customers", "warehouses", "distances"],
  "p-median-brazil": ["customers", "warehouses", "distances"],
  "max-coverage-us": ["customers", "warehouses", "distances"],
  "delivery-teaching-us": ["customers", "warehouses", "deliveryCosts"],
  "transport-coal": ["mines", "stations", "laneCosts"],
  "two-echelon-gold-au": ["refineries", "customers", "distances"],
  "two-echelon-jade-us": ["plants", "capability-matrix", "warehouses", "customers", "distances", "transportCosts"],
  "super-model": ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "transportCosts"],
};
```

(b) Immediately after `const superIsEmpty = …` (`:2896`):

```ts
  // WQF-C2 — Save renders beside Filter instead of in the toolbar row. Never when no table is mounted:
  // no scenario (first-run CTA), no draft yet, or an empty super network (SuperReadinessPanel replaces the table).
  const saveBesideFilter =
    showToolbarSave &&
    currentScenario != null &&
    localInputs != null &&
    !superIsEmpty &&
    activeView != null &&
    (SAVE_BESIDE_FILTER_TABS[modelId] ?? []).includes(activeView.entity);
```

(c) Between the end of `exportValue` (`:4618`, the line `};`) and the main `return (` (`:4620`):

```tsx
  // WQF-C2 — the Save cluster (unchanged content, moved verbatim from the toolbar row): rendered either in
  // the toolbar row or, on SAVE_BESIDE_FILTER_TABS, inside the tab's DataTable via ToolbarSaveSlot.
  const saveCluster = (
    <div className="flex items-center gap-2" data-testid="workspace-save-cluster">
      {(ordinaryDirty || lensDirty) && (
        <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
          Unsaved changes
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={handleSaveClick}
        disabled={!saveEnabled || saveIsPending}
        data-testid="button-save"
        className={saveEnabled ? "border-primary text-[var(--text-primary)] hover:bg-primary/10" : ""}
      >
        <Save className="w-3.5 h-3.5 mr-1" />
        {saveIsPending ? "Saving…" : saveLabel}
      </Button>
      {/* QFX-1 — super's whole-network Import / Export sit right of Save. Import is hidden while browsing
          history (it writes); Export stays (user decision C2) and exports the latest SAVED network. */}
      {modelId === "super-model" && currentScenario && (
        <>
          {!isBrowsingHistoryNow && (
            <Button size="sm" variant="outline" onClick={() => setSuperImportOpen(true)} data-testid="super-toolbar-import">
              Import network
            </Button>
          )}
          <DownloadMenu
            label="Export"
            testId="super-toolbar-export"
            itemTestIds={{ csv: "super-toolbar-export-csv", json: "super-toolbar-export-json", xlsx: "super-toolbar-export-xlsx" }}
            onDownload={format => void handleSuperExport(format)}
          />
        </>
      )}
    </div>
  );
```

(d) Replace the whole block `:4744-4789` (`{showToolbarSave && ( … )}`, including its A1.1 comment) with:

```tsx
          {showToolbarSave && !saveBesideFilter && (
            // A1.1 (fix) — explicit Save (isDirty-gated, useUpdateScenario on click). R4 — suppressed on the
            // Input Map tabs that render Save inline in their Layers row (saveInLayersRow*). WQF-C2 — also
            // suppressed on SAVE_BESIDE_FILTER_TABS, where the same cluster renders beside the table's Filter.
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b flex-shrink-0 bg-muted/10" data-testid="workspace-toolbar-row">
              <div className="ml-auto">{saveCluster}</div>
            </div>
          )}
```

(e) Add the import next to the other data-table imports:

```ts
import { ToolbarSaveSlot } from "@/components/data-table/ToolbarSaveSlot";
```

and wrap the tab-content region: the line `<ExportProvider value={exportValue}>` (`:4801`) becomes

```tsx
            <ExportProvider value={exportValue}>
              <ToolbarSaveSlot.Provider value={saveBesideFilter ? saveCluster : null}>
```

and the matching `</ExportProvider>` (`:4829`) becomes

```tsx
              </ToolbarSaveSlot.Provider>
            </ExportProvider>
```

- [ ] **Step 9: Run the Workspace tests — expect PASS**

Same command as Step 7. Expected: all pass. If a TabCoverage case reports `"none"` for a listed tab, that tab does not mount a `DataTable` in the mock: re-check the C2 table, do not edit the list to fit the test.

- [ ] **Step 10: Write the failing real-browser placement test**

Create `artifacts/studio/e2e/wqf-c2-save-beside-filter.spec.ts`:

```ts
/**
 * WQF-C2 — Save sits beside Filter in the table toolbar (spec Part C2). Layout lives in CSS, so this is
 * a real-browser test (jsdom has no Tailwind). Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md).
 */
import { test, expect, type Page, type Locator } from "./fixtures";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { CHAPTERS } from "../src/lib/chapters";

const T = 10_000;
const chapterPath = (modelId: string) => CHAPTERS.find(c => c.modelId === modelId)!.path;
const box = async (l: Locator) => (await l.boundingBox())!;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc2-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

async function openTab(page: Page, modelId: string, tab: string): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: `E2E WQF-C2 ${modelId}`, modelId, inputs: SOLVED_MODEL_INPUTS[modelId] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  await page.goto(`${chapterPath(modelId)}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await page.getByTestId(`sidebar-input-${tab}`).click({ timeout: T });
  return id;
}

test("WQF-C2: on Chapter 5 Customers (313 rows) Save is the next control right of Filter, on the same line", async ({ page }) => {
  await register(page);
  const id = await openTab(page, "delivery-teaching-us", "customers");
  try {
    const toolbar = page.getByTestId("customers-tab-toolbar");
    const filter = toolbar.getByTestId("button-filter-menu-trigger");
    const save = toolbar.getByTestId("button-save");
    await expect(filter).toBeVisible({ timeout: 15_000 });
    await expect(save).toBeVisible({ timeout: T });
    await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
    const f = await box(filter);
    const s = await box(save);
    expect(Math.abs(f.y + f.height / 2 - (s.y + s.height / 2)), "same line").toBeLessThanOrEqual(4);
    const gap = s.x - (f.x + f.width);
    expect(gap, "Save starts right after Filter").toBeGreaterThanOrEqual(0);
    expect(gap, "no control between them").toBeLessThanOrEqual(16);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});

test("WQF-C2: on JADE Transportation Costs (2 rows, Filter hidden) Save takes Filter's place at the toolbar's right end, above the table", async ({ page }) => {
  await register(page);
  const id = await openTab(page, "two-echelon-jade-us", "transportCosts");
  try {
    const tab = page.getByTestId("transport-costs-tab");
    const save = tab.getByTestId("data-table-save-slot").getByTestId("button-save");
    await expect(save).toBeVisible({ timeout: 15_000 });
    await expect(tab.getByTestId("button-filter-menu-trigger")).toHaveCount(0);
    await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
    const s = await box(save);
    const head = await box(tab.locator("thead"));
    expect(s.y + s.height, "Save sits above the table").toBeLessThanOrEqual(head.y);
    // The slot's parent is the toolbar's right-aligned group; its parent is the toolbar row itself.
    const toolbarRight = await save.evaluate(el => el.closest('[data-testid="data-table-save-slot"]')!.parentElement!.parentElement!.getBoundingClientRect().right);
    expect(Math.abs(s.x + s.width - toolbarRight), "right end of the toolbar").toBeLessThanOrEqual(2);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
```

- [ ] **Step 11: Run it — expect PASS now, then prove non-vacuity**

Start the two servers from `/Users/shubhamkr/nos-wqf-c2`, then:

```bash
cd /Users/shubhamkr/nos-wqf-c2/artifacts/studio && E2E_BASE_URL=http://localhost:5273 npx playwright test e2e/wqf-c2-save-beside-filter.spec.ts
```

Expected: `2 passed`. Non-vacuity: temporarily add `&& false` at the end of the `saveBesideFilter` expression, re-run → expect both FAIL (`toolbar.getByTestId("button-save")` / `data-table-save-slot` not found within the timeout). Remove `&& false`, re-run → `2 passed`. Confirm with `git diff` that no `&& false` remains.

- [ ] **Step 12: Guards, typecheck, studio suite**

```bash
cd /Users/shubhamkr/nos-wqf-c2 && pnpm --filter studio run typecheck && pnpm --filter studio test
```

Expected: typecheck clean; vitest 0 failed (record the count). `mutationErrorSurface.test.ts` and `historyReadOnlyTabs.test.ts` must stay green (no `.mutate(`/mount was changed).

- [ ] **Step 13: Changelog and commit**

Append:

```markdown
## WQF-C2 — Save beside Filter on input tables (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 2; spec Part C2.
- `components/data-table/ToolbarSaveSlot.ts` (new context) + `DataTable.tsx`: the Workspace Save cluster renders right of Filter (`data-table-save-slot`), or in Filter's place when Filter is hidden (≤ 10 rows).
- `Workspace.tsx`: `SAVE_BESIDE_FILTER_TABS` — 31 model/tab pairs where Save showed AND the tab is a DataTable (table in the plan); the cluster (`workspace-save-cluster`: unsaved text, Save, and super's Import network/Export) moves as one unit; the toolbar row renders only where Save stays. Gating, behaviour and `button-save` unchanged; Input Map inline Saves unchanged.
- Edge states kept in the row: no scenario, no draft yet, empty super network. During a tab's own `Loading…` (dataset not yet loaded) Save is briefly absent on listed tabs — nothing is dirty then.
- Tests: DataTable slot (RTL); TabCoverage asserts the location of Save on every input tab of seven models plus a 31-pair registry check; Workspace (delivery) and Super QFX-1 rewritten to the cluster; `e2e/wqf-c2-save-beside-filter.spec.ts` (real browser, Filter shown and hidden). Red with `saveBesideFilter && false`, green restored.
- Gate: studio typecheck clean; studio vitest <N from Step 12> passed; wqf-c2 e2e 2/2.
```

Commit (guard first):

```bash
cd /Users/shubhamkr/nos-wqf-c2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
P="artifacts/studio/src/components/data-table/ToolbarSaveSlot.ts artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx artifacts/studio/e2e/wqf-c2-save-beside-filter.spec.ts docs/CHANGELOG-implementation.md"
git add $P
git commit $P -m "[WQF-C2] move Save beside Filter on input tables"
```

---

### Task 3: `[WQF-C3]` Chapter 5 title

**Role:** frontend-engineer. **Worktree:** `/Users/shubhamkr/nos-wqf-c3`, branch `wqf-c3-work`, base `BASE_SHA`.

**Files:**
- Modify: `artifacts/studio/src/lib/chapters.ts:94,97`
- Test: `artifacts/studio/src/lib/chapters.test.ts` (append)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:** none. Consumers read the title from `CHAPTERS` (`pages/Landing.tsx:115` `c.title`; `pages/Workspace.tsx:4652` `activeChapter.title`; `labHeaderTitle`). `git grep "Introduction to Network Design"` outside specs/plans/changelog finds only `chapters.ts:94,97` — no test or e2e asserts the old string. The server manifest name (`solvers/delivery-teaching-us/manifest.json` "Delivery Company Teaching Example") is untouched.

- [ ] **Step 1: Sanity check and skills** — `cd /Users/shubhamkr/nos-wqf-c3 && git rev-parse --abbrev-ref HEAD` (must print `wqf-c3-work`); base guard; invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail`.

- [ ] **Step 2: Write the failing test** — append to `src/lib/chapters.test.ts`:

```ts
describe("chapters — delivery-teaching-us (Chapter 5) title (WQF-C3)", () => {
  it("reads Network Design Fundamentals on the landing card and the lab header", () => {
    const chapter = chapterForModelId("delivery-teaching-us");
    expect(chapter?.chapter).toBe("Chapter 5");
    expect(chapter?.title).toBe("Network Design Fundamentals");
    expect(chapter?.labHeaderTitle).toBe("Network Design Fundamentals · Model Lab");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd /Users/shubhamkr/nos-wqf-c3 && pnpm --filter studio exec vitest run src/lib/chapters.test.ts
```

Expected: `expected 'Introduction to Network Design' to be 'Network Design Fundamentals'`.

- [ ] **Step 4: Implement** — `chapters.ts:94` → `    title: "Network Design Fundamentals",`; `:97` → `    labHeaderTitle: "Network Design Fundamentals · Model Lab",`.

- [ ] **Step 5: Run — expect PASS**, then `pnpm --filter studio run typecheck && pnpm --filter studio test` → 0 failed (record count; `Landing.test.tsx`, `lockedChapterDrift.test.ts` must stay green).

- [ ] **Step 6: Changelog and commit**

```markdown
## WQF-C3 — Chapter 5 retitled "Network Design Fundamentals" (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 3; spec Part C3.
- `lib/chapters.ts:94,97`: landing card title and Model Lab header. Manifest name served by `/api/models` unchanged. No test asserted the old string.
- Test: `lib/chapters.test.ts` (red before, green after).
- Gate: studio typecheck clean; studio vitest <N> passed.
```

```bash
cd /Users/shubhamkr/nos-wqf-c3
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit artifacts/studio/src/lib/chapters.ts artifacts/studio/src/lib/chapters.test.ts docs/CHANGELOG-implementation.md -m "[WQF-C3] retitle Chapter 5 Network Design Fundamentals"
```

---

### Task 4: `[WQF-C4]` Delivery Cost names and two decimals (C4 + C6)

**Role:** frontend-engineer. **Worktree:** `/Users/shubhamkr/nos-wqf-c4`, branch `wqf-c4-work`, base = `wqf-c` tip **after Task 2's commit is cherry-picked** (call it `BASE4`).

**Files:**
- Create: `artifacts/studio/src/lib/deliveryCosts.ts`, `artifacts/studio/src/lib/deliveryCosts.test.ts`
- Modify: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` (`:1-10` imports, `:35-55` props, `:97`, `:136-143`, `:247-273`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (DeliveryCostsTab mount, `:4230-4241` before Task 2's shift — find it with `grep -n "<DeliveryCostsTab" artifacts/studio/src/pages/Workspace.tsx`)
- Test: `src/__tests__/DeliveryCostsTab.test.tsx` (`:75,108,112,314,322` + new block), `src/__tests__/Workspace.test.tsx` (delivery block)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces in `@/lib/deliveryCosts`: `round2(x: number): number` (half-up to 2 dp, `1.005 → 1.01`) and `formatCost2(x: number): string` (`1047.7157 → "1047.72"`, `8 → "8.00"`). Task 5 imports `round2`.
- `DeliveryCostsTab` gains `locationById?: Record<string, { city: string; state: string }>`.

- [ ] **Step 1: Sanity check and skills** — `cd /Users/shubhamkr/nos-wqf-c4 && git rev-parse --abbrev-ref HEAD` (must print `wqf-c4-work`); `git merge-base --is-ancestor <BASE4> HEAD`; invoke karpathy-guidelines and ponytail. (Overkill check: the location map already exists as `chenLocationMapFromInputs` (`Workspace.tsx:1176-1198`) and the formatter as `formatCityState` (`lib/formatLocation.ts:12`); reuse both, add only the two-line rounding helpers.)

- [ ] **Step 2: Write the failing helper tests** — create `src/lib/deliveryCosts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCost2, round2 } from "./deliveryCosts";

describe("round2 / formatCost2 (WQF-C6)", () => {
  it("rounds half up to 2 dp, including binary edge cases", () => {
    expect(round2(1047.7157)).toBe(1047.72);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(622.1149)).toBe(622.11);
    expect(round2(0)).toBe(0);
  });
  it("always displays two decimals", () => {
    expect(formatCost2(1047.7157)).toBe("1047.72");
    expect(formatCost2(8)).toBe("8.00");
    expect(formatCost2(0)).toBe("0.00");
  });
});
```

Run `cd /Users/shubhamkr/nos-wqf-c4 && pnpm --filter studio exec vitest run src/lib/deliveryCosts.test.ts` → expect FAIL `Failed to resolve import "./deliveryCosts"`.

- [ ] **Step 3: Implement the helpers** — create `src/lib/deliveryCosts.ts`:

```ts
// WQF-C5/C6 — numbers in Chapter 5's Delivery Cost table. A cost is billable miles, never a distance:
// no unit conversion here (DeliveryCostsTab.tsx header comment).

/** Round half up to 2 dp. `Number.EPSILON` keeps 1.005 → 1.01 (it is 1.00499… in binary). Costs are ≥ 0. */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Display form, always two decimals: 1047.7157 → "1047.72", 8 → "8.00". */
export function formatCost2(x: number): string {
  return round2(x).toFixed(2);
}
```

Re-run → PASS.

- [ ] **Step 4: Write the failing tab tests**

In `src/__tests__/DeliveryCostsTab.test.tsx`: lines `:108` and `:314` `toHaveValue("99")` → `toHaveValue("99.00")`; lines `:75`, `:112`, `:322` `toHaveTextContent("12.5")` → `toHaveTextContent("12.50")`. Add `within` to the RTL import on line 3. Append:

```tsx
describe("DeliveryCostsTab — names and two decimals (WQF-C4/C6)", () => {
  const LOC = { W33: { city: "Springfield", state: "IL" }, C33: { city: "Arlington", state: "TX" } };

  it("shows From/To as `ID · City, ST` and still filters on the ID", () => {
    mockReferenceCosts(buildPairs(40));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" locationById={LOC} />);
    filterText("from", "W33");
    const row = screen.getByTestId("row-deliverycost-W33-C33");
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(/^W33 · Springfield, IL$/);
    expect(cells[1]).toHaveTextContent(/^C33 · Arlington, TX$/);
    expect(screen.getAllByTestId(/^row-deliverycost-/)).toHaveLength(1);
  });

  it("falls back to the bare ID when a place is unknown", () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 5 }]);
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" locationById={{}} />);
    expect(within(screen.getByTestId("row-deliverycost-W1-C1")).getAllByRole("cell")[0]).toHaveTextContent(/^W1$/);
  });

  it("displays Base and Cost rounded to 2 dp", () => {
    mockReferenceCosts([
      { fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 1047.7157 },
      { fromId: "W1", fromCode: "W1", toId: "C2", toCode: "C2", cost: 1.005 },
    ]);
    render(<DeliveryCostsTab laneCostOverrides={[{ fromId: "W1", toId: "C2", cost: 3.14159 }]} onChange={vi.fn()} modelId="delivery-teaching-us" />);
    expect(within(screen.getByTestId("row-deliverycost-W1-C1")).getAllByRole("cell")[2]).toHaveTextContent(/^1047\.72$/);
    expect(within(screen.getByTestId("row-deliverycost-W1-C2")).getAllByRole("cell")[2]).toHaveTextContent(/^1\.01$/);
    expect(screen.getByTestId("input-deliverycost-W1-C2")).toHaveValue("3.14");
  });

  it("stores a hand-typed cost as typed, not rounded", () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} modelId="delivery-teaching-us" />);
    fireEvent.change(screen.getByTestId("input-deliverycost-W1-C1"), { target: { value: "3.14159" } });
    fireEvent.blur(screen.getByTestId("input-deliverycost-W1-C1"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "W1", toId: "C1", cost: 3.14159 }]);
  });
});
```

In `src/__tests__/Workspace.test.tsx`: add `useGetReferenceCosts` to the `@workspace/api-client-react` import at `:243`, and append inside the delivery describe block:

```ts
  describe("with reference costs loaded", () => {
    beforeEach(() => {
      vi.mocked(useGetReferenceCosts).mockReturnValue({
        data: { pairs: [{ fromId: "CHI", fromCode: "CHI", toId: "C1", toCode: "C1", cost: 10.005 }], distanceUnit: "mi" },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useGetReferenceCosts>);
    });
    afterEach(() => {
      vi.mocked(useGetReferenceCosts).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetReferenceCosts>);
    });

    it("WQF-C4: names From/To from the model's dataset", () => {
      renderDeliveryWorkspace();
      fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
      const cells = within(screen.getByTestId("row-deliverycost-CHI-C1")).getAllByRole("cell");
      expect(cells[0]).toHaveTextContent("CHI · Chicago, IL");
      expect(cells[1]).toHaveTextContent("C1 · New York, NY");
    });
  });
```

(The file's shared `dataset` mock, `:64-67`, is `CHI` Chicago, IL and `C1` New York, NY.)

- [ ] **Step 5: Run — expect FAIL**

```bash
cd /Users/shubhamkr/nos-wqf-c4 && pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.test.tsx src/__tests__/Workspace.test.tsx
```

Expected: FAILs on `toHaveValue("99.00")` (received `"99"`), on `/^W33 · Springfield, IL$/` (received `W33`), on `/^1047\.72$/` (received `1047.7157`), and on `CHI · Chicago, IL`.

- [ ] **Step 6: Implement in DeliveryCostsTab.tsx**

Imports (after `:10`):

```tsx
import { formatCityState } from "@/lib/formatLocation";
import { formatCost2 } from "@/lib/deliveryCosts";
```

Props interface (`:35-55`), add before the closing `}`:

```tsx
  /** WQF-C4 — city/state per warehouse and customer id, from the model's dataset (Workspace). The ID stays
   * first because city names repeat; filter and sort still read the ID (`value`). */
  locationById?: Record<string, { city: string; state: string }>;
```

Line 97 becomes:

```tsx
  const text = draft ?? (currentValue == null ? "" : formatCost2(currentValue));
```

Destructure `locationById` in the component signature (`:136-143`) and add right after it:

```tsx
  const named = (id: string) => {
    const loc = locationById?.[id];
    return loc ? `${id} · ${formatCityState(loc.city, loc.state)}` : id;
  };
```

Columns: `:255` `cell: r => r.fromId,` → `cell: r => named(r.fromId),`; `:264` `cell: r => r.toId,` → `cell: r => named(r.toId),`; `:272` → `cell: r => (r.base == null ? "—" : formatCost2(r.base)),`. Leave every `value:` unchanged.

- [ ] **Step 7: Wire the map in Workspace.tsx** — in the `<DeliveryCostsTab` mount add one prop line after `readOnly={isBrowsingHistoryNow}`:

```tsx
          locationById={chenLocationMapFromInputs(dataset, localInputs)}
```

(`chenLocationMapFromInputs` merges `dataset.warehouses`, `dataset.customers` and any added entities — delivery has none.)

- [ ] **Step 8: Run — expect PASS**, then `pnpm --filter studio run typecheck && pnpm --filter studio test` → 0 failed (record count).

- [ ] **Step 9: Changelog and commit**

```markdown
## WQF-C4 — Delivery Cost table: names and two decimals (C4 + C6) (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 4; spec Parts C4, C6.
- `DeliveryCostsTab.tsx`: From/To cells read `W8 · Atlanta, GA` (ID first; `value` stays the ID, so filter and sort are unchanged); Base and Cost display `formatCost2` (half-up, 2 dp). Hand-typed costs are still stored as typed. Exports are unchanged (raw values).
- `lib/deliveryCosts.ts` (new): `round2`, `formatCost2`. `Workspace.tsx` passes `chenLocationMapFromInputs(dataset, localInputs)`.
- Tests: `lib/deliveryCosts.test.ts`; DeliveryCostsTab names/2-dp/as-typed cases (five existing assertions moved to the 2-dp text); Workspace wiring. All red first.
- Gate: studio typecheck clean; studio vitest <N> passed.
```

```bash
cd /Users/shubhamkr/nos-wqf-c4
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
P="artifacts/studio/src/lib/deliveryCosts.ts artifacts/studio/src/lib/deliveryCosts.test.ts artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx docs/CHANGELOG-implementation.md"
git add $P
git commit $P -m "[WQF-C4] show delivery cost places and two decimals"
```

---

### Task 5: `[WQF-C5]` Base multiplier

**Role:** frontend-engineer. **Worktree:** `/Users/shubhamkr/nos-wqf-c5`, branch `wqf-c5-work`, base = `wqf-c` tip **after Task 4 is cherry-picked** (`BASE5`).

**Files:**
- Modify: `artifacts/studio/src/lib/deliveryCosts.ts`, `src/lib/deliveryCosts.test.ts` (append)
- Modify: `artifacts/studio/src/components/data-table/types.ts:113-138`, `DataTable.tsx` (signature `:74-89`, `hasToolbar`, toolbar left group `:316-320`)
- Modify: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`WorkspaceProps` `:1441-1445` and the signature `:1491`, `saveWholeInputsAsync` `:2205-2220`, new `wholeInputsBody` before it, new handler after `handleSaveInputs` `:2276-2285`, DeliveryCostsTab mount)
- Create: `artifacts/studio/src/__tests__/deliveryCostsWriteSize.test.ts`, `artifacts/studio/e2e/wqf-c5-base-multiplier.spec.ts`
- Test: `src/__tests__/DataTable.test.tsx`, `src/__tests__/DeliveryCostsTab.test.tsx`, `src/__tests__/Workspace.test.tsx` (append)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes `round2` from Task 4 (`@/lib/deliveryCosts`), `LaneCostOverride` (`@/components/workspace/tabs/LaneCostsTab`, already imported by Workspace at `:111`).
- Consumes `MAX_IMPORT_BYTES` from `@workspace/import-schema` — the same constant `app.ts:97` gives `express.json` for `PATCH /scenarios/:id` (studio already depends on the package, `ImportDialog.tsx:7`).
- Produces `pairKey(o: { fromId: string; toId: string }): string`, `applyBaseMultiplier(overrides: LaneCostOverride[], targets: ReadonlyArray<{ fromId: string; toId: string; base: number | null }>, multiplier: number): LaneCostOverride[]`, `parseMultiplier(text: string): number | null`, `jsonBytes(value: unknown): number`, and `rowsThatFit(body: (laneCostOverrides: LaneCostOverride[]) => unknown, next: LaneCostOverride[], appliedKeys: ReadonlySet<string>, limit: number): number | null`.
- Produces `DataTableProps<T>.renderToolbarAction?: (filteredRows: T[]) => ReactNode`.
- `DeliveryCostsTab` gains `onApplyCosts?: (next: LaneCostOverride[], appliedKeys: ReadonlySet<string>) => void` and `applyBlockedReason?: string | null`.
- `Workspace` gains `writeLimitBytes?: number` (default `MAX_IMPORT_BYTES`; tests inject a small one). `wholeInputsBody(patch: Record<string, unknown> = {}): { inputs: Record<string, unknown> }`; `saveWholeInputsAsync(patch: Record<string, unknown> = {}): Promise<Scenario>` sends exactly `wholeInputsBody(patch)` as the mutation's `data`.

- [ ] **Step 1: Sanity check and skills** — `cd /Users/shubhamkr/nos-wqf-c5 && git rev-parse --abbrev-ref HEAD` (must print `wqf-c5-work`); base guard against `BASE5`; invoke karpathy-guidelines and ponytail. (Overkill check: the save path already exists — `saveWholeInputsAsync` — and needs only a one-key patch; a new field-scoped PATCH route would add contract, codegen and server work for no gain. The size guard is required by spec C5 even though today's dataset cannot reach it; it is two small pure helpers plus an early return, it measures the body through the save's own builder rather than a second copy, and it takes the limit from the constant the server already uses — no new contract, no mirror. Simpler alternatives were rejected: no guard at all fails the spec; a hard-coded row cap would drift from the real byte limit.)

- [ ] **Step 2: Failing helper tests** — append to `src/lib/deliveryCosts.test.ts` (extend the import to `{ applyBaseMultiplier, formatCost2, jsonBytes, parseMultiplier, round2, rowsThatFit }`):

```ts
describe("applyBaseMultiplier (WQF-C5)", () => {
  const rows = [
    { fromId: "W1", toId: "C1", base: 10.005 },
    { fromId: "W1", toId: "C2", base: 20 },
    { fromId: "W9", toId: "C9", base: null },
  ];
  it("sets every target with a Base to round2(Base × m), overwriting in place and appending new pairs", () => {
    const existing = [{ fromId: "W1", toId: "C2", cost: 1 }, { fromId: "W5", toId: "C5", cost: 7 }];
    expect(applyBaseMultiplier(existing, rows, 1.5)).toEqual([
      { fromId: "W1", toId: "C2", cost: 30 },
      { fromId: "W5", toId: "C5", cost: 7 },
      { fromId: "W1", toId: "C1", cost: 15.01 },
    ]);
  });
  it("never writes a row without a Base, and never duplicates a pair", () => {
    const out = applyBaseMultiplier([], rows, 2);
    expect(out.map(o => `${o.fromId}|${o.toId}`)).toEqual(["W1|C1", "W1|C2"]);
  });
});

describe("parseMultiplier (WQF-C5)", () => {
  it.each([["1.5", 1.5], [" 2 ", 2], ["0.01", 0.01]])("accepts %j", (t, n) => expect(parseMultiplier(t)).toBe(n));
  it.each(["", "0", "-2", "abc", "Infinity", "NaN"])("rejects %j", t => expect(parseMultiplier(t)).toBeNull());
});

describe("jsonBytes / rowsThatFit — the C5 size guard (WQF-C5)", () => {
  // Synthetic body with a small injected limit; nothing is mocked. Every applied entry
  // {"fromId":"W1","toId":"Cn","cost":20} is 37 bytes, so 5 of them + 4 commas = 189 bytes = 37.8 per row.
  const body = (laneCostOverrides: unknown[]) => ({ inputs: { p: 3, laneCostOverrides } });
  const applied = [1, 2, 3, 4, 5].map(i => ({ fromId: "W1", toId: `C${i}`, cost: 20 }));
  const appliedKeys = new Set(applied.map(o => `${o.fromId}|${o.toId}`));

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(jsonBytes("é")).toBe(4); // `"é"`: quote + 2-byte é + quote
  });

  it("returns null when the body fits the limit exactly", () => {
    expect(rowsThatFit(body, applied, appliedKeys, jsonBytes(body(applied)))).toBeNull();
  });

  it("on overflow, says how many applied rows fit: floor((limit − bytes without them) / average per row)", () => {
    const without = jsonBytes(body([]));
    expect(rowsThatFit(body, applied, appliedKeys, without + 100)).toBe(2); // floor(100 / 37.8)
    expect(rowsThatFit(body, applied, appliedKeys, jsonBytes(body(applied)) - 1)).toBe(4); // floor(188 / 37.8)
    expect(rowsThatFit(body, applied, appliedKeys, without - 1)).toBe(0); // never negative
  });

  it("counts kept overrides outside the applied rows as fixed weight, not as rows that could be dropped", () => {
    const kept = { fromId: "W9", toId: "C9", cost: 7 }; // 36 bytes
    const next = [kept, ...applied];
    // without = body([kept]); applied add 5 × 37 + 5 commas = 190 → 38 per row; floor(100 / 38) = 2.
    // (Measuring "without" as body([]) instead would give floor(136 / 45.2) = 3.)
    expect(rowsThatFit(body, next, appliedKeys, jsonBytes(body([kept])) + 100)).toBe(2);
  });

  it("is 0 when nothing was applied but the body is still over the limit", () => {
    expect(rowsThatFit(body, [], new Set(), 1)).toBe(0);
  });
});
```

Run `pnpm --filter studio exec vitest run src/lib/deliveryCosts.test.ts` → FAIL (`applyBaseMultiplier is not a function` / not exported).

- [ ] **Step 3: Implement the helpers** — append to `src/lib/deliveryCosts.ts` (and add `import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";` at the top):

```ts
/** WQF-C5 — the one (fromId, toId) key the multiplier, its size guard and the tab share. */
export const pairKey = (o: { fromId: string; toId: string }): string => `${o.fromId}|${o.toId}`;

/** WQF-C5 — Cost = round2(Base × multiplier) for every target row that has a Base, overwriting any existing
 * override for that pair in place; overrides outside `targets` are kept; new pairs are appended. One entry per
 * pair, because the server refuses duplicate (fromId, toId) pairs (validation/inputs/delivery.ts). */
export function applyBaseMultiplier(
  overrides: LaneCostOverride[],
  targets: ReadonlyArray<{ fromId: string; toId: string; base: number | null }>,
  multiplier: number,
): LaneCostOverride[] {
  const byPair = new Map(overrides.map(o => [pairKey(o), o]));
  for (const t of targets) {
    if (t.base == null) continue;
    byPair.set(pairKey(t), { fromId: t.fromId, toId: t.toId, cost: round2(t.base * multiplier) });
  }
  return [...byPair.values()];
}

/** WQF-C5 — a request body's size on the wire: the UTF-8 bytes of its JSON, which is what the server's
 * `express.json({ limit })` counts. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** WQF-C5 size guard (spec C5). `body(overrides)` must build the request body exactly as the save sends it,
 * with `laneCostOverrides` = `overrides`. Returns null when `body(next)` fits `limit`; otherwise an estimate of
 * how many of the applied rows would fit: floor((limit − bytes without the applied rows) / average bytes per
 * applied row). Overrides outside `appliedKeys` stay in the "without" weight: Apply keeps them. */
export function rowsThatFit(
  body: (laneCostOverrides: LaneCostOverride[]) => unknown,
  next: LaneCostOverride[],
  appliedKeys: ReadonlySet<string>,
  limit: number,
): number | null {
  const bytesWith = jsonBytes(body(next));
  if (bytesWith <= limit) return null;
  if (appliedKeys.size === 0) return 0;
  const bytesWithoutNewOverrides = jsonBytes(body(next.filter(o => !appliedKeys.has(pairKey(o)))));
  const averageBytesPerOverride = (bytesWith - bytesWithoutNewOverrides) / appliedKeys.size;
  return Math.max(0, Math.floor((limit - bytesWithoutNewOverrides) / averageBytesPerOverride));
}

/** WQF-C5 — the multiplier Apply accepts: a finite number > 0, else null. */
export function parseMultiplier(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
```

Re-run → PASS.

- [ ] **Step 4: Failing DataTable render-prop test** — append to `src/__tests__/DataTable.test.tsx`:

```tsx
describe("DataTable — renderToolbarAction (WQF-C5)", () => {
  it("receives every row matching the filter across all pages, not just the visible page", async () => {
    const seen: string[][] = [];
    renderTable({
      rows: makeRows(120),
      renderToolbarAction: filtered => {
        seen.push(filtered.map(r => r.id));
        return <span data-testid="action">{filtered.length}</span>;
      },
    });
    expect(screen.getByTestId("action")).toHaveTextContent("120");
    await userEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    await userEvent.type(screen.getByTestId("input-filter-id"), "C1");
    // "C1" matches C1, C10–C19 and C100–C120: 1 + 10 + 21 = 32 rows (the unfiltered 120 above span 3 pages of 50).
    expect(screen.getByTestId("action")).toHaveTextContent("32");
    expect(seen.at(-1)).toContain("C120");
  });
});
```

Run → FAIL (TS: `renderToolbarAction` does not exist on `DataTableProps`; at runtime `action` not found).

- [ ] **Step 5: Implement the render-prop**

`types.ts`, inside `DataTableProps<T>` after `countNoun?: string;`:

```ts
  /** WQF-C5 — rendered in the toolbar after `toolbar.extra`, given every row that matches the current filter
   * across ALL pages (before sort and paging) — for bulk actions such as Delivery Costs' Base multiplier. */
  renderToolbarAction?: (filteredRows: T[]) => ReactNode;
```

`DataTable.tsx`: add `renderToolbarAction,` to the destructured props (after `countNoun,`); add `|| renderToolbarAction != null` inside `hasToolbar`'s `Boolean(…)`; and in the toolbar after `{toolbar?.extra}` add:

```tsx
          {renderToolbarAction?.(filteredRows)}
```

Re-run Step 4 → PASS.

- [ ] **Step 6: Pin the write size** — create `src/__tests__/deliveryCostsWriteSize.test.ts`:

```ts
// WQF-C5 — an unfiltered Apply writes all 10,329 lanes in one PATCH. Measured 2026-11-25: 463,259 bytes at ×1
// and 634,990 bytes with every cost at Number.MAX_VALUE (the longest JSON number), vs MAX_IMPORT_BYTES
// 2,097,152 (app.ts:97). The runtime size guard (rowsThatFit, Workspace's handleApplyDeliveryCosts) handles an
// over-limit Apply; this test pins that a real unfiltered Apply on today's dataset never reaches it, and fails
// first if the dataset or the override shape grows toward the limit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";

const COSTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../solvers/delivery-teaching-us/dataset/costs.json");

describe("WQF-C5 — an unfiltered Base-multiplier write fits the scenario write limit", () => {
  const costs = JSON.parse(readFileSync(COSTS, "utf8")) as Record<string, number>;
  const pairs = Object.keys(costs).map(k => {
    const [fromId, toId] = k.split(",");
    return { fromId, toId };
  });

  it("reads the whole 33 × 313 matrix (non-vacuous)", () => {
    expect(pairs).toHaveLength(10_329);
  });

  it("stays under half of MAX_IMPORT_BYTES even with the longest possible number in every cost", () => {
    const body = JSON.stringify({ inputs: { laneCostOverrides: pairs.map(p => ({ ...p, cost: Number.MAX_VALUE })) } });
    expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_IMPORT_BYTES / 2);
  });
});
```

Run → PASS immediately (it pins a measured fact; its non-vacuity is the first case). Prove it can fail: temporarily change `MAX_IMPORT_BYTES / 2` to `MAX_IMPORT_BYTES / 4` → expect FAIL (`634990` not less than `524288`); restore.

- [ ] **Step 7: Failing tab tests** — append to `src/__tests__/DeliveryCostsTab.test.tsx`:

```tsx
describe("DeliveryCostsTab — Base multiplier (WQF-C5)", () => {
  function setup(pairs: Pair[], props: Partial<ComponentProps<typeof DeliveryCostsTab>> = {}) {
    mockReferenceCosts(pairs);
    const onApplyCosts = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" onApplyCosts={onApplyCosts} {...props} />);
    return onApplyCosts;
  }
  const apply = () => screen.getByTestId("button-deliverycost-apply-multiplier");
  const typeMultiplier = (v: string) => fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: v } });

  it.each(["", "0", "-2", "abc", "Infinity"])("disables Apply for %j", v => {
    setup(buildPairs(3));
    typeMultiplier(v);
    expect(apply()).toBeDisabled();
  });

  it("applies to all 10,329 rows when unfiltered, not just page 1", () => {
    const onApplyCosts = setup(buildPairs(10329));
    typeMultiplier("1.5");
    fireEvent.click(apply());
    const next = onApplyCosts.mock.calls[0][0] as { fromId: string; toId: string; cost: number }[];
    expect(next).toHaveLength(10329);
    expect(next[0]).toEqual({ fromId: "W1", toId: "C1", cost: 15 });
    expect(next[10328]).toEqual({ fromId: "W33", toId: "C10329", cost: 15507 });
    expect((onApplyCosts.mock.calls[0][1] as ReadonlySet<string>).size).toBe(10329); // the applied keys, for the size guard
  });

  it("applies only to the filtered rows and keeps every other override", () => {
    const keep = { fromId: "W1", toId: "C1", cost: 7 };
    const onApplyCosts = setup(buildPairs(120), { laneCostOverrides: [keep] });
    filterText("from", "W33");
    typeMultiplier("2");
    fireEvent.click(apply());
    expect(onApplyCosts).toHaveBeenCalledWith(
      [
        keep,
        { fromId: "W33", toId: "C33", cost: 84 },
        { fromId: "W33", toId: "C66", cost: 150 },
        { fromId: "W33", toId: "C99", cost: 216 },
      ],
      new Set(["W33|C33", "W33|C66", "W33|C99"]), // applied keys only; the kept override is not one
    );
  });

  it("is disabled when the filter matches nothing", () => {
    setup(buildPairs(40));
    filterText("from", "ZZZ");
    typeMultiplier("2");
    expect(apply()).toBeDisabled();
  });

  it("is disabled, with Workspace's reason as its title, when Workspace blocks it", () => {
    setup(buildPairs(3), { applyBlockedReason: "Save your changes first" });
    typeMultiplier("2");
    expect(apply()).toBeDisabled();
    expect(apply()).toHaveAttribute("title", "Save your changes first");
  });

  it("is read-only while browsing history", () => {
    setup(buildPairs(3), { readOnly: true });
    expect(screen.getByTestId("input-deliverycost-multiplier")).toBeDisabled();
    expect(apply()).toBeDisabled();
  });

  it("renders no multiplier without onApplyCosts", () => {
    mockReferenceCosts(buildPairs(3));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);
    expect(screen.queryByTestId("input-deliverycost-multiplier")).not.toBeInTheDocument();
  });
});
```

(Add `import type { ComponentProps } from "react";` at the top of the file. `buildPairs(n)` costs are `10 + i`; W33 rows in 120 pairs are i = 32, 65, 98 → C33/C66/C99 with Base 42/75/108; i = 10328 → W33, Base 10338 × 1.5 = 15507.) Run → FAIL (`input-deliverycost-multiplier` not found).

- [ ] **Step 8: Implement the control in DeliveryCostsTab.tsx**

Extend the `@/lib/deliveryCosts` import to `{ applyBaseMultiplier, formatCost2, pairKey, parseMultiplier }`. Props interface, add:

```tsx
  /** WQF-C5 — persists Base × multiplier for the filtered rows as ONE scenario write. `appliedKeys` (pairKey of
   * every row the multiplier set) lets Workspace's size guard say how many rows fit. Omitted = no control. */
  onApplyCosts?: (next: LaneCostOverride[], appliedKeys: ReadonlySet<string>) => void;
  /** WQF-C5 — non-null disables Apply and is its title (unsaved edits, a save in flight). */
  applyBlockedReason?: string | null;
```

Destructure `onApplyCosts, applyBlockedReason = null` in the signature; add state next to the other `useState`s:

```tsx
  const [multiplierText, setMultiplierText] = useState("");
  const multiplier = parseMultiplier(multiplierText);
```

Before `return (`, add:

```tsx
  // WQF-C5 — sits right after Download (DataTable renders it after `toolbar.extra`). `filtered` is every row
  // matching the current filter across all pages; Apply overwrites those rows' Cost and saves once.
  const renderMultiplier = onApplyCosts
    ? (filtered: MergedRow[]) => {
        const blocked = readOnly
          ? READ_ONLY_TITLE
          : applyBlockedReason ?? (multiplier == null ? "Enter a multiplier greater than 0" : filtered.length === 0 ? "No rows match the filter" : null);
        return (
          <div className="flex items-center gap-1.5" data-testid="deliverycost-multiplier">
            <span className="text-xs text-muted-foreground">Base ×</span>
            <Input
              type="text"
              inputMode="decimal"
              aria-label="Base multiplier"
              value={multiplierText}
              onChange={e => setMultiplierText(e.target.value)}
              disabled={readOnly}
              title={readOnly ? READ_ONLY_TITLE : undefined}
              className="h-7 w-20 text-xs font-mono"
              data-testid="input-deliverycost-multiplier"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={blocked != null}
              title={blocked ?? `Set Cost = Base × ${multiplier} for ${filtered.length} rows`}
              onClick={() => {
                if (multiplier == null) return;
                const appliedKeys = new Set(filtered.filter(r => r.base != null).map(pairKey));
                onApplyCosts(applyBaseMultiplier(laneCostOverrides, filtered, multiplier), appliedKeys);
              }}
              data-testid="button-deliverycost-apply-multiplier"
            >
              Apply
            </Button>
          </div>
        );
      }
    : undefined;
```

and pass `renderToolbarAction={renderMultiplier}` to the `<DataTable<MergedRow>` (`:389-407`). Re-run Step 7 → PASS.

- [ ] **Step 9: Failing Workspace tests** — append inside the delivery block's `describe("with reference costs loaded", …)` added by Task 4 in `src/__tests__/Workspace.test.tsx`:

```ts
    it("WQF-C5: Apply writes Base × m for every filtered row in ONE whole-input save", () => {
      renderDeliveryWorkspace();
      fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
      fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: "1.5" } });
      fireEvent.click(screen.getByTestId("button-deliverycost-apply-multiplier"));
      expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
      const [args] = mockUpdateScenario.mutate.mock.calls[0];
      expect(args).toEqual({
        scenarioId: 9,
        data: { inputs: expect.objectContaining({ laneCostOverrides: [{ fromId: "CHI", toId: "C1", cost: 15.01 }] }) },
      });
    });

    it("WQF-C5: Apply is blocked while the draft has unsaved changes", () => {
      renderDeliveryWorkspace();
      fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
      fireEvent.change(screen.getByTestId("input-deliverycost-CHI-C1"), { target: { value: "4" } });
      fireEvent.blur(screen.getByTestId("input-deliverycost-CHI-C1"));
      fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: "2" } });
      expect(screen.getByTestId("button-deliverycost-apply-multiplier")).toBeDisabled();
      expect(screen.getByTestId("button-deliverycost-apply-multiplier")).toHaveAttribute("title", "Save your changes first");
    });

    it("WQF-C5: a rejected Apply shows the server's sentence via describeWriteError", async () => {
      const sentence = "laneCostOverrides row 1 cost must be a number.";
      mockUpdateScenario.mutate.mockImplementationOnce((_vars: unknown, opts: { onError: (e: unknown) => void }) =>
        opts.onError(Object.assign(new Error("HTTP 422 Unprocessable Content: {}"), { status: 422, data: { error: sentence } })),
      );
      renderDeliveryWorkspace();
      fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
      fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: "2" } });
      fireEvent.click(screen.getByTestId("button-deliverycost-apply-multiplier"));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't apply the multiplier", description: sentence, variant: "destructive" })),
      );
    });

    it("WQF-C5: an Apply whose body would exceed the write limit writes nothing and says how many rows fit", () => {
      // Five equal-length pairs: each applied override {"fromId":"CHI","toId":"Cn","cost":2x} is 38 bytes.
      vi.mocked(useGetReferenceCosts).mockReturnValue({
        data: { pairs: [1, 2, 3, 4, 5].map(i => ({ fromId: "CHI", fromCode: "CHI", toId: `C${i}`, toCode: `C${i}`, cost: 9 + i })), distanceUnit: "mi" },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useGetReferenceCosts>);
      const applyTimesTwo = () => {
        fireEvent.click(screen.getByTestId("sidebar-input-deliveryCosts"));
        fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: "2" } });
        fireEvent.click(screen.getByTestId("button-deliverycost-apply-multiplier"));
      };

      // 1) Default limit (MAX_IMPORT_BYTES): the write goes out. Capture the exact body the save sent.
      const first = renderDeliveryWorkspace();
      applyTimesTwo();
      expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
      const sent = mockUpdateScenario.mutate.mock.calls[0][0].data as { inputs: Record<string, unknown> };
      expect(sent.inputs.laneCostOverrides).toHaveLength(5); // non-vacuity: the applied rows are in the body
      const bytesWithout = new TextEncoder().encode(JSON.stringify({ inputs: { ...sent.inputs, laneCostOverrides: [] } })).length;
      first.unmount();
      mockUpdateScenario.mutate.mockClear();
      mockToast.mockClear();

      // 2) Injected limit 100 bytes above the body without overrides. The 5 applied overrides add
      // 5 × 38 + 4 commas = 194 bytes = 38.8 per row, so the body is over the limit and floor(100 / 38.8) = 2 fit.
      render(<Workspace modelId="delivery-teaching-us" userEmail="student@example.com" writeLimitBytes={bytesWithout + 100} />);
      applyTimesTwo();
      expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Too many rows to apply at once",
        description: "Filter to 2 rows or fewer, then apply again.",
        variant: "destructive",
      }));
      // Every row unchanged: no Cost became an override.
      for (const i of [1, 2, 3, 4, 5]) expect(screen.queryByTestId(`badge-deliverycost-overridden-CHI-C${i}`)).not.toBeInTheDocument();
    });
```

Run `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx` → FAIL (`input-deliverycost-multiplier` not found — Workspace does not pass `onApplyCosts` yet; the size-guard case also fails typecheck on `writeLimitBytes`).

- [ ] **Step 10: Implement in Workspace.tsx**

(a0) The limit prop. Add `import { MAX_IMPORT_BYTES } from "@workspace/import-schema";` to the imports; in `WorkspaceProps` (`:1441-1445`) add

```ts
  /** WQF-C5 — the scenario write body limit the Base multiplier's size guard checks against. Defaults to the
   * server's own (`MAX_IMPORT_BYTES`, the shared constant `app.ts:97` passes to express.json); tests inject a small one. */
  writeLimitBytes?: number;
```
and change the signature (`:1491`) to `export function Workspace({ modelId, userEmail, writeLimitBytes = MAX_IMPORT_BYTES }: WorkspaceProps) {`.

(a) Directly above `saveWholeInputsAsync` (`:2205`), add the one body builder:

```ts
  // WQF-C5 — the PATCH body a whole-input save sends (the generated client JSON.stringifies exactly this
  // `data`), built in ONE place so the Base multiplier's size guard measures what the save will send.
  // A caller may add keys on top of the draft (the Base multiplier passes laneCostOverrides).
  function wholeInputsBody(patch: Record<string, unknown> = {}): { inputs: Record<string, unknown> } {
    return { inputs: { ...buildWholeInputPayload(), ...patch } };
  }
```
`saveWholeInputsAsync`'s signature becomes `function saveWholeInputsAsync(patch: Record<string, unknown> = {}): Promise<Scenario> {` and its `const inputs = buildWholeInputPayload();` becomes `const { inputs } = wholeInputsBody(patch);` (the `updateScenario.mutate({ scenarioId, data: { inputs } }, …)` call is unchanged, so `data` is exactly `wholeInputsBody(patch)`).

(b) Add `import { rowsThatFit } from "@/lib/deliveryCosts";` (Workspace does not import that module yet), then after `handleSaveInputs` (ends `:2285`):

```ts
  // WQF-C5 — Delivery Costs' Base multiplier: the new laneCostOverrides go out as ONE whole-input write and
  // the response becomes the draft (saveWholeInputsAsync's onSuccess). Blocked while anything else is unsaved
  // (applyBlockedReason below), so the write changes laneCostOverrides and nothing else.
  // Size guard (spec C5), BEFORE any state change: measure the exact body the save would send against the
  // server's limit; over it, write nothing, leave every row as it is, and say how many rows fit.
  function handleApplyDeliveryCosts(next: LaneCostOverride[], appliedKeys: ReadonlySet<string>) {
    const fit = rowsThatFit(o => wholeInputsBody({ laneCostOverrides: o }), next, appliedKeys, writeLimitBytes);
    if (fit !== null) {
      toast({
        title: "Too many rows to apply at once",
        description: `Filter to ${fit} rows or fewer, then apply again.`,
        variant: "destructive",
      });
      return;
    }
    saveWholeInputsAsync({ laneCostOverrides: next }).catch(err => {
      toast({
        title: "Couldn't apply the multiplier",
        description: describeWriteError(err),
        variant: "destructive",
      });
    });
  }
```

(c) In the `<DeliveryCostsTab` mount, after `locationById={…}`:

```tsx
          onApplyCosts={handleApplyDeliveryCosts}
          applyBlockedReason={saveIsPending ? "Saving…" : saveEnabled ? "Save your changes first" : null}
```

Re-run Step 9 → PASS. Non-vacuity of the size guard: temporarily replace `writeLimitBytes` with `MAX_IMPORT_BYTES` inside `handleApplyDeliveryCosts` → the size-guard case fails (`mutate` called once); restore. Then run the guards: `pnpm --filter studio exec vitest run src/__tests__/mutationErrorSurface.test.ts src/__tests__/rawErrorMessageSurface.test.ts src/__tests__/historyReadOnlyTabs.test.ts` → PASS.

- [ ] **Step 11: Failing real-browser test** — create `artifacts/studio/e2e/wqf-c5-base-multiplier.spec.ts`:

```ts
/**
 * WQF-C5 — Base multiplier: Apply writes round2(Base × m) for every filtered row across all pages in one
 * PATCH, and the costs persist across a reload. Real API + DB (local two-server recipe); no solve.
 * Target: E2E_BASE_URL (never without it — e2e/CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";
import { SOLVED_MODEL_INPUTS } from "./helpers/solvedModelInputs";
import { fillTableFilter, closePopover } from "./helpers/inputTable";
import { CHAPTERS } from "../src/lib/chapters";
import { round2 } from "../src/lib/deliveryCosts";

const T = 10_000;
const MODEL = "delivery-teaching-us";
const here = path.dirname(fileURLToPath(import.meta.url));
const COSTS = JSON.parse(fs.readFileSync(path.resolve(here, "../../../solvers/delivery-teaching-us/dataset/costs.json"), "utf8")) as Record<string, number>;
const chapterPath = CHAPTERS.find(c => c.modelId === MODEL)!.path;

async function register(page: Page): Promise<void> {
  const email = `e2e-wqfc5-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
}

async function createAndOpenCosts(page: Page): Promise<string> {
  const create = await page.request.post("/api/scenarios", { data: { name: "E2E WQF-C5", modelId: MODEL, inputs: SOLVED_MODEL_INPUTS[MODEL] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = String((await create.json()).id);
  await page.goto(`${chapterPath}?scenario=${id}`);
  await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
  await page.getByTestId("sidebar-input-deliveryCosts").click({ timeout: T });
  await expect(page.getByTestId("delivery-costs-page-indicator")).toBeVisible({ timeout: 15_000 });
  return id;
}

const patchOf = (page: Page, id: string) =>
  page.waitForResponse(r => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/scenarios/${id}`, { timeout: 15_000 });

test("WQF-C5: Apply on a filter spanning 7 pages writes all 313 rows once, and they persist after reload", async ({ page }) => {
  await register(page);
  const id = await createAndOpenCosts(page);
  try {
    await fillTableFilter(page, "from", "W8");
    await closePopover(page);
    await expect(page.getByTestId("delivery-costs-page-indicator")).toContainText("Page 1 of 7", { timeout: T });

    await page.getByTestId("input-deliverycost-multiplier").fill("1.5");
    const patch = patchOf(page, id);
    await page.getByTestId("button-deliverycost-apply-multiplier").click({ timeout: T });
    expect((await patch).status()).toBe(200);

    const row = await (await page.request.get(`/api/scenarios/${id}`)).json();
    const saved = new Map((row.inputs.laneCostOverrides as { fromId: string; toId: string; cost: number }[]).map(o => [`${o.fromId},${o.toId}`, o.cost]));
    const expected = new Map(Object.entries(COSTS).filter(([k]) => k.startsWith("W8,")).map(([k, base]) => [k, round2(base * 1.5)]));
    expect(expected.size).toBe(313);
    expect(saved).toEqual(expected);

    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: T });
    await page.getByTestId("sidebar-input-deliveryCosts").click({ timeout: T });
    await fillTableFilter(page, "from", "W8");
    await fillTableFilter(page, "to", "C269");
    await closePopover(page);
    // costs.json "W8,C269": 1047.7157 × 1.5 = 1571.57355 → 1571.57 (C6 display).
    await expect(page.getByTestId("input-deliverycost-W8-C269")).toHaveValue("1571.57", { timeout: T });
    await expect(page.getByTestId("badge-deliverycost-overridden-W8-C269")).toBeVisible();
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});

test("WQF-C5: an unfiltered Apply writes all 10,329 lanes in one accepted PATCH", async ({ page }) => {
  await register(page);
  const id = await createAndOpenCosts(page);
  try {
    await page.getByTestId("input-deliverycost-multiplier").fill("1");
    const patch = patchOf(page, id);
    await page.getByTestId("button-deliverycost-apply-multiplier").click({ timeout: T });
    expect((await patch).status()).toBe(200);
    const row = await (await page.request.get(`/api/scenarios/${id}`)).json();
    expect(row.inputs.laneCostOverrides).toHaveLength(10_329);
  } finally {
    await page.request.delete(`/api/scenarios/${id}`).catch(() => {});
  }
});
```

(Path note: `e2e/` → `../../../solvers` resolves to the repo root's `solvers/`.)

- [ ] **Step 12: Run it — PASS, then non-vacuity**

Start the two servers from `/Users/shubhamkr/nos-wqf-c5`, then `cd artifacts/studio && E2E_BASE_URL=http://localhost:5273 npx playwright test e2e/wqf-c5-base-multiplier.spec.ts` → `2 passed`. Non-vacuity: temporarily replace the body of `handleApplyDeliveryCosts` with `updateInputsField("laneCostOverrides", next);` (draft only, no save) → re-run → expect both FAIL at the `waitForResponse` (no PATCH within 15 s). Restore the real body → `2 passed`; `git diff` shows no residue.

- [ ] **Step 13: OWNER DECISION D1 — the "Adjust Cost Table is off" note**

The lead asks the owner before this step runs (see "C5 — STOP" above) and records the answer in the dispatch message.
- **A (recommended): no note.** Do nothing in this step; the Task 5 changelog records that the spec's note was dropped because edited costs change the solve whether or not the toggle is on (`solve.py:1828-1837`, `tests/test_delivery.py:143-152`).
- **B: a true note.** Write this failing test first in `DeliveryCostsTab.test.tsx`:

```tsx
it("WQF-C5 (D1-B): says how costs are used while Adjust Cost Table is off, and nothing when it is on", () => {
  mockReferenceCosts(buildPairs(3));
  const { rerender } = render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" costAdjustEnabled={false} />);
  expect(screen.getByTestId("text-deliverycost-adjust-off")).toHaveTextContent("Adjust Cost Table is off, so the solve uses these costs at $1 per mile.");
  rerender(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" costAdjustEnabled />);
  expect(screen.queryByTestId("text-deliverycost-adjust-off")).not.toBeInTheDocument();
});
```

run it (FAIL: testid not found), then add the prop `costAdjustEnabled?: boolean;` to the interface, destructure it, render as the first child of `<div data-testid="delivery-costs-tab">`:

```tsx
      {costAdjustEnabled === false && (
        <p className="mb-2 text-xs text-muted-foreground" data-testid="text-deliverycost-adjust-off">
          Adjust Cost Table is off, so the solve uses these costs at $1 per mile.
        </p>
      )}
```

pass `costAdjustEnabled={localInputs.costAdjustEnabled === true}` from the Workspace mount, and re-run → PASS. (The $1/mile statement is what `_effective_delivery_costs` does when off; `e2e/delivery-teaching.spec.ts:259-261` relies on the same fact.)

- [ ] **Step 14: Typecheck, studio suite** — `cd /Users/shubhamkr/nos-wqf-c5 && pnpm --filter studio run typecheck && pnpm --filter studio test` → 0 failed (record count).

- [ ] **Step 15: Changelog and commit**

```markdown
## WQF-C5 — Delivery Costs Base multiplier (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 5; spec Part C5.
- `DeliveryCostsTab.tsx`: "Base ×" box + Apply right after Download. Apply sets Cost = round2(Base × m) for every row matching the filter across all pages (`DataTable`'s new `renderToolbarAction(filteredRows)`), overwriting existing Cost; disabled unless m is a finite number > 0, the filter matches rows, nothing else is unsaved, and no save is in flight.
- `Workspace.tsx`: `handleApplyDeliveryCosts` → `saveWholeInputsAsync({ laneCostOverrides })` (one PATCH; response becomes the draft); failure toast via `describeWriteError`.
- Size guard (spec C5): before any state change, `handleApplyDeliveryCosts` measures the exact body the save sends (`wholeInputsBody`, shared with `saveWholeInputsAsync`) in UTF-8 bytes against `MAX_IMPORT_BYTES` (the shared `@workspace/import-schema` constant the server's parser uses; Workspace `writeLimitBytes` prop for tests); over it, nothing is written and a toast says "Filter to N rows or fewer, then apply again." (`rowsThatFit`). Measured (plan "C5 — measured write size"): unfiltered write 463,259 B at ×1, 634,990 B worst case, vs 2,097,152 — today's dataset never reaches the guard; `__tests__/deliveryCostsWriteSize.test.ts` pins it below half the limit.
- D1 (owner, <date>): <A: no "Adjust Cost Table is off" note — edited costs change the solve with the toggle off too (`solve.py:1828-1837`) | B: note reads "…uses these costs at $1 per mile.">
- Tests: helpers (incl. `jsonBytes`/`rowsThatFit` with a synthetic body and injected limit), DataTable render-prop, tab (validation, 10,329 unfiltered, filtered + kept overrides, applied keys, blocked/read-only), Workspace (one write, dirty block, server sentence, over-limit → zero writes + "Filter to 2 rows or fewer"), `e2e/wqf-c5-base-multiplier.spec.ts` (313 rows over 7 pages persisted after reload; 10,329-row PATCH accepted). Red first; draft-only handler turns the e2e red.
- Gate: studio typecheck clean; studio vitest <N> passed; wqf-c5 e2e 2/2.
```

(Write the D1 line with the actual decision and date; keep only the chosen alternative.)

```bash
cd /Users/shubhamkr/nos-wqf-c5
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
P="artifacts/studio/src/lib/deliveryCosts.ts artifacts/studio/src/lib/deliveryCosts.test.ts artifacts/studio/src/components/data-table/types.ts artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/deliveryCostsWriteSize.test.ts artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/e2e/wqf-c5-base-multiplier.spec.ts docs/CHANGELOG-implementation.md"
git add $P
git commit $P -m "[WQF-C5] add the Delivery Costs Base multiplier"
```

---

### Task 6: `[WQF-C6-QA]` Sibling e2e specs and the local e2e gate

**Role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected anyway, ignore it and say so in the report). **Worktree:** `/Users/shubhamkr/nos-wqf-c6`, branch `wqf-c6-work`, base = `wqf-c` tip after Task 5 (`BASE6`).

**Files:** only sibling specs the grep proves broken, plus `docs/CHANGELOG-implementation.md`.

- [ ] **Step 1: Sanity check** — `cd /Users/shubhamkr/nos-wqf-c6 && git rev-parse --abbrev-ref HEAD` (must print `wqf-c6-work`); base guard against `BASE6`.

- [ ] **Step 2: Grep every changed test id / string / value shape**

```bash
cd /Users/shubhamkr/nos-wqf-c6
git grep -n -e "workspace-toolbar-row" -e "button-save" -e "output-map-narrative" -e "button-output-map-info" \
  -e "input-deliverycost-" -e "row-deliverycost-" -e "badge-deliverycost-" -e "delivery-costs-" \
  -e "Introduction to Network Design" -e "super-toolbar-import" -e "super-toolbar-export" -- artifacts/studio/e2e
```

Known hits to judge (from the plan's own read): `quick-fixes.spec.ts:172` reads the super trio from `workspace-toolbar-row` on the super landing tab (Input Map, which keeps the row — expected to still pass); `delivery-teaching.spec.ts:204` and `max-coverage.spec.ts:368` assert no toolbar row on Input Map (unchanged); `delivery-teaching.spec.ts:245-330` types costs `0` and `123.5` and asserts badges and the JSON export (`cost: 123.5`, stored as typed) — expected to still pass; `design-upgrade-p2.spec.ts:96` (delivery skeleton test ids, unchanged). For every hit that locates Save by position, by `.first()`/`.nth()`, or inside `workspace-toolbar-row` on one of the 31 pairs, rewrite it to locate `button-save` inside `data-table-save-slot` (or by test id alone).

- [ ] **Step 3: Run the full e2e gate locally**

Two servers from `/Users/shubhamkr/nos-wqf-c6` (Global Constraints recipe), 0 other Playwright runs, then:

```bash
cd /Users/shubhamkr/nos-wqf-c6 && E2E_BASE_URL=http://localhost:5273 pnpm e2e:gate
```

Expected: all pass except entries matched by name in `docs/superpowers/flake-registry.md`; each such failure re-run twice in isolation (`npx playwright test e2e/<file> -g "<test name>"`). `design-upgrade-p5.spec.ts` needs OSM tile access (`E2E_ALLOW_NO_TILES=1` only knowingly). A real failure in a sibling spec caused by WQF-C UI changes is rewritten to the new UI and re-run green; a real failure in WQF-C code goes back to the lead (do not patch product code).

- [ ] **Step 4: Changelog and commit** (only if a spec changed; otherwise record the gate result for the lead and make no commit)

```markdown
## WQF-C6-QA — sibling e2e specs for Part C (2026-11-25)

Plan `docs/superpowers/plans/2026-11-25-wqf-c-studio-ch5.md` Task 6.
- Grep of changed test ids/strings over `artifacts/studio/e2e`: <hits and verdicts>.
- Rewritten: <spec:test name → change>.
- `E2E_BASE_URL=http://localhost:5273 pnpm e2e:gate`: <passed>/<total>, flakes <names, registry entries>.
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add <changed spec paths> docs/CHANGELOG-implementation.md
git commit <changed spec paths> docs/CHANGELOG-implementation.md -m "[WQF-C6-QA] rewrite sibling e2e specs for the Part C UI"
```

Review: a separate `fable`-model reviewer agent reviews this diff (AGENTS.md), not the lead.

---

### Task 7: Gate, finish, approvals (lead)

- [ ] **Step 1: Integrate** — after each task's review passes, from the shared checkout on `wqf-c`: `git switch wqf-c` (alone; then `git rev-parse --abbrev-ref HEAD` must print `wqf-c`), `git cherry-pick <task-sha>`; resolve a `CHANGELOG-implementation.md` conflict by keeping both entries in task order. Record each task's SHA in the ledger.

- [ ] **Step 2: Full gate on `wqf-c`** — 0 concurrent vitest first (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "busy: $cnt"`), then `pnpm gate`. Exit 0 = green; exit 3 = a vitest timeout (machine load) → re-run serially with zero concurrent vitest; exit 1 = real failure → back to the owning task's branch. Record api-server / studio / pytest counts and typecheck from the output. No solver file changed, so `e2e_accuracy.py`/`e2e_journey.py` are not required; confirm with `git diff --stat <PLAN_SHA>..wqf-c -- artifacts/api-server solvers lib` (expect empty).

- [ ] **Step 3: e2e gate on `wqf-c`** — if Task 6 ran on the final tip, its result stands; otherwise repeat Task 6 Step 3 from a worktree on the `wqf-c` tip.

- [ ] **Step 4: `superpowers:finishing-a-development-branch`** — invoke it now (implementation complete, gates green). Its output is a recommendation; it grants no approval.

- [ ] **Step 5: `/harness-retro WQF-C`** — records `tasks.csv`, gate failures by cause, and fires the second-occurrence rule (stops for approval if it drafts a gate).

- [ ] **Step 6: STOP — ask the owner to approve the merge to local `main`.** Include: task SHAs, gate numbers, D1 decision, the resolved ambiguities below.

- [ ] **Step 7: On approval, merge** — `git fetch origin`; `git merge-base --is-ancestor origin/main main` must succeed; `git switch main` (alone, then assert `main`); `git merge --no-ff wqf-c`. Resolve conflicts deliberately (Parts A/B may have landed first; `Workspace.tsx`, `popover.tsx`, `WatBotMessages.tsx` are the likely overlaps).

- [ ] **Step 8: Whole-branch review on the merged state** — Opus reviewer over `<pre-merge main>..main` plus `ponytail:ponytail-review`. Findings → **switch back to `wqf-c` before fixing** (step 5a), commit there, re-merge, re-gate.

- [ ] **Step 9: STOP — ask for push approval**, saying the push is deploy-adjacent: `nos-studio` (Dashboard-managed, no suppression) can build from a push; `nos-api` is unchanged by this part. Before pushing, scan and gate the push on a clean result:

```bash
git log origin/main..main -p | grep -i -E '@(gmail|yahoo|outlook|hotmail)\.com|([0-9]{1,3}\.){3}[0-9]{1,3}|srv-[a-z0-9]{10,}|dpg-[a-z0-9]{10,}' && echo "SCAN HIT — do not push" || git push origin main
```

Then `list_deploys` for both services to see whether a build started.

- [ ] **Step 10: STOP — ask for `nos-studio` deploy approval** with the checklist from `pnpm deploy:preflight -- <deployed-sha>..HEAD` (expected: studio only, no schema, no migrations, no new env vars — Step 6a's `git diff --stat <deployed-sha>..HEAD -- lib/db/src/schema/` must be empty). Re-fetch `origin/main` immediately before triggering (Render builds the tip). After deploy: live check of C1–C5 on `app.networkdesignbook.com` with a throwaway account, then a deploy-record changelog entry on its own branch.

---

## Resolved ambiguities (lead confirms with the owner at Task 7 Step 6)

1. **C5 note (D1) — not resolved by the plan; owner decides** (Task 5 Step 13). Spec premise contradicts `solve.py:1828-1837`. Recommended A (no note).
2. **C5 over-limit message** — shipped as spec C5 requires (Codex adversarial review of the plans, 2026-11-25, reversed the earlier "unreachable, no branch" call): the Apply handler measures the exact save body's UTF-8 bytes against `MAX_IMPORT_BYTES` (one shared constant, `@workspace/import-schema`, used by the server's parser) before any state change; over it, zero writes, rows unchanged, toast "Filter to N rows or fewer, then apply again." with N = floor((limit − bytes without the applied rows) / average bytes per applied row). Unreachable with today's dataset (max 634,990 B of 2,097,152), so it is tested with an injected limit (`writeLimitBytes`), and the measured bound stays pinned by `deliveryCostsWriteSize.test.ts`.
3. **C5 with other unsaved edits** — Apply is disabled ("Save your changes first", the existing `superFetchDisabledReason` wording at `Workspace.tsx:2361`) so the single write changes only `laneCostOverrides`, never silently saving unrelated edits.
4. **C5 rows without a Base** (overrides outside the base matrix) are skipped; the delivery base matrix is complete (33 × 313), so none exist today.
5. **C2 super-model** — the whole cluster (Save + Import network + Export) moves together on the 7 super table tabs, keeping QFX-1's "right of Save" order; the row stays on super Input Map, Distances, Optimization Parameters and for an empty network.
6. **C2 transient states** — Save stays in the row when there is no scenario/draft; on listed tabs it is briefly absent while the tab's own dataset `Loading…` placeholder shows (nothing can be dirty then).
7. **C6 rounding** — half-up with an `EPSILON` nudge (`1.005 → 1.01`), always two decimals (`8 → 8.00`); display only, exports unchanged.
8. **C4 example** — `W8` is Atlanta, GA in the dataset; the format `ID · City, ST` is what ships.
9. **Pipeline order** — the brief listed the whole-branch review before finishing; CLAUDE.md's merge pipeline (review on the merged state, after merge approval) governs, so per-task Opus reviews run before merge and the whole-branch review after it.
