# Quick Fixes Bundle (QFX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo the controller dispatches per `AGENTS.md` (agent-team roles: frontend-engineer, backend-engineer, qa-sdet); see the per-task **Role** line.

**Goal:** Ship the 10 Studio UI quick fixes in `docs/superpowers/specs/2026-10-24-quick-fixes-design.md` (QFX-1…QFX-10) as one reviewed bundle.

**Architecture:** Mostly frontend changes on existing shared components: `DataTable`, `DownloadMenu`/`useEntityFileMenus`, `superFiles.ts`, `NetworkMap`, `OptimizationParametersTab`, and `index.css`. The one cross-layer change is QFX-7, where super location rows drop `name` in the server Zod validator and the studio together, in one commit. XLSX is produced and consumed entirely in the browser with the already-vendored SheetJS, so the API contract is unchanged.

**Tech Stack:** React + Vite + Tailwind (studio), vitest + React Testing Library, Playwright, Express + Zod (api-server), SheetJS `xlsx` 0.20.3 (vendored, `artifacts/studio/package.json:105`).

## Global Constraints

- The spec `docs/superpowers/specs/2026-10-24-quick-fixes-design.md` is the authority. If this plan and the spec disagree, the spec wins; fix the plan.
- No new dependencies. No OpenAPI change: the export enum stays `csv | json`. No DB schema change. No `solve.py` / `merge_inputs.py` change.
- Never edit generated code (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`).
- One task = one commit, `[QFX-n] <imperative summary>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The `docs/CHANGELOG-implementation.md` entry goes in the same commit (append at the bottom, as a `### QFX-n - <title>` heading matching the existing entries). The commit SHA is the task's rollback point.
- Commit only with an explicit pathspec, after the not-on-main guard: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`.
- Every write failure is rendered via `lib/describeWriteError.ts`, never `err.message`. The source guards `mutationErrorSurface.test.ts` and `rawErrorMessageSurface.test.ts` must stay green.
- Code-writing roles invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code (root CLAUDE.md rule 12). qa-sdet is exempt.
- Copy strings are verbatim from the spec:
  - "The workbook has no sheets."
  - "The first sheet is empty."
  - "This file must contain only <tableKey>."
  - "Fix the readiness issues before solving:"
  - "Use a number from 1 to 3 with up to 3 decimals."
  - "Limit reached: at most N <rows>."
  - "Add a plant and a product first."
  - "Add a customer and a product first."
  - "Add warehouses with plants or customers first."
  - caption nouns "Open warehouses" / "Open mines" / "Open facilities" / fallback "Open sites"
- Test commands:
  - studio single file: `pnpm --filter studio exec vitest run <path>`
  - api-server single file: `pnpm --filter api-server exec vitest run <path>`
  - full gate: `pnpm gate`, run only with 0 concurrent vitest processes. Check with `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "busy: $cnt"`. Exit 3 means a timeout; re-run serially. Exit 1 is a real failure.
  - e2e: `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`. The env var is mandatory; without it the gate tests a remote deployment.
- **`$WT`** in every command is the current task's worktree root (e.g. `export WT=/Users/shubhamkr/nos-qfx-<task>`). Set it once per task before running any step.
- **Line anchors are pre-bundle.** Every `file:line` in this plan was read on `quick-fixes-spec` before any QFX task landed. When an earlier QFX task has already changed a file, locate the block by its content, not its line number. Apply this task's intent on top, and **keep every addition earlier tasks made**. In particular:
  - QFX-4's `sortable` flags and header buttons
  - QFX-7's name-less location shape and `readSheet(…, t.legacy)`
  - QFX-2b's file menus in `SuperTableTab`
  - QFX-6's required `network` prop on `SuperTableTab` and `SuperDistancesTab`

  `pnpm run typecheck` after each task is the backstop.
- Cross-task names: the super table-key union is `TableKey` in `lib/superFiles.ts` and `SuperTable` in `lib/superNetwork.ts`. These are identical unions, so use whichever the file already imports. `superTableToFile` is **async** (SheetJS stays lazy-loaded). `openSiteIds` returns `string[] | null`, where `null` means the field is absent.
- A failing test is not a regression until it is checked against `docs/superpowers/flake-registry.md` and re-run twice in isolation.

## Branch and workspace setup (controller, once)

- [ ] **Step 1: Create the bundle branch off the spec branch (which is `main` + spec + plan commits)**

```bash
cd /Users/shubhamkr/network-optimization-studio
git fetch origin
git merge-base --is-ancestor origin/main quick-fixes-spec && echo "spec branch contains origin/main"   # must print; if not, STOP and ask
git worktree add --lock /Users/shubhamkr/nos-qfx -b quick-fixes quick-fixes-spec
cd /Users/shubhamkr/nos-qfx && git rev-parse --abbrev-ref HEAD   # expect: quick-fixes
pnpm install
```

- [ ] **Step 2: Seed the task ledger.** Create one tracked task per QFX task below, in this order: QFX-10, QFX-4, QFX-7, QFX-2a, QFX-2b, QFX-1, QFX-6, QFX-3, QFX-5, QFX-8, QFX-9, QFX-QA, QFX-GATE, QFX-FINISH.

- [ ] **Step 3: Dispatch.** Tasks run **sequentially** on `quick-fixes`, because later tasks build on earlier code (spec §4).
  - Per root CLAUDE.md, an agent dispatched to a task works in a pre-created locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-qfx-<task> -b <task>-work <current quick-fixes tip>`).
  - Its first command is `cd <path> && git rev-parse --abbrev-ref HEAD`, which must equal `<task>-work`; otherwise STOP.
  - The controller cherry-picks the task commit onto `quick-fixes`, and the next worktree is created from the new tip.
  - Do not use `isolation: "worktree"`.

---
# Plan section A — QFX-10, QFX-4

Paths are relative to `artifacts/studio/` unless stated. Line numbers are from `quick-fixes-spec` @ `7888412b`.

**Read this first: notes for the executor and the controller**

- **Environment:** the worktree `$WT` has **no `node_modules`**, so `pnpm --filter studio exec vitest …` fails there with `Command "vitest" not found`. Run `pnpm install` in the bundle worktree before Step 1 of the first task. I checked the command shape in the main checkout: `pnpm --filter studio exec vitest run src/__tests__/SuperTableTab.test.tsx` gave 7/7 passed.
- **Hard rule 12:** before writing code in each task, invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail`.
- **QFX-10 spec claim that cannot hold as written.** The spec asks for an *inline-SVG* chevron *and* chevron colours taken from theme tokens (`--foreground` / `--muted-foreground`). CSS custom properties do not resolve inside a `url("data:image/svg+xml…")` background image. An SVG chevron would therefore hard-code one colour and need a second, duplicated `.dark` rule, which can drift from the tokens.
  - This plan draws the chevron with two `linear-gradient` triangles coloured `hsl(var(--muted-foreground))`. That gives one rule, follows the tokens in both themes, and uses no image.
  - Everything else in the spec is unchanged (0.6rem inset, `padding-right: 2rem`, input-token border/radius/ring).
  - If the reviewer insists on SVG, the fallback is two data-URI rules: `:root` and `.dark`, with hex values copied from the tokens.
- **QFX-10 dark mode: spec claim (not false, but unreachable).** The app never applies `.dark`. Nothing in `src/` adds the class: grep finds no `ThemeProvider`, no `setTheme`, and no `classList.add/toggle`. `next-themes` is only imported by the unused `components/ui/sonner.tsx`, and `App.tsx:5` mounts the Radix `toaster`. So the "dark" half of the real-browser check means forcing `document.documentElement.classList.add("dark")`. The checklist below does exactly that.
- **QFX-10 small extra: `bg-white` is also removed.** It goes from the two selects that carry it (`superTables.tsx:106`, `SuperDistancesTab.tsx:23`). Under `.dark`, `--muted-foreground` is `210 40% 98%` (near-white), so the chevron would vanish on `bg-white`. The rule sets `background-color: hsl(var(--background))` instead. In light mode that is `60 20% 99%` against `#fff`, which is visually identical.
- **QFX-4 contract: honoured as written.** `ColumnDef.sortable?: boolean` (default true). Action/delete columns set `sortable: false`.
  - I applied it to the property that actually matters: **every column with an empty header (`header: ""`) sets `sortable: false`**, so no unlabeled sort button can render.
  - That covers all 11 delete/remove columns, plus CostSummary's two `metric` label columns (`CostSummaryTab.tsx:187, 218`).
  - A source-reading guard enforces this (Step 3 of QFX-4).
- **Resolved (controller, 2026-10-24): CostSummary's metric tables are not sortable.** These are transposed label/value tables (Objective, Runtime, …). Spec B2.2 already exempts them from the filter, and the user's ask covers "the needed tables". So Step 7b below also sets `sortable: false` on `summaryColumns`' `value` column and on `compareColumns`' scenario columns. The spec's QFX-4 is amended to match.
- **QFX-4 behaviour the spec leaves open, decided here (visible in tests):**
  1. A focus jump also clears the sort. It already "clears every filter". The target page is computed in unsorted order, so a stale sort would land on the wrong page.
  2. Editing the sorted column re-sorts live: the row moves. The super regression test proves that edit and delete still hit the intended row after the move.

---

### Task QFX-10: Refined native `<select>`s

**Plan-time `<select` inventory** (`grep -rn '<select' artifacts/studio/src`, excluding tests). The list is complete: 4 sites. `components/ui/select.tsx` is Radix, imported nowhere, and left untouched. No `createElement("select")` exists.

| # | Site | testid | Classes today | Needs adjusting? | Change |
|---|---|---|---|---|---|
| 1 | `src/components/workspace/super/superTables.tsx:106` (table-cell select; plantProducts/demand/distanceOverrides) | `super-<table>-<rowKey>-<col>` | `h-7 text-xs border rounded bg-white px-1` | **Yes.** `px-1` (utilities layer) overrides the base rule's `padding-right`. `bg-white` hides the dark chevron. | → `h-7 text-xs border rounded pl-1` (keeps `h-7`) |
| 2 | `src/components/workspace/super/SuperDistancesTab.tsx:23` | `super-distance-method` | `h-8 border rounded bg-white px-2 text-xs` | **Yes**, same reasons. QFX-9 later deletes this select. | → `h-8 border rounded pl-2 text-xs` |
| 3 | `src/components/workspace/super/SuperEntityDialog.tsx:48` | `super-entity-status` | `w-full border rounded px-2 h-8` | **Yes**: `px-2` overrides `padding-right`. | → `w-full border rounded pl-2 h-8` |
| 4 | `src/components/workspace/tabs/JadeDistancesTab.tsx:622` | `select-new-jadedistance-leg` | `h-7 text-xs border rounded px-1` | **Yes**: `px-1` overrides `padding-right`. | → `h-7 text-xs border rounded pl-1` |

Why `px-*` must go: Tailwind v4 emits utilities in `@layer utilities`, which outranks `@layer base` whatever the specificity. The new rule lives in the existing `@layer base` block (`src/index.css:504-512`), so any `px-*` / `pr-*` utility on a select would cancel `padding-right: 2rem`. `border` / `rounded` / `h-*` / `text-xs` / `w-full` stay. They set width, radius and height only, and the base rule supplies the input-token border colour (its specificity `0,2,1` beats `* { @apply border-border }` and preflight's `select` reset).

**Files:**
- Modify: `src/index.css:504-512` (the `@layer base` block)
- Modify: `src/components/workspace/super/superTables.tsx:106`
- Modify: `src/components/workspace/super/SuperDistancesTab.tsx:23`
- Modify: `src/components/workspace/super/SuperEntityDialog.tsx:48`
- Modify: `src/components/workspace/tabs/JadeDistancesTab.tsx:622`
- Create: `src/__tests__/nativeSelectStyle.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - A global base rule on `select:not([multiple]):not([size])`.
  - The convention that a native `<select>` carries no `px-*` / `pr-*` / `pe-*` / `bg-white` class. `nativeSelectStyle.test.ts` enforces it, so QFX-9 (which removes select #2) and any later select inherit the check.

- [ ] **Step 1: Write the failing test.** jsdom loads no stylesheet (`artifacts/studio/CLAUDE.md`, the "test that cannot fail" gotcha), so no RTL assertion can see this rule. The unit-level test is a source-reading guard in the style of `rawErrorMessageSurface.test.ts`. It walks the whole tree (not a named file list), and the real-browser check (Step 5) is the behavioural proof.

  Create `src/__tests__/nativeSelectStyle.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { readFileSync, readdirSync, statSync } from "node:fs";
  import { resolve, join, relative, sep } from "node:path";

  /**
   * QFX-10 — every native single-value <select> gets one look from ONE rule in
   * index.css's `@layer base`. jsdom loads no stylesheet, so this guard reads
   * source; the behavioural proof is the real-browser check (light + dark).
   * Tailwind v4 utilities outrank `@layer base`, so a `px-*`/`pr-*`/`pe-*` class
   * on a select cancels the rule's `padding-right` (the chevron then overlaps the
   * text) and `bg-white` hides the dark-mode chevron — hence the second test,
   * which walks the whole tree so a select in a file nobody has written yet is
   * still checked.
   */
  const SRC_ROOT = resolve(__dirname, "..");
  const css = readFileSync(join(SRC_ROOT, "index.css"), "utf8");

  function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collectSourceFiles(full, out);
      else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
    }
    return out;
  }

  /** Each `<select` opening tag's own className: the first `className="…"` before its first `<option`. */
  function nativeSelects(): Array<{ site: string; className: string | null }> {
    const found: Array<{ site: string; className: string | null }> = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<select\b/g)) {
        const end = src.indexOf("<option", m.index);
        const tag = src.slice(m.index, end < 0 ? undefined : end);
        const line = src.slice(0, m.index).split("\n").length;
        found.push({
          site: `${relative(SRC_ROOT, file).split(sep).join("/")}:${line}`,
          className: /className="([^"]*)"/.exec(tag)?.[1] ?? null,
        });
      }
    }
    return found;
  }

  describe("native <select> styling (QFX-10)", () => {
    it("index.css @layer base styles every single-value select: no native arrow, inset token chevron, room for it", () => {
      const base = css.slice(css.indexOf("@layer base {"), css.indexOf("@layer utilities {"));
      const rule = /select:not\(\[multiple\]\):not\(\[size\]\)\s*\{([^}]*)\}/.exec(base);
      expect(rule, "rule missing from @layer base").not.toBeNull();
      const decls = rule![1];
      expect(decls).toMatch(/appearance:\s*none/);
      expect(decls).toMatch(/padding-right:\s*2rem/);
      expect(decls).toMatch(/hsl\(var\(--muted-foreground\)\)/);
      expect(decls).toMatch(/calc\(100% - 0\.6rem\)/);
      expect(decls).toMatch(/border:\s*1px solid hsl\(var\(--input\)\)/);
      expect(base).toMatch(/select:not\(\[multiple\]\):not\(\[size\]\):focus-visible\s*\{[^}]*hsl\(var\(--ring\)\)/);
    });

    it("no native select carries a class that overrides the rule's padding-right or background", () => {
      const selects = nativeSelects();
      // Non-vacuity: superTables, SuperEntityDialog, JadeDistancesTab (+ SuperDistancesTab until QFX-9).
      expect(selects.length).toBeGreaterThanOrEqual(3);
      const offenders = selects.filter(s => /(^|\s)(px|pr|pe)-\S+|(^|\s)bg-white(\s|$)/.test(s.className ?? ""));
      expect(offenders).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run it, expect FAIL.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/nativeSelectStyle.test.ts
  ```
  Expected:
  - test 1 fails with `AssertionError: rule missing from @layer base: expected null not to be null`
  - test 2 fails with `expected [ { site: 'components/workspace/super/SuperDistancesTab.tsx:23', … }, … ] to deeply equal []`, listing 4 offenders

- [ ] **Step 3: Implement the CSS rule.** In `src/index.css:504-512`, replace:
  ```css
  @layer base {
    * {
      @apply border-border;
    }

    body {
      @apply font-sans antialiased bg-background text-foreground;
    }
  }
  ```
  with:
  ```css
  @layer base {
    * {
      @apply border-border;
    }

    body {
      @apply font-sans antialiased bg-background text-foreground;
    }

    /* QFX-10 — one look for every native single-value <select>: the browser arrow
       is replaced by an inset chevron drawn as two gradient triangles, because a
       data-URI SVG cannot read CSS variables and this must follow the theme tokens
       in light AND .dark. Border/radius/ring mirror ui/input.tsx's tokens. Lives in
       `base`, so per-file utilities still set height/width/radius — but a select
       must not carry px-*/pr-*/bg-white (utilities would cancel padding-right and
       hide the dark chevron; nativeSelectStyle.test.ts enforces this). */
    select:not([multiple]):not([size]) {
      appearance: none;
      background-color: hsl(var(--background));
      background-image:
        linear-gradient(45deg, transparent 50%, hsl(var(--muted-foreground)) 50%),
        linear-gradient(135deg, hsl(var(--muted-foreground)) 50%, transparent 50%);
      background-position: calc(100% - 0.6rem - 4px) 50%, calc(100% - 0.6rem) 50%;
      background-size: 4px 4px;
      background-repeat: no-repeat;
      padding-right: 2rem;
      border: 1px solid hsl(var(--input));
      border-radius: var(--radius);
    }

    select:not([multiple]):not([size]):focus-visible {
      outline: none;
      box-shadow: 0 0 0 1px hsl(var(--ring));
    }
  }
  ```

- [ ] **Step 4: Implement the per-file class changes** (one `className` string each; nothing else in these lines changes).
  - `src/components/workspace/super/superTables.tsx:106`:
    `<select className="h-7 text-xs border rounded bg-white px-1" value=…` → `<select className="h-7 text-xs border rounded pl-1" value=…`
  - `src/components/workspace/super/SuperDistancesTab.tsx:23`:
    `<select data-testid="super-distance-method" className="h-8 border rounded bg-white px-2 text-xs" value=…` → `<select data-testid="super-distance-method" className="h-8 border rounded pl-2 text-xs" value=…`
  - `src/components/workspace/super/SuperEntityDialog.tsx:48`:
    `<label>Status<select className="w-full border rounded px-2 h-8" data-testid="super-entity-status" …` → `<label>Status<select className="w-full border rounded pl-2 h-8" data-testid="super-entity-status" …`
  - `src/components/workspace/tabs/JadeDistancesTab.tsx:622`:
    `        className="h-7 text-xs border rounded px-1"` → `        className="h-7 text-xs border rounded pl-1"`

- [ ] **Step 5: Real-browser check (qa-sdet, light + dark).**
  1. Start the two local servers per `artifacts/studio/e2e/CLAUDE.md`:
     - api-server: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev`
     - studio: `PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`
  2. Register a fresh account, then open each site:
     - **(a)** Super Model card → create a scenario → empty state "Import network" → choose `public/samples/super-model-sample.json` → Replace. Then visit the Plant products, Demand and Distance overrides tabs. Their Plant/Product/Customer/From/To cells are select #1. On Distance overrides, click "+ Add row" if it is empty.
     - **(b)** Same scenario → Distances tab → method select #2.
     - **(c)** Same scenario → Input Map → right-click an empty map spot → Add warehouse. The dialog's Status field is select #3.
     - **(d)** Chapter 9 (JADE) card → create a scenario → Distances tab → `button-add-jadedistance-row`. The leg select is #4.
  3. At each site, run this in the DevTools console:
     ```js
     [...document.querySelectorAll("select")].map(s => { const c = getComputedStyle(s); return { id: s.dataset.testid, appearance: c.appearance, pr: c.paddingRight, bgImg: c.backgroundImage.slice(0, 22), bg: c.backgroundColor, h: c.height }; })
     ```
     Expect, for every select:
     - `appearance: "none"`
     - `pr: "32px"`
     - `bgImg: "linear-gradient(45deg"`
     - `bg` equal to `getComputedStyle(document.body).backgroundColor`
     - `h` is `28px` for #1/#4 (`h-7`) and `32px` for #2/#3 (`h-8`), so table-cell selects keep their height
  4. Visual checks: a small down-chevron sits about 10px inside the right edge and never overlaps the selected text (pick the longest option, e.g. "Road (OpenRouteService, truck)"). Tab to the select: a 1px ring-colour focus ring shows. The option list still opens and selection still works (mouse and keyboard ↑/↓).
  5. **Dark mode.** The app has no toggle, so run `document.documentElement.classList.add("dark")` in the console and repeat items 3–4. Expected: dark `bg` (`hsl(222 84% 12%)`), a near-white chevron that stays visible, and readable white text. Then remove the class.
  6. Save one screenshot per site × theme (8 total) to the bundle's `.harness/` scratch and record the pass in the QA report. `.harness/` is gitignored, so nothing is committed.

- [ ] **Step 6: Run the task's tests, expect PASS.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/nativeSelectStyle.test.ts src/__tests__/SuperTableTab.test.tsx
  ```
  Expect 2/2 and 7/7 passing. `SuperTableTab.test.tsx` still drives `super-distance-method` and the table-cell selects by `fireEvent.change`. Then run `pnpm gate` with 0 concurrent vitest: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || exit 1`. Exit 3 means re-run serially.

- [ ] **Step 7: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:
  ```markdown
  ### QFX-10 - refined native selects

  One `@layer base` rule in `artifacts/studio/src/index.css` on `select:not([multiple]):not([size])`: `appearance: none`, an inset chevron 0.6rem from the right drawn as two `linear-gradient` triangles in `hsl(var(--muted-foreground))` (a data-URI SVG cannot read CSS variables, so this is the one way a single rule follows the tokens in light and `.dark`), `padding-right: 2rem`, `--background` fill, `--input` border, `--radius`, and a 1px `--ring` focus ring (mirrors `ui/input.tsx`). Plan-time grep found 4 native selects; each lost the class that cancelled the rule (Tailwind utilities outrank `base`): `superTables.tsx:106` and `SuperDistancesTab.tsx:23` `bg-white px-N` → `pl-N`; `SuperEntityDialog.tsx:48` and `JadeDistancesTab.tsx:622` `px-N` → `pl-N`. Heights unchanged. Radix `ui/select.tsx` untouched. New source-reading guard `src/__tests__/nativeSelectStyle.test.ts` (tree walk, non-vacuity ≥3) fails on a missing rule or on any select carrying `px-*`/`pr-*`/`pe-*`/`bg-white`. Real-browser check in light and forced `.dark` (the app has no theme toggle; nothing adds `.dark`), 4 sites × 2 themes. No e2e spec asserts these classes.
  ```

- [ ] **Step 8: Commit.**
  ```bash
  [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
  git add artifacts/studio/src/index.css artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/__tests__/nativeSelectStyle.test.ts docs/CHANGELOG-implementation.md
  git commit artifacts/studio/src/index.css artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/__tests__/nativeSelectStyle.test.ts docs/CHANGELOG-implementation.md -m "[QFX-10] style native selects with one token-driven chevron rule

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

**E2E / sibling-spec impact (QFX-10):**
- `grep -rn "super-distance-method\|select-new-jadedistance-leg\|super-entity-status\|bg-white\|px-1\|px-2" artifacts/studio/e2e` → only `super-model.spec.ts:345`, `page.getByTestId("super-distance-method").selectOption("road", …)`.
  - It is unaffected: the testid is unchanged and `selectOption` ignores `appearance`.
  - No replacement needed. QFX-9 owns rewriting this line when it removes the select.
- No unit or e2e test asserts any of the removed classes (`grep -rn "bg-white\|px-1\|px-2" src/__tests__ e2e | grep -i select` → none).

---

### Task QFX-4: Sort by clicking a column header

**Consumer inventory: all 20 `DataTable` consumers** (`grep -rln "<DataTable" src`, excluding tests). All of them sort after this task, with no per-consumer change except the empty-header columns.

`src/components/workspace/super/SuperTableTab.tsx` and the tabs under `src/components/workspace/tabs/`: `AssignmentsTab`, `CapabilityMatrixTab`, `CostSummaryTab`, `CustomersTab`, `DeliveryCostsTab`, `DistancesTab`, `FlowsTab`, `JadeAssignmentsTab`, `JadeDistancesTab`, `JadeFlowsTab`, `LaneCostsTab`, `LegDistancesTab`, `MinesTab`, `OpenWarehousesTab`, `PlantsTab`, `ServiceStatsTab`, `StationsTab`, `TransportCostsTab`, `WarehousesTab`.

**Columns set to `sortable: false`: every `header: ""` column** (`grep -rn 'header: ""' src`, excluding tests; 13 sites, all listed):

| # | Site | Column id | What it is |
|---|---|---|---|
| 1 | `src/components/workspace/super/superTables.tsx:128` | `delete` | super row ✕ (`DeleteRowButton`) |
| 2 | `src/components/workspace/tabs/WarehousesTab.tsx:307` | `delete` | added-warehouse ✕ |
| 3 | `src/components/workspace/tabs/PlantsTab.tsx:151` | `delete` | added-plant ✕ |
| 4 | `src/components/workspace/tabs/MinesTab.tsx:228` | `delete` | added-mine ✕ |
| 5 | `src/components/workspace/tabs/CustomersTab.tsx:398` | `delete` | added-customer ✕ |
| 6 | `src/components/workspace/tabs/StationsTab.tsx:231` | `delete` | added-station ✕ |
| 7 | `src/components/workspace/tabs/DistancesTab.tsx:477` | `remove` | distance-override ✕ |
| 8 | `src/components/workspace/tabs/JadeDistancesTab.tsx:568` | `remove` | JADE distance-override ✕ |
| 9 | `src/components/workspace/tabs/DeliveryCostsTab.tsx:301` | `remove` | delivery cost-override ✕ |
| 10 | `src/components/workspace/tabs/LaneCostsTab.tsx:265` | `remove` | lane-cost-override ✕ |
| 11 | `src/components/workspace/tabs/LegDistancesTab.tsx:284` | `remove` | leg-distance-override ✕ |
| 12 | `src/components/workspace/tabs/CostSummaryTab.tsx:187` | `metric` | single-scenario metric label (unlabeled header) |
| 13 | `src/components/workspace/tabs/CostSummaryTab.tsx:218` | `metric` | compare metric label (unlabeled header) |

No other action column exists. Every other column in the 20 consumers has a non-empty header and a data `value()`. `grep 'value: () =>'` returns exactly sites 1–11.

**Files:**
- Modify: `src/components/data-table/types.ts:38-41` (add `sortable` after `filterResetKey`)
- Modify: `src/components/data-table/DataTable.tsx:1-7, 9, 17, 19, 35-45, 76-77, 110-120`
- Modify: the 13 sites in the table above (insert `sortable: false`)
- Modify: `src/__tests__/DataTable.test.tsx:62-65` (header class assertions now target the `<th>` by role)
- Test: `src/__tests__/DataTable.test.tsx` (append a describe block)
- Test: `src/__tests__/SuperTableTab.test.tsx` (append the regression test)
- Create: `src/__tests__/sortableEmptyHeaders.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ColumnDef<T>.sortable?: boolean` (`components/data-table/types.ts`), default true. Later tasks that add a `DataTable` action column must set `sortable: false`. `sortableEmptyHeaders.test.ts` fails otherwise: QFX-2 / QFX-6 rely on this if they add any action column with `header: ""`.
  - Sort state is internal to `DataTable`, with no new props.

- [ ] **Step 1: Write the failing tests (DataTable).** Append to `src/__tests__/DataTable.test.tsx` (it already imports `useState`, `render`, `screen`, `within`, `userEvent`, `DataTable`, `ColumnDef`, `DataTableFocus`, and defines `Row`, `makeRows`, `columns`, `renderTable`, `visibleIds`):
  ```tsx
  describe("DataTable — sort (QFX-4)", () => {
    // city: natural + case-insensitive ("a2" < "A10"; "b" ties "B"); blank city/demand go last.
    const mixed: Row[] = [
      { id: "r1", city: "b", demand: 10 },
      { id: "r2", city: "A10", demand: null },
      { id: "r3", city: "a2", demand: 2 },
      { id: "r4", city: "", demand: 10 },
      { id: "r5", city: "B", demand: 30 },
    ];
    const head = (name: string) => screen.getByRole("columnheader", { name });

    it("a header click cycles ascending → descending → off, with ▲/▼ and aria-sort", async () => {
      const user = userEvent.setup();
      renderTable({ rows: mixed });
      const th = head("Demand");
      const btn = within(th).getByRole("button");
      expect(th).toHaveAttribute("aria-sort", "none");
      await user.click(btn);
      expect(th).toHaveAttribute("aria-sort", "ascending");
      expect(th).toHaveTextContent("Demand▲");
      await user.click(btn);
      expect(th).toHaveAttribute("aria-sort", "descending");
      expect(th).toHaveTextContent("Demand▼");
      await user.click(btn);
      expect(th).toHaveAttribute("aria-sort", "none");
      expect(th.textContent).toBe("Demand");
      expect(visibleIds()).toEqual(["row-r1", "row-r2", "row-r3", "row-r4", "row-r5"]);
    });

    it("numbers compare numerically; blanks last in both directions; ties keep input order", async () => {
      const user = userEvent.setup();
      renderTable({ rows: mixed });
      const btn = within(head("Demand")).getByRole("button");
      await user.click(btn);
      expect(visibleIds()).toEqual(["row-r3", "row-r1", "row-r4", "row-r5", "row-r2"]);
      await user.click(btn);
      expect(visibleIds()).toEqual(["row-r5", "row-r1", "row-r4", "row-r3", "row-r2"]);
    });

    it("strings use natural, case-insensitive order; blanks last in both directions; ties stable", async () => {
      const user = userEvent.setup();
      renderTable({ rows: mixed });
      const btn = within(head("City")).getByRole("button");
      await user.click(btn);
      expect(visibleIds()).toEqual(["row-r3", "row-r2", "row-r1", "row-r5", "row-r4"]);
      await user.click(btn);
      expect(visibleIds()).toEqual(["row-r1", "row-r5", "row-r2", "row-r3", "row-r4"]);
    });

    it("only one column is sorted at a time", async () => {
      const user = userEvent.setup();
      renderTable({ rows: mixed });
      await user.click(within(head("City")).getByRole("button"));
      await user.click(within(head("Demand")).getByRole("button"));
      expect(head("City")).toHaveAttribute("aria-sort", "none");
      expect(head("Demand")).toHaveAttribute("aria-sort", "ascending");
      expect(visibleIds()[0]).toBe("row-r3");
    });

    it("sortable: false renders the plain header — no button, no aria-sort", () => {
      renderTable({ columns: [columns[0], { ...columns[1], sortable: false }, columns[2]] });
      expect(within(head("City")).queryByRole("button")).toBeNull();
      expect(head("City")).not.toHaveAttribute("aria-sort");
      expect(within(head("ID")).getByRole("button")).toBeInTheDocument();
    });

    it("sorts BEFORE paging, and a sort change returns to page 1", async () => {
      const user = userEvent.setup();
      render(
        <DataTable<Row> rows={makeRows(120)} rowKey={r => r.id} columns={columns}
          testIds={{ row: r => `row-${r.id}`, pagerNext: "t-next", pageIndicator: "t-ind" }} />,
      );
      const btn = within(head("Demand")).getByRole("button");
      await user.click(screen.getByTestId("t-next"));
      expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
      await user.click(btn); // ascending
      expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
      await user.click(screen.getByTestId("t-next"));
      await user.click(btn); // descending
      expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
      expect(visibleIds()[0]).toBe("row-C120"); // the global max, not page 1's max
    });

    it("never mutates or reorders the caller's rows array", async () => {
      const user = userEvent.setup();
      const rows = makeRows(3);
      const before = [...rows];
      renderTable({ rows });
      const btn = within(head("Demand")).getByRole("button");
      await user.click(btn);
      await user.click(btn);
      expect(visibleIds()).toEqual(["row-C3", "row-C2", "row-C1"]);
      expect(rows.every((r, i) => r === before[i])).toBe(true);
    });

    it("sections: rows sort within each section and section order is unchanged", async () => {
      const user = userEvent.setup();
      const added: Row[] = [
        { id: "A1", city: "Z", demand: 5, added: true },
        { id: "A2", city: "Y", demand: 50, added: true },
      ];
      render(
        <DataTable<Row>
          rows={[...makeRows(3), ...added]}
          rowKey={r => r.id}
          columns={columns}
          sections={[
            { id: "base", testId: "sec-base", includes: r => !r.added },
            { id: "added", testId: "sec-added", includes: r => !!r.added },
          ]}
          testIds={{ row: r => `row-${r.id}` }}
        />,
      );
      const btn = within(screen.getAllByRole("columnheader", { name: "Demand" })[0]).getByRole("button");
      await user.click(btn);
      await user.click(btn); // descending: A2 (50) is the global max but stays in its own section
      const ids = (sec: string) => within(screen.getByTestId(sec)).getAllByTestId(/^row-/).map(tr => tr.getAttribute("data-testid"));
      expect(ids("sec-base")).toEqual(["row-C3", "row-C2", "row-C1"]);
      expect(ids("sec-added")).toEqual(["row-A2", "row-A1"]);
      expect(screen.getByTestId("sec-base").compareDocumentPosition(screen.getByTestId("sec-added")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const th of screen.getAllByRole("columnheader", { name: "Demand" })) expect(th).toHaveAttribute("aria-sort", "descending");
    });

    it("a focus jump clears the sort and lands on the target's page in unsorted order", async () => {
      function SortThenJump() {
        const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
        return (
          <>
            <button onClick={() => setFocus({ token: Date.now(), matches: r => r.id === "C75" })}>jump</button>
            <DataTable<Row> rows={makeRows(120)} rowKey={r => r.id} columns={columns} focus={focus}
              testIds={{ row: r => `row-${r.id}`, pageIndicator: "t-ind" }} />
          </>
        );
      }
      const user = userEvent.setup();
      render(<SortThenJump />);
      const btn = within(head("Demand")).getByRole("button");
      await user.click(btn);
      await user.click(btn);
      expect(visibleIds()[0]).toBe("row-C120");
      await user.click(screen.getByText("jump"));
      expect(head("Demand")).toHaveAttribute("aria-sort", "none");
      expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
      expect(screen.getByTestId("row-C75")).toBeInTheDocument();
    });
  });
  ```
  In the same file, update the existing markup test at `:60-66`. Once the header text sits inside a `<button>`, `getByText("Demand")` resolves to the button, not the `<th>`. Replace:
  ```tsx
    it("centre-aligns kind:number header and cells only; applies cellClassName", () => {
      renderTable();
      expect(screen.getByText("Demand")).toHaveClass("text-center");
      expect(screen.getByText("City")).not.toHaveClass("text-center");
      expect(screen.getByTestId("cell-demand-C1")).toHaveClass("text-center", "font-mono", "px-3", "py-1.5");
      expect(screen.getByText("City")).toHaveClass("whitespace-nowrap");
    });
  ```
  with:
  ```tsx
    it("centre-aligns kind:number header and cells only; applies cellClassName", () => {
      renderTable();
      expect(screen.getByRole("columnheader", { name: "Demand" })).toHaveClass("text-center");
      expect(screen.getByRole("columnheader", { name: "City" })).not.toHaveClass("text-center");
      expect(screen.getByTestId("cell-demand-C1")).toHaveClass("text-center", "font-mono", "px-3", "py-1.5");
      expect(screen.getByRole("columnheader", { name: "City" })).toHaveClass("whitespace-nowrap");
    });
  ```

- [ ] **Step 2: Write the failing test (super-table regression, the spec's done-when).** In `src/__tests__/SuperTableTab.test.tsx`:
  - change line 2 from `import { render, screen, fireEvent } from "@testing-library/react";` to `import { render, screen, fireEvent, within } from "@testing-library/react";`
  - insert a new line 2 above it: `import { useState } from "react";`
  - append inside `describe("SuperTableTab", …)` before its closing `});`:
  ```tsx
    it("QFX-4 regression: sorted descending, an edit and a delete each hit the intended underlying row", () => {
      const three = [
        { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
        { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
        { plantId: "p1", productId: "k3", capacity: 6, costPerUnit: 3 },
      ];
      const spy = vi.fn();
      function Harness() {
        const [rs, setRs] = useState<Record<string, unknown>[]>(three);
        return <SuperTableTab table="plantProducts" rows={rs} onChange={next => { spy(next); setRs(next); }} readOnly={false}
          options={{ productIds: ["k1", "k2", "k3"], plantIds: ["p1"] }} />;
      }
      render(<Harness />);
      const order = () => screen.getAllByTestId(/^super-row-plantProducts-/).map(tr => tr.getAttribute("data-testid"));
      const cap = screen.getByRole("columnheader", { name: "Capacity" });
      fireEvent.click(within(cap).getByRole("button"));
      fireEvent.click(within(cap).getByRole("button"));
      expect(cap).toHaveAttribute("aria-sort", "descending");
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k3"]', 'super-row-plantProducts-["p1","k1"]',
      ]);

      // Edit the row DISPLAYED second (k3 = original index 2), not original index 1.
      fireEvent.change(screen.getByTestId('super-plantProducts-["p1","k3"]-capacity'), { target: { value: "1" } });
      expect(spy).toHaveBeenLastCalledWith([three[0], three[1], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]',
      ]);

      // Delete the row DISPLAYED first (k2 = original index 1), not original index 0.
      fireEvent.click(screen.getByTestId('super-plantProducts-["p1","k2"]-delete'));
      expect(spy).toHaveBeenLastCalledWith([three[0], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual(['super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]']);
    });

    it("the delete column header is not sortable", () => {
      render(<SuperTableTab table="plantProducts" rows={rows} onChange={vi.fn()} readOnly={false} options={options} />);
      const heads = screen.getAllByRole("columnheader");
      expect(within(heads[heads.length - 1]).queryByRole("button")).toBeNull();
      expect(heads[heads.length - 1]).not.toHaveAttribute("aria-sort");
    });
  ```

- [ ] **Step 3: Write the failing guard (every empty-header column is unsortable).** Create `src/__tests__/sortableEmptyHeaders.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { readFileSync, readdirSync, statSync } from "node:fs";
  import { resolve, join, relative, sep } from "node:path";

  /**
   * QFX-4 — a sortable header renders a <button> around `header`; with
   * `header: ""` that button has no accessible name. Every empty-header column
   * (delete/remove ✕ columns, CostSummary's metric-label column) must therefore
   * say `sortable: false` on the very next property. Walks the whole src tree so
   * an action column added by a later task is checked too.
   */
  const SRC_ROOT = resolve(__dirname, "..");

  function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collectSourceFiles(full, out);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  describe("empty-header DataTable columns are not sortable (QFX-4)", () => {
    it("every `header: \"\"` is followed by `sortable: false`", () => {
      let total = 0;
      const offenders: string[] = [];
      for (const file of collectSourceFiles(SRC_ROOT)) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/header: "",/g)) {
          total++;
          if (!/^\s*sortable: false,/.test(src.slice(m.index + m[0].length))) {
            offenders.push(`${relative(SRC_ROOT, file).split(sep).join("/")}:${src.slice(0, m.index).split("\n").length}`);
          }
        }
      }
      // Non-vacuity: 11 delete/remove columns + 2 CostSummary metric columns at QFX-4 time.
      expect(total).toBeGreaterThanOrEqual(13);
      expect(offenders).toEqual([]);
    });
  });
  ```

- [ ] **Step 4: Run them, expect FAIL.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/DataTable.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/sortableEmptyHeaders.test.ts
  ```
  Expected:
  - every new `DataTable — sort (QFX-4)` case fails with `TestingLibraryElementError: Unable to find an accessible element with the role "button"`
  - the `sortable: false` case fails at its last line, `within(head("ID")).getByRole("button")`, with the same `Unable to find … role "button"` error
  - the super regression fails with the same `Unable to find … role "button"`
  - "the delete column header is not sortable" **passes** before the change (no buttons exist yet). That is expected: it is the post-change guard for site #1.
  - `sortableEmptyHeaders` fails with `expected [ 'components/workspace/super/superTables.tsx:128', 'components/workspace/tabs/CostSummaryTab.tsx:187', … (13) ] to deeply equal []`
  - the updated markup test passes both before and after (it is a selector change only)

- [ ] **Step 5: Implement `sortable` on `ColumnDef`.** In `src/components/data-table/types.ts:38-41`, replace:
  ```ts
    /** When this value changes, ONLY this column's active filter is cleared (e.g. the
     * JADE `band` filter when bands or the unit change, `JadeAssignmentsTab.tsx:277-280`). */
    filterResetKey?: string | number;
  }
  ```
  with:
  ```ts
    /** When this value changes, ONLY this column's active filter is cleared (e.g. the
     * JADE `band` filter when bands or the unit change, `JadeAssignmentsTab.tsx:277-280`). */
    filterResetKey?: string | number;
    /** QFX-4 — the header is a button cycling ascending → descending → off, ordering by
     * `value()`. Default true. Every empty-header (delete/action) column sets `false`
     * (`sortableEmptyHeaders.test.ts`). */
    sortable?: boolean;
  }
  ```

- [ ] **Step 6: Implement the sort in `DataTable.tsx`.**
  - **(a)** Header comment, `src/components/data-table/DataTable.tsx:3`. Replace `// a literal testid map; the shell owns filter → clamp → slice 50, the filter` with `// a literal testid map; the shell owns filter → sort → clamp → slice 50, the filter`.
  - **(b)** Imports, `:9` and `:17`. Replace:
    ```ts
    import { useEffect, useMemo, useRef, type ReactNode } from "react";
    ```
    with:
    ```ts
    import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
    ```
    and replace:
    ```ts
    import type { ColumnDef, DataTableProps, DataTableSection } from "./types";
    ```
    with:
    ```ts
    import type { CellValue, ColumnDef, DataTableProps, DataTableSection } from "./types";
    ```
  - **(c)** Module-level helpers, directly after `const KEY_SEP = "\u0000";` (`:19`). Insert:
    ```ts

    // QFX-4 — one sorted column at a time; dir 1 = ascending, -1 = descending.
    type SortState = { id: string; dir: 1 | -1 };
    const sortKey = (s: SortState | null) => (s ? `${s.id}:${s.dir}` : "");
    const isBlank = (v: CellValue) => v === null || v === "" || Number.isNaN(v);

    /** Blank/null last in BOTH directions; numbers numerically; strings natural and
     * case-insensitive. 0 = tie (the caller keeps input order). */
    function compareCells(a: CellValue, b: CellValue, dir: 1 | -1): number {
      const blankA = isBlank(a);
      const blankB = isBlank(b);
      if (blankA || blankB) return Number(blankA) - Number(blankB);
      const c =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
      return dir * c;
    }

    /** Sorts decorated `{ row, originalIndex }` items, never the input array, so every
     * cell()/rowKey() callback still receives the adapter's own row (super tables carry
     * their original index inside it, `superTables.tsx` `Item`). With sections, a row's
     * section index sorts first: rows sort within their section, section order is
     * unchanged and paging still runs base-first. Ties keep input order (stable). */
    function sortRows<T>(rows: T[], sort: SortState | null, columns: ColumnDef<T>[], sections?: DataTableSection<T>[]): T[] {
      if (!sort) return rows;
      const decorated = rows.map((row, originalIndex) => {
        const found = sections ? sections.findIndex(s => s.includes(row)) : 0;
        const sec = found < 0 ? (sections?.length ?? 0) : found;
        const cols = sections?.[sec]?.columns ?? columns;
        const col = cols.find(c => c.id === sort.id);
        return { row, originalIndex, sec, v: col ? col.value(row) : null };
      });
      decorated.sort((x, y) => x.sec - y.sec || compareCells(x.v, y.v, sort.dir) || x.originalIndex - y.originalIndex);
      return decorated.map(d => d.row);
    }
    ```
  - **(d)** Pipeline, `:35-45`. Replace:
    ```ts
      // Pipeline (B2.2, fixed order): effective rows (adapter) → filter → clamp page → slice 50.
      const descriptors = useMemo(() => deriveFilterDescriptors(columns, rows), [columns, rows]);
      const tableFilters = useTableFilters(rows, descriptors);
      const { filteredRows, filterState, setFilter, clearAll } = tableFilters;
      // Reset key = canonical filter state + sorted key set of ALL effective rows
      // (pageResetKey): any filter change or add/delete resets to page 1; a cell
      // edit or a reorder does not.
      const resetKey = useMemo(() => pageResetKey(rows, rowKey, filterState), [rows, rowKey, filterState]);
      // The key the table will have once a focus jump has cleared every filter.
      const clearedKey = useMemo(() => pageResetKey(rows, rowKey, {}), [rows, rowKey]);
      const paged = usePagedRows(filteredRows, resetKey);
    ```
    with:
    ```ts
      // Pipeline (B2.2 + QFX-4, fixed order): effective rows (adapter) → filter → sort → clamp page → slice 50.
      const descriptors = useMemo(() => deriveFilterDescriptors(columns, rows), [columns, rows]);
      const tableFilters = useTableFilters(rows, descriptors);
      const { filteredRows, filterState, setFilter, clearAll } = tableFilters;
      // QFX-4 — component-local (resets on unmount); asc → desc → off, another column starts asc.
      const [sort, setSort] = useState<SortState | null>(null);
      const cycleSort = (id: string) =>
        setSort(s => (!s || s.id !== id ? { id, dir: 1 } : s.dir === 1 ? { id, dir: -1 } : null));
      // `columns` is rebuilt per render (types.ts), so this is not memoised; it is a no-op when unsorted.
      const sortedRows = sortRows(filteredRows, sort, columns, sections);
      // Reset key = canonical filter state + sorted key set of ALL effective rows
      // (pageResetKey) + the sort: any filter or sort change, or add/delete, resets to
      // page 1; a cell edit or a reorder does not.
      const resetKey = useMemo(
        () => pageResetKey(rows, rowKey, filterState) + KEY_SEP + sortKey(sort),
        [rows, rowKey, filterState, sort],
      );
      // The key the table will have once a focus jump has cleared every filter and the sort.
      const clearedKey = useMemo(() => pageResetKey(rows, rowKey, {}) + KEY_SEP + sortKey(null), [rows, rowKey]);
      const paged = usePagedRows(sortedRows, resetKey);
    ```
  - **(e)** Focus jump also clears the sort, `:62-63` and `:77`. Replace the comment line `  // Focus jump (today's behaviour, DistancesTab.tsx:459-467): clear every filter,` with `  // Focus jump (today's behaviour, DistancesTab.tsx:459-467): clear every filter (and the QFX-4 sort),`. Then replace:
    ```ts
        clearAll();
        paged.setPage(Math.floor(idx / PAGE_SIZE) + 1, clearedKey);
    ```
    with:
    ```ts
        clearAll();
        setSort(null);
        paged.setPage(Math.floor(idx / PAGE_SIZE) + 1, clearedKey);
    ```
  - **(f)** Header cells, `:110-120`. Replace:
    ```tsx
              {cols.map(c => (
                <TableHead
                  key={c.id}
                  className={cn("h-auto px-3 py-1.5 whitespace-nowrap", c.kind === "number" && "text-center")}
                  data-testid={c.headerTestId}
                >
                  {c.header}
                </TableHead>
              ))}
    ```
    with:
    ```tsx
              {cols.map(c => {
                const sortable = c.sortable !== false;
                const dir = sort?.id === c.id ? sort.dir : 0;
                return (
                  <TableHead
                    key={c.id}
                    className={cn("h-auto px-3 py-1.5 whitespace-nowrap", c.kind === "number" && "text-center")}
                    data-testid={c.headerTestId}
                    aria-sort={!sortable ? undefined : dir === 1 ? "ascending" : dir === -1 ? "descending" : "none"}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => cycleSort(c.id)}
                      >
                        {c.header}
                        {dir !== 0 && <span aria-hidden="true">{dir === 1 ? "▲" : "▼"}</span>}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
    ```
    `renderTable` is a closure inside the component, so `sort` / `cycleSort` are in scope. Sections render one header per section, and all of them read the same `sort`.

- [ ] **Step 7: Set `sortable: false` on the 13 empty-header columns.**
  - Site #1 is single-line. In `src/components/workspace/super/superTables.tsx:128`, replace:
    ```ts
        id: "delete", header: "", kind: "text", filter: false, value: () => "",
    ```
    with:
    ```ts
        id: "delete", header: "", sortable: false, kind: "text", filter: false, value: () => "",
    ```
  - Sites #2–#13 are all the multi-line form `<indent>header: "",\n`. In each of them, insert `<indent>sortable: false,` on the next line. One mechanical command from the repo root:
    ```bash
    cd artifacts/studio/src/components/workspace/tabs && perl -0pi -e 's/^(\s*)header: "",\n/$1header: "",\n$1sortable: false,\n/mg' WarehousesTab.tsx PlantsTab.tsx MinesTab.tsx CustomersTab.tsx StationsTab.tsx DistancesTab.tsx JadeDistancesTab.tsx DeliveryCostsTab.tsx LaneCostsTab.tsx LegDistancesTab.tsx CostSummaryTab.tsx && cd -
    ```
    For example, `WarehousesTab.tsx:306-309` becomes:
    ```ts
        {
          id: "delete",
          header: "",
          sortable: false,
          kind: "text",
    ```
  - Verify: `git diff --stat` shows exactly 12 files under `src/components/workspace/{tabs,super}` with **+1 line each**, except `CostSummaryTab.tsx` with +2. Also check that `grep -rn -A1 'header: ""' artifacts/studio/src | grep -v __tests__ | grep -c "sortable: false"` gives `13`.

- [ ] **Step 7b: Exempt CostSummary's value columns.** In `src/components/workspace/tabs/CostSummaryTab.tsx`, two places:
  - In the `summaryColumns` `value` column (`id: "value"`, ~`:196`), add the line `sortable: false,` directly after `filter: false,`.
  - In `compareColumns`' `...scenarios.map(...)` column object (`id: \`scenario-${sc.id}\``, ~`:225`), add `sortable: false,` directly after `filter: false,`.

  Add to `src/__tests__/CostSummaryTab.test.tsx`:
  ```tsx
  it("QFX-4: cost-summary metric tables are not sortable (no header sort buttons)", () => {
    const { container } = renderSolvedSingle();   // the file's existing single-scenario render helper; use the same one its first test uses
    // Every sortable column sets aria-sort (even "none" while unsorted), so zero th[aria-sort] means no sortable column.
    // Non-vacuity: remove the two `sortable: false` lines and this fails with length 1 (the value column).
    expect(container.querySelectorAll("th[aria-sort]")).toHaveLength(0);
  });
  ```
  If the file has no `renderSolvedSingle` helper, use the same render call the file's first single-scenario test makes. The assertion line stays as written.

- [ ] **Step 8: Run the task's tests, expect PASS.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/DataTable.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/sortableEmptyHeaders.test.ts
  ```
  Then run every consumer's own suite, since each table's header markup changed:
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/OpenWarehousesTab.test.tsx src/__tests__/WarehousesTab.dataTable.test.tsx src/__tests__/TransportCostsTab.dataTable.test.tsx src/__tests__/FlowsTab.test.tsx src/__tests__/AssignmentsTab.test.tsx src/__tests__/CustomersTab.test.tsx src/__tests__/WarehousesTab.test.tsx
  ```
  Expect all to pass. I grepped for the risky shapes:
  - `getByText(<header>).toHaveClass` exists only at `DataTable.test.tsx:62-65` (updated above).
  - The other `getByText("<header>")` uses are `toBeInTheDocument` only, and a button still contains the text.
  - `getByRole("columnheader", {name})` is unaffected because the `▲` / `▼` span is `aria-hidden`.
  - No test counts `getAllByRole("button")`.

  Then run `typecheck` + `pnpm gate` with 0 concurrent vitest (same check as QFX-10 Step 6).

- [ ] **Step 9: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:
  ```markdown
  ### QFX-4 - sort by clicking a column header

  `ColumnDef` gains `sortable?: boolean` (default true). `DataTable` renders a sortable header as a `<button>` inside the `<th>` cycling ascending → descending → off (▲/▼, `aria-sort` on the `<th>`; `aria-sort` omitted on unsortable columns); one column at a time, component-local state. Pipeline is now effective rows → filter → **sort** → clamp → slice 50. `sortRows` sorts decorated `{ row, originalIndex }` items and never touches the input array, so every `cell()`/`rowKey()` callback — and the super tables' `Item.i` edit/delete identity — still sees the original row. Numbers compare numerically, strings `localeCompare(…, { numeric: true, sensitivity: "base" })`, blank/null last in both directions, ties stable. With `sections`, the section index sorts first (rows sort within their section; section order and base-first paging unchanged). A sort change resets to page 1 (sort appended to `pageResetKey`'s key); a focus jump clears the sort along with the filters (its target page is computed unsorted). Editing the sorted column re-sorts live. All 20 `DataTable` consumers sort; the 13 `header: ""` columns (11 delete/remove ✕ columns + CostSummary's two metric-label columns) set `sortable: false`, enforced by the new tree-walking guard `src/__tests__/sortableEmptyHeaders.test.ts`. Regression in `SuperTableTab.test.tsx`: sort a super table descending, edit a cell, delete a row — both hit the intended underlying row. `DataTable.test.tsx`'s header-class assertions now target the `<th>` by role (the text now sits in a button). No e2e impact (`thead th` innerText is unchanged while unsorted).
  ```

- [ ] **Step 10: Commit.**
  ```bash
  [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
  git add artifacts/studio/src/components/data-table/types.ts artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx artifacts/studio/src/components/workspace/tabs/MinesTab.tsx artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx artifacts/studio/src/components/workspace/tabs/StationsTab.tsx artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/sortableEmptyHeaders.test.ts docs/CHANGELOG-implementation.md
  git commit artifacts/studio/src/components/data-table/types.ts artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx artifacts/studio/src/components/workspace/tabs/MinesTab.tsx artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx artifacts/studio/src/components/workspace/tabs/StationsTab.tsx artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/sortableEmptyHeaders.test.ts docs/CHANGELOG-implementation.md -m "[QFX-4] sort DataTable by clicking a column header

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

**E2E / sibling-spec impact (QFX-4):**
- `thead th` innerText reads at `jade-ch9-workspace-bundle.spec.ts:400, 408, 415, 441, 487` are unchanged. Sort is off by default, so no ▲/▼ glyph is rendered. No replacement needed.
- `getByRole("columnheader", { name: "Distance (mi)" | "Distance (km)" })` at `two-echelon.spec.ts:129, 132, 134` are unchanged: the column header's accessible name is still the header text. No replacement needed.
- `grep -rnE "getByRole\(['\"]button['\"], \{ name: ['\"/]\^?(ID|City|State|Status|Plant|Product|Capacity|Cost|Customer|Demand|From|To|Distance|Flow|Warehouse|Utilization|Leg|Rate|Min|Base|Zip|Latitude|Longitude|Miles)" artifacts/studio/e2e` finds none. No spec selects a button by a name that a header button now also carries, so there is no new strict-mode ambiguity.
- No spec clicks a header, and no spec asserts row order after a click on header text. **No e2e rewrite is needed for QFX-4.**
### Task QFX-7: Remove `name` from plants, warehouses, customers

**Contract notes (read first)**
- All QFX-7 CONTRACT names are kept as specified: `LEGACY_LOCATION_COLUMNS = ["name"] as const` (exported from `lib/superFiles.ts`), `LocationDraft` without `name`, and server `loc` without `name`.
- The table-key union in `lib/superFiles.ts` is called **`TableKey`** (`superFiles.ts:7`). `lib/superNetwork.ts:10` has an identical union called `SuperTable`. QFX-2's `parseSuperTableFile(tableKey: TableKey, …)` should use `TableKey`.
- Two places the spec's file list leaves out, both found by grep and both required:
  1. **`components/workspace/super/SuperInputMap.tsx:71,78`** builds `LocationDraft`s with `name` (`name: ""` on create, `name: String(r.name)` on edit). Once `name` is gone from `LocationDraft`, this file fails typecheck.
  2. **`scripts/build-super-sample.py:12`** generates `public/samples/super-model-sample.json`. Editing only the JSON would be undone the next time someone regenerates it. Verified at plan time: the generator, run unmodified, reproduces today's sample **byte for byte** (`cmp` clean). With line 12 edited, its output equals the current sample with `name` deleted from every location row (deep-equal checked; the 4 product `name`s are kept; 258,604 bytes, still above the 102,400 that `superNetworkImport.test.ts:46` asserts). So the deterministic command for the sample is: edit the generator, then run it.

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/superInputs.ts:8-9` (shared `loc`)
- Modify: `artifacts/studio/src/lib/superFiles.ts:10-19` (LOC, legacy list, table entries), `:53-61` (`readSheet` signature + header loop), `:115` (`sheetsToDocument` call)
- Modify: `artifacts/studio/src/lib/superNetwork.ts:62` (`LocationDraft`), `:74` (`clean`), `:103` (`copyLocation`)
- Modify: `artifacts/studio/src/components/workspace/super/superTables.tsx:20-31` (ENTITY/SPECS), `:68-71` (`blankRow`)
- Modify: `artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx:22-36,44`
- Modify: `artifacts/studio/src/components/workspace/super/SuperInputMap.tsx:71,78`
- Modify: `artifacts/studio/src/pages/Workspace.tsx:703` (`superOutputDataset`'s `pick`)
- Modify: `scripts/build-super-sample.py:12`; regenerate `artifacts/studio/public/samples/super-model-sample.json`
- Modify: `artifacts/studio/public/samples/super-model-template.json:9-11`
- Test (API): `artifacts/api-server/src/__tests__/superNetworkImport.test.ts` (new populated real-shape validator + write-path test; merge test `:62-69` rewritten)
- Test (API fixtures, sweep): `superModelRegistration.test.ts`, `superMaxSize.test.ts`, `superRoad.test.ts`, `superRoadRoute.test.ts`, `superNetworkImport.test.ts` (all in `artifacts/api-server/src/__tests__/`), and `artifacts/api-server/src/solver/tests/test_super.py:71-74`
- Test (studio): `artifacts/studio/src/__tests__/superFiles.test.ts`, `superNetwork.test.ts`, `SuperEntityDialog.test.tsx`, `SuperInputMap.test.tsx`, `SuperTableTab.test.tsx`, `CostSummaryTab.Super.test.tsx`, `SuperNetworkImportDialog.test.tsx`
- Test (e2e): `artifacts/studio/e2e/super-model.spec.ts:11,267-277,303-304,323`

**Interfaces:**
- Consumes: nothing from other QFX tasks. QFX-10 and QFX-4 have landed, but neither touches these lines.
- Produces:
  - `lib/superFiles.ts`:
    - `export const LEGACY_LOCATION_COLUMNS = ["name"] as const;`
    - `SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[]; legacy?: readonly string[] }[]`. Only `plants`/`warehouses`/`customers` set `legacy: LEGACY_LOCATION_COLUMNS`.
    - Internal `readSheet(sh, cols, errors, legacy: readonly string[] = [])`. **QFX-2's `parseSuperTableFile` must call `readSheet(sheet, t.cols, errors, t.legacy)`** so that per-table uploads also accept and discard a legacy `name`.
  - `lib/superNetwork.ts`: `export interface LocationDraft { id: string; city?: string; state?: string; lat: number; lng: number; status?: string }`. QFX-6's Add forms build this shape.
  - `superTables.tsx`: location `SPECS` have no `name` (ID, City, State, Lat, Lng[, Status]). `products` keeps ID, Name. `blankRow` location rows have no `name`.
  - Server: `loc = { id, city?, state?, lat, lng }`. Rows that still carry `name` validate, and `name` is stripped (z.object default strip). Products keep `name: z.string().trim().min(1)`.

---

- [ ] **Step 1: Write the failing tests**

**1a. API: populated real-shape validator and write-path test.** Append to the end of `artifacts/api-server/src/__tests__/superNetworkImport.test.ts`, after the last `describe` (the file's first describe sets `cookie` in its `setup` test, and vitest runs describes in file order). Also change the import on line 9 to:

```ts
import { SUPER_DEFAULT_INPUTS, superInputsSchema } from "../validation/inputs/superInputs.js";
```

Then append:

```ts
// QFX-7 — plants/warehouses/customers have no `name`. A row that still carries one (stored scenarios,
// old JSON files) validates and loses the key on the next write. Populated real-shape fixture: the shipped
// sample's 4 plants / 25 warehouses / 100 customers, every other row given a legacy name.
describe("QFX-7 location rows without name", () => {
  type R = Record<string, unknown>;
  const LOC = ["plants", "warehouses", "customers"] as const;
  const strip = (rows: R[]) => rows.map(({ name: _legacy, ...r }) => r);
  const nameless: R = { ...sample, ...Object.fromEntries(LOC.map(t => [t, strip(sample[t])])) };
  const mixed: R = { ...nameless, ...Object.fromEntries(LOC.map(t => [t, (nameless[t] as R[]).map((r, i) => (i % 2 === 0 ? { ...r, name: `Legacy ${r.id}` } : r))])) };

  it("the fixture is non-vacuous: every location table has rows with AND without name", () => {
    for (const t of LOC) {
      const rows = mixed[t] as R[];
      expect(rows.length, t).toBeGreaterThan(1);
      expect(rows.some(r => "name" in r), t).toBe(true);
      expect(rows.some(r => !("name" in r)), t).toBe(true);
    }
  });
  it("the validator accepts both shapes and strips name from every location row; products keep name", () => {
    const parsed = superInputsSchema.safeParse(mixed);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const t of LOC) {
      expect(parsed.data[t]).toHaveLength((sample[t] as R[]).length);
      expect((parsed.data[t] as R[]).filter(r => "name" in r), t).toEqual([]);
      expect(parsed.data[t], t).toEqual(nameless[t]);
    }
    expect(parsed.data.products).toEqual(sample.products);
    expect(parsed.data.products.every(p => typeof p.name === "string" && p.name.length > 0)).toBe(true);
    expect(superInputsSchema.safeParse({ ...nameless, products: [{ id: "k" }] }).success).toBe(false);   // product name still required
  });
  it("create and network import persist name-less rows; a legacy name is stripped on write", async () => {
    const id = await create("super-model", mixed);
    const stored = (await get(id)).inputs;
    for (const t of LOC) {
      expect(stored[t]).toHaveLength((sample[t] as R[]).length);
      expect((stored[t] as R[]).filter(r => "name" in r), t).toEqual([]);
    }
    expect(stored.products).toEqual(sample.products);
    const first = (nameless.customers as R[])[0];
    const res = await imp(id, "merge", { customers: [{ ...first, name: "Legacy again", city: "Merged" }] }).expect(200);
    expect(res.body.scenario.inputs.customers.find((c: { id: string }) => c.id === first.id)).toEqual({ ...first, city: "Merged" });
  });
});
```

And rewrite the merge test at `:62-69`, which today edits and asserts a customer `name`. Replace:

```ts
    const renamed = { ...sample.customers[0], name: "Renamed" };
    const res = await imp(id, "merge", { customers: [renamed] }).expect(200);
    expect(res.body.scenario.inputs.customers).toHaveLength(100);
    expect(res.body.scenario.inputs.customers.find((c: { id: string }) => c.id === renamed.id).name).toBe("Renamed");
```
with:
```ts
    const renamed = { ...sample.customers[0], city: "Renamed" };
    const res = await imp(id, "merge", { customers: [renamed] }).expect(200);
    expect(res.body.scenario.inputs.customers).toHaveLength(100);
    expect(res.body.scenario.inputs.customers.find((c: { id: string }) => c.id === renamed.id).city).toBe("Renamed");
```

**1b. Studio parser.** `artifacts/studio/src/__tests__/superFiles.test.ts`. Change line 6 to:

```ts
import { describeIssue, LEGACY_LOCATION_COLUMNS, parseCsvFiles, parseJsonText, parseXlsx, SUPER_TABLE_FILES, toCsvFiles, toCsvZip, toXlsx } from "@/lib/superFiles";
```

Rewrite every location fixture that carries a `name` column. Each block below is old → new, and every other line stays as it is.

- `:50-53`
  ```ts
    it("numeric-looking ids stay text; numeric columns parse; empty optional omitted; empty rows skipped", () => {
      const r = ok(csv({ "plants.csv": "id,city,lat,lng\n101,,1.5,-2\n,,,\n102,Town,3,4\n" }));
      expect(r.doc.plants).toEqual([{ id: "101", lat: 1.5, lng: -2 }, { id: "102", city: "Town", lat: 3, lng: 4 }]);
      expect(r.sources.plants).toEqual({ source: "plants.csv", headerRow: 1, rows: [2, 4] });
    });
  ```
- `:55-67` (lat moves from column C to column B)
  ```ts
    it("XLSX: numeric id cell -> text, formula uses cached value; date, error and uncached formula are errors", async () => {
      const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], [101, 1, 2]]);
      ws["B2"] = { t: "n", v: 5, f: "2+3" };
      const good = ok(await parseXlsx(book({ plants: ws })));
      expect(good.doc.plants).toEqual([{ id: "101", lat: 5, lng: 2 }]);
      for (const [cell, why] of [[{ t: "d", v: new Date("2026-01-01") }, "date"], [{ t: "e", v: 7 }, "error"], [{ t: "n", f: "1+1" }, "cached"]] as const) {
        const bad = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["x", 1, 2]]);
        bad["B2"] = cell as XLSX.CellObject;
        const r = await parseXlsx(book({ plants: bad }));
        expect(r.ok).toBe(false);
        expect(msgs(r).join("\n")).toMatch(new RegExp(`^sheet plants row 2 column lat: .*${why}`));
      }
    });
  ```
- `:69`: `const r = csv({ "plants.csv": "id,lat,lng,colour\nA,north,2,red\n,1,2,\n" });` (expected messages unchanged)
- `:78`: `const r = csv({ "plants.csv": "id,lat,lng\nA,north,2\n,1,2\n" });` (expected unchanged)
- `:89`: `expect(msgs(csv({ "plants.csv": "id,lat,lng\nA,1e999,2\n" }))).toEqual(["plants.csv row 2 column lat: is not a finite number"]);`
- `:92-93`
  ```ts
      expect(msgs(csv({ "plants.csv": "id,lat,lng\nA,1,2,stray\n" }))).toEqual(["plants.csv row 2 column position 4: has a value but no column header"]);
      expect(msgs(csv({ "plants.csv": "id,,lat,lng\nA,hidden,1,2\n" }))).toEqual(["plants.csv row 2 column position 2: has a value but no column header"]);
  ```
- `:96-97`
  ```ts
      const a = ok(csv({ "plants.csv": "id,lat,lng\nA,1,2\n" })).doc;
      const b = ok(csv({ "plants.csv": "lng,lat,id\n2,1,A\n" })).doc;
  ```
- `:101`: `expect(msgs(csv({ "plants.csv": "id,lat,lat,lng\nA,1,1,2\n" }))).toEqual(["plants.csv column lat: duplicate column"]);`
- `:106-109`. A blank `name` cell is no longer an error, so the test now uses a blank `id`:
  ```ts
    it("an empty required XLSX cell is an error with sheet, row and column", async () => {
      const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["", 1, 2]]);
      expect(msgs(await parseXlsx(book({ plants: ws })))).toEqual(["sheet plants row 2 column id: is required"]);
    });
  ```
- `:126`: `const { sources } = ok(csv({ "plants.csv": "id,lat,lng\nA,1,2\n,,\nB,3,4\n", "parameters.csv": "key,value\np,0\ntransportCosts.icMinTrans,-1\n" }));`
- `:135-143` (three columns now: B..D, lat in C)
  ```ts
    it("P4: an XLSX table that does not start at A1 reports real sheet rows", async () => {
      const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["A", 1, 2], ["B", "north", 4]], { origin: "B3" });
      ws["!ref"] = "B3:D5";   // SheetJS 0.20.3 reports A1:D5 for an origin write; pin the real B3:D5 dimension
      const bad = await parseXlsx(book({ plants: ws }));
      expect(msgs(bad)).toEqual(["sheet plants row 5 column lat: is not a number"]);
      ws["C5"] = { t: "n", v: 3 };
      const good = ok(await parseXlsx(book({ plants: ws })));
      expect(good.sources.plants).toEqual({ source: "sheet plants", headerRow: 3, rows: [4, 5] });
    });
  ```
- `:148`: `const r = parseCsvFiles([{ name: "Plants.CSV", text: "id,lat,lng\nA,1,2\n" }]);`

Append the new legacy-column block at the end of the file:

```ts
describe("QFX-7: location tables have no name; a legacy name column is accepted and discarded", () => {
  it("LEGACY_LOCATION_COLUMNS is exactly name, set on the three location files only, none of which lists name as a column", () => {
    expect(LEGACY_LOCATION_COLUMNS).toEqual(["name"]);
    expect(SUPER_TABLE_FILES.filter(t => t.legacy).map(t => t.key)).toEqual(["plants", "warehouses", "customers"]);
    for (const t of SUPER_TABLE_FILES.filter(t => t.legacy)) expect(t.cols.map(col => col.field), t.key).not.toContain("name");
  });
  it("CSV: a legacy name column with values imports on every location table and the values are dropped", () => {
    const r = ok(csv({
      "plants.csv": "id,name,lat,lng\nP,Old plant,1,2\n",
      "warehouses.csv": "id,name,lat,lng,status\nW,Old wh,3,4,active\n",
      "customers.csv": "name,id,lat,lng\nOld cust,C,5,6\n",
    }));
    expect(r.doc).toEqual({
      plants: [{ id: "P", lat: 1, lng: 2 }],
      warehouses: [{ id: "W", lat: 3, lng: 4, status: "active" }],
      customers: [{ id: "C", lat: 5, lng: 6 }],
    });
    for (const t of ["plants", "warehouses", "customers"]) expect((r.doc[t] as Record<string, unknown>[])[0], t).not.toHaveProperty("name");
  });
  it("XLSX: a legacy name column is discarded the same way", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["P", "Old", 1, 2]]);
    const r = ok(await parseXlsx(book({ plants: ws })));
    expect(r.doc.plants).toEqual([{ id: "P", lat: 1, lng: 2 }]);
    expect((r.doc.plants as Record<string, unknown>[])[0]).not.toHaveProperty("name");
  });
  it("name is not legacy on products (still required, still kept); any other unknown location column is still an error", () => {
    expect(msgs(csv({ "products.csv": "id\nk\n" }))).toEqual(["products.csv column name: required column is missing"]);
    expect(ok(csv({ "products.csv": "id,name\nk,K\n" })).doc.products).toEqual([{ id: "k", name: "K" }]);
    expect(msgs(csv({ "plants.csv": "id,name,label,lat,lng\nP,a,b,1,2\n" }))).toEqual(["plants.csv column label: unknown column"]);
  });
  it("export writes no name column for locations, even from a draft row that still carries one; products keep it", () => {
    const files = toCsvFiles({ plants: [{ id: "P", name: "Old", lat: 1, lng: 2 }], products: [{ id: "k", name: "K" }] });
    expect(files.find(f => f.name === "plants.csv")!.text.split("\n")[0]).toBe("id,city,state,lat,lng");
    expect(files.find(f => f.name === "plants.csv")!.text).not.toContain("Old");
    expect(files.find(f => f.name === "products.csv")!.text.split("\n")[0]).toBe("id,name");
  });
});
```

**1c. Studio mutators.** `artifacts/studio/src/__tests__/superNetwork.test.ts`. Step 5's fixture sweep removes the location `name`s from `n()` and from the `addLocation`/`editLocation`/`moveLocation`/`copyLocation` literals. The hand edits in this step are on top of that:

- `:42-48` addLocation test. Add, directly after the `expect(a.customers.at(-1)).toEqual(...)` line:
  ```ts
      expect(a.customers.at(-1)).not.toHaveProperty("name");
  ```
- `:57-65`. Replace the copy test's title and add a name-less assertion:
  ```ts
    it("copy: next id, same text fields (no suffix), 0.05° east, copies demand / plantProducts, never overrides", () => {
      const c = copyLocation(n(), "cs", "C-1");
      expect(c.customers.at(-1)).toEqual({ id: "C-2", lat: 5, lng: 6.05, status: "active" });
      expect(c.customers.at(-1)).not.toHaveProperty("name");
  ```
  The rest of the test body is unchanged.
- Append inside `describe("SM2-2 map mutators", …)`, after the copy test:
  ```ts
    it("QFX-7: editing a legacy row that still carries name writes it back without name", () => {
      const legacy = { ...n(), plants: [{ id: "PL-1", name: "Old", city: "Ashland", lat: 1, lng: 2 }] };
      const e = editLocation(legacy, "pl", { id: "PL-1", city: "Ashland", lat: 0, lng: 0 });
      expect(e.plants[0]).toStrictEqual({ id: "PL-1", city: "Ashland", lat: 1, lng: 2 });
    });
  ```

**1d. Studio dialog.** Replace the whole of `artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperEntityDialog } from "@/components/workspace/super/SuperEntityDialog";

const products = [{ id: "K1", name: "Bolts" }, { id: "K2", name: "Nuts" }];
const base = { mode: "create" as const, kind: "cs" as const, initial: { id: "C-2", lat: 1, lng: 2, status: "active" },
  initialDemand: {}, products, takenIds: new Set(["C-1", "WH-1"]), onCancel: vi.fn() };

describe("SuperEntityDialog", () => {
  it("create: pre-filled id, one demand input per product, blank demand omitted", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    expect(screen.getByTestId("super-entity-id")).toHaveValue("C-2");
    fireEvent.change(screen.getByTestId("super-entity-city"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K2"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ id: "C-2", city: "Acme", lat: 1, lng: 2, status: "active" }, { K2: 12 });
  });
  it("QFX-7: has no Name field, and submits with no name", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    expect(screen.queryByTestId("super-entity-name")).not.toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.queryByTestId("super-entity-error")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("name");
  });
  it("rejects a blank id, a taken id and a negative demand", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: " " } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("ID is required");
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("already used");
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "C-5" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K1"), { target: { value: "-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("Bolts");
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("edit: id is read-only; a plant shows no status and no demand", () => {
    render(<SuperEntityDialog {...base} mode="edit" kind="pl" initial={{ id: "PL-1", lat: 1, lng: 2 }} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("super-entity-id")).toHaveAttribute("readonly");
    expect(screen.queryByTestId("super-entity-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("super-entity-demand-K1")).not.toBeInTheDocument();
  });
});
```

**1e. Studio Input Map.** `artifacts/studio/src/__tests__/SuperInputMap.test.tsx`. Step 5's sweep removes the location `name`s in `net()` (`:13-16`), `:57` and `:65`. The hand edits are:

- `:84-91` (Add warehouse). Delete line `:88` (`fireEvent.change(screen.getByTestId("super-entity-name"), …)`) and replace line `:90` with:
  ```ts
      expect(onInputsChange.mock.calls[0][0].warehouses.at(-1)).toMatchObject({ id: "WH-3", status: "active" });
      expect(onInputsChange.mock.calls[0][0].warehouses.at(-1)).not.toHaveProperty("name");
  ```
- `:107` (Copy). Replace with:
  ```ts
      expect(onInputsChange.mock.calls[0][0].plants.at(-1)).toMatchObject({ id: "PL-2", city: "Ashland", state: "KY", lng: -82.55 });
      expect(onInputsChange.mock.calls[0][0].plants.at(-1)).not.toHaveProperty("name");
  ```
- `:136` (R13 add step). Delete the line `fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "N" } });`. Submit no longer needs a name.

**1f. Studio table.** Append inside `describe("SuperTableTab", …)` in `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`, after the last `it`:

```tsx
  it("QFX-7: location tables have no Name column and + Add row appends a name-less row; products keep Name", () => {
    const onChange = vi.fn();
    const { unmount } = render(<SuperTableTab table="plants" rows={[{ id: "PL-1", city: "Ashland", state: "KY", lat: 1, lng: 2 }]} onChange={onChange} readOnly={false} />);
    expect(screen.getByTestId("super-plants-PL-1-city")).toBeInTheDocument();
    expect(screen.queryByTestId("super-plants-PL-1-name")).not.toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("super-plants-add"));
    expect(onChange.mock.calls[0][0][1]).toStrictEqual({ id: "", city: "", state: "", lat: 0, lng: 0 });
    unmount();
    for (const table of ["warehouses", "customers"] as const) {
      const { unmount: u } = render(<SuperTableTab table={table} rows={[{ id: "X-1", lat: 1, lng: 2, status: "active" }]} onChange={vi.fn()} readOnly={false} />);
      expect(screen.queryByTestId(`super-${table}-X-1-name`), table).not.toBeInTheDocument();
      u();
    }
    render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByTestId("super-products-k1-name")).toHaveValue("K");
  });
```

- [ ] **Step 2: Run them, expect FAIL**

Run from the bundle worktree root. 5c/5d (pure fixture edits) may already have been run; either way these fail.

```bash
pnpm --filter studio exec vitest run src/__tests__/superFiles.test.ts src/__tests__/superNetwork.test.ts src/__tests__/SuperEntityDialog.test.tsx src/__tests__/SuperInputMap.test.tsx src/__tests__/SuperTableTab.test.tsx
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/superNetworkImport.test.ts
```

Expected failures (representative):
- superFiles:
  - `SyntaxError`/`undefined` for `LEGACY_LOCATION_COLUMNS`. The test reads `expected undefined to deeply equal [ 'name' ]`.
  - the cell-coercion and XLSX tests fail with `plants.csv column name: required column is missing` / `sheet plants column name: required column is missing`.
  - the legacy CSV test fails `toEqual` because `name: "Old plant"` is still present.
- superNetwork: the copy test, `expected { id: 'C-2', name: 'undefined (copy)', … } to deeply equal { id: 'C-2', lat: 5, … }`. The add test, `expected … not to have property "name"` (`clean` writes `name: undefined`).
- SuperEntityDialog: `expected document not to contain element, found <input data-testid="super-entity-name">`. The no-name submit test, `Name is required`.
- SuperInputMap: `not.toHaveProperty("name")` fails (`name: ""` from `startCreate`, and `"undefined (copy)"`).
- SuperTableTab: `super-plants-PL-1-name` is present, and the `toStrictEqual` fails on `name: ""`.
- superNetworkImport:
  - `QFX-7 … the validator accepts both shapes` fails with `expected false to be true`, because name-less rows are rejected with `plants.0.name Required`.
  - the create test fails with `expected 422 to be 201` (the `.expect(201)` inside `create`).

- [ ] **Step 3: Implement the server change**

`artifacts/api-server/src/validation/inputs/superInputs.ts:8-9`. Replace:
```ts
const loc = { id, name: z.string().trim().min(1), city: z.string().optional(), state: z.string().optional(),
  lat: num.min(-90).max(90), lng: num.min(-180).max(180) };
```
with:
```ts
// QFX-7: locations carry no `name` (the solver labels warehouses city -> id). A stored row or an old JSON file
// that still has one validates: z.object strips unknown keys, so it disappears on that scenario's next write.
const loc = { id, city: z.string().optional(), state: z.string().optional(),
  lat: num.min(-90).max(90), lng: num.min(-180).max(180) };
```
Products (`:21`) are untouched.

- [ ] **Step 4: Implement the studio changes**

**`artifacts/studio/src/lib/superFiles.ts:10-19`.** Replace:
```ts
const LOC = [c("id", "text"), c("name", "text"), c("city", "text", false), c("state", "text", false), c("lat", "number"), c("lng", "number")];
export const SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[] }[] = [
  { key: "products", file: "products", cols: [c("id", "text"), c("name", "text")] },
  { key: "plants", file: "plants", cols: LOC },
  { key: "warehouses", file: "warehouses", cols: [...LOC, c("status", "text", false)] },
  { key: "customers", file: "customers", cols: [...LOC, c("status", "text", false)] },
```
with:
```ts
const LOC = [c("id", "text"), c("city", "text", false), c("state", "text", false), c("lat", "number"), c("lng", "number")];
/** QFX-7: location files written before `name` was removed still carry the column; it is accepted and its values discarded. */
export const LEGACY_LOCATION_COLUMNS = ["name"] as const;
export const SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[]; legacy?: readonly string[] }[] = [
  { key: "products", file: "products", cols: [c("id", "text"), c("name", "text")] },
  { key: "plants", file: "plants", cols: LOC, legacy: LEGACY_LOCATION_COLUMNS },
  { key: "warehouses", file: "warehouses", cols: [...LOC, c("status", "text", false)], legacy: LEGACY_LOCATION_COLUMNS },
  { key: "customers", file: "customers", cols: [...LOC, c("status", "text", false)], legacy: LEGACY_LOCATION_COLUMNS },
```
The pair-table lines (`:16-18`) and the closing `];` are unchanged.

**`superFiles.ts:53-57`.** Replace:
```ts
function readSheet(sh: Sheet, cols: Col[], errors: ParseError[]): { rows: Record<string, unknown>[]; fileRows: number[] } {
  const header = (sh.rows[0] ?? []).map(h => asText(h, false));
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    if (h === null || typeof h === "object") return;
```
with:
```ts
function readSheet(sh: Sheet, cols: Col[], errors: ParseError[], legacy: readonly string[] = []): { rows: Record<string, unknown>[]; fileRows: number[] } {
  const header = (sh.rows[0] ?? []).map(h => asText(h, false));
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    if (h === null || typeof h === "object" || legacy.includes(h)) return;   // a legacy column is known, never read
```
The rest of `readSheet` is unchanged. A legacy header is still a string, so the "value but no column header" check at `:69` does not fire for its cells.

**`superFiles.ts:115`.** Replace:
```ts
    const { rows, fileRows } = readSheet(sh, t.cols, errors);
```
with:
```ts
    const { rows, fileRows } = readSheet(sh, t.cols, errors, t.legacy);
```
`documentToSheets` (`:176-189`) needs no change: it writes `t.cols`, which no longer has `name`, so an exported row that still carries a legacy `name` loses it.

**`artifacts/studio/src/lib/superNetwork.ts:62`.** Replace:
```ts
export interface LocationDraft { id: string; name: string; city?: string; state?: string; lat: number; lng: number; status?: string }
```
with:
```ts
export interface LocationDraft { id: string; city?: string; state?: string; lat: number; lng: number; status?: string }
```

**`superNetwork.ts:74`.** Replace `  const out: Row = { id: row.id, name: row.name };` with `  const out: Row = { id: row.id };`.

**`superNetwork.ts:103`.** Replace:
```ts
  const next = { ...inputs, [t]: [...inputs[t], { ...src, id: newId, name: `${src.name} (copy)`, lng: Math.min(180, Number(src.lng) + 0.05) }] } as SuperInputsLike;
```
with:
```ts
  const next = { ...inputs, [t]: [...inputs[t], { ...src, id: newId, lng: Math.min(180, Number(src.lng) + 0.05) }] } as SuperInputsLike;
```

**`artifacts/studio/src/components/workspace/super/superTables.tsx:20-31`.** Replace:
```ts
const ENTITY = (extra: Spec[]): Spec[] => [
  { key: "id", kind: "text" }, { key: "name", kind: "text" }, ...extra,
];
```
with:
```ts
const ENTITY = (extra: Spec[]): Spec[] => [{ key: "id", kind: "text" }, ...extra];
```
and replace `  products: ENTITY([]),` with `  products: ENTITY([{ key: "name", kind: "text" }]),`. `HEADERS.name` stays, because products use it.

**`superTables.tsx:69-71`** (`blankRow`). Replace:
```ts
    case "plants": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0 };
    case "warehouses": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
    case "customers": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
```
with:
```ts
    case "plants": return { id: "", city: "", state: "", lat: 0, lng: 0 };
    case "warehouses": return { id: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
    case "customers": return { id: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
```

**`artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx:22-36`.** Replace:
```ts
  function submit() {
    const id = row.id.trim(), name = row.name.trim();
    if (!id) return setError("ID is required.");
    if (p.mode === "create" && p.takenIds.has(id)) return setError(`ID "${id}" is already used by a plant, warehouse or customer.`);
    if (!name) return setError("Name is required.");
```
with:
```ts
  function submit() {
    const id = row.id.trim();
    if (!id) return setError("ID is required.");
    if (p.mode === "create" && p.takenIds.has(id)) return setError(`ID "${id}" is already used by a plant, warehouse or customer.`);
```
and replace:
```ts
    p.onSubmit({ ...row, id, name, city: row.city?.trim() || undefined, state: row.state?.trim() || undefined }, out);
```
with:
```ts
    p.onSubmit({ ...row, id, city: row.city?.trim() || undefined, state: row.state?.trim() || undefined }, out);
```
Then delete line `:44` (the `<label>Name<input … data-testid="super-entity-name" …/></label>`).

**`artifacts/studio/src/components/workspace/super/SuperInputMap.tsx:71`.** Replace:
```ts
    setDialog({ mode: "create", kind, demand: {}, initial: { id: nextFreeId(inputs, kind), name: "", lat: addAt.lat, lng: addAt.lng, ...(kind === "pl" ? {} : { status: "active" }) } });
```
with:
```ts
    setDialog({ mode: "create", kind, demand: {}, initial: { id: nextFreeId(inputs, kind), lat: addAt.lat, lng: addAt.lng, ...(kind === "pl" ? {} : { status: "active" }) } });
```

**`SuperInputMap.tsx:78`.** Replace:
```ts
      initial: { id: String(r.id), name: String(r.name), city: r.city as string | undefined, state: r.state as string | undefined, lat: Number(r.lat), lng: Number(r.lng), status: r.status as string | undefined },
```
with:
```ts
      initial: { id: String(r.id), city: r.city as string | undefined, state: r.state as string | undefined, lat: Number(r.lat), lng: Number(r.lng), status: r.status as string | undefined },
```
`:121` (`products={… name: String(p.name) …}`) is product name and stays.

**`artifacts/studio/src/pages/Workspace.tsx:703`.** Replace:
```ts
  const pick = (r: Record<string, any> & { id: string }) => ({ id: r.id, name: r.name, city: r.city, state: r.state, lat: r.lat, lng: r.lng });
```
with:
```ts
  const pick = (r: Record<string, any> & { id: string }) => ({ id: r.id, city: r.city, state: r.state, lat: r.lat, lng: r.lng });
```
`WarehouseCandidate.name` and `Customer.name` are optional in the generated `Dataset` type (`lib/api-client-react/src/generated/api.schemas.ts:166,186`), so no type change is needed.
Verify: `grep -n "name: r.name" artifacts/studio/src/pages/Workspace.tsx` prints nothing.

- [ ] **Step 5: Samples, template, generator, and the fixture sweep (deterministic commands)**

Run from the repo root. Every command was dry-run on copies at plan time, and the resulting diffs are listed under "Repo-wide grep" below.

```bash
# 5a. sample generator, then regenerate (byte-identical to today's file minus location `name`; verified)
perl -pi -e 's/"id": r\["id"\], "name": r\["name"\], /"id": r["id"], /' scripts/build-super-sample.py
python3 scripts/build-super-sample.py      # -> "wrote …/super-model-sample.json: 100 customers, 2600 overrides"
test "$(grep -c '"name"' artifacts/studio/public/samples/super-model-sample.json)" = 4   # the 4 products only

# 5b. hand-written template (3 location rows; product row untouched)
perl -pi -e 's/"name": "(?:Plant|Warehouse|Customer) 1", //' artifacts/studio/public/samples/super-model-template.json
test "$(grep -c '"name"' artifacts/studio/public/samples/super-model-template.json)" = 1

# 5c. TS test fixtures: drop `name: <literal>` from rows that start `{ id…` and continue with city/lat (never products)
perl -pi -e 's/(\{ id\b[^{}]*?), name: (?:"[^"]*"|`[^`]*`|\w+)(?=, (?:city|lat)\b)/$1/g' \
  artifacts/api-server/src/__tests__/superModelRegistration.test.ts \
  artifacts/api-server/src/__tests__/superRoad.test.ts \
  artifacts/api-server/src/__tests__/superRoadRoute.test.ts \
  artifacts/api-server/src/__tests__/superNetworkImport.test.ts \
  artifacts/studio/src/__tests__/superNetwork.test.ts \
  artifacts/studio/src/__tests__/SuperInputMap.test.tsx \
  artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx \
  artifacts/studio/src/__tests__/CostSummaryTab.Super.test.tsx

# 5d. Python solver-test fixture (rows passed straight to solve_super; labels fall back city -> id, and name == id here)
perl -pi -e 's/("id": "[^"]*"), "name": "[^"]*"(?=, "lat")/$1/g' artifacts/api-server/src/solver/tests/test_super.py
```

Run 5c **after** the Step 1 hand edits. It is idempotent, and on `SuperEntityDialog.test.tsx` (rewritten whole in 1d) it is a no-op.

Two fixtures the regex cannot reach. Edit them by hand:
- `artifacts/api-server/src/__tests__/superMaxSize.test.ts:41`. The id template contains `${…}` braces. Replace:
  ```ts
    const loc = (p: string, i: number) => ({ id: `${p}-${i}`.padEnd(20, "x"), name: `${p} ${i} Springfield`, city: "Springfield", state: "MO",
  ```
  with:
  ```ts
    const loc = (p: string, i: number) => ({ id: `${p}-${i}`.padEnd(20, "x"), city: "Springfield", state: "MO",
  ```
  The caps network gets smaller (no `name` strings), so `largest.bytes < SUPER_NETWORK_MAX_BYTES` only gains margin. The D14 measurement (2,538,956 B) in the changelog is historical and stays as it is.
- `artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx`. These are legacy-name CSVs that stay valid, but they are rewritten so that fixtures reflect the current shape:
  - `:54`: `await upload2("Plants.CSV", "id,lat,lng\nA,1,2\n");`
  - `:148`: `await uploadMany([csvFile("plants.csv", "id,lat,lng\nA,north,2\n")]);` (expected message `plants.csv row 2 column lat: is not a number` unchanged)

**Repo-wide grep for super location `name` (studio, api-server, e2e, scripts): every hit and its rewrite**

Grep used: `name` across every file that mentions `super-model`, `superInputs`, `SUPER_DEFAULT_INPUTS`, `LocationDraft` or the super sample, plus the e2e dir. Product `name`, scenario `name` (`send({ name: "sm-…" })`), file `name`s and `getByRole(…, { name })` are excluded as not-location.

| Hit | Rewrite |
|---|---|
| `api-server/src/validation/inputs/superInputs.ts:8` | Step 3 |
| `studio/src/lib/superFiles.ts:10` | Step 4 (LOC + `LEGACY_LOCATION_COLUMNS`) |
| `studio/src/lib/superNetwork.ts:62,74,103` | Step 4 |
| `studio/src/components/workspace/super/superTables.tsx:21,69-71` | Step 4 |
| `studio/src/components/workspace/super/SuperEntityDialog.tsx:23,26,35,44` | Step 4 |
| `studio/src/components/workspace/super/SuperInputMap.tsx:71,78` (**not in spec**) | Step 4 |
| `studio/src/pages/Workspace.tsx:703` | Step 4 |
| `scripts/build-super-sample.py:12` (**not in spec**) | 5a |
| `studio/public/samples/super-model-sample.json`: 129 location rows | 5a (regenerated) |
| `studio/public/samples/super-model-template.json:9-11` | 5b |
| `api-server/src/__tests__/superModelRegistration.test.ts:39,40,59` | 5c |
| `api-server/src/__tests__/superRoad.test.ts:9-11,25,27,38,47,48,60` | 5c |
| `api-server/src/__tests__/superRoadRoute.test.ts:38,39,144` | 5c |
| `api-server/src/__tests__/superNetworkImport.test.ts:125,165,174,191-193` | 5c |
| `api-server/src/__tests__/superNetworkImport.test.ts:65-68` (merge edits name) | Step 1a (edits `city`) |
| `api-server/src/__tests__/superMaxSize.test.ts:41` | hand edit, Step 5 |
| `api-server/src/solver/tests/test_super.py:71-74` | 5d |
| `studio/src/__tests__/superNetwork.test.ts:28-30,43,44,46,50,51,55,59,64` | 5c + Step 1c |
| `studio/src/__tests__/SuperInputMap.test.tsx:13-16,57,65` | 5c |
| `studio/src/__tests__/SuperInputMap.test.tsx:88,90,107,136` | Step 1e |
| `studio/src/__tests__/SuperEntityDialog.test.tsx:6,14,17,19,27,28,35` | Step 1d (file rewritten) |
| `studio/src/__tests__/CostSummaryTab.Super.test.tsx:56` | 5c (`row()` keeps `city`, which the test asserts) |
| `studio/src/__tests__/superFiles.test.ts:51,52,56,59,61,69,78,89,92,93,96,97,101,107,108,126,136,148` | Step 1b |
| `studio/src/__tests__/SuperNetworkImportDialog.test.tsx:54,148` | hand edit, Step 5 |
| `studio/e2e/super-model.spec.ts:11,267,271,277,303,304,323` | see "E2E / sibling-spec impact" |

Grep hits that are verified **not** location-name and are left as they are:
- product rows everywhere: `{ id: "K", name: "K" }`, `superFiles.test.ts:33,40`, `SuperTableTab.test.tsx:45-48`, `SuperReadinessPanel.test.tsx:52`, `SuperNetworkImportDialog.test.tsx:125,135,141,146`, `superMaxSize.test.ts:47`, `superModelRegistration.test.ts:51`, `Workspace.Super.test.tsx:176-205` (`super-products-product-1-name`)
- `SuperInputMap.tsx:121`
- `studio/src/__tests__/fixtures/superResult.json` (0 `"name"`)
- `solve.py:1474` (`city → name → id`, untouched per spec)

- [ ] **Step 6: Run the task's tests, expect PASS**

```bash
pnpm run typecheck
pnpm --filter studio exec vitest run src/__tests__/superFiles.test.ts src/__tests__/superNetwork.test.ts src/__tests__/SuperEntityDialog.test.tsx src/__tests__/SuperInputMap.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/CostSummaryTab.Super.test.tsx src/__tests__/SuperNetworkImportDialog.test.tsx src/__tests__/SuperReadinessPanel.test.tsx src/__tests__/Workspace.Super.test.tsx
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/superNetworkImport.test.ts src/__tests__/superModelRegistration.test.ts src/__tests__/superMaxSize.test.ts src/__tests__/superRoad.test.ts src/__tests__/superRoadRoute.test.ts src/__tests__/superRoadContract.test.ts src/__tests__/precheckSuper.test.ts src/__tests__/superCostSummaryExport.test.ts
(cd artifacts/api-server/src/solver && python3 -m pytest tests/test_super.py -x && python3 tests/e2e_accuracy.py)
grep -n "name: r.name" artifacts/studio/src/pages/Workspace.tsx; test $? -eq 1
```

All pass. `test_sample_network_reproduces_ch9_golden` still gives 254060828.6157 with `{wh-11, wh-14}` open, because `wh_label` uses `city` first and the objective does not depend on labels. `e2e_accuracy.py` stays 99/99. Then run `pnpm gate` with 0 concurrent vitest.

Known one-time effect, recorded rather than "fixed": a stored super scenario whose rows still carry `name` has those keys stripped on its next write. `applyScenarioInputWrite`'s `changed` set (`services/scenarioInputWrite.ts:122-125`) then counts the location tables as changed. That cannot turn a non-geometric write geometric for super, because the only non-geometric case is a `distanceBands`-only change and super has no `distanceBands`. So staleness behaviour is unchanged.

- [ ] **Step 7: E2E sibling spec**

Rewrite `artifacts/studio/e2e/super-model.spec.ts` as listed under "E2E / sibling-spec impact". Then run it locally against the two-server recipe in `artifacts/studio/e2e/CLAUDE.md`:

```bash
E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/super-model.spec.ts
```
Expect 8/8.

- [ ] **Step 8: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-7 - remove `name` from super-model plants, warehouses and customers

One commit, because it crosses the server/studio contract. Server: `loc` in `validation/inputs/superInputs.ts` has no `name`. `z.object` strips unknown keys, so stored rows and old JSON documents that still carry `name` keep validating and lose it on that scenario's next write (create, PATCH and network import all persist the parsed data). Products keep `name`. Studio:
- `superFiles.ts` drops `name` from the location `LOC` columns, so CSV/XLSX export no longer writes it. A new `LEGACY_LOCATION_COLUMNS = ["name"]` is accepted and discarded on location sheets only (`readSheet(…, legacy)`); any other unknown column is still an error.
- `LocationDraft`, `SuperEntityDialog` (field and "Name is required" removed), `SuperInputMap` create/edit drafts, the location table columns, `blankRow` and the `superOutputDataset` projection no longer carry `name`.
- Copy keeps the new-id behaviour and drops the " (copy)" suffix.

Samples: `scripts/build-super-sample.py` no longer emits location `name`, and `super-model-sample.json` was regenerated from it (output otherwise byte-identical to the previous file). `super-model-template.json` was edited by a perl one-liner.

`solve.py` is unchanged (warehouse label `city → name → id`). Stored solved results are unchanged. Manifest `required[]` does not list `name`, so the WF-5 notice is unaffected and no backfill is needed.

- Deviations from the spec's file list:
  - `SuperInputMap.tsx:71,78` (built drafts with `name`).
  - `scripts/build-super-sample.py` (the sample's generator; editing the JSON alone would be undone on regeneration).
- Tests:
  - new API test in `superNetworkImport.test.ts`: a populated real-shape fixture (sample's 129 locations, every other row with a legacy `name`). The validator accepts it and strips `name`; create plus merge import persist name-less rows; product `name` is still required.
  - new studio tests: legacy `name` column (CSV + XLSX, all three location files), export header without `name`, dialog without a Name field, name-less `+ Add row`, legacy-row edit, copy without suffix.
  - repo-wide fixture sweep (deterministic perl one-liners) across the api-server super tests, `test_super.py` and the studio super tests.
  - `e2e/super-model.spec.ts` D and E now edit/assert `city` and a name-less copy.
- Gate: <fill from the run: typecheck / api-server / studio / pytest / e2e_accuracy counts>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/validation/inputs/superInputs.ts \
  artifacts/api-server/src/__tests__/superNetworkImport.test.ts artifacts/api-server/src/__tests__/superModelRegistration.test.ts \
  artifacts/api-server/src/__tests__/superMaxSize.test.ts artifacts/api-server/src/__tests__/superRoad.test.ts \
  artifacts/api-server/src/__tests__/superRoadRoute.test.ts artifacts/api-server/src/solver/tests/test_super.py \
  artifacts/studio/src/lib/superFiles.ts artifacts/studio/src/lib/superNetwork.ts \
  artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx \
  artifacts/studio/src/components/workspace/super/SuperInputMap.tsx artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/public/samples/super-model-sample.json artifacts/studio/public/samples/super-model-template.json \
  scripts/build-super-sample.py \
  artifacts/studio/src/__tests__/superFiles.test.ts artifacts/studio/src/__tests__/superNetwork.test.ts \
  artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx artifacts/studio/src/__tests__/SuperInputMap.test.tsx \
  artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/CostSummaryTab.Super.test.tsx \
  artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx \
  artifacts/studio/e2e/super-model.spec.ts docs/CHANGELOG-implementation.md
git commit artifacts/api-server/src/validation/inputs/superInputs.ts \
  artifacts/api-server/src/__tests__/superNetworkImport.test.ts artifacts/api-server/src/__tests__/superModelRegistration.test.ts \
  artifacts/api-server/src/__tests__/superMaxSize.test.ts artifacts/api-server/src/__tests__/superRoad.test.ts \
  artifacts/api-server/src/__tests__/superRoadRoute.test.ts artifacts/api-server/src/solver/tests/test_super.py \
  artifacts/studio/src/lib/superFiles.ts artifacts/studio/src/lib/superNetwork.ts \
  artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx \
  artifacts/studio/src/components/workspace/super/SuperInputMap.tsx artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/public/samples/super-model-sample.json artifacts/studio/public/samples/super-model-template.json \
  scripts/build-super-sample.py \
  artifacts/studio/src/__tests__/superFiles.test.ts artifacts/studio/src/__tests__/superNetwork.test.ts \
  artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx artifacts/studio/src/__tests__/SuperInputMap.test.tsx \
  artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/CostSummaryTab.Super.test.tsx \
  artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx \
  artifacts/studio/e2e/super-model.spec.ts docs/CHANGELOG-implementation.md \
  -m "[QFX-7] remove name from super-model plants, warehouses and customers

Server loc drops name (z.object strips it from legacy rows on the next write);
products keep name. Studio: no Name column/field/draft/projection; location
CSV/XLSX accept and discard a legacy name column (LEGACY_LOCATION_COLUMNS);
copy drops the ' (copy)' suffix. Sample regenerated from
scripts/build-super-sample.py; template edited.

Deviation from spec file list: SuperInputMap.tsx (built drafts with name) and
scripts/build-super-sample.py (sample generator) also changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact** (`grep -rn "name" artifacts/studio/e2e/*.spec.ts`; only `super-model.spec.ts` touches super location names; no other spec references `super-entity-name` or `super-<loc>-*-name`)

- `super-model.spec.ts:11` (header comment). Replace `"Nassau-Suffolk, NY"; the sample's wh-14 is named New York, its city field is` / `Nassau-Suffolk), NOT optimality.` with `"Nassau-Suffolk, NY", from wh-14's city field), NOT optimality.`. Keep the surrounding lines.
- `:267`: `await page.getByTestId("super-entity-name").fill("Edited on map");` → `await page.getByTestId("super-entity-city").fill("Edited on map");`
- `:271`: `.poll(async () => (await serverInputs(page, id)).plants[plIdx].name, …)` → `.poll(async () => (await serverInputs(page, id)).plants[plIdx].city, { timeout: HEADER_TIMEOUT })`
- `:277`: `` page.getByTestId(`super-plants-${sample.plants[plIdx].id}-name`) `` → `` page.getByTestId(`super-plants-${sample.plants[plIdx].id}-city`) `` (still `.toHaveValue("Edited on map", …)`)
- `:303-304`. Replace:
  ```ts
        const customers = (await serverInputs(page, id)).customers as { id: string; name: string }[];
        expect(customers.map(c => c.name)).toContain(`${sample.customers[csIdx].name} (copy)`);
  ```
  with:
  ```ts
        const customers = (await serverInputs(page, id)).customers as Record<string, unknown>[];
        const copy = customers.find(c => !sample.customers.some((s: { id: string }) => s.id === c.id))!;
        expect(copy).toMatchObject({ city: sample.customers[csIdx].city, state: sample.customers[csIdx].state, status: sample.customers[csIdx].status });
        expect(copy).not.toHaveProperty("name");
  ```
  The following line `expect(new Set(customers.map(c => c.id)).size)…` is unchanged.
- `:323` (Test F): `Buffer.from("id,name,lat,lng\nA,P,north,2\n")` → `Buffer.from("id,lat,lng\nA,north,2\n")`. The asserted message `plants.csv row 2 column lat: is not a number` (`:325`) is unchanged.
- Tests D/E `for (const t of TABLES) expect(saved[t], t).toMatchObject(sample[t])`: no edit needed. They compare against the regenerated name-less sample, and the downloaded CSV/XLSX sample (built in the browser from that JSON) no longer has `name`.
## QFX-2 is split into QFX-2a and QFX-2b

Each half can be tested on its own:
- **QFX-2a** adds XLSX to every chapter per-table menu and to the shared `DownloadFormat` plumbing.
- **QFX-2b** adds the super per-table Upload ▾/Download ▾ menus and the Replace/Merge dialog. It builds on QFX-2a's `DownloadFormat`, `XLSX_MIME` and `readFileAs`.

Both are one commit each (`[QFX-2a]`, `[QFX-2b]`), in the order QFX-2a → QFX-2b → QFX-1. The header's ledger already lists them that way.

**Contract deviations. Read these before QFX-6 and QFX-1.**
1. **`superTableToFile` is async.** Its signature is `superTableToFile(tableKey, rows, format): Promise<{ blob: Blob; filename: string }>`, not a sync return.
   - Why: SheetJS is lazy-loaded on purpose (`lib/superFiles.ts:156,199` use `await import("xlsx")`). The SM2 changelog records it as a separate 161.55 kB-gzip chunk.
   - A sync XLSX writer inside `superFiles.ts` would need a static `import "xlsx"`. That would pull the chunk into the main bundle through `superNetwork.ts` → `Workspace.tsx`.
2. **`csvTextToXlsxBlob` stays sync, as contracted.** Its module `lib/xlsxFile.ts` imports `xlsx` statically. Production code reaches it **only** through `await import("@/lib/xlsxFile")`, so it stays in the lazy chunk. Tests may import it statically.
3. **The table-key type is the existing `TableKey`** in `lib/superFiles.ts:7`. It is the same union as `SuperTable` in `lib/superNetwork.ts:10`.
4. **`superRowKey` moves** from `components/workspace/super/superTables.tsx:58-64` to `lib/superFiles.ts`, so that a lib does not value-import a component module. `superTables.tsx` re-exports it, so `import { superRowKey } from "./superTables"` keeps working everywhere.
5. **Messages beyond the spec's two "exact" ones.** They cover cases the spec does not name:
   - "The file is not a readable .xlsx workbook." (`xlsxFileToCsvText` when SheetJS throws)
   - "Could not read the file." (ImportDialog when reading or loading the chunk fails; same sentence as `SuperNetworkImportDialog.tsx:83`)
   - per-table super: "is not valid JSON", "must be a .csv, .json or .xlsx file", "is not a readable .xlsx file" (same as `superFiles.ts:159`), and "duplicate key (first at row N)"

---

### Task QFX-2a: XLSX in every chapter per-table menu (download built from the server CSV, upload converted to CSV)

**Role:** frontend-engineer

**Files:**
- Modify: `artifacts/studio/src/components/data-table/DownloadMenu.tsx:1-7,14,30-33`
- Modify: `artifacts/studio/src/lib/clientCsv.ts:1-4,30-34`
- Create: `artifacts/studio/src/lib/xlsxFile.ts`
- Modify: `artifacts/studio/src/lib/superFiles.ts` (add `readFileAs`, after `:33`)
- Modify: `artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx:9,12-17,79-81` (use the moved `readFileAs`)
- Modify: `artifacts/studio/src/lib/superNetwork.ts:3,33,37` (use the shared `XLSX_MIME`)
- Modify: `artifacts/studio/src/lib/exportEntity.ts:1-4,48-61`
- Modify: `artifacts/studio/src/contexts/ExportContext.tsx:1-2,73,101`
- Modify: `artifacts/studio/src/components/ImportDialog.tsx:1-17,27-28,84-117,173`
- Modify: `artifacts/studio/src/components/data-table/useEntityFileMenus.tsx:1-10,55-60,73`
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx:218-225,414`
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx:601,862,866-867`
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx:282`, `OpenWarehousesTab.tsx:213`, `FlowsTab.tsx:161`, `ServiceStatsTab.tsx:328`, `AssignmentsTab.tsx:229`
- Test (create): `artifacts/studio/src/__tests__/xlsxFile.test.ts`
- Test (modify):
  - `artifacts/studio/src/__tests__/DownloadMenu.test.tsx`
  - `exportEntity.test.ts`
  - `ExportContext.test.tsx`
  - `entityFileMenus.test.tsx`
  - `ImportDialog.test.tsx`
  - `JadeFlowsTab.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier QFX tasks.
- Produces (used by QFX-2b and QFX-1):
  - `components/data-table/DownloadMenu.tsx`: `export type DownloadFormat = "csv" | "json" | "xlsx"`. `DownloadMenu` renders items CSV, JSON, XLSX in that order, and `itemTestIds: Record<DownloadFormat, string>` now **requires** an `xlsx` id.
  - `lib/xlsxFile.ts`:
    - `export function csvTextToXlsxBlob(csvText: string, sheetName: string): Blob`
    - `export async function xlsxFileToCsvText(file: File): Promise<{ ok: true; csvText: string } | { ok: false; message: string }>`
  - `lib/clientCsv.ts`:
    - `export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`
    - `export async function downloadAs(base: string, format: DownloadFormat, data: string | object): Promise<void>`. The csv/json branch still runs synchronously inside the call. xlsx requires CSV text.
  - `lib/superFiles.ts`: `export const readFileAs = (file: File, how: "text" | "buffer") => Promise<string | ArrayBuffer>`
  - `lib/exportEntity.ts`: `downloadEntityExport(scenarioId, entity, format: DownloadFormat, options?)`
  - `contexts/ExportContext.tsx`: `ExportApi.download(entity, format: DownloadFormat)`
  - `components/ImportDialog.tsx`: `format?: DownloadFormat`
  - New testids:
    - input tables: `button-import-{t}-xlsx`, `button-export-{t}-xlsx`
    - result tables:
      - `button-download-assignments-xlsx`
      - `button-download-jadeassignments-xlsx`
      - `button-download-open-warehouses-xlsx`
      - `button-download-flows-xlsx`
      - `button-download-service-stats-xlsx`
      - `button-download-cost-summary-xlsx`
      - `button-download-jade-flows-{pw|wc}-xlsx`

Design notes (decided, do not re-litigate):
- **Server-built downloads.** XLSX fetches the **CSV** export with the same `unit`/`runId`. `downloadEntityExport` maps `xlsx → "csv"` for the API call. The OpenAPI enum stays `csv | json` (`routes/scenarios.ts:626`).
- **Client-built downloads** (JADE flows, Cost Summary compare) pass the CSV text they already build. The ternaries flip to `format === "json" ? json : csv`, so xlsx gets the CSV text.
- **The CSV formula guard (`'` prefix) is kept verbatim** in XLSX text cells.
  - The server CSV writer adds it (`api-server/src/services/templates.ts:685`), and the server CSV import strips it (`services/import.ts:421`).
  - Keeping it means XLSX → (first sheet → CSV) → server import round-trips exactly as a CSV file does.
- **`sheet_to_csv` must get `rawNumbers: true`.** Measured with the vendored SheetJS 0.20.3: without it, `33.749001234567` comes out as `33.74900123`. `blankrows: false` drops fully empty spreadsheet rows.
- **Zero-sheet workbook test fixture.** SheetJS refuses to write a workbook with no sheets ("Workbook is empty", measured), so the fixture is a hand-zipped minimal OOXML package. `XLSX.read` of it returns `SheetNames: []` (measured).

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/xlsxFile.test.ts`:

```ts
// QFX-2a — XLSX for the chapter per-table menus: CSV text -> one-sheet workbook (download), first sheet -> CSV text (upload).
import { describe, it, expect, vi, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { csvTextToXlsxBlob, xlsxFileToCsvText } from "@/lib/xlsxFile";
import { downloadAs, XLSX_MIME } from "@/lib/clientCsv";
import { readFileAs } from "@/lib/superFiles";

const readBook = async (blob: Blob) =>
  XLSX.read((await readFileAs(new File([blob], "x.xlsx"), "buffer")) as ArrayBuffer, { type: "array" });
const xlsxFile = (sheets: Record<string, (string | number)[][]>, name = "book.xlsx") => {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], name, { type: XLSX_MIME });
};
// SheetJS refuses to WRITE a workbook with no sheets ("Workbook is empty"), so this is a hand-zipped minimal package.
const noSheetFile = () => {
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
  return new File([zip], "empty.xlsx", { type: XLSX_MIME });
};

afterEach(() => vi.restoreAllMocks());

describe("csvTextToXlsxBlob (QFX-2a)", () => {
  it("one sheet named sheetName, same header; only plain decimals become numbers; '=' text is never a formula", async () => {
    const blob = csvTextToXlsxBlob("id,city,lat,note\n007,\"Atlanta, GA\",33.749001234567,'=SUM(A1)\n12,,-84.5,=x\n01.5,1e5,0,x\n", "warehouses");
    expect(blob.type).toBe(XLSX_MIME);
    const wb = await readBook(blob);
    expect(wb.SheetNames).toEqual(["warehouses"]);
    const ws = wb.Sheets.warehouses!;
    const cell = (a: string) => ({ t: ws[a]?.t, v: ws[a]?.v, f: ws[a]?.f });
    expect(["A1", "B1", "C1", "D1"].map(a => ws[a]?.v)).toEqual(["id", "city", "lat", "note"]);
    expect(cell("A2")).toEqual({ t: "s", v: "007", f: undefined });
    expect(cell("B2")).toEqual({ t: "s", v: "Atlanta, GA", f: undefined });
    expect(cell("C2")).toEqual({ t: "n", v: 33.749001234567, f: undefined });
    expect(cell("D2")).toEqual({ t: "s", v: "'=SUM(A1)", f: undefined });   // server CSV guard kept verbatim
    expect(cell("A3")).toEqual({ t: "n", v: 12, f: undefined });
    expect(cell("B3")).toEqual({ t: "s", v: "", f: undefined });            // blank -> text cell
    expect(cell("C3")).toEqual({ t: "n", v: -84.5, f: undefined });
    expect(cell("D3")).toEqual({ t: "s", v: "=x", f: undefined });
    expect(cell("A4")).toEqual({ t: "s", v: "01.5", f: undefined });
    expect(cell("B4")).toEqual({ t: "s", v: "1e5", f: undefined });
    expect(ws["!ref"]).toBe("A1:D4");                                        // the trailing newline adds no row
  });
});

describe("xlsxFileToCsvText (QFX-2a)", () => {
  it("converts the FIRST sheet only (its name and the other sheets are ignored) at full number precision", async () => {
    const r = await xlsxFileToCsvText(xlsxFile({ Anything: [["id", "lat"], ["007", 33.749001234567], ["CHI", 0.30000000000000004]], second: [["junk"], ["x"]] }));
    expect(r).toEqual({ ok: true, csvText: "id,lat\n007,33.749001234567\nCHI,0.30000000000000004" });
  });
  it("a workbook with no sheets", async () => {
    expect(await xlsxFileToCsvText(noSheetFile())).toEqual({ ok: false, message: "The workbook has no sheets." });
  });
  it("a first sheet with no header row (later sheets are not consulted)", async () => {
    expect(await xlsxFileToCsvText(xlsxFile({ blank: [], data: [["id"], ["x"]] }))).toEqual({ ok: false, message: "The first sheet is empty." });
  });
});

describe("downloadAs xlsx (QFX-2a)", () => {
  it("saves <base>.xlsx: a one-sheet workbook named base, built from the CSV text", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await downloadAs("assignments", "xlsx", "a,b\n1,x\n");
    expect(names).toEqual(["assignments.xlsx"]);
    const blob = created.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe(XLSX_MIME);
    const wb = await readBook(blob);
    expect(wb.SheetNames).toEqual(["assignments"]);
    expect(XLSX.utils.sheet_to_csv(wb.Sheets.assignments!)).toBe("a,b\n1,x");
  });
  it("refuses a non-CSV payload", async () => {
    await expect(downloadAs("x", "xlsx", { rows: [] })).rejects.toThrow("XLSX downloads are built from CSV text");
  });
});
```

In `artifacts/studio/src/__tests__/DownloadMenu.test.tsx`, replace line 7 and the first two tests (lines 10-27):

```tsx
const ids = { csv: "button-download-x-csv", json: "button-download-x-json", xlsx: "button-download-x-xlsx" };

describe("DownloadMenu (SCU-2.P3, spec B2.4)", () => {
  it("renders only the trigger until opened; items carry the literal testids (QFX-2a: + XLSX)", () => {
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} />);
    expect(screen.getByTestId("button-download-x")).toHaveTextContent("Download");
    expect(screen.queryByTestId("button-download-x-csv")).toBeNull();
    fireEvent.click(screen.getByTestId("button-download-x"));
    expect(screen.getByTestId("button-download-x-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-download-x-json")).toHaveTextContent("JSON");
    expect(screen.getByTestId("button-download-x-xlsx")).toHaveTextContent("XLSX");
  });

  it("reports the chosen format and closes", () => {
    const onDownload = vi.fn();
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={onDownload} />);
    chooseDownload("button-download-x", "button-download-x-json");
    expect(onDownload).toHaveBeenCalledWith("json");
    expect(screen.queryByTestId("button-download-x-json")).toBeNull();
    chooseDownload("button-download-x", "button-download-x-csv");
    expect(onDownload).toHaveBeenLastCalledWith("csv");
    chooseDownload("button-download-x", "button-download-x-xlsx");
    expect(onDownload).toHaveBeenLastCalledWith("xlsx");
  });
```

In `artifacts/studio/src/__tests__/exportEntity.test.ts`, append at the end of the file (after line 110):

```ts
describe("downloadEntityExport — xlsx (QFX-2a: built in the browser from the CSV export)", () => {
  it("fetches the CSV export with the same unit/runId and saves <entity>.xlsx built from it", async () => {
    vi.unstubAllGlobals();                       // beforeEach replaced URL wholesale; spy on the real one instead
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    mockExportScenario.mockResolvedValue("id,lat\n007,33.75\n");
    await downloadEntityExport(3, "warehouses", "xlsx", { unit: "km", runId: 9 });
    expect(mockExportScenario).toHaveBeenCalledWith(3, { entity: "warehouses", format: "csv", unit: "km", runId: 9 });
    expect(names).toEqual(["warehouses.xlsx"]);
    expect((created.mock.calls[0]![0] as Blob).type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(mockToast).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("the 409 resolve prompt still applies to an xlsx export", async () => {
    mockExportScenario.mockRejectedValue(make409("LEGACY_RESULT_REQUIRES_RESOLVE"));
    await downloadEntityExport(1, "assignments", "xlsx");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Re-solve to export" }));
  });
});
```

In `artifacts/studio/src/__tests__/ExportContext.test.tsx`, insert right after the "forwards runId to the helper when injected" test (ends near line 175):

```tsx
    it("forwards xlsx unchanged with the same unit and runId (QFX-2a; the helper fetches CSV)", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 5, unit: "mi", runId: 12 }),
      });
      await act(async () => {
        await result.current.download("assignments", "xlsx");
      });
      expect(mockedDownload).toHaveBeenCalledWith(5, "assignments", "xlsx", { unit: "mi", runId: 12 });
    });
```

In `artifacts/studio/src/__tests__/entityFileMenus.test.tsx`, insert after the "Upload items open ImportDialog…" test (after line 78):

```tsx
  it("QFX-2a: both menus offer XLSX — Download passes xlsx to the export, Upload opens ImportDialog with format xlsx", () => {
    render(<Harness entity="distances" testIdEntity="distances" scenarioId={7} />, { wrapper: AllProviders });
    fireEvent.click(screen.getByTestId("button-download-distances"));
    expect(screen.getByTestId("button-export-distances-xlsx")).toHaveTextContent("XLSX");
    fireEvent.click(screen.getByTestId("button-export-distances-xlsx"));
    expect(downloadEntityExport).toHaveBeenLastCalledWith(1, "distances", "xlsx", { unit: "mi", runId: undefined });
    fireEvent.click(screen.getByTestId("button-import-distances"));
    fireEvent.click(screen.getByTestId("button-import-distances-xlsx"));
    expect(screen.getByTestId("stub-import-dialog")).toHaveAttribute("data-format", "xlsx");
  });
```

In `artifacts/studio/src/__tests__/ImportDialog.test.tsx`, add `import * as XLSX from "xlsx";` after line 7. Then append at the end of the file:

```tsx
describe("ImportDialog — XLSX (QFX-2a: first sheet -> CSV text, unchanged CSV import path)", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const sentBody = (call = 0) => JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
  const wbFile = (sheets: Record<string, (string | number)[][]>) => {
    const wb = XLSX.utils.book_new();
    for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
    return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "warehouses.xlsx", { type: XLSX_MIME });
  };

  it("accepts .xlsx and sends the FIRST sheet as { entity, csvText } — no format key, sheet name ignored", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog({ format: "xlsx" });
    const input = screen.getByTestId("input-import-file-warehouses");
    expect(input).toHaveAttribute("accept", `.xlsx,${XLSX_MIME}`);
    await userEvent.upload(input, wbFile({ Sheet9: [["id", "line"], ["CHI", 2]], other: [["x"], ["y"]] }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", csvText: "id,line\nCHI,2" });
  });

  it("an empty first sheet is refused before any request", async () => {
    renderDialog({ format: "xlsx" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), wbFile({ s: [] }));
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent("The first sheet is empty.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

In `artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx`:
- Add `waitFor` to the line-2 import: `import { render as rtlRender, screen, within, fireEvent, waitFor } from "@testing-library/react";`.
- Insert directly after the "CSV and JSON downloads are named jade-flows-plant-warehouse.{csv,json}" test (ends line 660):

```tsx
  it("QFX-2a: the XLSX download is jade-flows-plant-warehouse.xlsx", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-xlsx"));
    await waitFor(() => expect(dl.names).toEqual(["jade-flows-plant-warehouse.xlsx"]));
  });
```

- [ ] **Step 2: Run them, expect FAIL**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-2a   # the task worktree
pnpm --filter studio exec vitest run src/__tests__/xlsxFile.test.ts src/__tests__/DownloadMenu.test.tsx src/__tests__/exportEntity.test.ts src/__tests__/ExportContext.test.tsx src/__tests__/entityFileMenus.test.tsx src/__tests__/ImportDialog.test.tsx src/__tests__/JadeFlowsTab.test.tsx
```

Expected failures:
- `xlsxFile.test.ts`: `Failed to resolve import "@/lib/xlsxFile"`
- DownloadMenu: `Unable to find an element by: [data-testid="button-download-x-xlsx"]`
- exportEntity xlsx: `exportScenario` called with `format: "xlsx"`, and the name is `warehouses.xlsx` with a text body (or a JSON-stringify mismatch)
- entityFileMenus: `Unable to find an element by: [data-testid="button-export-distances-xlsx"]`
- ImportDialog: the `accept` mismatch (`.csv,text/csv`)
- JadeFlowsTab: `Unable to find an element by: [data-testid="button-download-jade-flows-pw-xlsx"]`

The ExportContext case passes at runtime and fails only typecheck (`"xlsx"` is not assignable to `"csv" | "json"`). That is expected.

- [ ] **Step 3: Implement `DownloadFormat` + the XLSX item**

`artifacts/studio/src/components/data-table/DownloadMenu.tsx`: replace lines 1-3 of the header comment:

```tsx
// SCU-2.P3 (spec B2.4) — the "Download ▾" control every migrated Workspace
// table puts in its DataTable toolbar (P4 input tables reuse it). One trigger,
// three items: CSV, JSON and XLSX (QFX-2a). Testids are passed literally per table (nothing is
```

Replace line 14:

```tsx
export type DownloadFormat = "csv" | "json" | "xlsx";
```

Replace lines 30-33:

```tsx
const ITEMS: Array<{ format: DownloadFormat; label: string }> = [
  { format: "csv", label: "CSV" },
  { format: "json", label: "JSON" },
  { format: "xlsx", label: "XLSX" },
];
```

- [ ] **Step 4: Implement the shared helpers (`clientCsv`, `readFileAs`, `xlsxFile`)**

`artifacts/studio/src/lib/clientCsv.ts`:
- Below the header comment (after line 4), add:

```ts
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
```

- Replace lines 30-34 (`downloadAs`):

```ts
/** `<base>.<format>` download; objects are pretty-printed JSON, strings pass through.
 *  QFX-2a — xlsx takes CSV text and saves a one-sheet workbook named `base` (SheetJS is loaded on demand). The csv/json
 *  branch still runs synchronously inside the call (before any await), exactly as before. */
export async function downloadAs(base: string, format: DownloadFormat, data: string | object): Promise<void> {
  if (format === "xlsx") {
    if (typeof data !== "string") throw new Error("XLSX downloads are built from CSV text");
    const { csvTextToXlsxBlob } = await import("@/lib/xlsxFile");
    return downloadBlob(`${base}.xlsx`, csvTextToXlsxBlob(data, base), XLSX_MIME);
  }
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  downloadTextFile(`${base}.${format}`, text, format === "csv" ? "text/csv" : "application/json");
}
```

`artifacts/studio/src/lib/superFiles.ts`: after line 33 (`const GUARDED = …`), add:

```ts
/** FileReader, not File.text()/arrayBuffer(): jsdom's File has neither. Shared by every in-browser file parser. */
export const readFileAs = (file: File, how: "text" | "buffer") => new Promise<string | ArrayBuffer>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string | ArrayBuffer);
  r.onerror = () => reject(r.error);
  if (how === "text") r.readAsText(file); else r.readAsArrayBuffer(file);
});
```

`artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx`:
- Line 9 becomes:

```tsx
import { describeIssue, parseCsvFiles, parseJsonText, parseXlsx, readFileAs, type ParseResult, type Sources } from "@/lib/superFiles";
```

- Delete lines 12-17 (the local `readAs`).
- Replace lines 79-81:

```tsx
      if (kind === "json") result = parseJsonText(String(await readFileAs(files[0], "text")));
      else if (kind === "xlsx") result = await parseXlsx((await readFileAs(files[0], "buffer")) as ArrayBuffer);
      else result = parseCsvFiles(await Promise.all(files.map(async f => ({ name: f.name, text: String(await readFileAs(f, "text")) }))));
```

`artifacts/studio/src/lib/superNetwork.ts`:
- Line 3 becomes:

```ts
import { downloadAs, downloadBlob, XLSX_MIME } from "@/lib/clientCsv";
```

- Delete line 33 (`const XLSX_MIME = …`). Line 37 is unchanged; it now uses the imported constant.

Create `artifacts/studio/src/lib/xlsxFile.ts`:

```ts
// QFX-2a — XLSX for the chapter per-table menus, entirely in the browser: the API only speaks CSV/JSON
// (openapi export enum `csv | json`), so a download is the CSV export re-written as one sheet and an upload
// is the first sheet converted to the CSV text the unchanged server CSV import parses.
// Production code reaches this module ONLY via `await import("@/lib/xlsxFile")`, which keeps SheetJS in its
// own lazy chunk (as superFiles.ts does).
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { XLSX_MIME } from "@/lib/clientCsv";
import { readFileAs } from "@/lib/superFiles";

/** A CSV field becomes a number cell only when it is a plain decimal; ids like 007, blanks and 1e5 stay text. */
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** One sheet named `sheetName`, same columns/order/header as the CSV. aoa_to_sheet writes strings as "s" cells, never formulas. */
export function csvTextToXlsxBlob(csvText: string, sheetName: string): Blob {
  const { data } = Papa.parse<string[]>(csvText, { delimiter: ",", skipEmptyLines: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data.map(row => row.map(v => (NUMERIC.test(v) ? Number(v) : v)))), sheetName);
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], { type: XLSX_MIME });
}

/** First sheet -> CSV text; the sheet name and every other sheet are ignored. rawNumbers keeps full precision
 *  (SheetJS's General format would print 33.749001234567 as 33.74900123). */
export async function xlsxFileToCsvText(file: File): Promise<{ ok: true; csvText: string } | { ok: false; message: string }> {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read((await readFileAs(file, "buffer")) as ArrayBuffer, { type: "array" }); }
  catch { return { ok: false, message: "The file is not a readable .xlsx workbook." }; }
  const first = wb.SheetNames[0];
  if (first === undefined) return { ok: false, message: "The workbook has no sheets." };
  const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[first]!, { rawNumbers: true, blankrows: false });
  if ((csvText.split("\n")[0] ?? "").replace(/,/g, "").trim() === "") return { ok: false, message: "The first sheet is empty." };
  return { ok: true, csvText };
}
```

- [ ] **Step 5: Implement the server-built path (`exportEntity`, `ExportContext`)**

`artifacts/studio/src/lib/exportEntity.ts`:
- After line 4, add:

```ts
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
```

- Replace lines 48-61:

```ts
export async function downloadEntityExport(
  scenarioId: number,
  entity: ExportEntity,
  format: DownloadFormat,
  options?: DownloadEntityExportOptions,
): Promise<void> {
  try {
    // QFX-2a — the API exports only csv|json: XLSX is the CSV export (same unit/runId) re-written in the browser.
    const data = await exportScenario(scenarioId, {
      entity,
      format: format === "xlsx" ? "csv" : format,
      unit: options?.unit,
      runId: options?.runId,
    });
    await downloadAs(entity, format, data);
```

The rest of the `try`/`catch` (lines 62-82) is unchanged.

`artifacts/studio/src/contexts/ExportContext.tsx`:
- After line 2, add:

```tsx
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
```

- Line 73 becomes:

```tsx
  download(entity: ExportEntity, format: DownloadFormat): Promise<void>;
```

- Line 101 becomes:

```tsx
    const download = async (entity: ExportEntity, format: DownloadFormat): Promise<void> => {
```

- [ ] **Step 6: Implement the upload path (`ImportDialog`, `useEntityFileMenus`)**

`artifacts/studio/src/components/ImportDialog.tsx`:
- After line 17, add:

```tsx
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
import { XLSX_MIME } from "@/lib/clientCsv";
```

- Replace lines 27-28:

```tsx
  /** SCU-2.P2.2 (B2.6) — which file the user picks. Defaults to csv (every existing caller).
   *  QFX-2a — xlsx: the first sheet is converted to CSV text in the browser and sent exactly like a CSV upload. */
  format?: DownloadFormat;
```

- After `const rowLabel = …` (line 59), add:

```tsx
const ACCEPT: Record<DownloadFormat, string> = { csv: ".csv,text/csv", json: ".json,application/json", xlsx: `.xlsx,${XLSX_MIME}` };
```

- Replace `handleFileChange` (lines 84-117) with these three functions. `previewMutation.mutate(` stays one call site with the same text, so the `mutationErrorSurface.test.ts:42` allow-list entry still matches exactly one site. The xlsx read uses `try/catch`, not `.catch(`: the `.catch(` guard (`mutationErrorSurface.test.ts:150`) does not count `setFileError(` as handling.

```tsx
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    applyMutation.reset();
    previewMutation.reset();
    setRequest(null);
    setFileName(file.name);
    if (format === "xlsx") {
      void submitXlsx(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (format === "json") {
        const document = parseJsonDocument(text);
        if (!document) {
          setFileError("File is not a valid import document (a JSON object with a rows array).");
          return;
        }
        submit({ entity, format: "json", document });
      } else {
        submit({ entity, csvText: text });
      }
    };
    reader.readAsText(file);
  }

  // QFX-2a — no server change: the workbook's first sheet becomes the same csvText a CSV upload sends.
  async function submitXlsx(file: File) {
    try {
      const { xlsxFileToCsvText } = await import("@/lib/xlsxFile");
      const r = await xlsxFileToCsvText(file);
      if (r.ok) submit({ entity, csvText: r.csvText });
      else setFileError(r.message);
    } catch {
      setFileError("Could not read the file.");
    }
  }

  function submit(next: ImportRequest) {
    // SCU-2.P2.2 (B2.6; review #10) — the limit is on the WIRE body, so measure
    // the serialized request (with mode, the larger of preview/apply), never file.size.
    if (new Blob([JSON.stringify({ ...next, mode: "all_or_nothing" })]).size > MAX_IMPORT_BYTES) {
      setFileError(LIMIT_MESSAGE);
      return;
    }
    setFileError(null);
    setRequest(next);
    previewMutation.mutate({ scenarioId, data: next });
  }
```

- Line 173 (`accept=…`) becomes:

```tsx
              accept={ACCEPT[format]}
```

`artifacts/studio/src/components/data-table/useEntityFileMenus.tsx`:
- Replace header lines 7 and 9:

```tsx
//   Upload items    button-import-{t}-csv|json|xlsx  (xlsx: QFX-2a)
//   Download items  button-export-{t}-csv|json|xlsx  (today's two button ids, kept; xlsx: QFX-2a)
```

- Line 55 comment becomes `// DownloadMenu is the shared "one trigger, CSV + JSON + XLSX items" control (P3);`.
- Line 60 becomes:

```tsx
      itemTestIds={{ csv: `button-import-${t}-csv`, json: `button-import-${t}-json`, xlsx: `button-import-${t}-xlsx` }}
```

- Line 73 becomes:

```tsx
      itemTestIds={{ csv: `button-export-${t}-csv`, json: `button-export-${t}-json`, xlsx: `button-export-${t}-xlsx` }}
```

- [ ] **Step 7: Update the result tables and the client-built downloads**

Each `itemTestIds` gains its literal `xlsx` id. `onDownload` already forwards `format` to `useExport().download`.
- `JadeAssignmentsTab.tsx:282`: `itemTestIds={{ csv: "button-download-jadeassignments-csv", json: "button-download-jadeassignments-json", xlsx: "button-download-jadeassignments-xlsx" }}`
- `OpenWarehousesTab.tsx:213`: `itemTestIds={{ csv: "button-download-open-warehouses-csv", json: "button-download-open-warehouses-json", xlsx: "button-download-open-warehouses-xlsx" }}`
- `FlowsTab.tsx:161`: `itemTestIds={{ csv: "button-download-flows-csv", json: "button-download-flows-json", xlsx: "button-download-flows-xlsx" }}`
- `ServiceStatsTab.tsx:328`: `itemTestIds={{ csv: "button-download-service-stats-csv", json: "button-download-service-stats-json", xlsx: "button-download-service-stats-xlsx" }}`
- `AssignmentsTab.tsx:229`: `itemTestIds={{ csv: "button-download-assignments-csv", json: "button-download-assignments-json", xlsx: "button-download-assignments-xlsx" }}`
- `CostSummaryTab.tsx:601` **and** `:862`, the same literal at both: `itemTestIds={{ csv: "button-download-cost-summary-csv", json: "button-download-cost-summary-json", xlsx: "button-download-cost-summary-xlsx" }}`

`CostSummaryTab.tsx:863-869` is the compare download, which is client-built. Replace the `onDownload`:

```tsx
          onDownload={format =>
            void downloadAs(
              "cost-summary-compare",
              format,
              format === "json" ? buildCompareJson(compareRows, compareScenarios, unitLabel) : buildCompareCsv(compareRows, compareScenarios),
            )
          }
```

`JadeFlowsTab.tsx`:
- Add `import type { DownloadFormat } from "@/components/data-table/DownloadMenu";` next to the line-11 import (or merge it: `import { DownloadMenu, type DownloadFormat } from "@/components/data-table/DownloadMenu";`).
- Replace lines 218-225:

```tsx
  const downloadLeg = (leg: JadeFlowLeg, format: DownloadFormat, screenRows: JadeFlowScreenRow[]) => {
      const toDisplay = (d: number) => unit.toDisplay(d, distanceUnit!);
      void downloadAs(
        leg.fileBase,
        format,
        format === "json" ? jadeFlowsJson(leg, screenRows, toDisplay, resolvedUnitLabel!) : jadeFlowsCsv(leg, screenRows, toDisplay, resolvedUnitLabel!),
      );
  };
```

- Line 414 becomes:

```tsx
                itemTestIds={{ csv: `button-download-jade-flows-${short}-csv`, json: `button-download-jade-flows-${short}-json`, xlsx: `button-download-jade-flows-${short}-xlsx` }}
```

Legacy `pages/Studio.tsx` is out of scope (spec §QFX-2). It still compiles: its `"csv" | "json"` arguments are assignable to `DownloadFormat`.

- [ ] **Step 8: Run the task's tests, then typecheck, expect PASS**

```bash
pnpm --filter studio exec vitest run src/__tests__/xlsxFile.test.ts src/__tests__/DownloadMenu.test.tsx src/__tests__/exportEntity.test.ts src/__tests__/ExportContext.test.tsx src/__tests__/entityFileMenus.test.tsx src/__tests__/ImportDialog.test.tsx src/__tests__/JadeFlowsTab.test.tsx src/__tests__/superFiles.test.ts src/__tests__/SuperNetworkImportDialog.test.tsx src/__tests__/mutationErrorSurface.test.ts src/__tests__/rawErrorMessageSurface.test.ts src/__tests__/CostSummaryTab.test.tsx
pnpm run typecheck
```

Then run `pnpm gate` once 0 vitest processes are running (header Global Constraints).

- [ ] **Step 9: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-2a - XLSX in every chapter per-table menu

`DownloadFormat` is now `"csv" | "json" | "xlsx"`, and `DownloadMenu` shows CSV / JSON / XLSX. Every per-table menu carries a literal `-xlsx` testid:
- input tables: `button-import-{t}-xlsx` / `button-export-{t}-xlsx`
- result tables: `button-download-<table>-xlsx`

XLSX never reaches the API, so the OpenAPI export enum stays `csv | json`.
- **Server-built downloads.** `downloadEntityExport` fetches the CSV export with the same `unit`/`runId`.
- **Client-built downloads** (JADE flows, Cost Summary compare) pass the CSV text they already build.
- `downloadAs` writes the workbook with the new `lib/xlsxFile.ts` `csvTextToXlsxBlob`. That module is lazy-loaded only, so SheetJS stays in its own chunk.
- **Cell typing.** Only fields matching `^-?(0|[1-9]\d*)(\.\d+)?$` become number cells.
- **Formula guard.** The server CSV's `'` formula guard is kept verbatim, so XLSX → CSV → server import round-trips like a CSV file.

**Upload.** `ImportDialog` `format="xlsx"` converts the first sheet with `xlsxFileToCsvText` (`sheet_to_csv` with `rawNumbers: true`, which keeps full precision, and `blankrows: false`). It sends the same `{ entity, csvText }` a CSV upload sends.
- New messages: "The workbook has no sheets.", "The first sheet is empty.", "The file is not a readable .xlsx workbook." and "Could not read the file."

**Shared helpers.**
- `readFileAs` moved from `SuperNetworkImportDialog.tsx` to `lib/superFiles.ts`.
- `XLSX_MIME` moved from `lib/superNetwork.ts` to `lib/clientCsv.ts`.

**Out of scope.** Legacy `pages/Studio.tsx` is excluded (spec).

**Tests.** New `xlsxFile.test.ts` (the zero-sheet fixture is hand-zipped, because SheetJS will not write an empty workbook). XLSX cases were added to `DownloadMenu`, `exportEntity`, `ExportContext`, `entityFileMenus`, `ImportDialog` and `JadeFlowsTab`. Rollback point: this commit.
```

- [ ] **Step 10: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/lib/xlsxFile.ts artifacts/studio/src/__tests__/xlsxFile.test.ts
git commit \
  artifacts/studio/src/components/data-table/DownloadMenu.tsx \
  artifacts/studio/src/components/data-table/useEntityFileMenus.tsx \
  artifacts/studio/src/components/ImportDialog.tsx \
  artifacts/studio/src/contexts/ExportContext.tsx \
  artifacts/studio/src/lib/clientCsv.ts \
  artifacts/studio/src/lib/exportEntity.ts \
  artifacts/studio/src/lib/xlsxFile.ts \
  artifacts/studio/src/lib/superFiles.ts \
  artifacts/studio/src/lib/superNetwork.ts \
  artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx \
  artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx \
  artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx \
  artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx \
  artifacts/studio/src/__tests__/xlsxFile.test.ts \
  artifacts/studio/src/__tests__/DownloadMenu.test.tsx \
  artifacts/studio/src/__tests__/exportEntity.test.ts \
  artifacts/studio/src/__tests__/ExportContext.test.tsx \
  artifacts/studio/src/__tests__/entityFileMenus.test.tsx \
  artifacts/studio/src/__tests__/ImportDialog.test.tsx \
  artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx \
  docs/CHANGELOG-implementation.md \
  -m "[QFX-2a] add XLSX download and upload to every chapter per-table menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- None to rewrite. Every existing `-csv`/`-json` testid and the `input-import-file-*` ids are unchanged:
  - `import.spec.ts:97-98`
  - `jade-two-echelon.spec.ts:366-367`
  - `max-coverage.spec.ts:391-392,416-417`
- No spec asserts the item count of a Download ▾ menu (grep `e2e/` for `-json"` and `toHaveCount` near download triggers: no hits).
- The QFX-QA real-browser pass should download one XLSX from a server-built result table and one from JADE flows, then upload one XLSX into an input table.

---

### Task QFX-2b: Super per-table Upload ▾ / Download ▾ (CSV / JSON / XLSX) with the Replace/Merge dialog

**Role:** frontend-engineer

**Files:**
- Modify: `artifacts/studio/src/lib/superFiles.ts`. Changes:
  - add `superRowKey`, `parseSuperTableFile`, `superTableToFile`
  - extract `csvSheet`, `readXlsxSheets`, `readTable`, `tableSheetRows`, `sheetsToXlsx` from the existing code
  - touches `:113-120,130-143,155-204` (line numbers as of post-QFX-7)
- Modify: `artifacts/studio/src/components/workspace/super/superTables.tsx:1-8,58-64` (`superRowKey` moves to the lib and is re-exported)
- Modify: `artifacts/studio/src/components/workspace/super/SuperTableTab.tsx` (imports, upload state, toolbar `upload`/`download` slots, dialog mount)
- Create: `artifacts/studio/src/components/workspace/super/SuperTableUploadDialog.tsx`
- Test (modify): `artifacts/studio/src/__tests__/superFiles.test.ts`, `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`

**Interfaces:**
- Consumes:
  - QFX-2a: `DownloadFormat`, `DownloadMenu` (xlsx item), `XLSX_MIME`, `readFileAs`, `downloadBlob`
  - QFX-7: `SUPER_TABLE_FILES` location `cols` without `name`, plus `LEGACY_LOCATION_COLUMNS` handling inside the per-table read
  - QFX-4: whatever `DataTable`/`superTables.tsx` sort changes landed. This task touches only the SuperTableTab toolbar and the `superRowKey` definition.
- Produces (QFX-6 and later rely on these):
  - `lib/superFiles.ts`:
    - `export function superRowKey(table: TableKey, r: Record<string, unknown>): string` (re-exported unchanged from `superTables.tsx`)
    - `export type TableParseResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; errors: ParseError[] }`
    - `export async function parseSuperTableFile(tableKey: TableKey, file: File): Promise<TableParseResult>`
    - `export async function superTableToFile(tableKey: TableKey, rows: Record<string, unknown>[], format: DownloadFormat): Promise<{ blob: Blob; filename: string }>` (**async**, see the deviation at the top)
  - `components/workspace/super/SuperTableUploadDialog.tsx`:
    - `export function mergeSuperRows(table: TableKey, existing: Row[], incoming: Row[]): Row[]`
    - `export function SuperTableUploadDialog(props: { table: TableKey; format: DownloadFormat; rows: Row[]; onApply(rows: Row[]): void; onClose(): void })`
  - SuperTableTab testids:
    - Upload: `super-{table}-upload`, items `super-{table}-upload-csv|json|xlsx`
    - Download: `super-{table}-download`, items `super-{table}-download-csv|json|xlsx`
  - Dialog testids:
    - `super-upload-dialog`, `super-upload-file-{table}`, `super-upload-errors`
    - `super-upload-replace-count`, `super-upload-merge-count`
    - `super-upload-replace`, `super-upload-merge`, `super-upload-cancel`
  - **For QFX-6:** the existing `toolbar.add` slot (`+ Add row`) is left in place here. QFX-6 replaces it.

Design notes (decided):
- **Format** comes from the file extension (`.csv` / `.json` / `.xlsx`). The menu choice sets the file input's `accept`. The file and sheet **names** never route.
- **Draft-only writes.** Replace and Merge call `SuperTableTab`'s existing `onChange(rows)`. That is `updateInputsField(e, rows)` for the six table tabs (`Workspace.tsx:3838`) and `setLocalInputs` via `SuperDistancesTab` `onChange({ distanceOverrides })` (`SuperDistancesTab.tsx:42-44`, `Workspace.tsx:3853-3855`). Both are draft-only. There is no network-import call and no PATCH until Save.
- **Download** writes the rows currently shown (the draft). It stays enabled while browsing history: the file is exactly the displayed rows, and nothing is written. **Upload** is disabled read-only, with `READ_ONLY_TITLE`.
- **Merge semantics** (spec L1): a file row whose key exists overwrites that row in place; a new key is appended in file order; other existing rows are kept. **Replace**: the table becomes exactly the file's rows. **Counts**: `untouched` = existing rows whose key is not in the file. That one number is both "M removed" (Replace) and "K kept" (Merge).

- [ ] **Step 1: Write the failing tests**

`artifacts/studio/src/__tests__/superFiles.test.ts`:
- Extend the line-6 import:

```ts
import { describeIssue, parseCsvFiles, parseJsonText, parseSuperTableFile, parseXlsx, readFileAs, SUPER_TABLE_FILES, superTableToFile, toCsvFiles, toCsvZip, toXlsx } from "@/lib/superFiles";
import { XLSX_MIME } from "@/lib/clientCsv";
```

- Append at the end of the file:

```ts
describe("per-table files (QFX-2b)", () => {
  it("every table round-trips through its own CSV, JSON and XLSX file (real writer, not a fixture)", async () => {
    for (const { key, file } of SUPER_TABLE_FILES) {
      for (const format of ["csv", "json", "xlsx"] as const) {
        const out = await superTableToFile(key, sample[key], format);
        expect(out.filename).toBe(`${file}.${format}`);
        expect(ok(await parseSuperTableFile(key, new File([out.blob], out.filename))).rows, `${key} ${format}`).toEqual(sample[key]);
      }
    }
  });
  it("XLSX download has one sheet named after the table file; JSON is { <tableKey>: rows }", async () => {
    const x = await superTableToFile("plantProducts", sample.plantProducts, "xlsx");
    expect(x.blob.type).toBe(XLSX_MIME);
    const wb = XLSX.read((await readFileAs(new File([x.blob], "a.xlsx"), "buffer")) as ArrayBuffer, { type: "array" });
    expect(wb.SheetNames).toEqual(["plant_products"]);
    const j = await superTableToFile("demand", sample.demand.slice(0, 2), "json");
    expect(JSON.parse(String(await readFileAs(new File([j.blob], "d.json"), "text")))).toEqual({ demand: sample.demand.slice(0, 2) });
  });
  it("file and sheet names never route; only the first sheet is read", async () => {
    expect(ok(await parseSuperTableFile("products", new File(["id,name\nk1,One\n"], "whatever.csv"))).rows).toEqual([{ id: "k1", name: "One" }]);
    const buf = book({ NotProducts: XLSX.utils.aoa_to_sheet([["id", "name"], ["k1", "One"]]), junk: XLSX.utils.aoa_to_sheet([["x"]]) });
    expect(ok(await parseSuperTableFile("products", new File([buf], "x.xlsx"))).rows).toEqual([{ id: "k1", name: "One" }]);
  });
  it("JSON must hold only the table's key: a bare array, another key and an extra key are rejected", async () => {
    const j = (v: unknown) => new File([JSON.stringify(v)], "p.json");
    for (const v of [[{ id: "k1", name: "One" }], { plants: [] }, { products: [], demand: [] }]) {
      expect(msgs(await parseSuperTableFile("products", j(v)))).toEqual(["p.json: This file must contain only products."]);
    }
  });
  it("duplicate keys inside the file are rejected with the server's key rules (id; pair keys)", async () => {
    expect(msgs(await parseSuperTableFile("plants", new File(["id,lat,lng\nP1,1,2\nP2,1,2\nP1,3,4\n"], "p.csv"))))
      .toEqual(["p.csv row 4: duplicate key (first at row 2)"]);
    expect(msgs(await parseSuperTableFile("demand", new File(["customerId,productId,demand\nc1,k1,1\nc1,k2,1\nc1,k1,5\n"], "d.csv"))))
      .toEqual(["d.csv row 4: duplicate key (first at row 2)"]);
    expect(msgs(await parseSuperTableFile("products", new File([JSON.stringify({ products: [{ id: "k1", name: "A" }, { id: "k1", name: "B" }] })], "p.json"))))
      .toEqual(["p.json row 2: duplicate key (first at row 1)"]);
    // a pair is not a duplicate of its reverse
    const rev = { distanceOverrides: [{ fromId: "a", toId: "b", miles: 1 }, { fromId: "b", toId: "a", miles: 1 }] };
    expect(ok(await parseSuperTableFile("distanceOverrides", new File([JSON.stringify(rev)], "o.json"))).rows).toHaveLength(2);
  });
  it("a per-table location file with the legacy name column imports and drops it (QFX-7 rule)", async () => {
    expect(ok(await parseSuperTableFile("warehouses", new File(["id,name,lat,lng\nw1,Old name,1,2\n"], "w.csv"))).rows)
      .toEqual([{ id: "w1", lat: 1, lng: 2 }]);
  });
  it("an unknown extension is an error", async () => {
    expect(msgs(await parseSuperTableFile("products", new File(["x"], "p.txt")))).toEqual(["p.txt: must be a .csv, .json or .xlsx file"]);
  });
});
```

`artifacts/studio/src/__tests__/SuperTableTab.test.tsx`:
- Replace lines 1-2:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
```

- Append at the end of the file:

```tsx
describe("SuperTableTab per-table Upload ▾ / Download ▾ (QFX-2b)", () => {
  afterEach(() => vi.restoreAllMocks());
  const pp = [
    { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
    { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
  ];
  const upload = async (table: string, format: "csv" | "json" | "xlsx", file: File) => {
    fireEvent.click(screen.getByTestId(`super-${table}-upload`));
    fireEvent.click(screen.getByTestId(`super-${table}-upload-${format}`));
    await userEvent.upload(screen.getByTestId(`super-upload-file-${table}`), file);
  };
  const csv = (text: string) => new File([text], "x.csv", { type: "text/csv" });

  it("Merge on plantProducts: counts, then overwrite in place + append + keep; the dialog closes", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np1,k2,70,3\np2,k1,9,4\n"));
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 2 rows (1 removed)");
    expect(screen.getByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 1 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-merge"));
    expect(onChange).toHaveBeenCalledWith([
      pp[0],
      { plantId: "p1", productId: "k2", capacity: 70, costPerUnit: 3 },
      { plantId: "p2", productId: "k1", capacity: 9, costPerUnit: 4 },
    ]);
    expect(screen.queryByTestId("super-upload-dialog")).toBeNull();
  });

  it("Replace on plantProducts makes the table exactly the file's rows", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np2,k1,9,4\n"));
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 1 rows (2 removed)");
    fireEvent.click(screen.getByTestId("super-upload-replace"));
    expect(onChange).toHaveBeenCalledWith([{ plantId: "p2", productId: "k1", capacity: 9, costPerUnit: 4 }]);
  });

  it("demand merges on (customerId, productId) from a JSON file", async () => {
    const dem = [{ customerId: "c1", productId: "k1", demand: 1 }, { customerId: "c1", productId: "k2", demand: 2 }];
    const onChange = vi.fn();
    render(<SuperTableTab table="demand" rows={dem} onChange={onChange} readOnly={false} options={options} />);
    await upload("demand", "json", new File([JSON.stringify({ demand: [{ customerId: "c1", productId: "k1", demand: 10 }] })], "d.json", { type: "application/json" }));
    expect(await screen.findByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 0 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-merge"));
    expect(onChange).toHaveBeenCalledWith([{ customerId: "c1", productId: "k1", demand: 10 }, dem[1]]);
  });

  it("distanceOverrides replaces on (fromId, toId) from an XLSX file (first sheet, any name)", async () => {
    const ov = [{ fromId: "p1", toId: "w1", miles: 3 }, { fromId: "w1", toId: "c1", miles: 4 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["fromId", "toId", "miles"], ["p1", "w1", 5]]), "Anything");
    const file = new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "o.xlsx");
    const onChange = vi.fn();
    render(<SuperTableTab table="distanceOverrides" rows={ov} onChange={onChange} readOnly={false} options={{ fromIds: ["p1", "w1"], toIds: ["w1", "c1"] }} />);
    await upload("distanceOverrides", "xlsx", file);
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 1 rows (1 removed)");
    expect(screen.getByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 0 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-replace"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "p1", toId: "w1", miles: 5 }]);
  });

  it("Cancel leaves the draft untouched", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np2,k1,9,4\n"));
    await screen.findByTestId("super-upload-replace-count");
    fireEvent.click(screen.getByTestId("super-upload-cancel"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("super-upload-dialog")).toBeNull();
  });

  it("parse errors show in place of the choices", async () => {
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={vi.fn()} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np1,k1,1,1\np1,k1,2,2\n"));
    expect(await screen.findByTestId("super-upload-errors")).toHaveTextContent("x.csv row 3: duplicate key (first at row 2)");
    expect(screen.queryByTestId("super-upload-replace")).toBeNull();
    expect(screen.queryByTestId("super-upload-merge")).toBeNull();
    expect(screen.queryByTestId("super-upload-replace-count")).toBeNull();
  });

  it("read-only disables Upload (READ_ONLY_TITLE) and keeps Download", () => {
    render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly />);
    expect(screen.getByTestId("super-products-upload")).toBeDisabled();
    expect(screen.getByTestId("super-products-upload")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("super-products-download")).toBeEnabled();
  });

  it("Download CSV / JSON / XLSX are named after the table file", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={vi.fn()} readOnly={false} options={options} />);
    for (const f of ["csv", "json", "xlsx"]) {
      fireEvent.click(screen.getByTestId("super-plantProducts-download"));
      fireEvent.click(screen.getByTestId(`super-plantProducts-download-${f}`));
    }
    await waitFor(() => expect([...names].sort()).toEqual(["plant_products.csv", "plant_products.json", "plant_products.xlsx"]));
  });
});
```

`artifacts/studio/src/__tests__/Workspace.Super.test.tsx`: append at the end of the file:

```tsx
describe("Workspace — super per-table upload writes only the draft (QFX-2b, L1)", () => {
  it("Merge adds the row to the draft: no PATCH and no network import until Save; Save sends it", async () => {
    const { useImportScenarioNetwork } = await import("@workspace/api-client-react");
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.click(screen.getByTestId("super-products-upload"));
    fireEvent.click(screen.getByTestId("super-products-upload-csv"));
    fireEvent.change(screen.getByTestId("super-upload-file-products"), { target: { files: [new File(["id,name\nproduct-9,Nine\n"], "p.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByTestId("super-upload-merge"));
    expect(screen.getByTestId("super-row-products-product-9")).toBeInTheDocument();
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    for (const r of vi.mocked(useImportScenarioNetwork).mock.results) expect((r.value as { mutate: ReturnType<typeof vi.fn> }).mutate).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId("button-save")); });
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.data.inputs.products.map((p: { id: string }) => p.id)).toEqual([...sample.products.map((p: { id: string }) => p.id), "product-9"]);
  });
});
```

- [ ] **Step 2: Run them, expect FAIL**

```bash
pnpm --filter studio exec vitest run src/__tests__/superFiles.test.ts src/__tests__/SuperTableTab.test.tsx src/__tests__/Workspace.Super.test.tsx
```

Expected failures:
- superFiles: `parseSuperTableFile is not a function` / `superTableToFile is not a function`
- SuperTableTab: `Unable to find an element by: [data-testid="super-plantProducts-upload"]` (and `super-products-upload`, `super-plantProducts-download`)
- Workspace.Super: `Unable to find an element by: [data-testid="super-products-upload"]`

- [ ] **Step 3: Implement the lib (`superFiles.ts`)**

All edits are in `artifacts/studio/src/lib/superFiles.ts` (post-QFX-7 state).

(a) Add `XLSX_MIME` to the existing `clientCsv` import, and add the `DownloadFormat` type import:

```ts
import { csvText, XLSX_MIME } from "@/lib/clientCsv";
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
```

(b) After `SUPER_TABLE_FILES` (`:11-19`), add:

```ts
type TableFile = (typeof SUPER_TABLE_FILES)[number];
const tableFile = (key: TableKey): TableFile => SUPER_TABLE_FILES.find(t => t.key === key)!;

/** Collision-free composite key (matches the server's KEY / pairKey JSON.stringify keys, services/superNetwork.ts, SM2-3). */
export function superRowKey(table: TableKey, r: Record<string, unknown>): string {
  if (table === "plantProducts") return JSON.stringify([r.plantId, r.productId]);
  if (table === "demand") return JSON.stringify([r.customerId, r.productId]);
  if (table === "distanceOverrides") return JSON.stringify([r.fromId, r.toId]);
  return String(r.id ?? "");
}
```

(c) Directly after `readSheet` (`:85` pre-QFX-7), add `readTable`. If QFX-7 made `sheetsToDocument`'s per-table call pass extra arguments (e.g. the location `LEGACY_LOCATION_COLUMNS`), move **that exact call** into `readTable` unchanged. The legacy-`name` test above enforces this.

```ts
/** One table's sheet -> rows. sheetsToDocument and parseSuperTableFile share it, so a per-table file obeys exactly the
 *  whole-network column rules (incl. QFX-7's accepted-and-discarded legacy `name` on location tables). */
function readTable(sh: Sheet, t: TableFile, errors: ParseError[]) {
  return readSheet(sh, t.cols, errors);
}
```

In `sheetsToDocument`, replace the per-table `readSheet(…)` call (`:115` pre-QFX-7) with:

```ts
    const { rows, fileRows } = readTable(sh, t, errors);
```

(d) Replace the inline CSV-sheet build in `parseCsvFiles` (`:136-139`) with a shared `csvSheet`. Insert it above `parseCsvFiles`:

```ts
function csvSheet(name: string, source: string, text: string, errors: ParseError[]): Sheet {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: "," });
  for (const e of parsed.errors) errors.push({ where: `${source} row ${(e.row ?? 0) + 1}`, message: e.message });
  return { name, source, csv: true, firstRow: 1, rows: parsed.data.map(r => r.map((v): Cell => (v === "" ? EMPTY : { kind: "text", v }))) };
}
```

The `parseCsvFiles` loop body after the `stem` check becomes:

```ts
    sheets.push(csvSheet(stem, f.name, f.text, errors));
```

(e) Replace `parseXlsx` (`:155-173`) with a sheet reader plus a thin `parseXlsx`:

```ts
/** null = SheetJS could not read the bytes. */
async function readXlsxSheets(data: ArrayBuffer): Promise<Sheet[] | null> {
  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try { wb = XLSX.read(data, { type: "array", cellDates: true }); }
  catch { return null; }
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name], ref = ws["!ref"];
    const sheet: Sheet = { name, source: `sheet ${name}`, csv: false, firstRow: 1, rows: [] };
    if (!ref) return sheet;
    const r = XLSX.utils.decode_range(ref);
    sheet.firstRow = r.s.r + 1;
    for (let y = r.s.r; y <= r.e.r; y++) {
      const row: Cell[] = [];
      for (let x = r.s.c; x <= r.e.c; x++) row.push(xlsxCell(ws[XLSX.utils.encode_cell({ r: y, c: x })] as CellObject | undefined));
      sheet.rows.push(row);
    }
    return sheet;
  });
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParseResult> {
  const sheets = await readXlsxSheets(data);
  return sheets ? sheetsToDocument(sheets) : { ok: false, errors: [{ where: "workbook", message: "is not a readable .xlsx file" }] };
}
```

(f) Replace `documentToSheets`' per-table mapping (`:177-181`) with the shared row builder. Replace `toXlsx` (`:198-204`) with the shared writer.

```ts
const tableSheetRows = (t: TableFile, rows: Record<string, unknown>[]): (string | number)[][] =>
  [t.cols.map(col => col.field), ...rows.map(r => t.cols.map(col => (r[col.field] ?? "") as string | number))];
```

The first statement of `documentToSheets` becomes:

```ts
  const out = SUPER_TABLE_FILES.map(t => ({ name: t.file, rows: tableSheetRows(t, (doc[t.key] as Record<string, unknown>[] | undefined) ?? []) }));
```

```ts
async function sheetsToXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  // aoa_to_sheet writes strings as "s" cells and numbers as "n" cells, never formulas (spec §7.2).
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
export function toXlsx(doc: Record<string, unknown>): Promise<ArrayBuffer> {
  return sheetsToXlsx(documentToSheets(doc));
}
```

(g) Append the two per-table entry points at the end of the file, after `describeIssue`:

```ts
export type TableParseResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; errors: ParseError[] };

/** QFX-2b — one super table from a per-table file. The format comes from the extension; the file and sheet NAMES never
 *  route (XLSX: first sheet only). Duplicate keys inside the file are rejected here, with the server's key rules
 *  (services/superNetwork.ts docDuplicateIssues; one table per file), before any Replace/Merge choice is offered. */
export async function parseSuperTableFile(tableKey: TableKey, file: File): Promise<TableParseResult> {
  const t = tableFile(tableKey), source = file.name, errors: ParseError[] = [];
  const fail = (message: string): TableParseResult => ({ ok: false, errors: [{ where: source, message }] });
  const ext = file.name.toLowerCase().split(".").pop();
  let rows: Record<string, unknown>[] = [], rowNos: number[] = [];
  try {
    if (ext === "json") {
      let v: unknown;
      try { v = JSON.parse(String(await readFileAs(file, "text"))); } catch { return fail("is not valid JSON"); }
      const list = v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 ? (v as Record<string, unknown>)[tableKey] : undefined;
      if (!Array.isArray(list) || !list.every(r => r !== null && typeof r === "object" && !Array.isArray(r))) return fail(`This file must contain only ${tableKey}.`);
      rows = list as Record<string, unknown>[];
      rowNos = rows.map((_, i) => i + 1);
    } else if (ext === "csv" || ext === "xlsx") {
      let sh: Sheet;
      if (ext === "csv") sh = csvSheet(t.file, source, String(await readFileAs(file, "text")), errors);
      else {
        const sheets = await readXlsxSheets((await readFileAs(file, "buffer")) as ArrayBuffer);
        if (!sheets) return fail("is not a readable .xlsx file");
        if (sheets.length === 0) return fail("The workbook has no sheets.");
        sh = { ...sheets[0]!, source };
      }
      ({ rows, fileRows: rowNos } = readTable(sh, t, errors));
    } else return fail("must be a .csv, .json or .xlsx file");
  } catch {
    return fail("could not be read");
  }
  const firstAt = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = superRowKey(tableKey, r), at = firstAt.get(k);
    if (at === undefined) firstAt.set(k, rowNos[i]!);
    else errors.push({ where: `${source} row ${rowNos[i]}`, message: `duplicate key (first at row ${at})` });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

/** QFX-2b — the per-table download: exactly the table's SUPER_TABLE_FILES columns, so the file is also a valid part of a
 *  whole-network import. Async because SheetJS is lazy-loaded (see sheetsToXlsx). */
export async function superTableToFile(tableKey: TableKey, rows: Record<string, unknown>[], format: DownloadFormat): Promise<{ blob: Blob; filename: string }> {
  const t = tableFile(tableKey);
  if (format === "json") return { blob: new Blob([JSON.stringify({ [tableKey]: rows }, null, 2)], { type: "application/json" }), filename: `${t.file}.json` };
  const sheet = tableSheetRows(t, rows);
  if (format === "csv") return { blob: new Blob([`${csvText(sheet)}\n`], { type: "text/csv" }), filename: `${t.file}.csv` };
  return { blob: new Blob([await sheetsToXlsx([{ name: t.file, rows: sheet }])], { type: XLSX_MIME }), filename: `${t.file}.xlsx` };
}
```

`artifacts/studio/src/components/workspace/super/superTables.tsx`:
- After line 4, add:

```tsx
import { superRowKey } from "@/lib/superFiles";
export { superRowKey };
```

- Delete lines 58-64 (the old `superRowKey` definition and its comment). Its callers (`:92`, `SuperTableTab.tsx:6,31`) are unchanged.

- [ ] **Step 4: Implement the dialog**

Create `artifacts/studio/src/components/workspace/super/SuperTableUploadDialog.tsx`:

```tsx
// QFX-2b (spec decision L1) — apply one parsed per-table file to the DRAFT only: Replace the table or Merge (upsert by
// the server's key). Nothing is persisted here; the toolbar Save writes it through the normal whole-input PATCH.
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
import { XLSX_MIME } from "@/lib/clientCsv";
import { parseSuperTableFile, SUPER_TABLE_FILES, superRowKey, type TableKey, type TableParseResult } from "@/lib/superFiles";
import type { Row } from "./superTables";

const ACCEPT: Record<DownloadFormat, string> = { csv: ".csv,text/csv", json: ".json,application/json", xlsx: `.xlsx,${XLSX_MIME}` };

/** A file row whose key exists overwrites that row in place; a new key is appended (file order); other rows are kept. */
export function mergeSuperRows(table: TableKey, existing: Row[], incoming: Row[]): Row[] {
  const byKey = new Map(incoming.map(r => [superRowKey(table, r), r]));
  const have = new Set(existing.map(r => superRowKey(table, r)));
  return [...existing.map(r => byKey.get(superRowKey(table, r)) ?? r), ...incoming.filter(r => !have.has(superRowKey(table, r)))];
}

export interface SuperTableUploadDialogProps {
  table: TableKey;
  format: DownloadFormat;
  /** The table's current draft rows. */
  rows: Row[];
  onApply(rows: Row[]): void;
  onClose(): void;
}

export function SuperTableUploadDialog({ table, format, rows, onApply, onClose }: SuperTableUploadDialogProps) {
  const [result, setResult] = useState<TableParseResult | null>(null);
  const selection = useRef(0); // a slower read from an older selection must not overwrite a newer one
  const file = SUPER_TABLE_FILES.find(t => t.key === table)!.file;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const mine = ++selection.current;
    setResult(null);
    const r = await parseSuperTableFile(table, f);
    if (mine === selection.current) setResult(r);
  }

  const parsed = result?.ok ? result.rows : null;
  const fileKeys = new Set((parsed ?? []).map(r => superRowKey(table, r)));
  const have = new Set(rows.map(r => superRowKey(table, r)));
  const updated = (parsed ?? []).filter(r => have.has(superRowKey(table, r))).length;
  const untouched = rows.filter(r => !fileKeys.has(superRowKey(table, r))).length;   // Replace removes them; Merge keeps them
  const apply = (next: Row[]) => { onApply(next); onClose(); };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="super-upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload {file} ({format.toUpperCase()})</DialogTitle>
          <DialogDescription>Changes apply to the unsaved draft. Press Save to keep them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <input type="file" accept={ACCEPT[format]} aria-label={`${file} file`} data-testid={`super-upload-file-${table}`}
            className="text-xs" onChange={e => void handleFile(e)} />
          {result && !result.ok && (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-upload-errors">
              {result.errors.map((x, i) => <li key={i}>{x.where}: {x.message}</li>)}
            </ul>
          )}
          {parsed && (
            <ul className="text-xs space-y-1">
              <li data-testid="super-upload-replace-count">Replace: {parsed.length} rows ({untouched} removed)</li>
              <li data-testid="super-upload-merge-count">Merge: {parsed.length - updated} added, {updated} updated, {untouched} kept</li>
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="super-upload-cancel">Cancel</Button>
          {parsed && (
            <>
              <Button variant="outline" onClick={() => apply(mergeSuperRows(table, rows, parsed))} data-testid="super-upload-merge">Merge</Button>
              <Button onClick={() => apply(parsed)} data-testid="super-upload-replace">Replace</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the menus into `SuperTableTab`**

`artifacts/studio/src/components/workspace/super/SuperTableTab.tsx`:
- Line 1 becomes `import { useMemo, useState } from "react";`.
- After the existing imports (line 6), add:

```tsx
import { DownloadMenu, type DownloadFormat } from "@/components/data-table/DownloadMenu";
import { toast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/clientCsv";
import { describeWriteError } from "@/lib/describeWriteError";
import { superTableToFile } from "@/lib/superFiles";
import { SuperTableUploadDialog } from "./SuperTableUploadDialog";

const menuIds = (table: SuperTable, verb: "upload" | "download"): Record<DownloadFormat, string> =>
  ({ csv: `super-${table}-${verb}-csv`, json: `super-${table}-${verb}-json`, xlsx: `super-${table}-${verb}-xlsx` });
```

- Inside `SuperTableTab`, after the `columns` declaration, add:

```tsx
  // QFX-2b — per-table files. Upload writes only the draft (via onChange), through the Replace/Merge dialog.
  const [uploadFormat, setUploadFormat] = useState<DownloadFormat | null>(null);
  async function handleDownload(format: DownloadFormat) {
    try {
      const { blob, filename } = await superTableToFile(table, rows, format);
      downloadBlob(filename, blob, blob.type);
    } catch (err) {
      toast({ title: "Export failed", description: describeWriteError(err, "Could not export the table."), variant: "destructive" });
    }
  }
```

- In the `toolbar={{ … }}` object, add `upload` and `download` before the existing `add` (keep `add` exactly as it is; QFX-6 owns it):

```tsx
          upload: (
            <DownloadMenu label="Upload" testId={`super-${table}-upload`} itemTestIds={menuIds(table, "upload")}
              onDownload={setUploadFormat} disabledReason={readOnly ? READ_ONLY_TITLE : undefined} />
          ),
          download: (
            <DownloadMenu testId={`super-${table}-download`} itemTestIds={menuIds(table, "download")}
              onDownload={format => void handleDownload(format)} />
          ),
```

- Directly after the closing `/>` of `<DataTable … />` (inside the wrapper `div`), add:

```tsx
      {uploadFormat && (
        <SuperTableUploadDialog table={table} format={uploadFormat} rows={rows} onApply={onChange} onClose={() => setUploadFormat(null)} />
      )}
```

- [ ] **Step 6: Run the task's tests, then typecheck, expect PASS**

```bash
pnpm --filter studio exec vitest run src/__tests__/superFiles.test.ts src/__tests__/SuperTableTab.test.tsx src/__tests__/Workspace.Super.test.tsx src/__tests__/SuperNetworkImportDialog.test.tsx src/__tests__/mutationErrorSurface.test.ts src/__tests__/rawErrorMessageSurface.test.ts
pnpm run typecheck
```

Then run `pnpm gate` with 0 concurrent vitest processes.

- [ ] **Step 7: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-2b - super per-table Upload ▾ / Download ▾ with Replace/Merge

**Menus.** Every super table (`SuperTableTab`, including the distance overrides inside `SuperDistancesTab`) now has Upload ▾ and Download ▾ (CSV / JSON / XLSX).
- testids: `super-{table}-upload|download[-csv|-json|-xlsx]`
- **File shape.** A per-table file has exactly that table's `SUPER_TABLE_FILES` columns, so it is also a valid part of a whole-network import.
  - CSV: `<file>.csv`
  - XLSX: one sheet named `<file>`
  - JSON: `{ "<tableKey>": [rows] }`. Any other key or a bare array → "This file must contain only <tableKey>."

**Parsing.** `lib/superFiles.ts` `parseSuperTableFile(tableKey, file)` reuses `readSheet`. The new `readTable` is shared with `sheetsToDocument`, so per-table files keep QFX-7's legacy-`name` acceptance.
- The format comes from the extension. File and sheet names never route; XLSX reads the first sheet only.
- Duplicate keys inside the file are rejected with the server's KEY rules before any choice is offered.
- `superRowKey` moved to the lib and is re-exported from `superTables.tsx`.

**Download.** `superTableToFile` is **async**, because SheetJS stays lazy-loaded. This is a deviation from the plan contract's sync signature. Download writes the displayed draft rows and stays enabled while browsing history; Upload is disabled read-only.

**Apply (L1).** `SuperTableUploadDialog` shows "Replace: N rows (M removed)" and "Merge: A added, U updated, K kept", with Replace / Merge / Cancel. Both choices call the tab's `onChange`, so they write only the draft:
- `updateInputsField` for the table tabs
- `setLocalInputs` via `SuperDistancesTab` for distance overrides

They never call `POST …/network/import`. Save persists through the normal whole-input PATCH; cross-table errors surface there via `describeWriteError`.

**Tests.** Round-trip of every table × CSV/JSON/XLSX through the real writer (sample fixture); key-mismatch/duplicate/legacy-name/extension cases; dialog counts and results for plantProducts, demand and distanceOverrides, plus Cancel and the error path; and a Workspace test that the upload changes only the draft until Save. Rollback point: this commit.
```

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/super/SuperTableUploadDialog.tsx
git commit \
  artifacts/studio/src/lib/superFiles.ts \
  artifacts/studio/src/components/workspace/super/superTables.tsx \
  artifacts/studio/src/components/workspace/super/SuperTableTab.tsx \
  artifacts/studio/src/components/workspace/super/SuperTableUploadDialog.tsx \
  artifacts/studio/src/__tests__/superFiles.test.ts \
  artifacts/studio/src/__tests__/SuperTableTab.test.tsx \
  artifacts/studio/src/__tests__/Workspace.Super.test.tsx \
  docs/CHANGELOG-implementation.md \
  -m "[QFX-2b] add per-table upload and download with replace/merge to super tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- No existing spec asserts super table toolbars beyond `super-tab-*` / `super-row-*` (grep `e2e/super-model.spec.ts`; the testids are all new). Nothing to rewrite.
- `+ Add row` (`super-*-add`) is untouched here; QFX-6 owns its e2e impact.
- The QFX-QA real-browser pass should, on the super model:
  1. download Products as XLSX
  2. upload it back with Merge, and check "Merge: 0 added, 4 updated, 0 kept"
  3. upload a one-row CSV into Demand with Replace, and see the Unsaved changes badge
  4. press Save; the PATCH should succeed, or show `describeWriteError` for orphaned references

---

### Task QFX-1: Super model — Import network + Export ▾ beside Save

**Role:** frontend-engineer

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx`. Changes:
  - the import block (`:32` area)
  - remove the header block `:4522-4531`
  - add to the toolbar Save row `:4588-4602`
- Test: `artifacts/studio/src/__tests__/Workspace.Super.test.tsx:260-268,310,343` (rewrite and repoint), plus two new tests
- E2E: `artifacts/studio/e2e/super-model.spec.ts:150-151`

**Interfaces:**
- Consumes: QFX-2a's `DownloadMenu` / `DownloadFormat` (`"csv" | "json" | "xlsx"`, structurally the same union as `SuperFileFormat`, `lib/superNetwork.ts:32`). The unchanged `handleSuperExport(format: SuperFileFormat)` (`Workspace.tsx:2782-2789`) and `setSuperImportOpen` (`:2775`).
- Produces: testids `super-toolbar-import`, `super-toolbar-export`, and items `super-toolbar-export-csv|json|xlsx`. The `super-header-import` / `super-header-export` / `super-header-export-csv` / `super-header-export-xlsx` testids no longer exist.

Notes:
- **Where the trio renders.** `showToolbarSave` (`:2435`) is true on all ten super input tabs, because `SUPER_INPUT_TABS` (`:1269`) is in `isEditableInputTab` (`:2304`) and no `saveInLayersRow*` gate names super. It does not depend on history, so the trio renders inside that row.
- **Menu order** is DownloadMenu's fixed CSV / JSON / XLSX. The spec lists "JSON / CSV / XLSX" as the item set; adding an order prop for this one menu is not worth it.
- **CSV still downloads a `.zip`** of per-table CSVs, unchanged (`superNetwork.ts:36`).

- [ ] **Step 1: Write the failing tests**

In `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`:
- Replace the test "SM-9: header has import/export; Optimization Parameters shows the readiness panel" (lines 260-268):

```tsx
  it("QFX-1: Import network + Export ▾ sit right of Save on every super input tab, never in the header", () => {
    renderWorkspace();
    for (const id of ["super-header-import", "super-header-export", "super-header-export-csv", "super-header-export-xlsx"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    for (const tab of ["input-map", "products", "plants", "warehouses", "customers", "plantProducts", "demand", "distances", "transportCosts", "optimization-parameters"]) {
      fireEvent.click(screen.getByTestId(`sidebar-input-${tab}`));
      const row = screen.getByTestId("workspace-toolbar-row");
      const trio = [...row.querySelectorAll("[data-testid]")]
        .map(e => e.getAttribute("data-testid"))
        .filter(id => id === "button-save" || id === "super-toolbar-import" || id === "super-toolbar-export");
      expect(trio, tab).toEqual(["button-save", "super-toolbar-import", "super-toolbar-export"]);
    }
    expect(screen.getByTestId("super-toolbar-export")).toHaveTextContent("Export");
    expect(screen.getByTestId("super-readiness-ok")).toBeInTheDocument();   // last tab is Optimization Parameters (SM-9, unchanged)
  });

  it("QFX-1: each Export ▾ item calls the unchanged handler (same network fetch, same file per format)", async () => {
    const { exportScenarioNetwork } = await import("@workspace/api-client-react");
    vi.mocked(exportScenarioNetwork).mockResolvedValue(sample as never);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    renderWorkspace();
    for (const f of ["json", "csv", "xlsx"]) {
      fireEvent.click(screen.getByTestId("super-toolbar-export"));
      fireEvent.click(screen.getByTestId(`super-toolbar-export-${f}`));
    }
    await waitFor(() => expect([...names].sort()).toEqual(["super-model-network-1.json", "super-model-network-1.xlsx", "super-model-network-1.zip"]));
    expect(vi.mocked(exportScenarioNetwork).mock.calls).toEqual([[1, { format: "json" }], [1, { format: "json" }], [1, { format: "json" }]]);
    vi.restoreAllMocks();
  });

  it("QFX-1: while browsing history both Import network and Export ▾ are hidden", () => {
    const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/superResult.json"), "utf8"));
    const solved = { ...scenario, result: { ...base } };
    mockUseGetScenario.mockReturnValue({ data: solved } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solved] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { rerender } = renderWorkspace();
    const next = { ...solved, result: { ...base } };   // new result reference: history appends (as in SM2-10 above)
    mockUseGetScenario.mockReturnValue({ data: next } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [next] } as unknown as ReturnType<typeof mockUseListScenarios>);
    rerender(<Workspace modelId="super-model" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    expect(screen.getByTestId("super-toolbar-import")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-result-back"));
    expect(screen.queryByTestId("super-toolbar-import")).toBeNull();
    // handleSuperExport always exports the PERSISTED network, not the historical entry on screen,
    // so offering it here would mislabel the file (per-table Download still exports the displayed rows).
    expect(screen.queryByTestId("super-toolbar-export")).toBeNull();
  });
```

- Lines 310 and 343: `fireEvent.click(screen.getByTestId("super-header-import"));` → `fireEvent.click(screen.getByTestId("super-toolbar-import"));`.

- [ ] **Step 2: Run them, expect FAIL**

```bash
pnpm --filter studio exec vitest run src/__tests__/Workspace.Super.test.tsx
```

Expected failures:
- `expect(element).toBeNull()` for `super-header-import`, which is still rendered
- `Unable to find an element by: [data-testid="super-toolbar-import"]` in the repointed SM2-1 / SM-9 import tests and the new ones

- [ ] **Step 3: Implement**

`artifacts/studio/src/pages/Workspace.tsx`:
- Next to the line-32 `Button` import, add:

```tsx
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
```

- Delete the header block (lines 4522-4531, the whole `{modelId === "super-model" && currentScenario && ( <> … Export XLSX</Button> </> )}`). The Run Optimizer `Button` that follows is unchanged.

- In the toolbar Save row, insert directly after the Save `</Button>` (line 4602) and before the closing `</div>` of `ml-auto` (line 4603):

```tsx
                {/* QFX-1 — super's whole-network Import / Export sit right of Save. Every super input tab uses this
                    row (no saveInLayersRow gate names super). Both are hidden while browsing history: Import would
                    write, and Export always exports the PERSISTED network (handleSuperExport), not the entry on screen. */}
                {modelId === "super-model" && currentScenario && !isBrowsingHistoryNow && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setSuperImportOpen(true)} data-testid="super-toolbar-import">
                      Import network
                    </Button>
                    <DownloadMenu
                      label="Export"
                      testId="super-toolbar-export"
                      itemTestIds={{ csv: "super-toolbar-export-csv", json: "super-toolbar-export-json", xlsx: "super-toolbar-export-xlsx" }}
                      onDownload={format => void handleSuperExport(format)}
                    />
                  </>
                )}
```

`handleSuperExport` (`:2782-2789`) is unchanged, so each format writes the same bytes as before (same `exportScenarioNetwork(id, { format: "json" })` → `downloadSuperFile`). The `SuperNetworkImportDialog` mount (`:4733`) is unchanged.

- [ ] **Step 4: Rewrite the sibling e2e assertion**

`artifacts/studio/e2e/super-model.spec.ts:150-151`. After `importSampleViaUi` the Input Map is open, and the toolbar row renders there. Replace:

```ts
      // SM2-1: the header export is now labelled "Export JSON" (testid unchanged).
      await expect(page.getByTestId("super-header-export")).toHaveText("Export JSON");
```

with:

```ts
      // QFX-1: Import network + Export ▾ moved from the header to the toolbar Save row.
      await expect(page.getByTestId("super-header-export")).toHaveCount(0);
      await expect(page.getByTestId("super-toolbar-import")).toHaveText("Import network");
      await expect(page.getByTestId("super-toolbar-export")).toHaveText("Export");
```

- [ ] **Step 5: Run the task's tests, then typecheck, expect PASS**

```bash
pnpm --filter studio exec vitest run src/__tests__/Workspace.Super.test.tsx src/__tests__/SuperNetworkImportDialog.test.tsx
pnpm run typecheck
```

Then run `pnpm gate` with 0 concurrent vitest processes. Run the rewritten e2e spec locally:

```bash
E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/super-model.spec.ts
```

The env var is mandatory (`artifacts/studio/e2e/CLAUDE.md`).

- [ ] **Step 6: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-1 - super Import network + Export ▾ beside Save

`pages/Workspace.tsx` changes:
- **Removed** the super page-header "Import network" and the three "Export JSON/CSV/XLSX" buttons (`super-header-*`).
- **Added** `Save · Import network · Export ▾` to the shared toolbar Save row, which every super input tab uses (`showToolbarSave`; no `saveInLayersRow*` gate names super). New testids:
  - `super-toolbar-import`
  - `super-toolbar-export`
  - `super-toolbar-export-csv|json|xlsx`
- **Export ▾** is the QFX-2a `DownloadMenu`. Each item calls the unchanged `handleSuperExport(format)`, so the files are byte-identical. CSV is still a `.zip`.
- **History.** While browsing history, both Import network and Export ▾ are hidden. Export always writes the persisted network (`exportScenarioNetwork`), not the historical entry on screen, so showing it there would mislabel the file. The spec was amended accordingly. Per-table Download stays, because it exports the displayed rows.
- **Unchanged:** chapter models and the empty-state import prompt (`super-open-import`).

**Tests.** `Workspace.Super.test.tsx`: the trio order on all ten super input tabs, header absence, the three formats through the same fetch, and the history rule. The SM-9/SM2-1 import tests were repointed to `super-toolbar-import`. E2E `super-model.spec.ts:150-151` was rewritten. Rollback point: this commit.
```

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit \
  artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/src/__tests__/Workspace.Super.test.tsx \
  artifacts/studio/e2e/super-model.spec.ts \
  docs/CHANGELOG-implementation.md \
  -m "[QFX-1] move super Import network and Export menu beside Save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- `artifacts/studio/e2e/super-model.spec.ts:150-151`: `expect(page.getByTestId("super-header-export")).toHaveText("Export JSON")` → `toHaveCount(0)` plus `super-toolbar-import` "Import network" and `super-toolbar-export` "Export" (Step 4).
- No other spec references `super-header-*` (grep `artifacts/studio/e2e/`: only `:151`). `importSampleViaUi` / `super-open-import` (`:62,77,321`) are the empty-state prompt and are unchanged.
- Real-browser QA (QFX-QA) should check:
  - the trio's alignment: the DownloadMenu trigger is `h-7 text-xs`, while the `size="sm"` buttons are `min-h-8`
  - all three downloads from the toolbar
### Task QFX-6: Tab-specific "Add …" forms on super tables

**Contract notes (read first):**
- The QFX-6 contract is honoured: `components/workspace/super/SuperAddRowDialog.tsx` plus the per-tab spec `SUPER_ADD_FORMS`, which lives in a new pure module `components/workspace/super/superAddForms.ts` so it can be unit-tested without React.
- **Where the button lands.** The Distances tab does not render its own table. `SuperDistancesTab.tsx:42-44` renders `<SuperTableTab table="distanceOverrides" …>`, so the Add button for all 7 tables is in one place, the `toolbar.add` slot of `SuperTableTab.tsx:33-40`. `SuperDistancesTab` only forwards the new `network` prop.
- **The form fields come from the table's own `SPECS`/`HEADERS`** (`superTables.tsx:15-53`), so the form and the table cannot drift. This assumes QFX-7 has landed: location specs have no `name` field; products keep `id, name`. As a result, the label for `costPerUnit` is the table header "Cost / unit", not the spec matrix's "Cost per unit". This is deliberate, so the form and its column read the same.
- **New required prop `network: SuperInputsLike`** on `SuperTableTab` and `SuperDistancesTab`. The form needs the whole draft for four things: location-ID uniqueness across three tables, the pair-table sources, the W×C×P limit, and `nextFreeId`. `SuperDistancesTab` keeps its `plantIds/warehouseIds/customerIds` props unchanged, because QFX-9 is written against them. Inside `SuperTableTab`, the table's own `rows` override `network[table]`, so the duplicate and limit checks always see the rows on screen.
- **Studio has no copy of `SUPER_CAPS`.** `superAddForms.ts` mirrors `artifacts/api-server/src/validation/inputs/superInputs.ts:4` with a pointer comment. There is no cross-package import, because studio does not depend on api-server.
- **Not merged with `SuperEntityDialog`.** That dialog is the Input Map's create/edit flow and carries per-product customer demand. The spec scopes QFX-6 to the table tabs, so it stays as it is.

**Files:**
- Create: `artifacts/studio/src/components/workspace/super/superAddForms.ts`
- Create: `artifacts/studio/src/components/workspace/super/SuperAddRowDialog.tsx`
- Modify: `artifacts/studio/src/components/workspace/super/superTables.tsx:15,27,49` (export `Spec`, `SPECS`, `HEADERS`) and `:66-76` (delete `blankRow`)
- Modify: `artifacts/studio/src/components/workspace/super/SuperTableTab.tsx:1-44` (new `network` prop, Add button + dialog; "+ Add row" removed)
- Modify: `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx:6-17,42-44` (forward `network`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:3835-3859` (pass `network` to both)
- Test (new): `artifacts/studio/src/__tests__/superAddForms.test.ts`
- Test (new): `artifacts/studio/src/__tests__/SuperAddRowDialog.test.tsx`
- Test (modify): `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`, `artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`

**Interfaces:**
- Consumes:
  - QFX-7: location `SPECS` without `name`.
  - QFX-4: `ColumnDef.sortable`. Untouched here; the Add path appends and never re-indexes.
  - QFX-2: whatever upload/download it put in `SuperTableTab`'s toolbar. Keep it; this task edits only the `add:` slot.
  - Existing: `nextFreeId`, `SuperInputsLike`, `SuperTable` (`lib/superNetwork.ts`).
- Produces:
  - `superAddForms.ts`:
    - `SUPER_ADD_FORMS: Record<SuperTable, { label: string; needs?: { ok(n: SuperInputsLike): boolean; message: string } }>`
    - `superAddFields(table): AddField[]`
    - `superAddDefaults(table, n): Record<string, string>`
    - `superAddOptions(key, values, n): string[]`
    - `superAddDisabledReason(table, n): string | null`
    - `validateSuperAdd(table, values, n): { errors: Record<string, string>; formError: string | null; row: Row | null }`
  - `SuperAddRowDialog` props: `{ table: SuperTable; network: SuperInputsLike; onAdd(row: Row): void; onCancel(): void }`.
  - `SuperTableTabProps.network` and `SuperDistancesTabProps.network`, both `SuperInputsLike`.
  - Test IDs:
    - `super-<table>-add` is unchanged, so existing tests and specs still find it.
    - New: `super-<table>-add-reason`, `super-add-dialog`, `super-add-<key>`, `super-add-<key>-error`, `super-add-form-error`, `super-add-confirm`, `super-add-cancel`.

- [ ] **Step 1: Write the failing tests**

`artifacts/studio/src/__tests__/superAddForms.test.ts` (new):
```ts
import { describe, it, expect } from "vitest";
import type { SuperInputsLike } from "@/lib/superNetwork";
import { superAddDefaults, superAddDisabledReason, superAddOptions, validateSuperAdd } from "@/components/workspace/super/superAddForms";

const net = (over: Partial<SuperInputsLike> = {}): SuperInputsLike => ({
  products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [], ...over,
});
const loc = (id: string) => ({ id, lat: 0, lng: 0 });
const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => loc(`${p}${i}`));
const products = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: "x" }));

describe("superAddDisabledReason", () => {
  it("entity tables are never source-gated", () => {
    for (const t of ["products", "plants", "warehouses", "customers"] as const) expect(superAddDisabledReason(t, net())).toBeNull();
  });
  it("pair tables need their sources", () => {
    expect(superAddDisabledReason("plantProducts", net({ plants: [loc("P")] }))).toBe("Add a plant and a product first.");
    expect(superAddDisabledReason("plantProducts", net({ plants: [loc("P")], products: products(1) }))).toBeNull();
    expect(superAddDisabledReason("demand", net({ products: products(1) }))).toBe("Add a customer and a product first.");
    expect(superAddDisabledReason("demand", net({ customers: [loc("C")], products: products(1) }))).toBeNull();
    expect(superAddDisabledReason("distanceOverrides", net({ plants: [loc("P")], customers: [loc("C")] }))).toBe("Add warehouses with plants or customers first.");
    expect(superAddDisabledReason("distanceOverrides", net({ warehouses: [loc("W")] }))).toBe("Add warehouses with plants or customers first.");
    expect(superAddDisabledReason("distanceOverrides", net({ warehouses: [loc("W")], customers: [loc("C")] }))).toBeNull();
    expect(superAddDisabledReason("distanceOverrides", net({ plants: [loc("P")], warehouses: [loc("W")] }))).toBeNull();
  });
  it("at a table's server limit the button is disabled with that limit", () => {
    expect(superAddDisabledReason("products", net({ products: products(10) }))).toBe("Limit reached: at most 10 products.");
    expect(superAddDisabledReason("plants", net({ plants: many(20, "p") }))).toBe("Limit reached: at most 20 plants.");
    expect(superAddDisabledReason("warehouses", net({ warehouses: many(50, "w") }))).toBe("Limit reached: at most 50 warehouses.");
    expect(superAddDisabledReason("customers", net({ customers: many(500, "c") }))).toBe("Limit reached: at most 500 customers.");
    expect(superAddDisabledReason("plants", net({ plants: many(19, "p") }))).toBeNull();
  });
});

describe("superAddDefaults", () => {
  it("locations default to nextFreeId in the SHARED location namespace; status defaults to active", () => {
    const n = net({ plants: [loc("PL-1")], customers: [loc("PL-2")] });
    expect(superAddDefaults("plants", n)).toEqual({ id: "PL-3", city: "", state: "", lat: "", lng: "" });
    expect(superAddDefaults("warehouses", n)).toEqual({ id: "WH-1", city: "", state: "", lat: "", lng: "", status: "active" });
    expect(superAddDefaults("customers", n)).toMatchObject({ id: "C-1", status: "active" });
  });
  it("products and pair tables start empty", () => {
    expect(superAddDefaults("products", net())).toEqual({ id: "", name: "" });
    expect(superAddDefaults("demand", net())).toEqual({ customerId: "", productId: "", demand: "" });
    expect(superAddDefaults("distanceOverrides", net())).toEqual({ fromId: "", toId: "", miles: "" });
  });
});

describe("validateSuperAdd", () => {
  const base = net({
    products: [{ id: "K1", name: "Bolts" }], plants: [loc("P1")], warehouses: [loc("W1")], customers: [loc("C1")],
    plantProducts: [{ plantId: "P1", productId: "K1", capacity: 5, costPerUnit: 1 }],
  });

  it("location: trims text, accepts signed lat/lng at the bounds, omits blank optional text", () => {
    const r = validateSuperAdd("plants", { id: " P2 ", city: " ", state: "", lat: "-33.5", lng: "-180" }, base);
    expect(r.errors).toEqual({});
    expect(r.row).toEqual({ id: "P2", lat: -33.5, lng: -180 });
  });
  it("location: lat/lng out of range or blank are field errors", () => {
    const r = validateSuperAdd("customers", { id: "C2", city: "", state: "", lat: "90.1", lng: "", status: "active" }, base);
    expect(r.errors).toEqual({ lat: "Must be between -90 and 90.", lng: "Required." });
    expect(r.row).toBeNull();
    expect(validateSuperAdd("plants", { id: "P2", lat: "0", lng: "180.5" }, base).errors.lng).toBe("Must be between -180 and 180.");
  });
  it("location ids are unique across plants, warehouses and customers; products are their own namespace", () => {
    expect(validateSuperAdd("customers", { id: "W1", lat: "1", lng: "1", status: "active" }, base).errors.id)
      .toBe('ID "W1" is already used by a plant, warehouse or customer.');
    expect(validateSuperAdd("products", { id: "P1", name: " Plant-named " }, base).row).toEqual({ id: "P1", name: "Plant-named" });
    expect(validateSuperAdd("products", { id: "K1", name: "Dup" }, base).errors.id).toBe('ID "K1" is already used by a product.');
    expect(validateSuperAdd("products", { id: "K2", name: "  " }, base).errors.name).toBe("Required.");
  });
  it(">= 0 numerics accept 0 and reject negatives and non-numbers", () => {
    const ok = validateSuperAdd("plantProducts", { plantId: "P1", productId: "K1", capacity: "0", costPerUnit: "0" }, { ...base, plantProducts: [] });
    expect(ok.row).toEqual({ plantId: "P1", productId: "K1", capacity: 0, costPerUnit: 0 });
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "-1" }, base).errors.demand).toBe("Must be 0 or more.");
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "abc" }, base).errors.demand).toBe("Enter a number.");
  });
  it("an existing composite pair cannot be added again", () => {
    const r = validateSuperAdd("plantProducts", { plantId: "P1", productId: "K1", capacity: "1", costPerUnit: "1" }, base);
    expect(r.formError).toBe("Plant P1 already has a row for product K1.");
    expect(r.row).toBeNull();
    const d = net({ ...base, demand: [{ customerId: "C1", productId: "K1", demand: 2 }] });
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "1" }, d).formError).toBe("Customer C1 already has demand for product K1.");
    const o = net({ ...base, distanceOverrides: [{ fromId: "W1", toId: "C1", miles: 2 }] });
    expect(validateSuperAdd("distanceOverrides", { fromId: "W1", toId: "C1", miles: "1" }, o).formError).toBe("An override for W1 → C1 already exists.");
  });
  it("a select value not in its list is rejected", () => {
    expect(validateSuperAdd("demand", { customerId: "nope", productId: "K1", demand: "1" }, base).errors.customerId).toBe("Choose from the list.");
  });
  it("Distances: To is filtered by From (plant→warehouse, warehouse→customer only)", () => {
    expect(superAddOptions("fromId", {}, base)).toEqual(["P1", "W1"]);
    expect(superAddOptions("toId", { fromId: "P1" }, base)).toEqual(["W1"]);
    expect(superAddOptions("toId", { fromId: "W1" }, base)).toEqual(["C1"]);
    expect(superAddOptions("toId", { fromId: "" }, base)).toEqual([]);
    expect(validateSuperAdd("distanceOverrides", { fromId: "P1", toId: "C1", miles: "3" }, base).errors.toId).toBe("Choose from the list.");
    expect(validateSuperAdd("distanceOverrides", { fromId: "W1", toId: "C1", miles: "0" }, base).row).toEqual({ fromId: "W1", toId: "C1", miles: 0 });
  });
  it("a From with nothing reachable is not offered", () => {
    expect(superAddOptions("fromId", {}, net({ plants: [loc("P1")], warehouses: [loc("W1")] }))).toEqual(["P1"]);
    expect(superAddOptions("fromId", {}, net({ warehouses: [loc("W1")], customers: [loc("C1")] }))).toEqual(["W1"]);
  });
  it("warehouses × customers × products may reach 50,000 but not exceed it", () => {
    const at = net({ products: products(10), customers: many(500, "c"), warehouses: many(9, "w") });
    expect(validateSuperAdd("warehouses", { id: "W-new", lat: "0", lng: "0", status: "active" }, at).formError).toBeNull();
    const over = { ...at, warehouses: many(10, "w") };
    const r = validateSuperAdd("warehouses", { id: "W-new", lat: "0", lng: "0", status: "active" }, over);
    expect(r.formError).toBe("Limit reached: warehouses × customers × products would be 55,000 (at most 50,000).");
    expect(r.row).toBeNull();
    // a table that does not grow the product is never blocked by it
    expect(validateSuperAdd("plants", { id: "P-new", lat: "0", lng: "0" }, over).formError).toBeNull();
  });
});
```

`artifacts/studio/src/__tests__/SuperAddRowDialog.test.tsx` (new):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperAddRowDialog } from "@/components/workspace/super/SuperAddRowDialog";
import type { SuperInputsLike } from "@/lib/superNetwork";

const loc = (id: string) => ({ id, lat: 0, lng: 0 });
const base: SuperInputsLike = {
  products: [{ id: "K1", name: "Bolts" }], plants: [loc("P1")], warehouses: [loc("W1")], customers: [loc("C1")],
  plantProducts: [{ plantId: "P1", productId: "K1", capacity: 5, costPerUnit: 1 }], demand: [], distanceOverrides: [],
};
const options = (testId: string) => [...screen.getByTestId(testId).querySelectorAll("option")].map(o => o.value);

describe("SuperAddRowDialog", () => {
  it("is titled per tab; Add stays disabled until valid; errors show inline after editing; adds the parsed row", () => {
    const onAdd = vi.fn();
    render(<SuperAddRowDialog table="plants" network={base} onAdd={onAdd} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add plant" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-id")).toHaveValue("PL-1");
    expect(screen.queryByTestId("super-add-name")).toBeNull();          // QFX-7: no location name
    expect(screen.getByTestId("super-add-confirm")).toBeDisabled();
    expect(screen.queryByTestId("super-add-lat-error")).toBeNull();     // untouched fields show no error
    fireEvent.change(screen.getByTestId("super-add-lat"), { target: { value: "95" } });
    expect(screen.getByTestId("super-add-lat-error")).toHaveTextContent("Must be between -90 and 90.");
    expect(screen.getByTestId("super-add-lat")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByTestId("super-add-lat"), { target: { value: "-12.5" } });
    fireEvent.change(screen.getByTestId("super-add-lng"), { target: { value: "130" } });
    expect(screen.getByTestId("super-add-confirm")).toBeEnabled();
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(onAdd).toHaveBeenCalledWith({ id: "PL-1", lat: -12.5, lng: 130 });
  });

  it("warehouse and customer forms default Status to active and offer only the server's statuses", () => {
    render(<SuperAddRowDialog table="warehouses" network={base} onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add warehouse" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-status")).toHaveValue("active");
    expect(options("super-add-status")).toEqual(["active", "forced_open", "inactive"]);
  });

  it("Distances: To lists warehouses for a plant, customers for a warehouse; a new From clears an unreachable To", () => {
    render(<SuperAddRowDialog table="distanceOverrides" network={base} onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add distance override" })).toBeInTheDocument();
    expect(options("super-add-fromId")).toEqual(["", "P1", "W1"]);
    fireEvent.change(screen.getByTestId("super-add-fromId"), { target: { value: "P1" } });
    expect(options("super-add-toId")).toEqual(["", "W1"]);
    fireEvent.change(screen.getByTestId("super-add-toId"), { target: { value: "W1" } });
    fireEvent.change(screen.getByTestId("super-add-fromId"), { target: { value: "W1" } });
    expect(options("super-add-toId")).toEqual(["", "C1"]);
    expect(screen.getByTestId("super-add-toId")).toHaveValue("");
  });

  it("a duplicate pair is shown inline and cannot be added", () => {
    const onAdd = vi.fn();
    render(<SuperAddRowDialog table="plantProducts" network={base} onAdd={onAdd} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add capability" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("super-add-plantId"), { target: { value: "P1" } });
    fireEvent.change(screen.getByTestId("super-add-productId"), { target: { value: "K1" } });
    fireEvent.change(screen.getByTestId("super-add-capacity"), { target: { value: "0" } });
    fireEvent.change(screen.getByTestId("super-add-costPerUnit"), { target: { value: "0" } });
    expect(screen.getByTestId("super-add-form-error")).toHaveTextContent("Plant P1 already has a row for product K1.");
    expect(screen.getByTestId("super-add-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel and never onAdd", () => {
    const onAdd = vi.fn(), onCancel = vi.fn();
    render(<SuperAddRowDialog table="products" network={base} onAdd={onAdd} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Add product" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-id")).toHaveValue("");
    fireEvent.click(screen.getByTestId("super-add-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
```

`artifacts/studio/src/__tests__/SuperTableTab.test.tsx`: three edits.

(a) After the `const options = …` line (`:6`), add:
```tsx
import type { SuperInputsLike } from "@/lib/superNetwork";
const net = (over: Partial<SuperInputsLike> = {}): SuperInputsLike => ({
  products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [], ...over,
});
const NET = net({
  products: [{ id: "k1", name: "K1" }, { id: "k2", name: "K2" }],
  plants: [{ id: "p1", lat: 0, lng: 0 }], customers: [{ id: "c1", lat: 0, lng: 0 }],
});
```
Move the `import type` line up with the other imports.

(b) Every `<SuperTableTab ` and `<SuperDistancesTab ` render in the file gains `network={NET}`. That includes any renders QFX-4 or QFX-2 added. The prop is required, so typecheck flags any that are missed:
```bash
cd $WT/artifacts/studio && sed -i '' -e 's/<SuperTableTab table=/<SuperTableTab network={NET} table=/g' -e 's/<SuperDistancesTab onFetchRoad=/<SuperDistancesTab network={NET} onFetchRoad=/g' src/__tests__/SuperTableTab.test.tsx
```

(c) Replace the `it("+ Add row appends one row", …)` block (`:30-36`) with:
```tsx
  it("the Add button is tab-specific and the blank '+ Add row' is gone", () => {
    render(<SuperTableTab network={NET} table="plantProducts" rows={rows} onChange={vi.fn()} readOnly={false} options={options} />);
    expect(screen.getByTestId("super-plantProducts-add")).toHaveTextContent("Add capability");
    expect(screen.queryByText("+ Add row")).toBeNull();
  });
  it("Add appends the form's row to the draft (onChange) and closes", () => {
    const onChange = vi.fn();
    render(<SuperTableTab network={NET} table="demand" rows={[]} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId("super-demand-add"));
    expect(screen.getByRole("dialog", { name: "Add demand" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("super-add-customerId"), { target: { value: "c1" } });
    fireEvent.change(screen.getByTestId("super-add-productId"), { target: { value: "k2" } });
    fireEvent.change(screen.getByTestId("super-add-demand"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(onChange).toHaveBeenCalledWith([{ customerId: "c1", productId: "k2", demand: 0 }]);
    expect(screen.queryByTestId("super-add-dialog")).toBeNull();
  });
  it("an empty source disables Add with the tab's message", () => {
    render(<SuperTableTab network={net()} table="plantProducts" rows={[]} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByTestId("super-plantProducts-add")).toBeDisabled();
    expect(screen.getByTestId("super-plantProducts-add-reason")).toHaveTextContent("Add a plant and a product first.");
  });
  it("the tab's own rows (not network[table]) drive the duplicate check", () => {
    // NET.plantProducts is empty; the on-screen rows already hold p1/k1.
    render(<SuperTableTab network={NET} table="plantProducts" rows={rows} onChange={vi.fn()} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId("super-plantProducts-add"));
    fireEvent.change(screen.getByTestId("super-add-plantId"), { target: { value: "p1" } });
    fireEvent.change(screen.getByTestId("super-add-productId"), { target: { value: "k1" } });
    expect(screen.getByTestId("super-add-form-error")).toHaveTextContent("Plant p1 already has a row for product k1.");
  });
  it("Distances tab: the override table's Add opens 'Add distance override'", () => {
    const n = net({ plants: [{ id: "p1", lat: 0, lng: 0 }], warehouses: [{ id: "w1", lat: 0, lng: 0 }] });
    render(<SuperDistancesTab network={n} onFetchRoad={() => {}} fetchDisabledReason={null} overrides={[]} plantIds={["p1"]} warehouseIds={["w1"]} customerIds={[]}
      readOnly={false} distanceMethod="haversine" circuityFactor={1.17} onChange={vi.fn()} />);
    expect(screen.getByTestId("super-distanceOverrides-add")).toHaveTextContent("Add distance override");
    fireEvent.click(screen.getByTestId("super-distanceOverrides-add"));
    expect(screen.getByRole("dialog", { name: "Add distance override" })).toBeInTheDocument();
  });
```
The existing readOnly test (`:43-51`, `super-products-add` disabled) stays as it is.

`artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx`: in `setup()`'s `<SuperDistancesTab …>` (`:13-16`), add the prop after `readOnly={false}`:
```tsx
      network={{ products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] }}
```

`artifacts/studio/src/__tests__/Workspace.Super.test.tsx`: append inside `describe("Workspace — super-model input tabs (SM-7)", …)`:
```tsx
  it("QFX-6: Add plant appends a row to the draft, and it is in the Save payload", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-plants"));
    expect(screen.getByTestId("button-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("super-plants-add"));
    expect(screen.getByTestId("super-add-id")).toHaveValue("PL-1");   // sample ids are plant-N / wh-N / customer-N
    fireEvent.change(screen.getByTestId("super-add-lat"), { target: { value: "40.5" } });
    fireEvent.change(screen.getByTestId("super-add-lng"), { target: { value: "-90.25" } });
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(screen.getByTestId("super-row-plants-PL-1")).toBeInTheDocument();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();            // no auto-save
    await act(async () => { fireEvent.click(screen.getByTestId("button-save")); });
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.data.inputs.plants).toHaveLength(sample.plants.length + 1);
    expect(args.data.inputs.plants.at(-1)).toEqual({ id: "PL-1", lat: 40.5, lng: -90.25 });
  });
```
`button-save` is `disabled={!saveEnabled || saveIsPending}` (`Workspace.tsx:4596`), so it is disabled on the clean sample draft.

- [ ] **Step 2: Run them, expect FAIL**
```bash
cd $WT && pnpm --filter studio exec vitest run src/__tests__/superAddForms.test.ts src/__tests__/SuperAddRowDialog.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/Workspace.Super.test.tsx
```
Expected:
- `superAddForms.test.ts` and `SuperAddRowDialog.test.tsx` fail to load: `Failed to resolve import "@/components/workspace/super/superAddForms"` / `".../SuperAddRowDialog"`.
- `SuperTableTab.test.tsx` fails with `expected element to have text content "Add capability"` / received `"+ Add row"`, then `Unable to find an element by: [data-testid="super-plantProducts-add-reason"]`, then `Unable to find role="dialog"`.
- `Workspace.Super.test.tsx` "QFX-6" fails with `Unable to find an element by: [data-testid="super-add-id"]`.

- [ ] **Step 3: Implement `superAddForms.ts` and export the specs from `superTables.tsx`**

`superTables.tsx`:
- `:15`: `type Spec =` → `export type Spec =`
- `:27`: `const SPECS: Record<SuperTable, Spec[]> = {` → `export const SPECS: Record<SuperTable, Spec[]> = {`
- `:49`: `const HEADERS: Record<string, string> = {` → `export const HEADERS: Record<string, string> = {`
- Delete `blankRow` (`:66-76`, the whole `export function blankRow(…) { switch … }` block). Its only caller was "+ Add row".

Create `artifacts/studio/src/components/workspace/super/superAddForms.ts`:
```ts
// QFX-6 — the per-tab "Add …" forms. Fields come from the table's own SPECS/HEADERS (one source for table and form);
// the rules mirror the server validator, artifacts/api-server/src/validation/inputs/superInputs.ts.
import { nextFreeId, type LocKind, type SuperInputsLike, type SuperTable } from "@/lib/superNetwork";
import { HEADERS, SPECS, type Row, type Spec } from "./superTables";

/** Server SUPER_CAPS (superInputs.ts:4). Pair tables have no row cap. */
const CAP: Partial<Record<SuperTable, number>> = { products: 10, plants: 20, warehouses: 50, customers: 500 };
const WCP_CAP = 50_000;

export const SUPER_ADD_FORMS: Record<SuperTable, { label: string; needs?: { ok(n: SuperInputsLike): boolean; message: string } }> = {
  products: { label: "Add product" },
  plants: { label: "Add plant" },
  warehouses: { label: "Add warehouse" },
  customers: { label: "Add customer" },
  plantProducts: { label: "Add capability", needs: { ok: n => n.plants.length > 0 && n.products.length > 0, message: "Add a plant and a product first." } },
  demand: { label: "Add demand", needs: { ok: n => n.customers.length > 0 && n.products.length > 0, message: "Add a customer and a product first." } },
  distanceOverrides: {
    label: "Add distance override",
    needs: { ok: n => n.warehouses.length > 0 && (n.plants.length > 0 || n.customers.length > 0), message: "Add warehouses with plants or customers first." },
  },
};

const LOC_KIND: Partial<Record<SuperTable, LocKind>> = { plants: "pl", warehouses: "wh", customers: "cs" };
const OPTIONAL = new Set(["city", "state"]);
const RANGE: Record<string, [number, number]> = { lat: [-90, 90], lng: [-180, 180] };   // every other number is >= 0
const PAIR: Partial<Record<SuperTable, [string, string, (a: string, b: string) => string]>> = {
  plantProducts: ["plantId", "productId", (a, b) => `Plant ${a} already has a row for product ${b}.`],
  demand: ["customerId", "productId", (a, b) => `Customer ${a} already has demand for product ${b}.`],
  distanceOverrides: ["fromId", "toId", (a, b) => `An override for ${a} → ${b} already exists.`],
};

export interface AddField { key: string; label: string; spec: Spec; required: boolean }
export const superAddFields = (table: SuperTable): AddField[] =>
  SPECS[table].map(spec => ({ key: spec.key, label: HEADERS[spec.key], spec, required: !OPTIONAL.has(spec.key) }));

export function superAddDisabledReason(table: SuperTable, n: SuperInputsLike): string | null {
  const cap = CAP[table];
  if (cap != null && n[table].length >= cap) return `Limit reached: at most ${cap} ${table}.`;
  const needs = SUPER_ADD_FORMS[table].needs;
  return needs && !needs.ok(n) ? needs.message : null;
}

export function superAddDefaults(table: SuperTable, n: SuperInputsLike): Record<string, string> {
  const v: Record<string, string> = Object.fromEntries(SPECS[table].map(s => [s.key, ""]));
  const kind = LOC_KIND[table];
  if (kind) v.id = nextFreeId(n, kind);
  if ("status" in v) v.status = "active";
  return v;
}

const ids = (rows: Row[]) => rows.map(r => String(r.id));
/** Dropdown ids from the draft. Distances: only pairs the server accepts (superInputs.ts:81-83), so To depends on From. */
export function superAddOptions(key: string, values: Record<string, string>, n: SuperInputsLike): string[] {
  switch (key) {
    case "plantId": return ids(n.plants);
    case "productId": return ids(n.products);
    case "customerId": return ids(n.customers);
    case "fromId": return [...(n.warehouses.length ? ids(n.plants) : []), ...(n.customers.length ? ids(n.warehouses) : [])];
    case "toId":
      if (ids(n.plants).includes(values.fromId)) return ids(n.warehouses);
      if (ids(n.warehouses).includes(values.fromId)) return ids(n.customers);
      return [];
    default: return [];
  }
}

export interface SuperAddCheck { errors: Record<string, string>; formError: string | null; row: Row | null }

export function validateSuperAdd(table: SuperTable, values: Record<string, string>, n: SuperInputsLike): SuperAddCheck {
  const errors: Record<string, string> = {};
  const row: Row = {};
  for (const f of superAddFields(table)) {
    const raw = (values[f.key] ?? "").trim();
    if (raw === "") { if (f.required) errors[f.key] = "Required."; continue; }   // blank optional text is omitted, as the import does
    if (f.spec.kind === "number") {
      const x = Number(raw);
      const [lo, hi] = RANGE[f.key] ?? [0, Infinity];
      if (!Number.isFinite(x)) errors[f.key] = "Enter a number.";
      else if (x < lo || x > hi) errors[f.key] = hi === Infinity ? "Must be 0 or more." : `Must be between ${lo} and ${hi}.`;
      else row[f.key] = x;
    } else if (f.spec.kind === "select" && !superAddOptions(f.key, values, n).includes(raw)) errors[f.key] = "Choose from the list.";
    else row[f.key] = raw;
  }
  if (typeof row.id === "string") {
    const taken = table === "products" ? n.products : [...n.plants, ...n.warehouses, ...n.customers];
    if (taken.some(r => String(r.id).trim() === row.id))
      errors.id = table === "products" ? `ID "${row.id}" is already used by a product.` : `ID "${row.id}" is already used by a plant, warehouse or customer.`;
  }
  let formError: string | null = null;
  const pair = PAIR[table];
  if (pair) {
    const [a, b, message] = pair;
    if (row[a] != null && row[b] != null && n[table].some(r => String(r[a]) === row[a] && String(r[b]) === row[b])) formError = message(String(row[a]), String(row[b]));
  }
  if (table === "warehouses" || table === "customers" || table === "products") {
    const grow = (t: SuperTable) => n[t].length + (t === table ? 1 : 0);
    const product = grow("warehouses") * grow("customers") * grow("products");
    if (product > WCP_CAP)
      formError = `Limit reached: warehouses × customers × products would be ${product.toLocaleString("en-US")} (at most ${WCP_CAP.toLocaleString("en-US")}).`;
  }
  return { errors, formError, row: Object.keys(errors).length === 0 && formError === null ? row : null };
}
```

- [ ] **Step 4: Implement `SuperAddRowDialog.tsx`**

Create `artifacts/studio/src/components/workspace/super/SuperAddRowDialog.tsx`:
```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SuperInputsLike, SuperTable } from "@/lib/superNetwork";
import type { Row } from "./superTables";
import { SUPER_ADD_FORMS, superAddDefaults, superAddFields, superAddOptions, validateSuperAdd } from "./superAddForms";

export interface SuperAddRowDialogProps {
  table: SuperTable;
  /** The whole draft, with this table's on-screen rows. */
  network: SuperInputsLike;
  onAdd(row: Row): void;
  onCancel(): void;
}

/** QFX-6 — one renderer for every super tab's "Add …" form, driven by SUPER_ADD_FORMS + the table's SPECS. */
export function SuperAddRowDialog({ table, network, onAdd, onCancel }: SuperAddRowDialogProps) {
  const [values, setValues] = useState(() => superAddDefaults(table, network));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const check = validateSuperAdd(table, values, network);
  const set = (key: string, v: string) => {
    setTouched(t => new Set(t).add(key));
    setValues(prev => {
      const next = { ...prev, [key]: v };
      // To depends on From: drop a To the new From cannot reach.
      if (key === "fromId" && !superAddOptions("toId", next, network).includes(next.toId)) next.toId = "";
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={o => !o && onCancel()}>
      <DialogContent data-testid="super-add-dialog">
        <DialogHeader>
          <DialogTitle>{SUPER_ADD_FORMS[table].label}</DialogTitle>
          <DialogDescription>Fields marked * are required. The row is added to your unsaved changes.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3 text-sm" onSubmit={e => { e.preventDefault(); if (check.row) onAdd(check.row); }}>
          {superAddFields(table).map(f => {
            const id = `super-add-${f.key}`;
            const err = touched.has(f.key) ? check.errors[f.key] : undefined;
            const common = { id, value: values[f.key] ?? "", "data-testid": id, "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-error` : undefined };
            const opts = f.spec.kind === "select" ? superAddOptions(f.key, values, network) : f.spec.kind === "status" ? f.spec.values : null;
            return (
              <div key={f.key} className="space-y-1">
                <label htmlFor={id} className="block text-xs font-medium">{f.label}{f.required ? " *" : ""}</label>
                {opts ? (
                  <select {...common} className="w-full h-8 border rounded px-2 bg-white text-sm" onChange={e => set(f.key, e.target.value)}>
                    {f.spec.kind === "select" && <option value="">Select…</option>}
                    {opts.map(o => <option key={o} value={o}>{f.spec.kind === "status" ? o.replace("_", " ") : o}</option>)}
                  </select>
                ) : (
                  <Input {...common} className="h-8" inputMode={f.spec.kind === "number" ? "decimal" : undefined} onChange={e => set(f.key, e.target.value)} />
                )}
                {err && <p id={`${id}-error`} className="text-xs text-destructive" data-testid={`${id}-error`}>{err}</p>}
              </div>
            );
          })}
          {check.formError && <p className="col-span-2 text-xs text-destructive" data-testid="super-add-form-error">{check.formError}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel} data-testid="super-add-cancel">Cancel</Button>
            <Button type="submit" size="sm" disabled={!check.row} data-testid="super-add-confirm">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```
- The `<select>` className matches the other dialog select (`SuperEntityDialog.tsx:48`). QFX-10's global `select` rule gives it the chevron. If QFX-10 removed `px-2` from selects for its `padding-right`, follow the class pattern QFX-10 left in `SuperEntityDialog`.
- Status options are displayed with `replace("_", " ")`, as `StatusToggle`'s `labelOf` does (`superTables.tsx:117`).

- [ ] **Step 5: Wire `SuperTableTab`, `SuperDistancesTab`, `Workspace`**

`SuperTableTab.tsx`, imports (`:1-6`). Replace
```tsx
import { useMemo } from "react";
…
import type { SuperTable } from "@/lib/superNetwork";
import { blankRow, isEntityTable, superColumns, superRowKey, type Item, type Row, type SuperOptions } from "./superTables";
```
with
```tsx
import { useMemo, useState } from "react";
…
import type { SuperInputsLike, SuperTable } from "@/lib/superNetwork";
import { isEntityTable, superColumns, superRowKey, type Item, type Row, type SuperOptions } from "./superTables";
import { SUPER_ADD_FORMS, superAddDisabledReason } from "./superAddForms";
import { SuperAddRowDialog } from "./SuperAddRowDialog";
```
Leave any imports QFX-2 added as they are.

Props (`:8-16`): add the following after `options?: SuperOptions;`:
```tsx
  /** The whole draft: location-ID uniqueness, the Add form's dropdown sources and the server limits read it.
   *  This table's own rows always come from `rows`. */
  network: SuperInputsLike;
```

Function head (`:18-19`). Replace
```tsx
export function SuperTableTab({ table, rows, onChange, onDelete, readOnly, options = {} }: SuperTableTabProps) {
  const items = useMemo<Item[]>(() => rows.map((r, i) => ({ r, i })), [rows]);
```
with
```tsx
export function SuperTableTab({ table, rows, onChange, onDelete, readOnly, options = {}, network }: SuperTableTabProps) {
  const items = useMemo<Item[]>(() => rows.map((r, i) => ({ r, i })), [rows]);
  const [adding, setAdding] = useState(false);
  const net = useMemo(() => ({ ...network, [table]: rows }) as SuperInputsLike, [network, table, rows]);
  const addBlocked = readOnly ? READ_ONLY_TITLE : superAddDisabledReason(table, net);
```
Keep any QFX-2 state lines that follow.

Toolbar `add` slot (`:34-39`). Replace
```tsx
          add: (
            <Button size="sm" variant="outline" disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined}
              data-testid={`super-${table}-add`} onClick={() => onChange([...rows, blankRow(table, options)])}>
              + Add row
            </Button>
          ),
```
with
```tsx
          add: (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={addBlocked !== null} title={addBlocked ?? undefined}
                data-testid={`super-${table}-add`} onClick={() => setAdding(true)}>
                {SUPER_ADD_FORMS[table].label}
              </Button>
              {addBlocked && !readOnly && <span className="text-xs text-muted-foreground" data-testid={`super-${table}-add-reason`}>{addBlocked}</span>}
            </span>
          ),
```

Immediately before the component's closing `</div>` (`:43`, after `<DataTable … />` and after any dialog QFX-2 rendered there), add:
```tsx
      {adding && (
        <SuperAddRowDialog table={table} network={net}
          onAdd={row => { onChange([...rows, row]); setAdding(false); }}
          onCancel={() => setAdding(false)} />
      )}
```

`SuperDistancesTab.tsx`:
- Import (`:4`): `import type { Row } from "./superTables";` becomes
  ```tsx
  import type { Row } from "./superTables";
  import type { SuperInputsLike } from "@/lib/superNetwork";
  ```
- Props (`:16`): after `plantIds: string[]; warehouseIds: string[]; customerIds: string[];` add
  ```tsx
  /** The whole draft, for the override table's "Add distance override" form. */
  network: SuperInputsLike;
  ```
- Render (`:42`): `<SuperTableTab table="distanceOverrides" rows={p.overrides} readOnly={p.readOnly}` becomes `<SuperTableTab table="distanceOverrides" rows={p.overrides} readOnly={p.readOnly} network={p.network}`.

`pages/Workspace.tsx` (the SM-7 super block, `:3835-3859`). `SuperInputsLike` is already imported at `:78`, and the same cast is already used for the Input Map at `:3391`:
- In `<SuperTableTab …>`, after `options={{ productIds: idsOf("products"), plantIds: idsOf("plants"), customerIds: idsOf("customers") }}` add `network={localInputs as SuperInputsLike}`.
- In `<SuperDistancesTab …>`, after `customerIds={idsOf("customers")}` add `network={localInputs as SuperInputsLike}`.

`onChange` still goes through `updateInputsField(e, rows)` (tables) and `setLocalInputs` patch (distances). An Add therefore only touches the draft, and history-view `readOnly` disables the button.

- [ ] **Step 6: Run the task's tests, expect PASS**
```bash
cd $WT && pnpm --filter studio exec vitest run src/__tests__/superAddForms.test.ts src/__tests__/SuperAddRowDialog.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/SuperDistancesTab.test.tsx src/__tests__/Workspace.Super.test.tsx
pnpm --filter studio run typecheck   # tsc -p tsconfig.json --noEmit (studio package.json:10)
```
- Typecheck must be clean. It is what proves every `<SuperTableTab>`/`<SuperDistancesTab>` render got `network`, and that no `blankRow` import survives.
- Non-vacuity check: temporarily change `if (product > WCP_CAP)` to `if (false)`. The "may reach 50,000 but not exceed it" test must fail. Restore it.
- Then `pnpm gate` with 0 concurrent vitest:
  ```bash
  cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || exit 1
  ```

- [ ] **Step 7: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:
```markdown
### QFX-6 - tab-specific "Add …" forms on super tables

Each super input tab's blank "+ Add row" (empty id, lat/lng 0) is replaced by its own titled form:
- Add product / plant / warehouse / customer / capability / demand / distance override
- `SuperAddRowDialog`, one renderer driven by `SUPER_ADD_FORMS` in the new pure `superAddForms.ts`
- fields come from the table's own `SPECS`/`HEADERS` in `superTables.tsx`, now exported; `blankRow` is deleted

Validation mirrors `validation/inputs/superInputs.ts`:
- trimmed required text; City/State optional and omitted when blank
- signed lat −90..90 / lng −180..180
- capacity, cost/unit, demand and miles finite and ≥ 0, with 0 allowed
- location IDs unique across plants, warehouses and customers; product IDs separately
- no duplicate (plant, product), (customer, product) or (from, to)
- Distances To filtered by From: plant→warehouses, warehouse→customers. A From that can reach nothing is not offered.

Defaults: location ID = `nextFreeId`; warehouse/customer Status `active`.

Button disabled states:
- at the server caps (products 10, plants 20, warehouses 50, customers 500): "Limit reached: at most N <rows>."
- with an empty source: "Add a plant and a product first." / "Add a customer and a product first." / "Add warehouses with plants or customers first."
- an add that would push warehouses × customers × products past 50,000 shows that limit inline and cannot be confirmed

Add appends to the draft only, with no auto-save. `SuperTableTab` and `SuperDistancesTab` gain a required `network` prop (the whole draft). Inside the tab, its own `rows` override `network[table]`.

- Deviation: the `costPerUnit` label is the table header "Cost / unit", so form and column read the same.
- Deviation: studio mirrors `SUPER_CAPS` as constants with a pointer to `superInputs.ts:4`; studio does not depend on api-server.
- Deviation: the Input Map's `SuperEntityDialog` is unchanged. It has its own create/edit flow with per-product demand.
- Tests: `superAddForms.test.ts` and `SuperAddRowDialog.test.tsx` (new); `SuperTableTab` (Add replaces "+ Add row"; source-gate message; own rows drive duplicates; Distances tab button); `SuperDistancesTab` (prop); `Workspace.Super` ("Add plant" appends, no auto-save, row in the Save payload). Non-vacuity: disabling the W×C×P check fails its test.
- E2E: no spec references `super-*-add` or "+ Add row" (grep), so no sibling rewrite.
```

- [ ] **Step 8: Commit**
```bash
cd $WT
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/super/superAddForms.ts artifacts/studio/src/components/workspace/super/SuperAddRowDialog.tsx \
  artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperTableTab.tsx \
  artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/src/__tests__/superAddForms.test.ts artifacts/studio/src/__tests__/SuperAddRowDialog.test.tsx \
  artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx \
  artifacts/studio/src/__tests__/Workspace.Super.test.tsx docs/CHANGELOG-implementation.md
git commit artifacts/studio/src/components/workspace/super/superAddForms.ts artifacts/studio/src/components/workspace/super/SuperAddRowDialog.tsx \
  artifacts/studio/src/components/workspace/super/superTables.tsx artifacts/studio/src/components/workspace/super/SuperTableTab.tsx \
  artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx artifacts/studio/src/pages/Workspace.tsx \
  artifacts/studio/src/__tests__/superAddForms.test.ts artifacts/studio/src/__tests__/SuperAddRowDialog.test.tsx \
  artifacts/studio/src/__tests__/SuperTableTab.test.tsx artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx \
  artifacts/studio/src/__tests__/Workspace.Super.test.tsx docs/CHANGELOG-implementation.md \
  -m "[QFX-6] add tab-specific Add forms to super tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- Grep of `artifacts/studio/e2e/` for `super-[a-zA-Z]*-add`, `Add row` and `blankRow`: **no hits**.
  - `super-model.spec.ts` never clicks a super table's add button.
  - The other "+ Add row" strings in `src/` (`JadeDistancesTab`, `LaneCostsTab`, `LegDistancesTab`, `DeliveryCostsTab`, `DistancesTab`) are chapter-model tabs that QFX-6 does not touch.
- No replacement assertion is needed. The kept test ID `super-<table>-add` means any future spec still finds the button; its text changes from "+ Add row" to the tab label.
- QA (qa-sdet, real browser, spec §2) should drive one Add per tab on the super model. This includes Distances From→To filtering and a Save, followed by a reload to confirm the row persisted.
### Task QFX-3: Solve button at the bottom of Optimization Parameters

> Contract note: honoured exactly. `OptimizationParametersTab` gains `showSolveButton?: boolean; onSolve?: () => void; solveDisabled?: boolean; solveBlockedReason?: string | null`. Workspace computes `superReadinessBlockedReason` and feeds the single shared `solveBlockedReason`.
> Two small deviations, both on purpose:
> 1. `solveDisabled` covers `!currentScenario || isBrowsingHistoryNow || solvePhase !== "idle"`. The fourth early-return condition, `objectiveRequired`, reaches the button through `solveBlockedReason`, which also disables it and shows the hint. The fifth, `solveInFlightRef.current`, is a ref and cannot drive a render. `handleSolve` moves `solvePhase` off `"idle"` in the same click (to `"saving"` or `"solving"`), so `solvePhase` stands in for it.
> 2. `handleSolve`'s own guard changes from `objectiveRequired ||` to `solveBlockedReason != null ||`. The super-readiness block is then enforced inside the handler too, the same defence-in-depth pattern the CH4UX-6 comment describes. Without this, the dialog's disabled button would be the only thing standing in the way.
> Line numbers are from `quick-fixes-spec` before QFX-10/4/7/2/1/6 land. Anchor on the quoted code, not the number.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx:180` (props interface), `:279` (destructure), `:720-730` (render, after the band editor)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:2120-2123` (new `superReadinessBlockedReason` + `solveBlockedReason` after `objectiveRequired`), `:3053-3059` (`handleSolve` guard), `:3361-3364` (`optimizationTabProps`), `:4698` (SolveDialog `solveBlockedReason`)
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`
- Test: `artifacts/studio/src/__tests__/Workspace.test.tsx`
- Test: `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`
- Test: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx`

**Interfaces:**
- Consumes: nothing from other QFX tasks. QFX-1 has already removed the super header Import/Export buttons, so none of the new tests use `super-header-*` test ids. QFX-7 leaves product `name` in place, so `super-products-product-1-name` still exists.
- Produces:
  - `OptimizationParametersTabProps.showSolveButton?: boolean` (default `false`)
  - `onSolve?: () => void`
  - `solveDisabled?: boolean` (default `false`)
  - `solveBlockedReason?: string | null` (default `null`)
  - test ids `button-tab-solve` and `tab-solve-blocked-hint` (both go through `tid()`, so a prefixed instance would read `solve-dialog-button-tab-solve`, but the embedded instance never renders it)
  - In `Workspace.tsx`: `superReadinessBlockedReason: string | null` and `solveBlockedReason: string | null` (render-scope consts)

- [ ] **Step 1: Write the failing component tests.** Append this block at the end of `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`. The file already imports `describe/it/expect/vi`, `screen`, `fireEvent`, and the wrapped `render` / `renderTab` helpers.

```tsx
// QFX-3 — the tab's own Solve button. Opt-in via `showSolveButton`; the Solve
// dialog's embedded copy never passes it (the dialog has its own Solve).
describe("OptimizationParametersTab — Solve button (QFX-3)", () => {
  it("renders no Solve button by default (the embedded Solve-dialog instance)", () => {
    renderTab();
    expect(screen.queryByTestId("button-tab-solve")).not.toBeInTheDocument();
  });

  it("showSolveButton renders a Solve button at the bottom that calls onSolve", () => {
    const onSolve = vi.fn();
    renderTab({ showSolveButton: true, onSolve });
    const btn = screen.getByTestId("button-tab-solve");
    expect(btn).toHaveTextContent("Solve");
    expect(btn).toBeEnabled();
    // last element of the tab: nothing renders after it
    const tab = screen.getByTestId("optimization-parameters-tab");
    expect(tab.lastElementChild).toContainElement(btn);
    fireEvent.click(btn);
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("solveDisabled disables the button with no hint", () => {
    const onSolve = vi.fn();
    renderTab({ showSolveButton: true, onSolve, solveDisabled: true });
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(onSolve).not.toHaveBeenCalled();
  });

  it("a non-null solveBlockedReason disables the button and is shown under it", () => {
    renderTab({ showSolveButton: true, onSolve: vi.fn(), solveBlockedReason: "Blocked for a reason." });
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
    expect(screen.getByTestId("tab-solve-blocked-hint")).toHaveTextContent("Blocked for a reason.");
  });

  it("solveBlockedReason without showSolveButton renders nothing (the dialog shows its own hint)", () => {
    renderTab({ solveBlockedReason: "Blocked for a reason." });
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx
  ```
  - Expected: the 3 tests that look the button up fail with `Unable to find an element by: [data-testid="button-tab-solve"]`.
  - The two "renders nothing" tests pass: they pin the default.
  - TypeScript does not fail vitest. The unknown props are only a `tsc` error.

- [ ] **Step 3: Implement the component.** All three edits are in `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`.

  (a) Props interface. Replace the last member, at `:180`:
  ```ts
    missingRequiredInputs?: string[];
  }
  ```
  with:
  ```ts
    missingRequiredInputs?: string[];
    /** QFX-3 — renders a primary "Solve" button at the bottom of the tab.
     * Only the standalone Optimization Parameters tab passes it; the Solve
     * dialog's embedded copy (max-coverage-us `paramsSlot`) does not, because
     * the dialog has its own Solve. Defaults to false. */
    showSolveButton?: boolean;
    /** QFX-3 — Workspace's `handleSolve` (save-before-solve), called directly;
     * no dialog opens. */
    onSolve?: () => void;
    /** QFX-3 — mirrors `handleSolve`'s early-return conditions (no scenario,
     * browsing history, a solve already in flight). */
    solveDisabled?: boolean;
    /** QFX-3 — the SAME value the Solve dialog gets (Workspace's single
     * `solveBlockedReason`). Non-null: shown under the button, which is
     * disabled. */
    solveBlockedReason?: string | null;
  }
  ```

  (b) Destructure. Replace, at `:279-280`:
  ```ts
    missingRequiredInputs,
  }: OptimizationParametersTabProps) {
  ```
  with:
  ```ts
    missingRequiredInputs,
    showSolveButton = false,
    onSolve,
    solveDisabled = false,
    solveBlockedReason = null,
  }: OptimizationParametersTabProps) {
  ```

  (c) Render. Replace the end of the main return, at `:720-731`:
  ```tsx
        {showBandEditor && (
          <BandChipEditor
            bands={distanceBands}
            onChange={bands => onChange("distanceBands", bands)}
            distanceUnit={distanceUnit}
            canonicalUnit={canonicalUnit}
            testIdPrefix={testIdPrefix}
          />
        )}
      </div>
    );
  }
  ```
  with:
  ```tsx
        {showBandEditor && (
          <BandChipEditor
            bands={distanceBands}
            onChange={bands => onChange("distanceBands", bands)}
            distanceUnit={distanceUnit}
            canonicalUnit={canonicalUnit}
            testIdPrefix={testIdPrefix}
          />
        )}

        {/* QFX-3 — Solve from the tab itself (no dialog). `onSolve` is
            Workspace's handleSolve, so a dirty draft is saved first. */}
        {showSolveButton && (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={onSolve}
              disabled={solveDisabled || !!solveBlockedReason}
              data-testid={tid("button-tab-solve")}
            >
              Solve
            </Button>
            {solveBlockedReason && (
              <p className="text-xs text-muted-foreground" data-testid={tid("tab-solve-blocked-hint")}>
                {solveBlockedReason}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
  ```
  `Button` is already imported at `:1`.

- [ ] **Step 4: Run the component tests, expect PASS.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx
  ```

- [ ] **Step 5: Write the failing Workspace tests for the chapter models.**

  (a) Append at the end of `artifacts/studio/src/__tests__/Workspace.test.tsx`. It reuses the file-level `scenario`, `scenario2`, `pmedianInputs`, `mockUpdateScenario`, `mockSolveScenario`, `updateScenarioResolvesWithPersistedRow`, `renderWorkspace`, and the top-level `beforeEach` that resets the mutate mocks.

```tsx
// QFX-3 — the Optimization Parameters tab's own Solve: handleSolve directly,
// no dialog; disabled on exactly handleSolve's early-return conditions.
describe("Workspace — Optimization Parameters Solve button (QFX-3)", () => {
  it("a clean draft: the tab's Solve enqueues the solve directly, with no dialog", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(screen.queryByTestId("solve-dialog")).not.toBeInTheDocument();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockSolveScenario.mutate.mock.calls[0][0]).toEqual({ scenarioId: 1 });
  });

  it("a dirty draft is saved first (handleSolve's save-before-solve), then solved", () => {
    updateScenarioResolvesWithPersistedRow();
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateScenario.mutate.mock.calls[0][0].data.inputs).toMatchObject({ p: 10 });
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("solve-dialog")).not.toBeInTheDocument();
  });

  it("is disabled while a solve is in flight, so a second click cannot enqueue twice", () => {
    // mutate never calls back: the phase stays "solving".
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
  });

  it("is disabled while browsing an older result", async () => {
    const resultA = {
      status: "optimal" as const, objective: 111, runTimeSec: 0.1, quality: "Proven optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };
    const solvedA = { ...scenario, inputs: { ...pmedianInputs }, result: resultA, stale: false };
    mockUseGetScenario.mockReturnValue({ data: solvedA } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedA, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    const view = renderWorkspace();
    const next = { ...solvedA, result: { ...resultA } };   // new result reference: history appends
    mockUseGetScenario.mockReturnValue({ data: next } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [next, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("button-tab-solve")).toBeEnabled();
    fireEvent.click(await screen.findByTestId("button-result-back"));
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
  });

  it("no super readiness block for a chapter model, even when its precheck has errors", () => {
    mockUsePrecheckScenario.mockReturnValue({ data: { ok: false, errors: [{ code: "x", message: "Something" }] } } as unknown as ReturnType<typeof usePrecheckScenario>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("button-tab-solve")).toBeEnabled();
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
  });
});
```

  (b) In the same file, inside `describe("Workspace — Chen inputs UI (max-coverage-us, C4.12)", …)`, insert these two tests immediately before that describe's closing `});`. That is right after the test "the Solve dialog's own Solve button disables from the same local draft, with the hint, and re-enables on a choice", which ends `expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();\n  });` at about `:3156`. Both tests use that describe's `maxCoverageScenario`, `maxCoverageCoverageInputs`, `renderChen`, `openParamsTab` and `OBJECTIVE_HINT`.

```tsx
  it("QFX-3: the tab's Solve shows the same objective hint and is disabled; choosing re-enables it", () => {
    const { objective: _o, ...noObjective } = maxCoverageCoverageInputs;
    void _o;
    const unselected = { ...maxCoverageScenario, inputs: noObjective };
    mockUseGetScenario.mockReturnValue({ data: unselected } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [unselected] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="max-coverage-us" userEmail="student@example.com" />);
    openParamsTab();
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
    expect(screen.getByTestId("tab-solve-blocked-hint")).toHaveTextContent(OBJECTIVE_HINT);
    fireEvent.click(screen.getByTestId("objective-coverage"));
    expect(screen.getByTestId("button-tab-solve")).toBeEnabled();
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
  });

  it("QFX-3: the Solve dialog's embedded parameters instance shows no extra Solve button", () => {
    renderChen();
    openParamsTab();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("solve-dialog-optimization-parameters-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-button-tab-solve")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("button-tab-solve")).toHaveLength(1);   // the standalone tab behind the dialog only
    expect(screen.getAllByTestId("solve-dialog-solve")).toHaveLength(1);
  });
```

  (c) In `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx`:
  - Add this helper directly after `function runTabCoverage(…) { … }` (it ends at about `:175`):

```tsx
// QFX-3 — the Optimization Parameters tab's own Solve starts a solve (no
// dialog) for this model. The save mock resolves with the persisted row so a
// load-time-normalised (dirty) draft still reaches the enqueue.
function assertTabSolveStartsSolve(scenarioId: number) {
  mockUpdateScenario.mutate.mockImplementation(
    (vars: { data: { inputs: Record<string, unknown> } }, opts: { onSuccess: (u: unknown) => void }) =>
      opts.onSuccess({ id: scenarioId, inputs: vars.data.inputs }),
  );
  fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
  fireEvent.click(screen.getByTestId("button-tab-solve"));
  expect(screen.queryByTestId("solve-dialog")).not.toBeInTheDocument();
  expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
  expect(mockSolveScenario.mutate.mock.calls[0][0]).toEqual({ scenarioId });
}
```

  - Then add one `it` inside each of the seven chapter-model describes, as the last test of that describe. In each, `<model>` is the describe's model id and `solvedScenario` is the describe's own local const:
    - `p-median-us`
    - `transport-coal`
    - `two-echelon-gold-au`
    - `two-echelon-jade-us`
    - `p-median-brazil`
    - `max-coverage-us`
    - `delivery-teaching-us`

    Their fixture objective is `"coverage"`, so `objectiveRequired` is false. The template:

```tsx
  it("QFX-3: the Optimization Parameters tab's Solve starts a solve with no dialog", () => {
    render(<Workspace modelId="<model>" userEmail="student@example.com" />);
    assertTabSolveStartsSolve(solvedScenario.id);
  });
```

  Super is covered in `Workspace.Super.test.tsx` in Step 7.

- [ ] **Step 6: Run them, expect FAIL.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx
  ```
  - Expected: every new test that clicks the button fails with `Unable to find an element by: [data-testid="button-tab-solve"]`.
  - The new chapter-model "no super readiness block" test fails the same way.
  - The embedded-instance test fails at `getAllByTestId("button-tab-solve")`.

- [ ] **Step 7: Write the failing super readiness (L2) tests.** In `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`:
  - Change `:1` to:
    ```ts
    import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
    ```
  - Add this line directly after `import { Workspace } from "@/pages/Workspace";` (`:111`):
    ```ts
    import { usePrecheckScenario, useSolveScenario } from "@workspace/api-client-react";
    ```
  - Append this describe at the end of the file:

```tsx
// QFX-3 (decision L2) — super readiness blocks BOTH Solve buttons through the
// single shared solveBlockedReason, but only while the draft is CLEAN (precheck
// describes the saved row). Loading/failed precheck never blocks.
describe("Workspace — super-model Solve readiness (QFX-3, L2)", () => {
  const BLOCK = "Fix the readiness issues before solving:";
  const mockSolve = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  const withErrors = () =>
    vi.mocked(usePrecheckScenario).mockReturnValue({
      data: { ok: false, errors: [{ code: "noPlants", message: "No plants" }, { code: "zeroDemand", message: "Zero demand" }] },
    } as never);

  beforeEach(() => {
    mockSolve.mutate.mockReset();
    vi.mocked(useSolveScenario).mockReturnValue(mockSolve as never);
  });
  afterEach(() => {
    vi.mocked(usePrecheckScenario).mockReturnValue({ data: { ok: true, errors: [] } } as never);
  });

  it("ready precheck: the tab's Solve enqueues directly, no dialog", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("super-readiness-ok")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(screen.queryByTestId("solve-dialog")).not.toBeInTheDocument();
    expect(mockSolve.mutate).toHaveBeenCalledTimes(1);
    expect(mockSolve.mutate.mock.calls[0][0]).toEqual({ scenarioId: 1 });
  });

  it("clean draft + precheck errors: the tab's Solve is disabled with the block message and the FIRST error", () => {
    withErrors();
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("super-readiness-error-0")).toHaveTextContent("No plants");
    expect(screen.getByTestId("button-tab-solve")).toBeDisabled();
    expect(screen.getByTestId("tab-solve-blocked-hint")).toHaveTextContent(`${BLOCK} No plants`);
    expect(screen.getByTestId("tab-solve-blocked-hint")).not.toHaveTextContent("Zero demand");
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(mockSolve.mutate).not.toHaveBeenCalled();
  });

  it("clean draft + precheck errors: the SolveDialog's Solve is blocked by the same value", () => {
    withErrors();
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));   // header button is unchanged: it still opens the dialog
    expect(screen.getByTestId("solve-dialog-solve")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-blocked-hint")).toHaveTextContent(`${BLOCK} No plants`);
  });

  it("dirty draft: precheck errors do NOT block; Solve saves first (handleSolve)", () => {
    withErrors();
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-tab-solve")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-tab-solve"));
    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateScenario.mutate.mock.calls[0][0].data.inputs.products[0].name).toBe("Renamed");
  });

  it("precheck still loading (no data): does not block", () => {
    vi.mocked(usePrecheckScenario).mockReturnValue({ data: undefined } as never);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("button-tab-solve")).toBeEnabled();
    expect(screen.queryByTestId("tab-solve-blocked-hint")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it, expect FAIL.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/Workspace.Super.test.tsx
  ```
  - Expected: the tab tests fail with `Unable to find an element by: [data-testid="button-tab-solve"]`.
  - The dialog test fails at `expect(...solve-dialog-solve).toBeDisabled()`, because today's dialog only receives the objective hint.

- [ ] **Step 9: Implement in Workspace.** All edits are in `artifacts/studio/src/pages/Workspace.tsx`.

  (a) After `objectiveRequired`. Replace, at `:2120-2123`:
  ```ts
    const objectiveRequired =
      modelId === "max-coverage-us" &&
      localInputs != null &&
      resolveMaxCoverageRun(coverageFloorDemandFromInputs(localInputs), objectiveFromInputs(localInputs)) === null;
  ```
  with:
  ```ts
    const objectiveRequired =
      modelId === "max-coverage-us" &&
      localInputs != null &&
      resolveMaxCoverageRun(coverageFloorDemandFromInputs(localInputs), objectiveFromInputs(localInputs)) === null;

    // QFX-3 (decision L2) — the server precheck SuperReadinessPanel renders
    // also blocks Solve, but only on a CLEAN draft: GET .../precheck validates
    // the SAVED row, so on a dirty draft it describes the wrong inputs —
    // handleSolve saves first and the server stays the enqueue-time authority
    // (precheck refetches after that save). A loading/failed precheck (no
    // data) never blocks.
    const superReadinessBlockedReason =
      modelId === "super-model" && !ordinaryDirty && precheck && precheck.errors.length > 0
        ? `Fix the readiness issues before solving: ${precheck.errors[0].message}`
        : null;
    // The ONE blocked reason both Solve buttons read (the tab's and
    // SolveDialog's). The max-coverage objective hint keeps priority; only
    // max-coverage-us can produce it, so the two never collide in practice.
    const solveBlockedReason = objectiveRequired ? OBJECTIVE_REQUIRED_HINT : superReadinessBlockedReason;
  ```
  `precheck` is declared at `:1561`, `ordinaryDirty` at `:1939`, and `OBJECTIVE_REQUIRED_HINT` at module scope `:306`, so all three are in scope here.

  (b) `handleSolve` guard. Replace, at `:3053-3059`:
  ```ts
      if (
        objectiveRequired ||
        !currentScenario ||
  ```
  with:
  ```ts
      if (
        // QFX-3 — the shared blocked reason (objective hint OR super readiness),
        // enforced here as well as on both buttons.
        solveBlockedReason != null ||
        !currentScenario ||
  ```

  (c) Standalone tab props. Replace, at `:3360-3364`:
  ```ts
    // The tab follows what the student is LOOKING AT.
    const optimizationTabProps: OptimizationParametersTabProps | null =
      optimizationParamsBaseProps && {
        ...optimizationParamsBaseProps,
      };
  ```
  with:
  ```ts
    // The tab follows what the student is LOOKING AT.
    // QFX-3 — the Solve button is standalone-tab ONLY (deliberately not in the
    // shared base object): the dialog's embedded copy has the dialog's Solve.
    // `solveDisabled` mirrors handleSolve's early returns; the in-flight ref
    // is covered by `solvePhase`, which handleSolve moves off "idle" in the
    // same click, and `objectiveRequired` arrives via `solveBlockedReason`.
    const optimizationTabProps: OptimizationParametersTabProps | null =
      optimizationParamsBaseProps && {
        ...optimizationParamsBaseProps,
        showSolveButton: true,
        onSolve: handleSolve,
        solveDisabled: !currentScenario || isBrowsingHistoryNow || solvePhase !== "idle",
        solveBlockedReason,
      };
  ```
  `solveDialogParamsProps` (the next const) stays unchanged, so the embedded instance never gets `showSolveButton`.

  (d) SolveDialog. Replace, at `:4698`:
  ```tsx
          solveBlockedReason={objectiveRequired ? OBJECTIVE_REQUIRED_HINT : null}
  ```
  with:
  ```tsx
          solveBlockedReason={solveBlockedReason}
  ```

  Leave the header Run Optimizer at `:4532-4540` alone: it keeps opening `SolveDialog` (user decision) and keeps its own `objectiveRequired` disable.
  - **Do not** write the text `modelId === "max-coverage-us" ?` followed by a number anywhere. The MIG-8 source-grep test in `Workspace.test.tsx` counts every such occurrence.

- [ ] **Step 10: Run the task's tests, expect PASS.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/Workspace.Super.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx src/__tests__/SolveDialog.test.tsx
  pnpm run typecheck
  ```
  Then run `pnpm gate` with 0 concurrent vitest processes (root CLAUDE.md flake rule).

- [ ] **Step 11: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-3 - Solve button at the bottom of Optimization Parameters

`OptimizationParametersTab` gains `showSolveButton` / `onSolve` / `solveDisabled` / `solveBlockedReason`; a primary "Solve" (`button-tab-solve`, hint `tab-solve-blocked-hint`) renders at the bottom of the tab. Workspace passes them on the standalone tab only (`optimizationTabProps`, not the shared base object), so the max-coverage `paramsSlot` copy inside SolveDialog shows no extra button. `onSolve={handleSolve}` (save-before-solve, no dialog); `solveDisabled` = no scenario / browsing history / `solvePhase !== "idle"` (the in-flight ref is covered by the phase; `objectiveRequired` arrives via the blocked reason). Decision L2: new `superReadinessBlockedReason` = "Fix the readiness issues before solving:" + the first `precheck.errors` message, only when the super draft is clean (`ordinaryDirty` false) and precheck has data; it feeds the single `solveBlockedReason` (objective hint first) that disables both the tab Solve and SolveDialog's Solve, and `handleSolve`'s guard now checks `solveBlockedReason` instead of `objectiveRequired` alone. Header Run Optimizer unchanged. Tests: component (OptimizationParametersTab.test), p-median clean/dirty/in-flight/history + max-coverage hint + embedded-instance (Workspace.test), one tab-Solve test per chapter model (Workspace.TabCoverage.test), super ready/blocked-tab/blocked-dialog/dirty/loading (Workspace.Super.test).
```

- [ ] **Step 12: Commit.**
  ```bash
  [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
  git add artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx docs/CHANGELOG-implementation.md
  git commit artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx docs/CHANGELOG-implementation.md -m "[QFX-3] add Solve button to Optimization Parameters; super readiness blocks Solve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

**E2E / sibling-spec impact (QFX-3):**
- No existing `artifacts/studio/e2e/*.spec.ts` line asserts a test id or string this task changes. I grepped `e2e/` for `button-tab-solve`, `tab-solve`, `solve-dialog-blocked-hint`, `name: "Solve"`, `text=Solve` and `hasText: "Solve"`, with no hits.
- `e2e/super-model.spec.ts:164` asserts `super-readiness-ok`, then clicks `solve-dialog-solve` at `:182`. Readiness is OK there, so the dialog Solve stays enabled. No change.
- Specs that wait for `optimization-parameters-tab` only check that it is visible. The new button adds one child but changes no test id. Those specs are:
  - `workspace-fixups-2.spec.ts:662`
  - `nonjade-servicestats-live-coverage.spec.ts:248,344,447`
  - `jade-ch9-workspace-bundle.spec.ts:308,628,645`
  - `two-echelon.spec.ts:169`
- Real-browser QA (spec §2, qa-sdet) should cover two things:
  - On the super model with a readiness error, the tab Solve and the dialog Solve are both disabled with the hint.
  - On a dirty draft, the tab Solve saves and then solves, with no dialog.

---

### Task QFX-5: Chapter 5 — % demand within each distance band

> Spec check: Compare does **not** exclude Ch.5. The band-row block (`CostSummaryTab.tsx:830-853`) is gated only on `scenariosShareBands(results)`, never on `modelId`. So the Compare half of this item is a pinning test, which is expected to PASS before the change and keep passing after the shared-helper refactor. No Compare fix is needed.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx:76` (new `DELIVERY_MODEL_ID` const), `:474` (shared band helpers before `if (!compareMode)`), `:553-558` (single-view band rows before "Runtime"), `:833-839` (Compare uses the shared helpers)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`

**Interfaces:**
- Consumes: nothing from other QFX tasks. QFX-2 may have added an `xlsx` entry to the `DownloadMenu` `itemTestIds` in this file; this task does not touch those lines.
- Produces:
  - Single-view row test ids `cost-summary-band-${band}`. The overflow row is `cost-summary-band--1`, mirroring Compare's `cost-summary-compare-band-${band}-${id}`.
  - Component-local helpers `bandRowLabels(boundaries)` and `exclusiveBands(result)`, which the single view and Compare both use.

- [ ] **Step 1: Write the tests.** Append at the end of `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`. It uses the file-level `result`, `scenario()`, `compareToggle()`, `render`, `cleanup`, `UnitProvider`, `ExportProvider`, `makeExportProviderValue`, and `CostSummaryTab` imports. The `mockUseListModels` fixture already lists `delivery-teaching-us` with `distanceUnit: "mi"`.

```tsx
// QFX-5 — Chapter 5's single-scenario summary shows % of demand within each
// distance band (+ overflow), built by the SAME helpers as Compare's band rows.
// solve.py freezes CUMULATIVE bandCoverage for delivery; the rows are exclusive.
describe("CostSummaryTab — Chapter 5 band rows (QFX-5)", () => {
  const wrap = (ui: React.ReactElement) =>
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}>{ui}</ExportProvider></UnitProvider>);
  const ch5 = (bandCoverage: Array<{ band: number; percent: number }>) => ({
    ...result,
    details: { objective: "base" },
    metrics: { weightedAvgDistance: 422.5511, bandCoverage },
  });
  // cumulative 40.5 / 80.25 / 95 / 100 -> exclusive 40.5 / 39.75 / 14.75 / 5 / overflow 0
  const r1 = ch5([{ band: 400, percent: 40.5 }, { band: 800, percent: 80.25 }, { band: 1200, percent: 95 }, { band: 1600, percent: 100 }]);
  // -> 50 / 40 / 10 / 0 / 0
  const r2 = ch5([{ band: 400, percent: 50 }, { band: 800, percent: 90 }, { band: 1200, percent: 100 }, { band: 1600, percent: 100 }]);
  // -> 10 / 10 / 10 / 10 / overflow 60
  const r3 = ch5([{ band: 400, percent: 10 }, { band: 800, percent: 20 }, { band: 1200, percent: 30 }, { band: 1600, percent: 40 }]);
  const BANDS = [400, 800, 1200, 1600, -1];
  const d1 = scenario({ id: 60, name: "Delivery A", modelId: "delivery-teaching-us", result: r1 });
  const d2 = scenario({ id: 61, name: "Delivery B", modelId: "delivery-teaching-us", result: r2 });
  const d3 = scenario({ id: 62, name: "Delivery C", modelId: "delivery-teaching-us", result: r3 });
  const labelOf = (el: HTMLElement) => el.closest("tr")!.querySelector("td")!.textContent;

  it("single view: one exclusive % row per band plus overflow, labelled like Compare", () => {
    wrap(<CostSummaryTab result={r1} scenarioId={60} modelId="delivery-teaching-us" />);
    expect(BANDS.map(b => screen.getByTestId(`cost-summary-band-${b}`).textContent)).toEqual(["40.5%", "39.75%", "14.75%", "5%", "0%"]);
    expect(BANDS.map(b => labelOf(screen.getByTestId(`cost-summary-band-${b}`)))).toEqual([
      "0–400 mi", "400–800 mi", "800–1,200 mi", "1,200–1,600 mi", "> 1,600 mi",
    ]);
    // raw cumulative values are never shown
    expect(screen.queryByText("80.25%")).not.toBeInTheDocument();
  });

  it("single view rows equal Compare's column for the same result", () => {
    wrap(<CostSummaryTab result={r1} scenarioId={60} modelId="delivery-teaching-us" />);
    const single = BANDS.map(b => {
      const el = screen.getByTestId(`cost-summary-band-${b}`);
      return [labelOf(el), el.textContent];
    });
    cleanup();
    wrap(<CostSummaryTab result={r1} scenarioId={60} modelId="delivery-teaching-us" scenarios={[d1, d2]} />);
    fireEvent.click(compareToggle("cost-summary-compare-toggle-61").querySelector("input")!);
    const compare = BANDS.map(b => {
      const el = screen.getByTestId(`cost-summary-compare-band-${b}-60`);
      return [labelOf(el), el.textContent];
    });
    expect(single).toEqual(compare);
  });

  it("no band rows for a Ch.5 result without bandCoverage, nor for another model's single view", () => {
    wrap(<CostSummaryTab result={{ ...r1, metrics: { weightedAvgDistance: 422.5511 } }} scenarioId={60} modelId="delivery-teaching-us" />);
    expect(document.querySelector('[data-testid^="cost-summary-band-"]')).toBeNull();
    cleanup();
    wrap(<CostSummaryTab result={{ ...result, metrics: { weightedAvgDistance: 1, bandCoverage: [{ band: 200, percent: 40 }] } }} scenarioId={1} modelId="p-median-us" />);
    expect(screen.queryByTestId("cost-summary-band-200")).not.toBeInTheDocument();
  });

  // Spec: "verify Compare renders Ch.5 band rows for 2+ shared-band scenarios".
  // Pins existing behaviour (Compare's band block is gated on shared bands only,
  // never modelId) — expected to pass before AND after this task.
  it("Compare of three shared-band Ch.5 scenarios shows the band rows per column", () => {
    wrap(<CostSummaryTab result={r1} scenarioId={60} modelId="delivery-teaching-us" scenarios={[d1, d2, d3]} />);
    fireEvent.click(compareToggle("cost-summary-compare-toggle-61").querySelector("input")!);
    fireEvent.click(compareToggle("cost-summary-compare-toggle-62").querySelector("input")!);
    const col = (id: number) => BANDS.map(b => screen.getByTestId(`cost-summary-compare-band-${b}-${id}`).textContent);
    expect(col(60)).toEqual(["40.5%", "39.75%", "14.75%", "5%", "0%"]);
    expect(col(61)).toEqual(["50%", "40%", "10%", "0%", "0%"]);
    expect(col(62)).toEqual(["10%", "10%", "10%", "10%", "60%"]);
    expect(screen.queryByTestId("cost-summary-compare-bands-note")).not.toBeInTheDocument();
  });

  it("Compare of Ch.5 scenarios with differing boundaries keeps today's behaviour (rows omitted, note shown)", () => {
    const dOther = scenario({ id: 63, name: "Delivery D", modelId: "delivery-teaching-us", result: ch5([{ band: 500, percent: 70 }]) });
    wrap(<CostSummaryTab result={r1} scenarioId={60} modelId="delivery-teaching-us" scenarios={[d1, dOther]} />);
    fireEvent.click(compareToggle("cost-summary-compare-toggle-63").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-band-400-60")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-bands-note")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it.** The two single-view tests FAIL; the Compare tests PASS.
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx
  ```
  - Expected failures: "single view: one exclusive % row…" and "single view rows equal Compare's…" both fail with `Unable to find an element by: [data-testid="cost-summary-band-400"]`.
  - The three other new tests pass. That confirms Compare already includes Ch.5, so no Compare fix is needed.

- [ ] **Step 3: Implement.** All edits are in `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`.

  (a) Model id const. Replace, at `:76`:
  ```ts
  const MAX_COVERAGE_MODEL_ID = "max-coverage-us";
  ```
  with:
  ```ts
  const MAX_COVERAGE_MODEL_ID = "max-coverage-us";
  const DELIVERY_MODEL_ID = "delivery-teaching-us";
  ```

  (b) Shared helpers. Replace, at `:475`:
  ```ts
    if (!compareMode) {
  ```
  with:
  ```ts
    // QFX-5 — the ONE band-row builder (labels + exclusive percentages), used by
    // the Chapter 5 single view AND Compare, so the two views cannot disagree.
    // Never reads raw (cumulative) bandCoverage for display.
    const bandRowLabels = (boundaries: number[]): string[] =>
      unitLabel == null
        ? [...boundaries, OVERFLOW_BAND].map(() => "—")
        : exclusiveBandLabels(boundaries, v => unit.toDisplay(v, canonicalDistanceUnit!), unitLabel);
    const exclusiveBands = (r: SolveResult) =>
      frozenBandCoverageToExclusive(r.metrics.bandCoverage, bandDecimals(modelId), frozenBandShape(modelId));

    if (!compareMode) {
  ```

  (c) Single-view rows, placed after the distance row and before Runtime. Replace, at `:553-558`:
  ```ts
      if (!isSuper) rows.push(
        [showCoverageRows ? "Avg distance to customers" : "Weighted avg. distance",
         noIncumbent ? "—" : formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit), true],
      );
      rows.push(
        ["Runtime", `${result.runTimeSec.toFixed(2)}s`, true],
  ```
  with:
  ```ts
      if (!isSuper) rows.push(
        [showCoverageRows ? "Avg distance to customers" : "Weighted avg. distance",
         noIncumbent ? "—" : formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit), true],
      );
      // QFX-5 — Chapter 5's % of demand within each distance band, one row per
      // band plus overflow (Ch.5 has no capacity, so "% demand served" would
      // always read 100%). Skipped while the unit is unresolved: every label
      // would be "—", and the DataTable's rowKey is the label.
      const ch5Boundaries = modelId === DELIVERY_MODEL_ID && unitLabel != null ? bandBoundaries(result) : [];
      if (ch5Boundaries.length > 0) {
        const labels = bandRowLabels(ch5Boundaries);
        const exclusive = exclusiveBands(result);
        [...ch5Boundaries, OVERFLOW_BAND].forEach((band, i) => {
          const coverage = exclusive?.find(b => b.band === band);
          rows.push([labels[i], coverage ? `${coverage.percent}%` : "—", true, `cost-summary-band-${band}`]);
        });
      }
      rows.push(
        ["Runtime", `${result.runTimeSec.toFixed(2)}s`, true],
  ```

  (d) Compare uses the shared helpers. Replace, at `:833-839`:
  ```ts
      const boundaries = bandBoundaries(results[0]);
      const labels = unitLabel == null
        ? [...boundaries, OVERFLOW_BAND].map(() => "—")
        : exclusiveBandLabels(boundaries, v => unit.toDisplay(v, canonicalDistanceUnit!), unitLabel);
      const exclusiveByColumn = compareScenarios.map(s =>
        frozenBandCoverageToExclusive(s.result!.metrics.bandCoverage, bandDecimals(modelId), frozenBandShape(modelId)),
      );
  ```
  with:
  ```ts
      const boundaries = bandBoundaries(results[0]);
      const labels = bandRowLabels(boundaries);
      const exclusiveByColumn = compareScenarios.map(s => exclusiveBands(s.result!));
  ```
  - The imports at `:12` (`OVERFLOW_BAND`, `bandDecimals`, `exclusiveBandLabels`, `frozenBandCoverageToExclusive`, `frozenBandShape`) are all still used.
  - `SolveResult` is already imported at `:2`.
  - The existing stale badge is Workspace-level and covers this tab unchanged.

- [ ] **Step 4: Run the task's tests, expect PASS.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/CostSummaryTab.Super.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx
  pnpm run typecheck
  ```
  The existing Compare band tests at `CostSummaryTab.test.tsx:905-929` must still pass, which proves the refactor kept Compare's behaviour. Then run `pnpm gate` with 0 concurrent vitest processes.

- [ ] **Step 5: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-5 - Chapter 5: % demand within each distance band

`CostSummaryTab.tsx`: the `delivery-teaching-us` single-scenario summary gains one row per distance band plus the overflow row (test ids `cost-summary-band-${band}`, overflow `cost-summary-band--1`), inserted after Weighted avg. distance. Values are EXCLUSIVE % of demand from solve.py's frozen cumulative `metrics.bandCoverage`, via two component-local helpers now shared with Compare — `bandRowLabels` (`exclusiveBandLabels`) and `exclusiveBands` (`frozenBandCoverageToExclusive(…, bandDecimals, frozenBandShape)`) — so the single view and Compare cannot disagree (test asserts equality). Rows are skipped while the canonical unit is unresolved (labels would all be "—", and the label is the DataTable row key). Compare was verified, not changed: its band block is gated only on shared boundaries, never modelId, so Ch.5 already rendered; a 3-scenario pinning test and a differing-boundaries test were added. The server-side costSummary export (Download) is unchanged and does not carry the band rows.
```

- [ ] **Step 6: Commit.**
  ```bash
  [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
  git add artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx docs/CHANGELOG-implementation.md
  git commit artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx docs/CHANGELOG-implementation.md -m "[QFX-5] show Chapter 5 distance-band demand % in the single-scenario summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

**E2E / sibling-spec impact (QFX-5):**
- `e2e/delivery-teaching.spec.ts:211-212` asserts only `cost-summary-value-weighted-avg-distance` "422.6 mi". That test id is unchanged, so the spec needs no change.
- `e2e/workspace-ux-r1-r9.spec.ts:267` counts compare `tbody tr` dynamically and feeds that count to the download check. Compare's row set is unchanged, so there is no impact.
- No spec counts the single-view `cost-summary-list` rows for Ch.5 (grepped `e2e/` for `cost-summary`).
- Optional real-browser QA: on a solved Ch.5 scenario, the band rows appear in Solution Summary and match the Compare column for the same scenario.
### Task QFX-8: Output map caption — up to 5 open site labels

**Role:** frontend-engineer (invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code).

> **CONTRACT deviation: `openSiteIds` returns `string[] | null`, not `string[]`.** The narrative tells "field absent or malformed" apart from "opened nothing". With an absent field it returns no narrative at all: `resultNarrative.ts:116` for super-model, `:153` for the rest, and the test at `__tests__/resultNarrative.test.ts:149-150` (`details: {}` + `openFacilityIds: undefined` → `toBeNull()`). If the helper returned `[]` for an absent field, that p-median case would get as far as `text("Open .", …)` and break the behaviour-preservation requirement. `null` is the minimum signature that keeps one authority. The caption reads it as `?? []`.

**Spec facts checked against the code:**
- **Output map mount.** The output map is mounted in one place for all 8 models: `Workspace.tsx:4154` → `OutputMapTab` → `NetworkMap`.
- **Stale/unsolved banner.** The stale/unsolved banner returns at `Workspace.tsx:4090-4092`, before `OutputMapTab` mounts. If the caption lives inside `OutputMapTab`, it cannot render on the banner. Existing `Workspace.StaleOutputs.test.tsx:209` already asserts `output-map-tab` is absent there.
- **Identity source.** `OutputMapTab` already receives `identityById={outputIdentityById}` (`Workspace.tsx:4223`). That map comes from `buildEntityIdentityById(modelId, dataset, activeOutputInputs)` (`Workspace.tsx:1894-1897`) and maps canonical id → `{ displayId, city, state }`. It covers every model:
  - base rows
  - `added*` rows, where `displayId` is the `displayCode`
  - super-model's scenario-owned plants/warehouses/customers
  - transport-coal mines, which are `dataset.warehouses`
  - gold-au refineries

  The caption needs no new data plumbing.
- **Open-site fields.** JADE (`solve.py:1367,1379`) and super-model (`solve.py:1912-1915`) emit **both** `details.openWarehouseIds` and `metrics.openFacilityIds` with the same ids. So the narrative's existing rule ("super-model → metrics; everyone else → details ?? metrics") is the authority, and it is extracted unchanged.
- **"Failed" results.** Workspace mounts the map whenever `result != null && !stale` (`Workspace.tsx:1583`), so an infeasible result does reach `OutputMapTab`. The tab's own `showIncumbent` gate (`OutputMapTab.tsx:218-219`) is what keeps the caption off a failed result. The existing infeasible test fixture spreads `result` and still carries `details.openWarehouseIds: ["W1"]`, so the gate does real work.
- **Sort key.** The spec says "ascending ID, numeric-aware". The sort uses the **displayed** id (`displayId`, the text that starts each label) with `localeCompare(…, { numeric: true })`. For base rows this equals the canonical id. For added rows it sorts by the code the student sees, not the internal `aw-…` uid.

**Files:**
- Create: `artifacts/studio/src/lib/openSites.ts`
- Modify: `artifacts/studio/src/lib/resultNarrative.ts:1-3` (import), `:46-48` (delete `stringIds`), `:115`, `:152`
- Create: `artifacts/studio/src/components/workspace/OpenSitesCaption.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx:18` (import), `:392` (mount the caption between `FloorExceedsMaxAlert` and the map container)
- Test (new): `artifacts/studio/src/__tests__/openSites.test.ts`
- Test (new): `artifacts/studio/src/__tests__/OpenSitesCaption.test.tsx`
- Test (append): `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`
- Test (append): `artifacts/studio/src/__tests__/Workspace.OutputMap.test.tsx`
- Test (unchanged, must stay green): `artifacts/studio/src/__tests__/resultNarrative.test.ts`

**Interfaces:**
- Consumes: none from other QFX tasks. QFX-3/5/9 do not touch these files.
- Produces:
  - `lib/openSites.ts`:
    - `export function openSiteIds(result: unknown, modelId: string): string[] | null`
    - `export const OPEN_SITE_NOUN: Record<string, string>`
    - `export const OPEN_SITE_NOUN_FALLBACK = "Open sites"`
  - `components/workspace/OpenSitesCaption.tsx`: `export function OpenSitesCaption(props: { result: SolveResult | null; modelId?: string; identityById: Record<string, EntityIdentity> })`
  - Test ids: `output-map-open-sites` (the caption `<p>`) and `output-map-open-sites-toggle` (the "+N more" / "Show fewer" button).

- [ ] **Step 1: Write the failing tests.**

`artifacts/studio/src/__tests__/openSites.test.ts` (new):

```ts
// QFX-8 — openSiteIds is the ONE per-model open-site authority shared by the
// Output Map narrative and its caption. Real envelopes from the narrative
// fixtures (and the super-model fixture) so the per-model field choice is
// checked against what solve.py actually emits.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { OPEN_SITE_NOUN, OPEN_SITE_NOUN_FALLBACK, openSiteIds } from "@/lib/openSites";

const narrative = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/narrative", `${name}.json`), "utf8")).result;
const superResult = (): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/superResult.json"), "utf8"));

describe("openSiteIds — per-model authority (real envelopes)", () => {
  it.each([
    { modelId: "p-median-us", file: "p-median-us", expected: ["BAL", "DAL", "LA"] },
    { modelId: "max-coverage-us", file: "max-coverage-us-coverage", expected: ["DAL", "LA", "PIT"] },
    { modelId: "delivery-teaching-us", file: "delivery-teaching-us", expected: ["W1", "W2", "W60"] },
    { modelId: "p-median-brazil", file: "p-median-brazil-VARIANT-singleSource-false", expected: ["BEL", "BET", "JDF", "PGR", "REC", "SSA", "STS"] },
    // details.openWarehouseIds holds MINES for transport-coal (solve.py:687).
    { modelId: "transport-coal", file: "transport-coal", expected: ["KY", "WY", "PA", "IA"] },
    { modelId: "two-echelon-gold-au", file: "two-echelon-gold-au", expected: ["cunnamulla"] },
    { modelId: "two-echelon-jade-us", file: "two-echelon-jade-us", expected: ["wh-16", "wh-44", "wh-60"] },
  ])("$modelId", ({ modelId, file, expected }) => {
    expect(openSiteIds(narrative(file), modelId)).toEqual(expected);
  });

  it("super-model reads its real envelope", () => {
    expect(openSiteIds(superResult(), "super-model")).toEqual(["wh-11", "wh-14"]);
  });

  it("an infeasible envelope that genuinely opened nothing is [], not null", () => {
    expect(openSiteIds(narrative("p-median-brazil"), "p-median-brazil")).toEqual([]);
  });
});

describe("openSiteIds — field precedence", () => {
  it("super-model: metrics.openFacilityIds wins even when details disagrees", () => {
    expect(openSiteIds({ metrics: { openFacilityIds: ["w2"] }, details: { openWarehouseIds: ["w9"] } }, "super-model")).toEqual(["w2"]);
  });

  it("super-model never falls back to details.openWarehouseIds", () => {
    expect(openSiteIds({ metrics: {}, details: { openWarehouseIds: ["w9"] } }, "super-model")).toBeNull();
  });

  it("every other model: details.openWarehouseIds, else metrics.openFacilityIds", () => {
    expect(openSiteIds({ metrics: { openFacilityIds: ["b"] }, details: { openWarehouseIds: ["a"] } }, "two-echelon-jade-us")).toEqual(["a"]);
    expect(openSiteIds({ metrics: { openFacilityIds: ["b"] }, details: {} }, "two-echelon-jade-us")).toEqual(["b"]);
  });

  it("absent or malformed fields are null (the narrative then renders nothing)", () => {
    expect(openSiteIds({ metrics: {}, details: {} }, "p-median-us")).toBeNull();
    expect(openSiteIds({ metrics: {}, details: { openWarehouseIds: [1, 2] } }, "p-median-us")).toBeNull();
    expect(openSiteIds(null, "p-median-us")).toBeNull();
    expect(openSiteIds("not a result", "p-median-us")).toBeNull();
  });
});

describe("OPEN_SITE_NOUN (decision L3)", () => {
  it("names every model's open sites", () => {
    expect(OPEN_SITE_NOUN).toEqual({
      "p-median-us": "Open warehouses",
      "p-median-brazil": "Open warehouses",
      "max-coverage-us": "Open warehouses",
      "delivery-teaching-us": "Open warehouses",
      "transport-coal": "Open mines",
      "two-echelon-gold-au": "Open facilities",
      "two-echelon-jade-us": "Open facilities",
      "super-model": "Open facilities",
    });
    expect(OPEN_SITE_NOUN_FALLBACK).toBe("Open sites");
  });
});
```

`artifacts/studio/src/__tests__/OpenSitesCaption.test.tsx` (new):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SolveResult } from "@workspace/api-client-react";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { OpenSitesCaption } from "@/components/workspace/OpenSitesCaption";

// QFX-8 — the one-line caption above the Output Map.
const res = (details: Record<string, unknown>, metrics: Record<string, unknown> = {}): SolveResult =>
  ({ status: "optimal", objective: 1, edges: [], metrics, details }) as unknown as SolveResult;

const sevenIds = ["W10", "W2", "W7", "W1", "W3", "W30", "W4"];
const identity = (ids: string[]): Record<string, EntityIdentity> =>
  Object.fromEntries(ids.map(id => [id, { displayId: id, city: `City${id}`, state: "TX" }]));

describe("OpenSitesCaption — ordering and +N more", () => {
  it("lists the first five in ascending numeric-aware id order, then '+N more'", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: sevenIds })} modelId="p-median-us" identityById={identity(sevenIds)} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(
      "Open warehouses: W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W7 · CityW7, TX +2 more",
    );
    expect(screen.getByTestId("output-map-open-sites-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("'+N more' expands to the full list and 'Show fewer' collapses it", async () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: sevenIds })} modelId="p-median-us" identityById={identity(sevenIds)} />);
    await userEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(
      "Open warehouses: W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W7 · CityW7, TX, W10 · CityW10, TX, W30 · CityW30, TX Show fewer",
    );
    expect(screen.getByTestId("output-map-open-sites-toggle")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getByTestId("output-map-open-sites")).toHaveTextContent("W7 · CityW7, TX +2 more");
    expect(screen.getByTestId("output-map-open-sites")).not.toHaveTextContent("W10");
  });

  it("five or fewer sites: all listed, no toggle", () => {
    const five = ["W5", "W4", "W3", "W2", "W1"];
    render(<OpenSitesCaption result={res({ openWarehouseIds: five })} modelId="p-median-us" identityById={identity(five)} />);
    expect(screen.getByTestId("output-map-open-sites")).toHaveTextContent("W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W5 · CityW5, TX");
    expect(screen.queryByTestId("output-map-open-sites-toggle")).not.toBeInTheDocument();
  });
});

describe("OpenSitesCaption — labels", () => {
  it("uses the identity's displayId (an added row's display code), and just the id when city and state are empty", () => {
    render(
      <OpenSitesCaption
        result={res({ openWarehouseIds: ["aw-123", "W1"] })}
        modelId="p-median-us"
        identityById={{ "aw-123": { displayId: "W99", city: "", state: "" }, W1: { displayId: "W1", city: "Dallas", state: "TX" } }}
      />,
    );
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: W1 · Dallas, TX, W99");
  });

  it("an id with no identity entry is shown raw", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["X7"] })} modelId="p-median-us" identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: X7");
  });

  it("a blank state falls back to the city alone (formatCityState)", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["W1"] })} modelId="p-median-us" identityById={{ W1: { displayId: "W1", city: "Dallas", state: "" } }} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: W1 · Dallas");
  });
});

describe("OpenSitesCaption — noun per model and source field", () => {
  it.each([
    ["p-median-us", "Open warehouses"],
    ["p-median-brazil", "Open warehouses"],
    ["max-coverage-us", "Open warehouses"],
    ["delivery-teaching-us", "Open warehouses"],
    ["transport-coal", "Open mines"],
    ["two-echelon-gold-au", "Open facilities"],
    ["two-echelon-jade-us", "Open facilities"],
    ["super-model", "Open facilities"],
    ["some-future-model", "Open sites"],
  ])("%s -> %s", (modelId, noun) => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["A"] }, { openFacilityIds: ["A"] })} modelId={modelId} identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(`${noun}: A`);
  });

  it("no modelId falls back to 'Open sites'", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["A"] })} identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open sites: A");
  });

  it("super-model names metrics.openFacilityIds, not details", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["wh-9"] }, { openFacilityIds: ["wh-2"] })} modelId="super-model" identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open facilities: wh-2");
  });
});

describe("OpenSitesCaption — hidden", () => {
  it("renders nothing for zero open sites", () => {
    const { container } = render(<OpenSitesCaption result={res({ openWarehouseIds: [] })} modelId="p-median-us" identityById={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a result", () => {
    const { container } = render(<OpenSitesCaption result={null} modelId="p-median-us" identityById={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to the end of `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`. It reuses the file's top-level `dataset`/`result` fixtures and its `render` wrapper:

```tsx
// QFX-8 — the open-sites caption sits directly ABOVE the map, outside the
// captured map node, and only for a result with an incumbent.
describe("OutputMapTab — open-sites caption (QFX-8)", () => {
  it("renders the caption above the map for a solved result", () => {
    const { container } = render(
      <OutputMapTab
        dataset={dataset} warehouseStatuses={[]} result={result} bands={[]} modelId="p-median-us"
        identityById={{ W1: { city: "Testville", state: "TS", displayId: "W1" } }}
      />,
    );
    const caption = screen.getByTestId("output-map-open-sites");
    expect(caption.textContent).toBe("Open warehouses: W1 · Testville, TS");
    const map = container.querySelector(".leaflet-container")!;
    expect(map.contains(caption)).toBe(false);
    expect(caption.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no caption pre-solve (input network only)", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[]} modelId="p-median-us" />);
    expect(screen.queryByTestId("output-map-open-sites")).not.toBeInTheDocument();
  });

  it("no caption for a failed result, even though its details still list W1", () => {
    const failed = { ...result, status: "infeasible" as const, solutionStatus: "infeasible" as const, objective: 0, edges: [] };
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={failed} bands={[]} modelId="p-median-us" />);
    expect(screen.getByTestId("output-map-no-incumbent")).toBeInTheDocument();
    expect(screen.queryByTestId("output-map-open-sites")).not.toBeInTheDocument();
  });
});
```

Append to the end of `artifacts/studio/src/__tests__/Workspace.OutputMap.test.tsx`. Earlier tests in this file leave `mockReturnValue` overrides in place, because `vi.clearAllMocks` keeps implementations. So this test pins its own fixtures:

```tsx
// QFX-8 — Workspace wires the SOLVED identity map into the caption.
// (The stale/unsolved banner returns before OutputMapTab mounts —
// Workspace.tsx:4090-4092 — so the caption cannot render there; that branch is
// already covered by Workspace.StaleOutputs.test.tsx's output-map-tab-absent
// assertion.)
describe("Workspace — Output Map open-sites caption (QFX-8)", () => {
  it("names the solved result's open warehouse above the map", () => {
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: CHI · Chicago, IL");
  });
});
```

- [ ] **Step 2: Run them, expect FAIL**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-8
pnpm --filter studio exec vitest run src/__tests__/openSites.test.ts src/__tests__/OpenSitesCaption.test.tsx src/__tests__/OutputMapTab.test.tsx src/__tests__/Workspace.OutputMap.test.tsx
```

Expected failures:
- `openSites.test.ts` and `OpenSitesCaption.test.tsx`: `Failed to resolve import "@/lib/openSites"` / `"@/components/workspace/OpenSitesCaption"`.
- The 2 new `OutputMapTab` caption-present tests and the new `Workspace` test: `Unable to find an element by: [data-testid="output-map-open-sites"]`.
- The two "no caption" tests pass vacuously at this point. That is fine: they guard the gate once the caption exists.

- [ ] **Step 3: Implement `lib/openSites.ts`** (new file)

```ts
// QFX-8 — the ONE per-model authority for "which sites did this solve open",
// shared by the Output Map narrative (resultNarrative.ts) and its caption
// (OpenSitesCaption.tsx). Extracted unchanged from buildResultNarrative:
//   - super-model: metrics.openFacilityIds only (SM-8).
//   - every other model: details.openWarehouseIds, else metrics.openFacilityIds.
//     transport-coal's openWarehouseIds are MINES (solve.py:687); JADE emits
//     both fields with the same ids (solve.py:1367,1379).
// null = the field is absent or malformed (the narrative then renders
// nothing); [] = the solve genuinely opened nothing.

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export function openSiteIds(result: unknown, modelId: string): string[] | null {
  const facilities = stringIds(field(field(result, "metrics"), "openFacilityIds"));
  if (modelId === "super-model") return facilities;
  return stringIds(field(field(result, "details"), "openWarehouseIds")) ?? facilities;
}

// Decision L3 — the caption's noun, keyed by modelId.
export const OPEN_SITE_NOUN: Record<string, string> = {
  "p-median-us": "Open warehouses",
  "p-median-brazil": "Open warehouses",
  "max-coverage-us": "Open warehouses",
  "delivery-teaching-us": "Open warehouses",
  "transport-coal": "Open mines",
  "two-echelon-gold-au": "Open facilities",
  "two-echelon-jade-us": "Open facilities",
  "super-model": "Open facilities",
};
export const OPEN_SITE_NOUN_FALLBACK = "Open sites";
```

- [ ] **Step 4: Point `lib/resultNarrative.ts` at it** (behaviour-preserving)

`resultNarrative.ts:1-3`. Add one import after line 3:

```ts
import type { Edge, SolveResult } from "@workspace/api-client-react";
import { bandDecimals, computeExclusiveBandCoverage, serviceEdgesFor } from "@/lib/bands";
import { classifyResultOutcome, hasIncumbent } from "@/lib/resultOutcome";
import { openSiteIds } from "@/lib/openSites";
```

`resultNarrative.ts:46-48`. Delete the now-unused helper. Its only two callers are replaced below:

```ts
function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

```

(Delete these lines and the blank line after them. `finite` at `:50` stays.)

`resultNarrative.ts:115`, inside the `modelId === "super-model"` branch:

```ts
    const ids = stringIds(metrics.openFacilityIds);
```
→
```ts
    const ids = openSiteIds(result, modelId);
```

`resultNarrative.ts:152`:

```ts
  const openIds = stringIds(details.openWarehouseIds) ?? stringIds(metrics.openFacilityIds);
```
→
```ts
  const openIds = openSiteIds(result, modelId);
```

(`details` is still used at `:124`, `:222`, `:224-225` and `:250`, so its declaration at `:98` stays.)

- [ ] **Step 5: Implement `components/workspace/OpenSitesCaption.tsx`** (new file)

```tsx
import { useState } from "react";
import type { SolveResult } from "@workspace/api-client-react";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { formatCityState } from "@/lib/formatLocation";
import { OPEN_SITE_NOUN, OPEN_SITE_NOUN_FALLBACK, openSiteIds } from "@/lib/openSites";

const SHOWN = 5;

// QFX-8 — one line above the Output Map naming the sites the displayed solve
// opened: "<Noun>: <displayId · City, ST>, … +N more". Ids come from the same
// openSiteIds() authority the narrative uses; labels from the SOLVED identity
// map (Workspace's outputIdentityById). Sorted by the displayed id,
// numeric-aware (W2 before W10). Renders nothing when no site is open.
export function OpenSitesCaption({ result, modelId, identityById }: {
  result: SolveResult | null;
  modelId?: string;
  identityById: Record<string, EntityIdentity>;
}) {
  const [expanded, setExpanded] = useState(false);
  const labels = (openSiteIds(result, modelId ?? "") ?? [])
    .map(id => identityById[id] ?? { displayId: id, city: "", state: "" })
    .sort((a, b) => a.displayId.localeCompare(b.displayId, undefined, { numeric: true }))
    .map(i => (i.city || i.state ? `${i.displayId} · ${formatCityState(i.city, i.state)}` : i.displayId));
  if (labels.length === 0) return null;
  const hidden = labels.length - SHOWN;
  const shown = expanded || hidden <= 0 ? labels : labels.slice(0, SHOWN);
  return (
    <p data-testid="output-map-open-sites" className="flex-shrink-0 text-xs leading-relaxed">
      <span className="text-muted-foreground">{OPEN_SITE_NOUN[modelId ?? ""] ?? OPEN_SITE_NOUN_FALLBACK}: </span>
      {shown.join(", ")}
      {hidden > 0 && (
        <>
          {" "}
          <button
            type="button"
            data-testid="output-map-open-sites-toggle"
            aria-expanded={expanded}
            className="text-primary hover:underline"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? "Show fewer" : `+${hidden} more`}
          </button>
        </>
      )}
    </p>
  );
}
```

- [ ] **Step 6: Mount it in `OutputMapTab.tsx`**

`OutputMapTab.tsx:18`. Add the import after the `OutputMapNarrative` import:

```tsx
import { OutputMapNarrative } from "@/components/workspace/tabs/OutputMapNarrative";
import { OpenSitesCaption } from "@/components/workspace/OpenSitesCaption";
```

`OutputMapTab.tsx:390-394`. Replace:

```tsx
      {/* CH4OS (spec §6.3) — same alert as Solution Summary, above the map so
          it never covers it; self-gated, renders nothing otherwise. */}
      <FloorExceedsMaxAlert result={result} formatDistance={showDistance} className="mx-2 mt-2" />

      <div className="flex-1 min-h-0 relative" ref={mapRef}>
```

with:

```tsx
      {/* CH4OS (spec §6.3) — same alert as Solution Summary, above the map so
          it never covers it; self-gated, renders nothing otherwise. */}
      <FloorExceedsMaxAlert result={result} formatDistance={showDistance} className="mx-2 mt-2" />

      {/* QFX-8 — open-site caption directly above the map (outside mapRef, so
          the PNG/clipboard capture is unchanged). A failed result keeps stale
          ids in details on some envelopes, so only an incumbent is captioned. */}
      <OpenSitesCaption result={showIncumbent ? result : null} modelId={modelId} identityById={identityById} />

      <div className="flex-1 min-h-0 relative" ref={mapRef}>
```

(`showIncumbent` is already declared at `:219`; `identityById` defaults to `{}` at `:140`.)

- [ ] **Step 7: Run the task's tests, expect PASS**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-8
pnpm --filter studio exec vitest run src/__tests__/openSites.test.ts src/__tests__/OpenSitesCaption.test.tsx src/__tests__/resultNarrative.test.ts src/__tests__/OutputMapTab.test.tsx src/__tests__/Workspace.OutputMap.test.tsx
pnpm run typecheck
```

Expected: all green.
- `resultNarrative.test.ts` passes **unmodified**. That is the behaviour-preservation proof, including the `:149-150` absent-field → `null` case.
- Then run `pnpm gate` (0 concurrent vitest) per the Global Constraints.
- Real-browser check (spec §2, qa-sdet in QFX-QA): caption layout above the map in light and dark mode, on one ≤5-site model (p-median-us) and on one model or scenario with more than 5 open sites (expand/collapse).

- [ ] **Step 8: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-8 - Output map caption: open site labels

- `lib/openSites.ts` (new): `openSiteIds(result, modelId)` is the one per-model open-site authority, extracted unchanged from `resultNarrative.ts` and now imported by it. Rule: super-model uses `metrics.openFacilityIds`; every other model uses `details.openWarehouseIds ?? metrics.openFacilityIds`.
  - It returns `string[] | null` (the plan contract said `string[]`). `null` = field absent, so the narrative still renders nothing then; `resultNarrative.test.ts` passes unmodified.
  - `OPEN_SITE_NOUN` (decision L3) + fallback "Open sites".
- `components/workspace/OpenSitesCaption.tsx` (new), mounted in `OutputMapTab` between `FloorExceedsMaxAlert` and the map node (outside the PNG capture).
  - Text: `<Noun>: displayId · City, ST, …`, sorted by the displayed id (numeric-aware), at most 5 shown, then a "+N more" / "Show fewer" toggle (`aria-expanded`).
  - Hidden pre-solve, on failed results (`showIncumbent` gate), and with zero open sites. The stale/unsolved banner returns before `OutputMapTab` mounts (`Workspace.tsx:4090-4092`), so the caption cannot render there.
- Labels reuse the solved `outputIdentityById` already passed to the tab. No new data plumbing.
- Tests: `openSites.test.ts` (real envelopes for all 8 models + precedence), `OpenSitesCaption.test.tsx`, plus caption cases in `OutputMapTab.test.tsx` and `Workspace.OutputMap.test.tsx`.
```

- [ ] **Step 9: Commit**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-8
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/lib/openSites.ts artifacts/studio/src/lib/resultNarrative.ts \
  artifacts/studio/src/components/workspace/OpenSitesCaption.tsx artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx \
  artifacts/studio/src/__tests__/openSites.test.ts artifacts/studio/src/__tests__/OpenSitesCaption.test.tsx \
  artifacts/studio/src/__tests__/OutputMapTab.test.tsx artifacts/studio/src/__tests__/Workspace.OutputMap.test.tsx \
  docs/CHANGELOG-implementation.md
git commit artifacts/studio/src/lib/openSites.ts artifacts/studio/src/lib/resultNarrative.ts \
  artifacts/studio/src/components/workspace/OpenSitesCaption.tsx artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx \
  artifacts/studio/src/__tests__/openSites.test.ts artifacts/studio/src/__tests__/OpenSitesCaption.test.tsx \
  artifacts/studio/src/__tests__/OutputMapTab.test.tsx artifacts/studio/src/__tests__/Workspace.OutputMap.test.tsx \
  docs/CHANGELOG-implementation.md -m "[QFX-8] add open-sites caption above the output map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- None to rewrite. I grepped `artifacts/studio/e2e/*.spec.ts` for `output-map`, `Open warehouses|Open mines|Open facilities`, and `getByText("Open…` / `name: /open`.
- Every `output-map-tab` assertion is a visibility or Leaflet-pane locator, and none reads the tab's full text:
  - `bundle2-fastfollow.spec.ts:169-172,244,318`
  - `chen-bands-units-qa.spec.ts:130`
  - `bundle6.1-legend-distances.spec.ts:176`
  - `bundle6-ui-tweaks.spec.ts:266-270`
  - `delivery-teaching.spec.ts:144`
  - `design-system.spec.ts:234`
  - `jade-ch9-workspace-bundle.spec.ts:155,178-179,225,237`
- No spec uses a bare `getByText("Open …")`, which would hit Playwright's substring match and fail strict mode.
- New test ids `output-map-open-sites` and `output-map-open-sites-toggle` are additive.

---

### Task QFX-9: Distance method — 3-way segmented control + factor Apply

> **Carry-forward (controller, assembly):** this section was drafted against pre-bundle code. By the time it runs, QFX-6 has added a required `network: SuperInputsLike` prop to `SuperDistancesTab`, and QFX-2b has added file menus inside `SuperTableTab`. The rewrite below keeps `network` and forwards it. Add `import type { SuperInputsLike } from "@/lib/superNetwork";` to both the component and the test file. QFX-10's `pl-2` select class is moot, because this task deletes that select.

**Role:** frontend-engineer (invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` before writing code).

**Spec facts checked against the code:**
- **Current controls.** `SuperDistancesTab.tsx:22-40` holds the native `<select data-testid="super-distance-method">`, the `DraftNumberInput` factor (always rendered, disabled unless circuity; commits on every keystroke, `entityCells.tsx:73-112`) and the Road-only "Fetch road distances" button.
- **Parent wiring.** The single parent is `Workspace.tsx:3847-3860`:
  - `onChange` merges the patch into `localInputs`, the draft.
  - `circuityFactor` defaults to `1.17` when absent.

  The props interface is unchanged by this task.
- **QFX-10 interaction.** QFX-10 lands first. The spec says the `<select>` at `SuperDistancesTab.tsx:23` is replaced by QFX-9, so if QFX-10 touched that line, replace whatever the `<div className="flex items-center gap-3 text-sm">…</div>` block holds at that point. After this task, `SuperDistancesTab.tsx` has no `<select>`.
- **Re-sync rule.** "Re-sync on external draft change" is implemented as re-syncing whenever the stored `circuityFactor` **value** changes: import, history restore, Discard, and Apply itself. The component receives only the value, not draft identity, so an external change that leaves the factor equal to its current value does not clear the typed text. Nothing observable changes in that case, because the stored value is the same. The field also unmounts, which resets it, whenever the method leaves Circuity or the tab is left.
- **Simplicity.** The segmented control stays local to this file, per the contract. There is no second consumer, and Radix `ToggleGroup` would add no a11y benefit over the explicit contract below.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx:1-47` (whole file; the props interface `:6-17` is kept verbatim)
- Test (rewrite): `artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx`
- Test (delete the old block): `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`. Remove the `import { SuperDistancesTab } …` line (`:4`) and the whole `describe("SuperDistancesTab", …)` block (`:54-73`, the last block in the file). It asserted the `<select>` and `DraftNumberInput` behaviour this task removes, and its coverage moves into `SuperDistancesTab.test.tsx`. If QFX-6 shifted those lines, anchor on the content, not the line numbers.
- E2E: `artifacts/studio/e2e/super-model.spec.ts:345`

**Interfaces:**
- Consumes: nothing from other QFX tasks. QFX-10's global `select` rule simply no longer applies to this file.
- Produces:
  - The `SuperDistancesTabProps` interface is unchanged.
  - Test ids:
    - `super-distance-method` is now the `role="radiogroup"` container, not a `<select>`.
    - `super-distance-method-haversine`, `super-distance-method-circuity`, `super-distance-method-road` are the radio segments.
    - `super-circuity-factor` is now a text input, not `type=number`.
    - `super-circuity-apply` and `super-circuity-error` are new.
    - `super-road-fetch` is unchanged.

- [ ] **Step 1: Write the failing test.** Replace the whole of `artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx`:

```tsx
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuperDistancesTab, type SuperDistancesTabProps } from "@/components/workspace/super/SuperDistancesTab";

type Method = SuperDistancesTabProps["distanceMethod"];

// QFX-6 made `network` a required prop; an empty draft is enough for these tests.
const NET = { products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } as unknown as SuperInputsLike;

// Stateful host: the real parent (Workspace) merges each patch into the draft
// and feeds distanceMethod/circuityFactor back as props.
function setup(over: Partial<SuperDistancesTabProps> = {}, initial: { method?: Method; factor?: number } = {}) {
  const onChange = vi.fn();
  const onFetchRoad = vi.fn();
  function Host() {
    const [method, setMethod] = useState<Method>(initial.method ?? "circuity");
    const [factor, setFactor] = useState(initial.factor ?? 1.17);
    return <SuperDistancesTab distanceMethod={method} circuityFactor={factor} overrides={[]}
      onChange={patch => {
        onChange(patch);
        if (typeof patch.circuityFactor === "number") setFactor(patch.circuityFactor);
        if (typeof patch.distanceMethod === "string") setMethod(patch.distanceMethod as Method);
      }}
      onFetchRoad={onFetchRoad} fetchDisabledReason={null}
      readOnly={false} plantIds={[]} warehouseIds={[]} customerIds={[]} network={NET} {...over} />;
  }
  render(<Host />);
  return Object.assign(onChange, { onFetchRoad });
}

const radio = (name: string) => screen.getByRole("radio", { name });
const ERROR = "Use a number from 1 to 3 with up to 3 decimals.";

describe("SuperDistancesTab method segmented control (QFX-9)", () => {
  it("is a radiogroup named 'Distance method' with Haversine | Circuity | Road; only the checked segment is tabbable", () => {
    setup({}, { method: "circuity" });
    const group = screen.getByRole("radiogroup", { name: "Distance method" });
    expect(group).toHaveAttribute("data-testid", "super-distance-method");
    expect(screen.getAllByRole("radio").map(r => r.textContent)).toEqual(["Haversine", "Circuity", "Road"]);
    expect(radio("Circuity")).toHaveAttribute("aria-checked", "true");
    expect(radio("Circuity")).toHaveAttribute("tabindex", "0");
    expect(radio("Haversine")).toHaveAttribute("aria-checked", "false");
    expect(radio("Haversine")).toHaveAttribute("tabindex", "-1");
    expect(radio("Road")).toHaveAttribute("tabindex", "-1");
    expect(group.querySelector("select")).toBeNull();
  });

  it("clicking a segment writes distanceMethod to the draft immediately", async () => {
    const onChange = setup({}, { method: "haversine" });
    await userEvent.click(radio("Road"));
    expect(onChange).toHaveBeenCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveAttribute("aria-checked", "true");
  });

  it("clicking the already-checked segment writes nothing", async () => {
    const onChange = setup({}, { method: "road" });
    await userEvent.click(radio("Road"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("→/↓ move to and select the next segment, wrapping; ←/↑ the previous, wrapping", async () => {
    const onChange = setup({}, { method: "haversine" });
    radio("Haversine").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
    expect(radio("Circuity")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "haversine" });
    expect(radio("Haversine")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
    expect(radio("Circuity")).toHaveAttribute("aria-checked", "true");
    expect(radio("Circuity")).toHaveAttribute("tabindex", "0");
  });

  it("Home and End go to the first and last segment", async () => {
    const onChange = setup({}, { method: "circuity" });
    radio("Circuity").focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "haversine" });
    expect(radio("Haversine")).toHaveFocus();
  });

  it("Space and Enter select the focused segment", async () => {
    const onChange = setup({}, { method: "haversine" });
    radio("Road").focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    radio("Circuity").focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
  });

  it("read-only (history) disables every segment", () => {
    setup({ readOnly: true });
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
  });
});

describe("SuperDistancesTab circuity factor + Apply (QFX-9)", () => {
  it("is shown only under Circuity", () => {
    setup({}, { method: "haversine" });
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
    expect(screen.queryByTestId("super-circuity-apply")).toBeNull();
  });

  it("is a compact decimal text input showing the stored value", () => {
    setup();
    const el = screen.getByTestId("super-circuity-factor");
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "decimal");
    expect(el).toHaveValue("1.17");
  });

  it("typing never touches the draft; Apply writes the parsed number", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "1.25");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("super-circuity-apply"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 1.25 });
  });

  it("Enter applies", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.5{Enter}");
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 2.5 });
  });

  it("blur does nothing", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.5");
    await userEvent.tab();
    expect(el).not.toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(el).toHaveValue("2.5");
  });

  it.each(["1.2345", "3.5", "0.99", "abc", "", "1.", "-1"])("'%s' is invalid: message shown, Apply disabled, Enter does nothing", async raw => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    if (raw) await userEvent.type(el, raw);
    expect(screen.getByTestId("super-circuity-error")).toHaveTextContent(ERROR);
    expect(el).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    await userEvent.type(el, "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  // Object rows (not tuples): this .test.tsx is in the studio typecheck, and
  // mixed-type tuple rows infer `string | number` for each argument.
  it.each([{ raw: "1", n: 1 }, { raw: "3", n: 3 }, { raw: "1.175", n: 1.175 }, { raw: "2.5", n: 2.5 }])("'$raw' is valid and applies $n", async ({ raw, n }) => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, raw);
    expect(screen.queryByTestId("super-circuity-error")).toBeNull();
    await userEvent.click(screen.getByTestId("super-circuity-apply"));
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: n });
  });

  it("Apply is disabled while the input equals the stored value (including '1.170')", async () => {
    setup();
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "1.170");
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    expect(screen.queryByTestId("super-circuity-error")).toBeNull();
  });

  it("re-syncs to the stored value when the draft changes from elsewhere (import, history restore)", async () => {
    const props: SuperDistancesTabProps = {
      distanceMethod: "circuity", circuityFactor: 1.17, overrides: [], onChange: vi.fn(), onFetchRoad: vi.fn(),
      fetchDisabledReason: null, readOnly: false, plantIds: [], warehouseIds: [], customerIds: [], network: NET,
    };
    const { rerender } = render(<SuperDistancesTab {...props} />);
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.9");
    rerender(<SuperDistancesTab {...props} circuityFactor={1.5} />);
    expect(screen.getByTestId("super-circuity-factor")).toHaveValue("1.5");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("read-only disables the input and Apply", () => {
    setup({ readOnly: true });
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
  });
});

describe("SuperDistancesTab road method", () => {
  it("under road the fetch button renders and calls onFetchRoad; no factor field", async () => {
    const h = setup({}, { method: "road" });
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
    await userEvent.click(screen.getByTestId("super-road-fetch"));
    expect(h.onFetchRoad).toHaveBeenCalled();
  });
  it("is disabled with the reason as title", () => {
    setup({ fetchDisabledReason: "Save your changes first" }, { method: "road" });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
    expect(screen.getByTestId("super-road-fetch")).toHaveAttribute("title", "Save your changes first");
  });
  it("is disabled read-only (history)", () => {
    setup({ readOnly: true }, { method: "road" });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });
  it("haversine shows no extra controls", () => {
    setup({}, { method: "haversine" });
    expect(screen.queryByTestId("super-road-fetch")).toBeNull();
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
  });
});
```

`setup` defaults to `circuity` and puts `over` after the Host's own props, so `over` wins. The `readOnly`/`fetchDisabledReason` overrides above use it. The method is passed through `initial` so that it stays stateful.

Delete the old `SuperDistancesTab` coverage from `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`:
- Remove line `:4`:
  ```tsx
  import { SuperDistancesTab } from "@/components/workspace/super/SuperDistancesTab";
  ```
- Remove the whole final block, from `describe("SuperDistancesTab", () => {` (`:54`) through its closing `});` (`:73`). It drove the removed `<select>` with `fireEvent.change(…, { target: { value: "circuity" } })` and asserted per-keystroke commits, both of which this task removes on purpose. `fireEvent`/`vi` are still used by the remaining `SuperTableTab` tests, so the other imports stay.

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-9
pnpm --filter studio exec vitest run src/__tests__/SuperDistancesTab.test.tsx
```

Expected failures:
- `Unable to find role="radiogroup"` / `Unable to find role="radio"` in the segmented-control tests.
- `expect(element).toHaveAttribute("type", "text")` receives `"number"`.
- "typing never touches the draft": `expected "spy" to not be called` (the current `DraftNumberInput` commits per keystroke).
- `Unable to find [data-testid="super-circuity-apply"]`.

- [ ] **Step 3: Implement.** Replace the whole of `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx`. Lines `:1-47` are shown below as the replacement; the `SuperDistancesTabProps` interface `:6-17` and the trailing note + `SuperTableTab` block `:41-44` are kept verbatim:

```tsx
import { useRef, useState, type KeyboardEvent } from "react";
import { READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SuperTableTab } from "./SuperTableTab";
import type { Row } from "./superTables";

export interface SuperDistancesTabProps {
  distanceMethod: "haversine" | "circuity" | "road";
  onFetchRoad(): void;
  /** Non-null disables the fetch button and is its title. */
  fetchDisabledReason: string | null;
  circuityFactor: number;
  overrides: Row[];
  /** A partial patch of `distanceMethod` / `circuityFactor` / `distanceOverrides`. */
  onChange(patch: Record<string, unknown>): void;
  readOnly: boolean;
  plantIds: string[]; warehouseIds: string[]; customerIds: string[];
  /** QFX-6 — the whole draft, forwarded to SuperTableTab for its Add form. Keep it. */
  network: SuperInputsLike;
}

type DistanceMethod = SuperDistancesTabProps["distanceMethod"];

const METHODS: { value: DistanceMethod; label: string }[] = [
  { value: "haversine", label: "Haversine" },
  { value: "circuity", label: "Circuity" },
  { value: "road", label: "Road" },
];

// QFX-9 — radiogroup with roving tabindex: only the checked segment is
// tabbable; arrows move AND select (wrapping), Home/End jump to the ends.
// Space/Enter on the focused segment are the native <button> click.
function MethodSegments({ value, disabled, onSelect }: {
  value: DistanceMethod;
  disabled: boolean;
  onSelect(method: DistanceMethod): void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: KeyboardEvent, i: number) {
    const last = METHODS.length - 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
        : e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
          : e.key === "Home" ? 0
            : e.key === "End" ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(METHODS[next].value);
  }
  return (
    <div role="radiogroup" aria-label="Distance method" data-testid="super-distance-method" className="inline-flex rounded-md border p-0.5">
      {METHODS.map((m, i) => {
        const checked = m.value === value;
        return (
          <button
            key={m.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={disabled ? READ_ONLY_TITLE : undefined}
            data-testid={`super-distance-method-${m.value}`}
            onClick={() => onSelect(m.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              "h-7 rounded px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// QFX-9 — 1 ≤ value ≤ 3 with at most 3 decimals. Intentionally stricter than
// the server (superInputs.ts:44-46, any finite 1–3); over-precise input is
// invalid, never rounded.
function parseCircuityFactor(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 3 ? n : null;
}

// QFX-9 — typing edits local text only; the draft changes on Apply (button or
// Enter), never per keystroke and never on blur. A change to the stored value
// from elsewhere (import, history restore, Discard, or Apply itself) re-syncs
// the text.
function CircuityFactorField({ value, disabled, onApply }: {
  value: number;
  disabled: boolean;
  onApply(n: number): void;
}) {
  const [raw, setRaw] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setRaw(String(value));
  }
  const parsed = parseCircuityFactor(raw);
  const canApply = !disabled && parsed !== null && parsed !== value;
  const apply = () => { if (canApply && parsed !== null) onApply(parsed); };
  return (
    <div className="flex items-start gap-2">
      <div>
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Circuity factor"
          aria-invalid={parsed === null}
          aria-describedby={parsed === null ? "super-circuity-error" : undefined}
          data-testid="super-circuity-factor"
          className="h-8 w-[7ch] px-1.5 text-xs md:text-xs"
          value={raw}
          disabled={disabled}
          title={disabled ? READ_ONLY_TITLE : undefined}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
        />
        {parsed === null && (
          <p id="super-circuity-error" data-testid="super-circuity-error" className="mt-1 text-xs text-destructive">
            Use a number from 1 to 3 with up to 3 decimals.
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" data-testid="super-circuity-apply" disabled={!canApply} onClick={apply}>
        Apply
      </Button>
    </div>
  );
}

export function SuperDistancesTab(p: SuperDistancesTabProps) {
  return (
    <div className="space-y-4" data-testid="super-distances-tab">
      <div className="space-y-2 text-sm">
        <MethodSegments value={p.distanceMethod} disabled={p.readOnly}
          onSelect={m => { if (m !== p.distanceMethod) p.onChange({ distanceMethod: m }); }} />
        {p.distanceMethod === "circuity" && (
          <CircuityFactorField value={p.circuityFactor} disabled={p.readOnly}
            onApply={n => p.onChange({ circuityFactor: n })} />
        )}
        {p.distanceMethod === "road" && (
          <Button size="sm" variant="outline" data-testid="super-road-fetch" onClick={p.onFetchRoad}
            disabled={p.readOnly || p.fetchDisabledReason !== null} title={p.fetchDisabledReason ?? undefined}>
            Fetch road distances
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Pairs without an override use the method above. Overrides always win. Road pairs are checked by the readiness panel.</p>
      <SuperTableTab network={p.network} table="distanceOverrides" rows={p.overrides} readOnly={p.readOnly}
        onChange={rows => p.onChange({ distanceOverrides: rows })}
        options={{ fromIds: [...p.plantIds, ...p.warehouseIds], toIds: [...p.warehouseIds, ...p.customerIds] }} />
    </div>
  );
}
```

Notes for the implementer:
- `DraftNumberInput` is no longer imported here. It stays in `entityCells.tsx` for `WarehousesTab`/`MinesTab`/`superTables.tsx`.
- `Workspace.tsx:3847-3860` needs no change.
- If QFX-10 added a chevron `select` rule, it simply no longer matches anything in this file.

- [ ] **Step 4: Rewrite the sibling e2e step.** `artifacts/studio/e2e/super-model.spec.ts:345`:

```ts
      await page.getByTestId("super-distance-method").selectOption("road", { timeout: HEADER_TIMEOUT });
```
→
```ts
      await page.getByTestId("super-distance-method-road").click({ timeout: HEADER_TIMEOUT });
```

The rest of test G (`:347-353`: fetch disabled until saved → Save → poll `distanceMethod === "road"` → fetch enabled) is unchanged. Clicking the segment writes `distanceMethod` to the draft exactly as `selectOption` did.

- [ ] **Step 5: Run the task's tests, expect PASS**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-9
pnpm --filter studio exec vitest run src/__tests__/SuperDistancesTab.test.tsx src/__tests__/SuperTableTab.test.tsx src/__tests__/Workspace.Super.test.tsx
pnpm run typecheck
```

Expected: all green.
- `Workspace.Super.test.tsx:196-235` (SM2-10 road fetch tests) still pass unchanged. They set `distanceMethod: "road"` through scenario inputs and only use `super-road-fetch`.
- Then run `pnpm gate` (0 concurrent vitest).
- The super-model e2e test G runs in QFX-QA's local e2e pass: `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`.

- [ ] **Step 6: Changelog.** Append at the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
### QFX-9 - Distance method: segmented control + circuity factor Apply

`components/workspace/super/SuperDistancesTab.tsx`:
- **Segmented control.** The native method `<select>` is now a local `Haversine | Circuity | Road` segmented control.
  - Markup: `role="radiogroup"` + `aria-label="Distance method"`, each segment a `<button role="radio" aria-checked>`.
  - Keyboard: roving tabindex; ←/↑ and →/↓ move-and-select with wrap; Home/End; Space/Enter are the native button click.
  - A segment writes `distanceMethod` to the draft at once. Re-clicking the checked segment writes nothing.
- **Circuity factor.** The per-keystroke `DraftNumberInput` is now a text input (`inputMode="decimal"`) plus Apply, shown only under Circuity.
  - Typing never touches the draft. Apply or Enter writes the parsed number. Blur does nothing.
  - Valid input: 1–3 with at most 3 decimals (no rounding; stricter than the server, which is unchanged). Otherwise the message "Use a number from 1 to 3 with up to 3 decimals." shows.
  - Apply is disabled when the input is invalid, equals the stored value, or the view is read-only.
  - The text re-syncs when the stored value changes from elsewhere.
- **Road** keeps "Fetch road distances". **Haversine** shows no extra controls.

Tests:
- `SuperDistancesTab.test.tsx` rewritten.
- The obsolete `SuperDistancesTab` block in `SuperTableTab.test.tsx` was removed; it asserted the removed select and per-keystroke commit.
- `e2e/super-model.spec.ts:345` `selectOption("road")` → click `super-distance-method-road`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/shubhamkr/nos-qfx-QFX-9
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx \
  artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx artifacts/studio/src/__tests__/SuperTableTab.test.tsx \
  artifacts/studio/e2e/super-model.spec.ts docs/CHANGELOG-implementation.md
git commit artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx \
  artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx artifacts/studio/src/__tests__/SuperTableTab.test.tsx \
  artifacts/studio/e2e/super-model.spec.ts docs/CHANGELOG-implementation.md -m "[QFX-9] replace distance method select with a segmented control and factor Apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**E2E / sibling-spec impact**
- `artifacts/studio/e2e/super-model.spec.ts:345`
  - Before: `await page.getByTestId("super-distance-method").selectOption("road", { timeout: HEADER_TIMEOUT });`
  - After: `await page.getByTestId("super-distance-method-road").click({ timeout: HEADER_TIMEOUT });`
  - Rewritten in Step 4. `super-distance-method` is no longer a `<select>`, so `selectOption` would throw.
- `super-road-fetch` (`super-model.spec.ts:347,352,353`) is unchanged and needs no edit.
- No e2e spec references `super-circuity-factor`, `circuity`, or `haversine` UI. The `max-coverage.spec.ts:32,337` and `bundle2-fastfollow.spec.ts:16` hits are comments about solver circuity.

---

### Task QFX-QA: Real-browser QA + sibling e2e specs

**Role:** qa-sdet (exempt from the ponytail and karpathy skills).

**Files:**
- Modify: every `artifacts/studio/e2e/*.spec.ts` listed in the "E2E / sibling-spec impact" blocks of the tasks above. Each task's own block is the inventory; this task re-greps to catch any it missed.
- Create: `artifacts/studio/e2e/quick-fixes.spec.ts`

**Interfaces:**
- Consumes: every QFX test id and visible string introduced above.
- Produces: green `pnpm e2e:gate` on the bundle tip.

- [ ] **Step 1: Start both servers locally.** Use the two-server recipe in `artifacts/studio/e2e/CLAUDE.md`, with `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`. Note the studio port.

- [ ] **Step 2: Re-grep for stale assertions.** This is the inventory backstop.

```bash
cd /Users/shubhamkr/nos-qfx/artifacts/studio
grep -rnE "Export JSON|Export CSV|Export XLSX|Add row|button-import-|button-export-|getByLabel\(.Name|\"name\"|distance-method|circuity" e2e/*.spec.ts
```

Every hit not already rewritten by a task's impact block is rewritten here to the new UI, using the test ids those tasks define.

- [ ] **Step 3: Write `e2e/quick-fixes.spec.ts`.** It covers what jsdom cannot see (`artifacts/studio/CLAUDE.md`: CSS, overlay layout, real file I/O):
  1. **QFX-10:** on a super scenario's Warehouses tab and in the Run Optimizer dialog, every visible `select:not([multiple]):not([size])` has computed `appearance: none` and `padding-right ≥ 28px`, and its `background-image` contains `gradient` (the chevron is drawn with two linear-gradient triangles, per QFX-10). The app has no dark-mode switch (nothing adds `.dark`), so the dark check forces it: run `page.evaluate(() => document.documentElement.classList.add("dark"))`, then assert the same computed styles again.
  2. **QFX-8:** after a seeded solved result (seed via API, not real CBC, per `HARNESS.md`), the caption above the output map reads `^Open (warehouses|mines|facilities): ` and shows at most 5 labels. "+N more" expands to the full list and "Show fewer" collapses it. The caption has a non-zero bounding box and does not overlap the map container's top edge.
  3. **QFX-1 / QFX-2b:** on the super model, the toolbar shows Save, then Import network, then Export ▾, in DOM order. Export ▾ → XLSX triggers a download ending `.xlsx`. On Warehouses, Download ▾ → CSV, then Upload ▾ → CSV of the same file, then **Replace** in the dialog leaves the table unchanged and the draft clean once Save completes.
  4. **QFX-3:** the Optimization Parameters tab → bottom Solve shows the solve progress overlay with no `role=dialog` named "Run Optimizer" opening.
  5. **QFX-6:** Warehouses → "+ Add warehouse" → fill the fields → Add puts the row in the table. After Save and a reload, the row persists.
  6. **QFX-9:** Distances → arrow keys move between Haversine / Circuity / Road. Typing `1.2345` into the factor shows "Use a number from 1 to 3 with up to 3 decimals." with Apply disabled. Typing `1.234` and pressing Enter applies it.

- [ ] **Step 4: Run.**

```bash
E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate
```

Expected: 0 unexpected. Any failure is checked against `docs/superpowers/flake-registry.md` and re-run twice alone (`--retries=0`). Record new flakes in the registry.

- [ ] **Step 5: Changelog + commit**

Changelog entry:
```markdown
### QFX-QA - real-browser QA + sibling e2e rewrites

New `e2e/quick-fixes.spec.ts` covers the CSS/overlay/file-I/O behaviour jsdom cannot see (QFX-10 select chevron in light and dark, QFX-8 caption, QFX-1/2b toolbar and per-table round-trip, QFX-3 dialog-less solve, QFX-6 add form persistence, QFX-9 keyboard and factor Apply). Sibling specs rewritten: <list files>. `pnpm e2e:gate`: <expected/unexpected/flaky counts, measured>.
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e docs/CHANGELOG-implementation.md docs/superpowers/flake-registry.md
git commit artifacts/studio/e2e docs/CHANGELOG-implementation.md docs/superpowers/flake-registry.md -m "[QFX-QA] add quick-fixes e2e and rewrite sibling specs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task QFX-GATE: Integrated gate on the bundle tip

**Role:** controller.

- [ ] **Step 1: Confirm the machine is quiet.**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); echo "concurrent vitest: $cnt"
```

Expected: `0`. If it is not 0, wait. Do not trust a gate run under load.

- [ ] **Step 2: Run the full gate and both standalone solver scripts.**

```bash
cd /Users/shubhamkr/nos-qfx
pnpm gate; echo "gate exit: $?"
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```

Expected: gate exit 0, and `e2e_accuracy.py` 99/99. The latter must pass unmodified (hard rule #2), even though no solver file changed.

- [ ] **Step 3: Record the measured counts** (typecheck, api-server, studio, pytest, e2e_accuracy, e2e:gate) in a `### QFX - bundle gate` changelog entry. Every number comes from this run; an underivable value is `unknown`. Commit as `[QFX-GATE] record bundle gate`.

---

### Task QFX-FINISH: End of branch

**Role:** controller.

- [ ] **Step 1:** Invoke `superpowers:finishing-a-development-branch`.
- [ ] **Step 2:** Run `/harness-retro QFX`.
- [ ] **Step 3: STOP.** Ask the user for approval to merge `quick-fixes` into local `main`. Then follow the root CLAUDE.md pipeline. Each of these steps needs its own explicit yes:
  1. merge to local `main`
  2. whole-branch review on the merged state
  3. any fixes go back on the branch (step 5a)
  4. push to `origin/main`, which is deploy-adjacent: it can ship `nos-studio`
  5. deploy (separate approval): include `pnpm deploy:preflight -- <deployed-sha>..HEAD`
- [ ] **Deploy note for the approval request:**
  - QFX-7 changes the API validator. The studio no longer sends `name`, and the old API **requires** it. So `nos-api` must deploy **before or together with** `nos-studio`; studio-first would make every super location write fail validation.
  - No `lib/db/src/schema/**` change, so no `drizzle-kit push`.
