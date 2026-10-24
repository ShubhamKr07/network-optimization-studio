# Design Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec `docs/superpowers/specs/2026-10-24-design-upgrade-design.md` (v2, `ac7cb1ec`). The spec fixes meaning colours, tokens, formats, tables, map interactions, multi-echelon reporting, dark mode and autosave across all 8 chapters. The brand stays olive/ink.

**Architecture:** The work is phased (spec D1). This file holds two things:
- **(A) a master index** of every task in all 6 phases: IDs, files, interfaces, order, and the cross-layer seams.
- **(B) the full step-level plan for Phase 1.**

The step-level plans for Phases 2–6 get written **immediately before each phase executes** (user decision, 2026-10-24), as `docs/superpowers/plans/2026-10-24-design-upgrade-phase-N.md`. They're written against the code as it stands then, and must keep the interfaces fixed in §A.

**Tech stack:**
- React 18 + Vite + Tailwind v4 (`@theme inline` in `src/index.css`)
- react-leaflet
- vitest + RTL, Playwright
- Express + Drizzle + hand-written Zod validators (api-server)
- `@workspace/units` shared lib
- Orval codegen from `lib/api-spec/openapi.yaml`
- PuLP solver (untouched)

## Global Constraints

These come from the spec and the repo, and bind every task.

**Brand and design**
- The brand palette is fixed (C3). The only new colours are:
  - the 5 derived olive band shades, approved 2026-10-24: `#6F952F #597726 #455C1D #314215 #1B240B`;
  - status text shades `--success #15803D` and `--danger #B91C1C`;
  - an info set `--info #0369A1`, `--info-bg #F0F9FF`, `--info-border #7DD3FC`.
- Band gate: every `--band-0..4` is ≥ 3:1 against the map tile `#F2EFE9`, and adjacent steps are ≥ 1.4:1. Overflow stays violet `#7C3AED`.
- Text contrast is AA, ≥ 4.5:1. Minimum arbitrary text size is 11px (`--text-2xs: 0.6875rem`).
- Red is for errors only.

**Solver and contracts**
- `solve.py`, result envelopes and `e2e_accuracy.py` are untouched. Run `e2e_accuracy.py` **and** `e2e_journey.py` directly at every phase gate; they aren't pytest-discovered.
- Never hand-edit `lib/api-zod/src/generated/**` or `lib/api-client-react/src/generated/**`.
- `inboundDistanceBands` never enters any `required[]`.
- Every scenario query keeps the `user_id` filter. Non-owned scenarios return **404**.

**Commits and branches**
- One task = one commit, message `[DU-<phase>.<n>] <imperative summary>` ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line.
- A task that crosses a layer boundary is one atomic commit.
- Before every `git commit`, guard against `main`: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. Commit with an explicit pathspec.
- Each phase's commits land on branch `design-upgrade-p<N>`, cut from the previous phase's merged `main`. Phase 1 is cut from `design-upgrade-spec` so the spec and plan travel with it.
- When all of a phase's tasks are done: `superpowers:finishing-a-development-branch`, then STOP and ask for merge approval. Push and deploy are separate approvals.

**Process**
- Code-writing roles invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code (hard rule #12). qa-sdet is exempt.
- Each task appends its entry to `docs/CHANGELOG-implementation.md` **in the same commit** (hard rule #9).
- Test commands, run from the repo root:
  - studio: `pnpm --filter studio test -- <file>`
  - whole gate: `pnpm gate`
  - typecheck: `pnpm run typecheck`
- Before trusting a full suite, check that **zero** concurrent vitest processes are running: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt"`. Check `docs/superpowers/flake-registry.md` before calling a failure a regression.
- `/harness-retro DU-<phase>` runs before a phase branch counts as finished.

---

## A. Master index (all phases)

Interfaces named here are **fixed**. Later phase plans must use these exact names.

### Phase 1: Foundations (detailed in §B)

| Task | Deliverable | Key files |
|---|---|---|
| DU-1.1 | Remove the dead Studio page and its dead styling (Arcadia, `.studio-lab`, `.scn-theme`) | `pages/Studio.tsx` (delete), `App.tsx`, `index.css`, `pages/Workspace.tsx:4451`, tests |
| DU-1.2 | Meaning colours: olive band ramp + stroke patterns; ink warehouses; grey plants; neutral (not red) Inactive/Excluded; token contrast test | `index.css`, `lib/bandPalette.ts`, `components/NetworkMap.tsx`, `components/workspace/map/MapLegend.tsx`, `WarehousesTab.tsx`, `CustomersTab.tsx` |
| DU-1.3 | Status tokens in `@theme`; sweep of raw Tailwind palette classes; source guard | `index.css`, 24 source files (list in task), new guard test |
| DU-1.4 | Contrast + type floor: primary text → `--green-700`, `--input` → `--line-strong`, `--text-2xs`; sweep of sub-11px sizes; source guard | `index.css`, ~30 source files, new guard test |
| DU-1.5 | Real-browser QA of Phase 1 across all 8 chapters + sibling e2e sweep (qa-sdet) | `artifacts/studio/e2e/design-upgrade-p1.spec.ts` (new) |

**Phase 1 produces:**

```ts
// lib/bandPalette.ts
export const BAND_DASH: readonly (string | undefined)[]; // 5 entries, index-aligned with BAND_COLORS
export function getBandDash(index: number): string | undefined; // OVERFLOW_BAND -> undefined (solid)
```

It also produces the CSS utilities `bg-success|warning|danger|info(-bg)`, `text-success|warning|danger|info`, `border-*-border`, and `text-2xs`.

### Phase 2: Shared components and copy (display only)

| Task | Deliverable | Interfaces produced |
|---|---|---|
| DU-2.1 | Formatter set + every call site in the spec §5.2.1 inventory switched over | `formatDistanceDisplay(value: number): string` (broadened scope, same signature); `formatMoney(value: number, opts?: { compact?: boolean }): string` in `lib/formatObjective.ts`; lat/lng 4 dp |
| DU-2.2 | Range-label authority + `BandLabel` in every UI surface; the four old representations removed; tests and e2e rewritten | `@workspace/units`: `bandRangeLabel(index: number, bands: number[], unit: CanonicalUnit): string` (upper-inclusive; `≤ a`, `a–b`, `> z`); studio `components/BandLabel.tsx`: `<BandLabel index bands unit />` |
| DU-2.3 | Units in headers; `demandUnit` | `Chapter.demandUnit: "tons" \| "units"` (required; JADE `"tons"`) |
| DU-2.4 | Copy pass (legacy result, Unverified, "4 plants", "Run 1 of N") | none |
| DU-2.5 | Header title = chapter title; one primary action per view; lane-colour mode as a segmented control | none |
| DU-2.6 | `DataTable`: sticky header, pinned pager, loading skeleton, ID `nowrap`, ≥ 24px targets, repeated-value → group header | `DataTable` prop `loading?: boolean` |
| DU-2.7 | Entity naming (name + stable ID) on every surface; unified tooltip typography | reuses `formatLocation` / `EntityIdCell` |
| DU-2.8 | P presets = current P ± 2; parameter helper text; non-sticky Landing footer | none |
| DU-2.9 | Real-browser QA + sibling e2e sweep | — |

### Phase 3: Map interactions

| Task | Deliverable |
|---|---|
| DU-3.1 | `MapDetailsCard` action buttons mirroring `MapActionMenu`; one shared action list feeds the menu, the buttons and the hint (G17, G18); keyboard + Escape |
| DU-3.2 | Input Map selection ring; card close button; card placement that avoids the selected marker (G19) |
| DU-3.3 | Output filter dims both legs; filter-aware narrative (G21) |
| DU-3.4 | Route popup: tooltip suppression; per-product rows (G22) |
| DU-3.5 | Real-browser QA (incl. a touch-emulated viewport) + sibling e2e sweep |

Interface: `entityActionsFor(entity: MapEntity): EntityAction[]` in `components/workspace/map/MapActionMenu.tsx`. It's the single list consumed by the menu, the card buttons and the hint.

### Phase 4: Multi-echelon / multi-product (holds both contract changes)

| Task | Deliverable | Atomic seam |
|---|---|---|
| DU-4.1 | `inboundDistanceBands`: Zod (`jadeInputs.ts`, `twoEchelon.ts`) + both manifests' `properties` (never `required[]`) + field-scoped route + `bandsForLeg` + every studio consumer + second band editor + tests. Re-count production rows first, per spec §5.4.1 | **yes**, one commit |
| DU-4.2 | Export contract: `distance_band` uses `bandRangeLabel`; per-leg via `bandsForLeg`; grid-local template version constant; `openapi.yaml` enums + descriptions; Orval regen; contract tests pinned to the constant, with populated rows | **yes**, one commit |
| DU-4.3 | Service Stats inbound table (studio) + export section (server). Fold into DU-4.2 if the export row shape changes together | yes |
| DU-4.4 | Product-repetition collapse: Assignments group-by, Plant Production toggle + Utilization %, Capability Matrix (studio only) | no |
| DU-4.5 | Real-browser QA + sibling e2e sweep; run `e2e_accuracy.py` + `e2e_journey.py` | — |

Interfaces:

```ts
// @workspace/units
export const INBOUND_LEGS: ReadonlySet<string>;   // moved from studio lib/legPalette.ts:20
export const OUTBOUND_LEGS: ReadonlySet<string>;  // moved from studio lib/legPalette.ts:21
export function bandsForLeg(
  leg: string | null | undefined,
  inputs: { distanceBands: number[]; inboundDistanceBands?: number[] },
): number[]; // inbound -> inboundDistanceBands ?? distanceBands; otherwise distanceBands
```

The field-scoped route is `PUT /scenarios/:id/inbound-distance-bands`, body `{ inboundDistanceBands: number[] }`, modelled on `routes/distanceBands.ts`: one `jsonb_set`, no `inputsUpdatedAt` bump, 404 when not owned. The OpenAPI path is added in DU-4.1 with Orval regen in the same commit.

### Phase 5: Dark mode

| Task | Deliverable |
|---|---|
| DU-5.1 | Brand-derived dark token set replacing `.dark`; contrast test extended to both themes |
| DU-5.2 | Theme control (light/dark/system, follows `prefers-color-scheme`, `localStorage` wrapped in try/catch) |
| DU-5.3 | Real-browser QA of both themes on all chapters |

Interface: `lib/theme.ts`: `type ThemePref = "light" | "dark" | "system"; getThemePref(): ThemePref; setThemePref(p: ThemePref): void; applyTheme(p: ThemePref): void`.

### Phase 6: Autosave

| Task | Deliverable |
|---|---|
| DU-6.1 | Serialized write queue (revision IDs, 1 s debounce, coalescing, stale-response rejection), `flushAutosave()` awaited by solve / save-as / switch / navigate / unmount (+ `pagehide` keepalive), field-scoped writers, failure retention + retry, solve blocked while unsaved failures exist, save-status indicator, undo (20 edits, Cmd/Ctrl+Z outside text inputs) |
| DU-6.2 | Remove the page Save button and `DirtyNavPrompt`; rename the Edit-dialog "Save" to "Apply"; rewrite `Workspace.Integration.test.tsx:280-291,605-627` and the sibling e2e specs |
| DU-6.3 | Real-browser QA, incl. solve during the debounce window and scenario switch mid-edit |

Interface: `lib/autosave.ts`: `createWriteQueue(opts): { enqueue(edit: QueuedEdit): void; flush(): Promise<void>; undo(): void; status: "idle" | "saving" | "saved" | "error" }`.

### Ordering and dependencies

Phases run in order 1 → 6.

- DU-2.2's `bandRangeLabel` is required by DU-4.2.
- DU-3.4's popup band text uses `bandRangeLabel` and switches to `bandsForLeg` in DU-4.1.
- DU-6.1 must route band edits through the DU-4.1 route.
- Inside a phase, tasks run in listed order. The QA task always runs last.

---

## B. Phase 1: step-level plan

**Branch setup (once, before DU-1.1):**

```bash
cd /Users/shubhamkr/network-optimization-studio
git switch design-upgrade-spec
git switch -c design-upgrade-p1
git rev-parse --abbrev-ref HEAD   # must print: design-upgrade-p1
```

All paths below are relative to `artifacts/studio/src/` unless they start with `artifacts/`, `docs/` or `lib/`.

---

### Task DU-1.1: Remove the dead Studio page and its dead styling

Every chapter in `lib/chapters.ts` has `workspace: true`, so `App.tsx`'s Studio branch never runs. Removing it also removes the only consumer of the Arcadia tokens and `.studio-lab`.

These components are imported only by `Studio.tsx` and become orphaned: `components/BrazilMap.tsx`, `components/ConstraintChips.tsx`, `components/MapBulkEditToolbar.tsx`, `components/ObjectiveBar.tsx`, and the `WarehouseTable`/`CustomerTable` *components* (their *types* are still used by `Workspace.tsx`). They are **left in place**, because deleting them isn't in the spec (§2 / Q6). Record them as a follow-up in the changelog entry.

`Chapter.workspace` stays. It's read by test fixtures in 6 files, and dropping it is churn with no design value.

**Files:**
- Delete: `pages/Studio.tsx`, `__tests__/Studio.test.tsx`
- Modify: `App.tsx:10` (import), `App.tsx:79-88` (route branch)
- Modify: `__tests__/App.test.tsx:17` (mock), `:108` (assertion), `:122-127` (comment)
- Modify: `__tests__/rawErrorMessageSurface.test.ts` (remove the `"pages/Studio.tsx"` allow-list entry)
- Modify: `index.css:32-112` (Arcadia tokens, classes, keyframes), `:113-171` (`.studio-lab`), `:173-181` (`.scn-theme`)
- Modify: `pages/Workspace.tsx:4451` (drop the `scn-theme` class token), `components/workspace/map/MapLegend.tsx:159-161` (stale comment)
- Modify: `docs/CHANGELOG-implementation.md` (append entry)

**Interfaces:** Consumes nothing. Produces nothing new.

- [ ] **Step 1: Write the failing guard**

Add to the end of `__tests__/App.test.tsx`:

```tsx
describe("DU-1.1 — Studio page is gone", () => {
  it("no studio source file imports pages/Studio or uses Arcadia/studio-lab/scn-theme styling", async () => {
    const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs");
    const { resolve, join } = await import("node:path");
    const root = resolve(__dirname, "..");
    expect(existsSync(resolve(root, "pages/Studio.tsx"))).toBe(false);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === "__tests__") continue;
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(e)) {
          const src = readFileSync(full, "utf8");
          if (/pages\/Studio|--arc-|\.arc-|studio-lab|scn-theme/.test(src)) hits.push(full);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter studio test -- src/__tests__/App.test.tsx -t "Studio page is gone"`
Expected: FAIL. `existsSync(...)` is `true`, and `hits` lists `App.tsx`, `index.css`, `pages/Workspace.tsx`, `components/workspace/map/MapLegend.tsx`.

- [ ] **Step 3: Delete the page and its test**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
git rm src/pages/Studio.tsx src/__tests__/Studio.test.tsx
```

- [ ] **Step 4: Remove the route branch in `App.tsx`**

Delete line 10 (`import { Studio } from "@/pages/Studio";`). Replace lines 79–88 (from `: c.workspace` through `: authedOnly(<Studio modelId={c.modelId} />)}`) with:

```tsx
            : // Every chapter renders Workspace (Studio was retired in DU-1.1).
              // Workspace renders its own full header, so it is NOT wrapped
              // in AppShell (that would stack two headers).
              user
              ? <Workspace modelId={c.modelId} userEmail={user.email} />
              : <Redirect to="/login" />}
```

The full ternary must now read: `{c.locked ? user ? <Redirect to="/" /> : <Redirect to="/login" /> : user ? <Workspace … /> : <Redirect to="/login" />}`.

- [ ] **Step 5: Update `__tests__/App.test.tsx`**

- Delete line 17: `vi.mock("@/pages/Studio", () => ({ Studio: () => <div>StudioPage</div> }));`
- Delete line 108: `expect(screen.queryByText("StudioPage")).not.toBeInTheDocument();`
- Replace the comment at lines 122–127 with: `// DU-1.1: Studio.tsx is deleted; every chapter route renders Workspace.`

- [ ] **Step 6: Remove the allow-list entry**

In `__tests__/rawErrorMessageSurface.test.ts`, delete the entire `"pages/Studio.tsx": "Dead code: …",` entry from `ALLOWED_RAW_ERROR_FILES`. Leave the other 3 entries.

- [ ] **Step 7: Delete the dead CSS from `index.css`**

Delete these three blocks completely:
1. from `/* ===== ARCADIA DESIGN TOKENS ===== */` through the closing `}` of `@keyframes arc-xp-burst`;
2. from `/* ===== STUDIO LAB DARK SKIN ===== */` through the last `.studio-lab .rounded-xl { … }` rule;
3. from `/* ===== SCN DESIGN WIREFRAME THEME ===== */` through `.scn-theme {}`.

The next line after the deletion must be `@plugin "@tailwindcss/typography";`.

- [ ] **Step 8: Drop the no-op class and the stale comment**

`pages/Workspace.tsx:4451`: change `className="h-screen flex flex-col overflow-hidden scn-theme"` to `className="h-screen flex flex-col overflow-hidden"`.

`components/workspace/map/MapLegend.tsx:159-161`: replace the two comment lines mentioning `.scn-theme` with:
`// (resolve via the :root book-cover tokens in index.css).`

- [ ] **Step 9: Confirm no references remain**

Run: `cd /Users/shubhamkr/network-optimization-studio && rg -n "pages/Studio|@/pages/Studio|--arc-|\.arc-|studio-lab|scn-theme" artifacts/studio`
Expected: no output. If an e2e spec matches, rewrite it to target the Workspace equivalent, or delete the Studio-only assertion, in this same task.

- [ ] **Step 10: Run tests**

Run: `pnpm --filter studio test -- src/__tests__/App.test.tsx src/__tests__/rawErrorMessageSurface.test.ts`
Expected: PASS, including "Studio page is gone".

Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 11: Append the changelog entry**

Append to `docs/CHANGELOG-implementation.md`:

```markdown
### DU-1.1 — remove dead Studio page and its styling (design upgrade, Phase 1)
Deleted `pages/Studio.tsx` (+ `Studio.test.tsx`), its `App.tsx` route branch (every chapter is `workspace: true`), the Arcadia `--arc-*` tokens/classes/keyframes, the `.studio-lab` override skin and the empty `.scn-theme`. Guard: `App.test.tsx` "DU-1.1 — Studio page is gone".
Follow-up (not in spec scope): now-orphaned Studio-only modules `BrazilMap`, `ConstraintChips`, `MapBulkEditToolbar`, `ObjectiveBar`, and the `WarehouseTable`/`CustomerTable` components (types still used); `Chapter.workspace` is now always true.
```

- [ ] **Step 12: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit artifacts/studio/src/pages/Studio.tsx artifacts/studio/src/__tests__/Studio.test.tsx \
  artifacts/studio/src/App.tsx artifacts/studio/src/index.css artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/src/components/workspace/map/MapLegend.tsx artifacts/studio/src/__tests__/App.test.tsx \
  artifacts/studio/src/__tests__/rawErrorMessageSurface.test.ts docs/CHANGELOG-implementation.md \
  -m "[DU-1.1] remove dead Studio page and its styling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git show --stat HEAD | head -20   # must list the 2 deletions + the files above, nothing else
```

---

### Task DU-1.2: Meaning colours

**Files:**
- Create: `__tests__/designTokens.test.ts`
- Modify: `index.css` (the `--band-*` line at ~343, `--map-warehouse-open` and `--map-plant` at ~373-376)
- Modify: `lib/bandPalette.ts`, `__tests__/bandPalette.test.ts`
- Modify: `components/NetworkMap.tsx:719-735` (lane `pathOptions`)
- Modify: `components/workspace/map/MapLegend.tsx:306-336` (band swatches)
- Modify: `components/workspace/tabs/WarehousesTab.tsx:31-32`, `components/workspace/tabs/CustomersTab.tsx:128-129`
- Modify: `__tests__/WarehousesTab.dataTable.test.tsx:182`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces `BAND_DASH` and `getBandDash(index: number): string | undefined` in `lib/bandPalette.ts`. Phase 2's `BandLabel` uses them for its pattern swatch.

- [ ] **Step 1: Write the failing token test**

Create `__tests__/designTokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// DU-1.2 / spec §5.1.1 — numeric gates on the shipped tokens, re-computed
// from index.css so a value edit can never silently drop below the gate.
const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf("/* LIGHT MODE */"), CSS.indexOf(".dark {"));

function token(name: string): string {
  const m = ROOT.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token ${name} not found as a hex literal in :root`);
  return m[1];
}
function lum(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const MAP_TILE = "#F2EFE9"; // OSM standard land fill under every lane

describe("distance-band ramp (spec §5.1.1)", () => {
  const bands = [0, 1, 2, 3, 4].map(i => token(`--band-${i}`));
  it("every band reaches >= 3:1 against the map tile", () => {
    for (const b of bands) expect(contrast(b, MAP_TILE)).toBeGreaterThanOrEqual(3);
  });
  it("adjacent bands differ by >= 1.4:1", () => {
    for (let i = 0; i < 4; i++) expect(contrast(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(1.4);
  });
  it("runs near = light -> far = dark", () => {
    for (let i = 0; i < 4; i++) expect(lum(bands[i])).toBeGreaterThan(lum(bands[i + 1]));
  });
  it("overflow stays violet", () => {
    expect(token("--band-overflow").toUpperCase()).toBe("#7C3AED");
  });
});

describe("map entity hues (spec §5.1.1)", () => {
  it("open/fixed-open warehouses are ink, not green", () => {
    expect(token("--map-warehouse-open").toUpperCase()).toBe("#181A15");
  });
  it("plants are distinguishable from customers (>= 1.5:1)", () => {
    expect(contrast(token("--map-plant"), token("--map-customer"))).toBeGreaterThanOrEqual(1.5);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter studio test -- src/__tests__/designTokens.test.ts`
Expected: FAIL. Adjacent bands 3→4 are at 1.28 (`#EF4444`/`#DC2626`), the ramp isn't light→dark, and `--map-warehouse-open` is `#5F7F28`.

- [ ] **Step 3: Change the tokens in `index.css`**

Replace the band line:

```css
  /* five-step distance bands (0=nearest .. 4=farthest) — DU-1.2: one olive
     hue (82°/52%, the brand --green-600 hue) at five lightness steps, gated
     by designTokens.test.ts (>= 3:1 vs map tile, >= 1.4:1 adjacent). Colour
     is never the only signal: lib/bandPalette.ts pairs each with a stroke
     pattern. Derived shades approved 2026-10-24 under the fixed palette. */
  --band-0: #6F952F; --band-1: #597726; --band-2: #455C1D; --band-3: #314215; --band-4: #1B240B;
```

In the map-entities block, set `--map-warehouse-open: #181A15;` (ink, was `#5F7F28`) and `--map-plant: #5B5F54;` (ink-500 grey, was `#2E7D32`). Leave every other map token unchanged. The highlighted warehouse keeps `--green-700` (`NetworkMap.tsx:65`).

- [ ] **Step 4: Add patterns to `lib/bandPalette.ts`**

Append:

```ts
// DU-1.2 (spec §5.1.1) — per-band stroke pattern, index-aligned with
// BAND_COLORS, so band identity never rests on colour alone (WCAG 1.4.1).
// Leaflet/SVG `dashArray` strings; undefined = solid. Overflow stays solid
// (its violet hue is already categorically distinct from the olive ramp).
export const BAND_DASH: readonly (string | undefined)[] = [undefined, "10 4", "6 4", "2 4", "8 3 2 3"];

export function getBandDash(index: number): string | undefined {
  if (index === OVERFLOW_BAND) return undefined;
  return BAND_DASH[Math.min(index, BAND_DASH.length - 1)];
}
```

Append to `__tests__/bandPalette.test.ts`:

```ts
import { BAND_DASH, getBandDash } from "@/lib/bandPalette";
import { OVERFLOW_BAND } from "@/lib/bands";

describe("BAND_DASH (DU-1.2)", () => {
  it("has one entry per band colour and every entry is distinct", () => {
    expect(BAND_DASH).toHaveLength(5);
    expect(new Set(BAND_DASH).size).toBe(5);
  });
  it("clamps past the last band and leaves overflow solid", () => {
    expect(getBandDash(9)).toBe(BAND_DASH[4]);
    expect(getBandDash(OVERFLOW_BAND)).toBeUndefined();
    expect(getBandDash(0)).toBeUndefined();
  });
});
```

(Merge the two new imports into the file's existing import lines instead of duplicating them.)

- [ ] **Step 5: Apply the pattern to map lanes**

In `components/NetworkMap.tsx`, change the import at line 9 to `import { getBandColor, getBandDash } from "@/lib/bandPalette";`. In the route block around line 719, replace:

```tsx
              const bandColor = getBandColor(assignBandOrOverflow(edge.distance, bands));
```

with:

```tsx
              const bandIndex = assignBandOrOverflow(edge.distance, bands);
              const bandColor = getBandColor(bandIndex);
              // DU-1.2: pattern only when lanes are coloured by band; leg/plain
              // mode (bands = []) stays solid.
              const bandDash = bands.length > 0 ? getBandDash(bandIndex) : undefined;
```

Then add `dashArray: bandDash,` to that `<Polyline>`'s `pathOptions` object, after `opacity`.

- [ ] **Step 6: Apply the pattern to the legend swatches**

In `components/workspace/map/MapLegend.tsx`, extend the import to `import { getBandColor, getBandDash } from "@/lib/bandPalette";`.

The legend is a 2-column grid (swatch, label). Wrap the existing per-band swatch `<span>` in a flex cell and add a pattern sample beside it. **Keep the `<span>`, its `data-testid` and its inline `backgroundColor` unchanged**, because `e2e/design-system.spec.ts:239-242` asserts that swatch's computed `backgroundColor` equals `--band-0`:

```tsx
                <span className="flex items-center gap-1">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getBandColor(i) }}
                    data-testid={`legend-band-${i}`}
                  />
                  <svg width="18" height="6" aria-hidden="true" data-testid={`legend-dash-${i}`}>
                    <line x1="0" y1="3" x2="18" y2="3" stroke={getBandColor(i)} strokeWidth="2.5"
                      strokeDasharray={getBandDash(i)} />
                  </svg>
                </span>
```

Wrap the overflow swatch the same way, using `getBandColor(OVERFLOW_BAND)`, no `strokeDasharray`, and `data-testid="legend-overflow-dash"`. Keep `data-testid="legend-overflow-band"` on its `<span>`. The dash testids must **not** start with `legend-band-`, because three e2e specs count `[data-testid^="legend-band-"]` (`nonjade-servicestats-live-coverage.spec.ts:273,475`, `jade-ch9-workspace-bundle.spec.ts:620`).

- [ ] **Step 7: Neutral, not red, for modelling states**

`components/workspace/tabs/WarehousesTab.tsx:31-32`:

```ts
const statusActiveClass = (s: Status) =>
  s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-foreground text-background" : "bg-secondary text-foreground";
```

`components/workspace/tabs/CustomersTab.tsx:128-129`:

```ts
const customerStatusClass = (s: "active" | "excluded") =>
  s === "excluded" ? "bg-foreground text-background" : "bg-secondary text-foreground";
```

`__tests__/WarehousesTab.dataTable.test.tsx:182`: change `toHaveClass("bg-destructive")` to `toHaveClass("bg-foreground")`. Then run `rg -n 'button-customer-.*-excluded.*bg-destructive|bg-slate-200' artifacts/studio/src/__tests__` and update any CustomersTab assertion the same way.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter studio test -- src/__tests__/designTokens.test.ts src/__tests__/bandPalette.test.ts src/__tests__/WarehousesTab.dataTable.test.tsx src/__tests__/CustomersTab`
Expected: PASS.

Run: `rg -n 'stroke="var\(--band-0\)"' artifacts/studio/e2e`
Expected: the 5 existing hits still hold, because the stroke still references `var(--band-0)`. Note them for DU-1.5.

- [ ] **Step 9: Changelog + commit**

Append:

```markdown
### DU-1.2 — meaning colours (design upgrade, Phase 1)
Bands: olive ramp `#6F952F #597726 #455C1D #314215 #1B240B` + per-band stroke patterns (`BAND_DASH`/`getBandDash`, lanes + legend); open warehouses ink `#181A15`; plants ink-500; Inactive/Excluded segments neutral (`bg-foreground`), not red. Gates in `designTokens.test.ts`.
```

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/__tests__/designTokens.test.ts
git commit artifacts/studio/src/index.css artifacts/studio/src/lib/bandPalette.ts artifacts/studio/src/__tests__/bandPalette.test.ts \
  artifacts/studio/src/__tests__/designTokens.test.ts artifacts/studio/src/components/NetworkMap.tsx \
  artifacts/studio/src/components/workspace/map/MapLegend.tsx artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx \
  artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx \
  docs/CHANGELOG-implementation.md -m "[DU-1.2] olive band ramp with stroke patterns, ink warehouses, neutral modelling states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any CustomersTab test file touched in Step 7 to the pathspec.)

---

### Task DU-1.3: Status tokens in `@theme`, raw-palette sweep, source guard

**Files:**
- Create: `__tests__/rawPaletteClasses.test.ts`
- Modify: `index.css` (`@theme inline` block; the status-token lines at ~337-339)
- Modify: the 24 files listed in Step 4 (counts measured 2026-10-24, before DU-1.1). Re-run the Step 2 command for the live list.
- Modify: `__tests__/LaneCostsTab.dataTable.test.tsx:85-86`, `__tests__/DeliveryCostsTab.dataTable.test.tsx:110-111,135`, `__tests__/DistancesTab.dataTable.test.tsx:137-138,175`, `__tests__/DataTable.test.tsx:99-100` (they assert `bg-amber-50`)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:** Produces the utilities `bg-{success,warning,danger,info}`, `bg-{…}-bg`, `text-{…}`, `border-{…}-border`.

- [ ] **Step 1: Write the failing guard**

Create `__tests__/rawPaletteClasses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-1.3 (spec §5.1.3) — status/neutral colour must come from tokens, never
// raw Tailwind palette classes. Tree walk (not a file list), comment lines
// skipped, named allow-list (currently empty — keep it that way or give a
// reason), non-vacuity case. Same shape as rawErrorMessageSurface.test.ts.
const SRC_ROOT = resolve(__dirname, "..");
const RAW = /\b(?:bg|text|border|ring|fill|stroke|divide|outline|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
const ALLOWED: Record<string, string> = {};

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "__tests__") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(SRC_ROOT, f).split(sep).join("/");

describe("raw Tailwind palette classes (DU-1.3)", () => {
  it("no source file uses a raw palette colour class", () => {
    const offenders: string[] = [];
    for (const f of collect(SRC_ROOT)) {
      if (rel(f) in ALLOWED) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (isCode(line) && RAW.test(line)) offenders.push(`${rel(f)}:${i + 1} — ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("is not vacuous", () => {
    expect(collect(SRC_ROOT).length).toBeGreaterThan(50);
    expect(RAW.test('className="bg-amber-50"')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter studio test -- src/__tests__/rawPaletteClasses.test.ts`
Expected: FAIL, with about 100 offenders across the files listed in Step 4.

- [ ] **Step 3: Add the tokens and map them into `@theme`**

In `index.css`, replace the `/* status (full sets) */` lines with:

```css
  /* status (full sets) — DU-1.3: text shades chosen for >= 4.5:1 on their own -bg */
  --success: #15803D; --success-bg: #F0FDF4; --success-border: #86EFAC;
  --warning: #B45309; --warning-bg: #FFFBEB; --warning-border: #FCD34D;
  --danger: #B91C1C;  --danger-bg: #FEF2F2;  --danger-border: #FCA5A5;
  --info: #0369A1;    --info-bg: #F0F9FF;    --info-border: #7DD3FC;
```

Inside `@theme inline { … }`, after the `--color-destructive-border` line, add:

```css
  --color-success: var(--success);
  --color-success-bg: var(--success-bg);
  --color-success-border: var(--success-border);
  --color-warning: var(--warning);
  --color-warning-bg: var(--warning-bg);
  --color-warning-border: var(--warning-border);
  --color-danger: var(--danger);
  --color-danger-bg: var(--danger-bg);
  --color-danger-border: var(--danger-border);
  --color-info: var(--info);
  --color-info-bg: var(--info-bg);
  --color-info-border: var(--info-border);
```

Append to `__tests__/designTokens.test.ts`:

```ts
describe("status text contrast (DU-1.3)", () => {
  for (const s of ["success", "warning", "danger", "info"]) {
    it(`--${s} on --${s}-bg >= 4.5:1`, () => {
      expect(contrast(token(`--${s}`), token(`--${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
```

- [ ] **Step 4: Sweep with this exact mapping**

Apply the table to every non-test file. Keep any `hover:` / `focus:` prefix.

| Raw class(es) | Token class |
|---|---|
| `bg-amber-50`, `bg-amber-100` | `bg-warning-bg` |
| `border-amber-200`, `border-amber-300` | `border-warning-border` |
| `text-amber-500` … `text-amber-900` | `text-warning` |
| `bg-red-50` | `bg-danger-bg` |
| `border-red-200`, `border-red-300` | `border-danger-border` |
| `text-red-300`, `text-red-500`, `text-red-700`, `hover:text-red-900` | `text-danger` (keep the prefix) |
| `focus:ring-red-400` | `focus:ring-danger` |
| `hover:text-red-50` | `hover:text-danger-bg` |
| `bg-green-50` | `bg-success-bg` |
| `border-green-200` | `border-success-border` |
| `text-green-600`, `text-green-700` | `text-success` |
| `bg-sky-50`, `bg-sky-100` | `bg-info-bg` |
| `border-sky-300` | `border-info-border` |
| `text-sky-700` | `text-info` |
| `bg-slate-50`, `bg-slate-100`, `bg-gray-50` | `bg-muted` |
| `bg-slate-200` | `bg-secondary` |
| `bg-slate-400` | `bg-muted-foreground` |
| `border-slate-300`, `border-slate-500` | `border-border` / `border-input` (300 → `border-border`, 500 → `border-input`) |
| `text-slate-900`, `text-gray-900` | `text-foreground` |
| `text-slate-600`, `text-slate-700`, `text-gray-600` | `text-muted-foreground` |

Files (count measured 2026-10-24): `JadeDistancesTab.tsx` 13, `ImportDialog.tsx` 11, `DistancesTab.tsx` 10, `InputMapTab.tsx` 8, `LaneCostsTab.tsx` 6, `pages/not-found.tsx` 4, `WarehousesTab.tsx` 4, `LegDistancesTab.tsx` 4, `DeliveryCostsTab.tsx` 4, `CustomersTab.tsx` 4, `SidebarTree.tsx` 4, `StationsTab.tsx` 3, `MinesTab.tsx` 3, `SuperNetworkImportDialog.tsx` 3, `FloorExceedsMaxAlert.tsx` 3, `components/ui/toast.tsx` 3, `SuperReadinessPanel.tsx` 2, `SuperInputMap.tsx` 2, `MapLegend.tsx` 2, `OutputMapTab.tsx` 1, `StaleOutputBanner.tsx` 1, `tables/WarehouseTable.tsx` 1, `tables/CustomerTable.tsx` 1, `BrazilMap.tsx` 1.

Do the replacement as a reviewed script. Don't hand-edit 100 sites:

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio/src
FILES=$(rg -l --glob '!__tests__/**' -e '\b(bg|text|border|ring)-(slate|gray|red|amber|green|sky)-[0-9]{2,3}\b' .)
for f in $FILES; do
  perl -pi -e '
    s/\bbg-amber-(50|100)\b/bg-warning-bg/g;      s/\bborder-amber-(200|300)\b/border-warning-border/g;
    s/\btext-amber-[5-9]00\b/text-warning/g;
    s/\bbg-red-50\b/bg-danger-bg/g;               s/\bborder-red-(200|300)\b/border-danger-border/g;
    s/\btext-red-50\b/text-danger-bg/g;           s/\btext-red-(300|500|700|900)\b/text-danger/g;
    s/\bring-red-400\b/ring-danger/g;
    s/\bbg-green-50\b/bg-success-bg/g;            s/\bborder-green-200\b/border-success-border/g;
    s/\btext-green-(600|700)\b/text-success/g;
    s/\bbg-sky-(50|100)\b/bg-info-bg/g;           s/\bborder-sky-300\b/border-info-border/g; s/\btext-sky-700\b/text-info/g;
    s/\bbg-(slate-(50|100)|gray-50)\b/bg-muted/g; s/\bbg-slate-200\b/bg-secondary/g; s/\bbg-slate-400\b/bg-muted-foreground/g;
    s/\bborder-slate-300\b/border-border/g;       s/\bborder-slate-500\b/border-input/g;
    s/\btext-(slate|gray)-900\b/text-foreground/g; s/\btext-(slate-(600|700)|gray-600)\b/text-muted-foreground/g;
  ' "$f"
done
git diff --stat
```

Then fix the four test files that assert `bg-amber-50` (listed under **Files**): change each to `bg-warning-bg`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter studio test -- src/__tests__/rawPaletteClasses.test.ts src/__tests__/designTokens.test.ts src/__tests__/LaneCostsTab.dataTable.test.tsx src/__tests__/DeliveryCostsTab.dataTable.test.tsx src/__tests__/DistancesTab.dataTable.test.tsx src/__tests__/DataTable.test.tsx`
Expected: PASS. If an offender remains whose meaning doesn't fit the table, map it by meaning (warning/danger/success/info/neutral) and note it in the changelog entry. Don't add an allow-list entry without a written reason.

Run: `rg -n "bg-amber|text-amber|bg-red-|bg-sky|bg-slate" artifacts/studio/e2e`
Expected: none. Any hit gets rewritten to the token class in this task.

- [ ] **Step 6: Changelog + commit**

Append:

```markdown
### DU-1.3 — status tokens + raw-palette sweep (design upgrade, Phase 1)
`--success/--warning/--danger/--info` (+`-bg`/`-border`) mapped into `@theme`; `--success` → `#15803D`, `--danger` → `#B91C1C` for >= 4.5:1 on their -bg; ~100 raw Tailwind palette classes in 24 files replaced per the plan's mapping table. Guard: `rawPaletteClasses.test.ts` (tree walk, empty allow-list, non-vacuity).
```

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/__tests__/rawPaletteClasses.test.ts
git commit $(git diff --name-only HEAD -- artifacts/studio docs) artifacts/studio/src/__tests__/rawPaletteClasses.test.ts \
  -m "[DU-1.3] map status tokens into theme and replace raw palette classes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git show --stat HEAD | tail -5
```

---

### Task DU-1.4: Contrast fixes + 11px type floor

**Files:**
- Create: `__tests__/minTextSize.test.ts`
- Modify: `index.css` (the `@theme inline` text scale, `--input`, `.scnd-kicker`)
- Modify: the files with `text-[9px]`, `text-[10px]` or `text-[10.5px]` (about 30 files; live list from Step 2). The biggest are `pages/Landing.tsx` 8, `MapLegend.tsx` 6 and `InputMapTab.tsx` 4.
- Modify: the primary-coloured text sites found in Step 5
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:** Produces the `text-2xs` utility (11px).

- [ ] **Step 1: Write the failing guard and token tests**

Create `__tests__/minTextSize.test.ts` with the same `collect`/`rel`/`isCode` helpers as `rawPaletteClasses.test.ts`, written out in full:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-1.4 (spec §5.1.3) — 11px floor: no arbitrary text size below 11px.
const SRC_ROOT = resolve(__dirname, "..");
const SUB_11 = /\btext-\[(?:[0-9]|10)(?:\.\d+)?px\]/;
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "__tests__") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(SRC_ROOT, f).split(sep).join("/");

describe("minimum text size (DU-1.4)", () => {
  it("no source file uses an arbitrary text size below 11px", () => {
    const offenders: string[] = [];
    for (const f of collect(SRC_ROOT))
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (isCode(line) && SUB_11.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
      });
    expect(offenders).toEqual([]);
  });
  it("is not vacuous", () => {
    expect(SUB_11.test("text-[10px]")).toBe(true);
    expect(SUB_11.test("text-[10.5px]")).toBe(true);
    expect(SUB_11.test("text-[11px]")).toBe(false);
  });
  it("index.css defines the 11px token and the kicker is >= 11px", () => {
    const css = readFileSync(resolve(SRC_ROOT, "index.css"), "utf8");
    expect(css).toMatch(/--text-2xs:\s*0\.6875rem/);
    expect(css).not.toMatch(/\.scnd-kicker\s*\{[^}]*font-size:\s*10(\.5)?px/);
  });
});
```

Append to `__tests__/designTokens.test.ts`:

```ts
describe("contrast fixes (DU-1.4)", () => {
  it("primary-coloured text token (--green-700) >= 4.5:1 on the page background", () => {
    expect(contrast(token("--green-700"), "#FCFCFA")).toBeGreaterThanOrEqual(4.5);
  });
  it("input border matches --line-strong (#C9CCBD = hsl 72 13% 77%)", () => {
    expect(ROOT).toMatch(/--input:\s*72 13% 77%/);
    expect(token("--line-strong").toUpperCase()).toBe("#C9CCBD");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter studio test -- src/__tests__/minTextSize.test.ts src/__tests__/designTokens.test.ts`
Expected: FAIL. You'll see about 60 offenders, the missing `--text-2xs`, the 10.5px kicker, and `--input` still at `72 16% 87%`.

- [ ] **Step 3: Change the tokens in `index.css`**

In `@theme inline`, before `--text-xs: 0.75rem;`, add:

```css
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: calc(1 / 0.6875);
```

In `:root`, change `--input: 72 16% 87%;` to `--input: 72 13% 77%; /* DU-1.4: = --line-strong #C9CCBD as an HSL triple (consumed via hsl(var(--input)) at @theme --color-input) */`. Keep it as an HSL triple. `--color-input: hsl(var(--input))` (`index.css:191`) is its only consumer and stays unchanged.

In `@layer components`, change `.scnd-kicker`'s `font-size: 10.5px;` to `font-size: 11px;`.

- [ ] **Step 4: Sweep the sizes**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio/src
for f in $(rg -l --glob '!__tests__/**' -e 'text-\[(9|10|10\.5)px\]' .); do
  perl -pi -e 's/\btext-\[(?:9|10|10\.5)px\]/text-2xs/g' "$f"
done
rg -n --glob '!__tests__/**' 'text-\[(9|10|10\.5)px\]' . ; echo "exit=$?"   # expect no lines, exit=1
```

Inline-style font sizes are a separate thing: `rg -n "font-size:\s*(9|10)(\.5)?px|fontSize:\s*['\"]?(9|10)" .`. For each hit in student-visible UI (map popups/tooltips HTML strings in `NetworkMap.tsx`), change the value to `11px`. Leave the 12px/13px ones alone.

- [ ] **Step 5: Primary-coloured text → `--green-700`**

Find text painted in primary: `rg -n "text-primary\b|color:\s*['\"]?var\(--primary\)|hsl\(var\(--primary\)\)" artifacts/studio/src --glob '!__tests__/**'`.

For every hit that colours **text** (not a background or border), replace `text-primary` with `text-[var(--green-700)]`. Leave `bg-primary`, `border-primary` and `ring-primary` unchanged: white on primary is 4.56:1 and passes.

Record the count in the changelog entry.

- [ ] **Step 5b: Restrict `--text-faint` to non-essential text**

`--text-faint` (`#83887A`) is only 3.58:1 on the page background. List every use with `rg -n "text-faint|--ink-400" artifacts/studio/src --glob '!__tests__/**'`.

For each hit that renders information a student needs (a value, a label, an instruction, an error), change it to `var(--text-muted)` (`#5B5F54`, 6.46:1). Keep `--text-faint` only for decoration: separators, placeholder glyphs like `—`, and disabled-state hints that duplicate an enabled label nearby.

Append to `__tests__/designTokens.test.ts`:

```ts
describe("faint text is decorative-only (DU-1.4)", () => {
  it("--text-muted, the essential-text fallback, passes AA on the page background", () => {
    expect(contrast(token("--text-muted"), "#FCFCFA")).toBeGreaterThanOrEqual(4.5);
  });
});
```

Record the kept vs changed sites, and the reason for each kept one, in the changelog entry.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter studio test -- src/__tests__/minTextSize.test.ts src/__tests__/designTokens.test.ts`
Expected: PASS.

Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Changelog + commit**

Append:

```markdown
### DU-1.4 — contrast + 11px type floor (design upgrade, Phase 1)
`--text-2xs` (11px) replaces every `text-[9|10|10.5px]` (~60 sites); `.scnd-kicker` 11px; `--input` → `--line-strong`; primary-coloured text → `--green-700` (N sites; fills keep `--primary`). Guards: `minTextSize.test.ts`, `designTokens.test.ts` contrast cases.
```

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/__tests__/minTextSize.test.ts
git commit $(git diff --name-only HEAD -- artifacts/studio docs) artifacts/studio/src/__tests__/minTextSize.test.ts \
  -m "[DU-1.4] enforce 11px text floor and AA contrast tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task DU-1.5: Phase 1 real-browser QA (qa-sdet)

jsdom can't see CSS, so the dash patterns, the token colours and the 11px floor only show up in a real browser. qa-sdet owns this task and is exempt from the simplicity skills.

**Files:**
- Create: `artifacts/studio/e2e/design-upgrade-p1.spec.ts`
- Modify: any sibling `e2e/*.spec.ts` that asserts something Phase 1 changed (Step 1)
- Modify: `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: Sibling-spec sweep**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
rg -n "StudioPage|studio-lab|scn-theme|bg-destructive|bg-amber|bg-slate|text-\[1?0|legend-band-|--band-[0-4]|map-warehouse-open|#5F7F28|rgb\(95, 127, 40\)" e2e
```

Review every hit:
- `design-system.spec.ts:239-242` compares the legend swatch to `--band-0` through `resolveCssVar`. It still holds, because the swatch keeps its inline `backgroundColor`.
- The 5 `path[stroke="var(--band-0)"]` locators still hold.
- Rewrite any assertion on a removed class or value to the new token.

- [ ] **Step 2: Write the QA spec**

`e2e/design-upgrade-p1.spec.ts` must, for **each of the 8 chapter paths** in `lib/chapters.ts`, while logged in to a seeded local account (reuse the auth helper from an existing spec, e.g. the one used by `design-system.spec.ts`):
1. Open the chapter and its Output Map tab, using a seeded solved scenario. Per the e2e `CLAUDE.md`, seed solver results; don't run real CBC.
2. Assert that every `.leaflet-route-pane path` stroke for a banded lane is one of `var(--band-0..4)` or `var(--band-overflow)`, and that lanes in bands 1–4 carry a non-empty `stroke-dasharray`.
3. Assert that `getComputedStyle(document.documentElement).getPropertyValue("--band-0").trim()` is `#6F952F`.
4. Assert that no visible text node renders with a computed `font-size` below 11px: `page.evaluate` over `document.querySelectorAll("body *")`, filtered to elements with a non-empty own text node and a non-zero bounding box.
5. On the Warehouses tab, click an `Inactive` segment and assert its computed `background-color` isn't the destructive red (`rgb(220, 38, 38)` / `rgb(185, 28, 28)`). This is read-only: don't Save.

- [ ] **Step 3: Run the QA locally**

Start both servers per `artifacts/studio/e2e/CLAUDE.md` (local two-server recipe), then:

Run: `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`
Expected: PASS, including `design-upgrade-p1.spec.ts`. **Without `E2E_BASE_URL` the gate silently tests the remote deployment, so never omit it.**

- [ ] **Step 4: Phase gate**

```bash
cd /Users/shubhamkr/network-optimization-studio
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt — wait"
pnpm gate                                                        # exit 0 (3 = timeout: re-run serially)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)   # all pass, unmodified
(cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:<api-port> auth)  # pass
```

Expected: everything green. Record the gate counts in the changelog entry. Compare any failure against `docs/superpowers/flake-registry.md` before treating it as real.

- [ ] **Step 5: Changelog + commit**

Append a `### DU-1.5 — Phase 1 real-browser QA` entry that lists which chapters passed, the gate counts, and every sibling spec rewritten. Then:

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e/design-upgrade-p1.spec.ts
git commit $(git diff --name-only HEAD -- artifacts/studio/e2e docs) artifacts/studio/e2e/design-upgrade-p1.spec.ts \
  -m "[DU-1.5] add Phase 1 real-browser QA and update sibling e2e specs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Phase 1 close-out

- [ ] Run `/harness-retro DU-1`.
- [ ] Invoke `superpowers:finishing-a-development-branch`.
- [ ] **STOP and ask the user for merge approval.** Don't merge, push or deploy without explicit, separate approvals. If the merge is approved: merge to local `main`, run the whole-branch review on the merged state, fix any findings **on `design-upgrade-p1`** (step 5a), and only then ask about the push.
- [ ] After Phase 1 merges: write `docs/superpowers/plans/2026-10-24-design-upgrade-phase-2.md` against the merged code, using the interfaces fixed in §A.
