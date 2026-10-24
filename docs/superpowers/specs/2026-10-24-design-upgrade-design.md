# Design Upgrade — Design Spec

**Date:** 2026-10-24 · **Branch:** `design-upgrade-spec` · **Scope:** `artifacts/studio` (all 8 chapters incl. Super Model) + two solver manifests (Phase 4 only)

## 1. Why

A design critique (token audit of `artifacts/studio/src/index.css`, grep counts across `src/`, live walk of production Ch 3 and Ch 9 incl. every tab and the Input/Output Map interactions) found 24 cross-cutting problems. The visual identity — olive/ink "book-cover", Source Serif 4 display, IBM Plex Sans/Mono — is right and is **kept**. What is wrong is underneath it: three token systems where one is live, colors that carry meaning but are ambiguous, inconsistent number/ID/unit formats, map actions reachable only by right-click, and multi-product / multi-echelon outputs presented as raw repetition.

All findings were reviewed in a Lavish decision surface (`.lavish/design-upgrade-review.html`, session 2026-10-24); every finding was dispositioned **include**. Decisions and clarifications are recorded in §3 and are normative for this spec.

### Evidence boundary
Walked live: Ch 3, Ch 9. Not walked: Ch 4, Ch 5 transport + delivery, Brazil, Ch 10 gold, Super Model. Per C4 the changes apply to **all** chapters anyway; because they land in shared components (tokens, `DataTable`, `NetworkMap`/`EntityMarkers`, formatters), per-chapter divergence is caught in QA (§7), not by a pre-spec walk.

### Correction recorded
The review page claimed tables paginate at 10 rows. **Wrong** — `components/data-table/usePagedRows.ts:20` is `PAGE_SIZE = 50` for every `DataTable`; screenshots showed only the first viewport of rows. D5 was re-decided on the corrected fact (§3).

## 2. Non-goals

- No change to the solver, `solve.py`, `e2e_accuracy.py`, result envelopes, or the OpenAPI contract — except the single optional input key in Phase 4 (§5.4).
- No new brand palette (C3). No new component library, no new dependency.
- No change to which entities/parameters exist, only to how they are presented and edited.

## 3. Decisions (normative)

| ID | Decision | Consequence |
|---|---|---|
| D1 | Phased: foundations → shared components → maps → multi-echelon → dark mode → autosave | §5 phases; each phase is its own branch-merge unit under the plan |
| D2 | Band ramp in **brand hues + stroke patterns** (C3 wins over a cividis ramp) | Color is never the only band signal (§5.1.1) |
| D3 | **Separate band sets per leg** for two-echelon models | Contract change, isolated in Phase 4 (§5.4) |
| D4 | Multi-product assignments: one row per customer, expand when products split | §5.4.2 |
| D5 | Keep 50 rows/page; **sticky column header + pager visible without scrolling** | §5.2.6 |
| D6 | **Keep dark mode, redesign it to the brand** (and actually wire it — today `.dark` is never applied) | Phase 5 |
| D7 | **Autosave, own phase**, with debounce + undo + save-status indicator | Phase 6, after all visual phases |
| D8 | Remove dead `Studio.tsx` styling **inside this upgrade** | §5.1.2 |
| C1 | JADE (Ch 9) demand **is in tons** | Relabel (§5.2.3) |
| C2 | Viewing context: **all** (laptop, projector, tablet/touch) | Touch parity is a requirement (§5.3.1), contrast targets AA minimum |
| C3 | Olive/ink palette **fixed** | Contrast fixes use existing palette shades only (§5.1.3) |
| C4 | Apply to all chapters; no pre-spec walk | QA covers every chapter (§7) |

## 4. Findings → phase map

| ID | Finding (short) | Phase |
|---|---|---|
| G1 | Meaning colors ambiguous (band ramp, entity hues, red for neutral choice) | 1 |
| G2 | Three token systems, one live; dead Arcadia/`.studio-lab`/`.scn-theme`/unused ui | 1 |
| G3 | Status tokens bypassed (~150 raw Tailwind palette classes) | 1 |
| G4 | Contrast + text size below AA | 1 |
| G5 | Same quantity, many formats | 2 |
| G6 | Band labels disconnected from map | 2 |
| G7 | Units repeated per cell / wrong | 2 |
| G10 | Internal jargon on student surfaces | 2 |
| G11 | Header title + action placement | 2 |
| G12 | Action hierarchy inverted; mode as checkbox | 2 |
| G13 | Targets < 24×24 | 2 |
| G14 | Loading state shows empty-state copy (pagination part superseded by D5) | 2 |
| G15 | Repeated row chrome; ID columns wrap | 2 |
| G16 | Parameter guidance; Landing sticky footer | 2 |
| G20 | Entity naming differs across tooltip / dialog / tables | 2 |
| G24 | Tooltip wording/typography/precision inconsistent | 2 |
| G17 | Entity actions right-click only (no touch path) | 3 |
| G18 | Details-card hint lists actions the menu doesn't offer | 3 |
| G19 | No visible selection ring on Input Map; card has no close | 3 |
| G21 | Output warehouse filter leaves inbound lanes bright; narrative ignores selection | 3 |
| G22 | Route popup collides with tooltip; no per-product breakdown | 3 |
| G8 | Multi-dimension tables explode into repetition | 4 |
| G9 | Multi-leg models judged on one band lens | 4 |
| G23 | Two "Save"s with different meanings | 6 |

## 5. Design

### 5.1 Phase 1 — Foundations (tokens only, no layout)

**5.1.1 Meaning colors (G1).**
- **Bands:** replace `--band-0..4` (`index.css:343`, green→red traffic light; band-3/4 contrast 1.28:1) with a 5-step ramp drawn from the existing olive/ink families (`--green-300…800`, `--ink-*`), near = light, far = dark, **plus a per-band stroke pattern** (solid, long-dash, dash, dot, dash-dot) applied to map lanes and repeated as a pattern swatch in legends. `--band-overflow` stays violet `#7C3AED`. Adjacent steps must differ by ≥ 1.4:1 luminance contrast, and every step must reach ≥ 3:1 against the map tile background (WCAG 1.4.11). Consumers already route through `lib/bandPalette.ts` (`BAND_COLORS`) — add the pattern array there, same index contract; no consumer re-implements a ramp.
- **Entities:** warehouse markers use ink (`--map-warehouse`), customers stay green, plants get a distinct shape/fill that does not rely on green-vs-green (`--map-plant` `#2E7D32` is currently indistinguishable at marker size). Selection and forced-open rings keep their distinct hues.
- **Red is for errors only.** Neutral modelling states (warehouse "Inactive", customer "Excluded") use a neutral filled segment (ink/grey).

**5.1.2 Dead systems (G2, D8).** Delete: the `--arc-*` tokens, `.arc-*` classes and keyframes, the `.studio-lab` override skin, the empty `.scn-theme {}`, `pages/Studio.tsx` and its route branch in `App.tsx` (all 8 chapters are `workspace: true`, so the branch is unreachable), `__tests__/Studio.test.tsx`, and the 32 never-imported `components/ui/*` files. The old `.dark` block is **replaced** in Phase 5, not deleted here. Note: `rawErrorMessageSurface.test.ts` carries an allow-list entry for `pages/Studio.tsx` — remove it in the same commit (its stale-entry check will otherwise fail).

**5.1.3 Status tokens + contrast (G3, G4).**
- Map `--success/--warning/--danger` (+ `-bg`, `-border`) into `@theme inline` so `bg-warning-bg text-warning` etc. exist; replace every raw `(bg|text|border)-(amber|red|green|emerald|yellow|sky|slate)-NNN` class in `src/` (excluding tests) with the token. Add a source-reading guard test (walks `src/`, asserted allow-list, non-vacuity case) so raw palette classes cannot return.
- Primary-colored **text** (links, labels) uses the existing `--green-700` `#48611E`; filled primary buttons keep `--primary` (white on primary = 4.56:1, passes). No palette value changes (C3).
- `--text-faint` (3.58:1) restricted to non-essential/decorative text.
- Input border: `--input` moves to `--line-strong`.
- Type floor: add `--text-2xs: 0.6875rem` (11px). Replace all `text-[9px]`, `text-[10px]`, `text-[10.5px]` with it; `.scnd-kicker` 10.5px → 11px. Minimum body text in tables stays `text-xs` (12px).

### 5.2 Phase 2 — Shared components and copy

**5.2.1 One formatter set (G5, G24).** Extend the existing `lib/` formatters rather than adding a parallel module: `formatDistanceDisplay` (already "the ONE display formatter" for Distances grids) becomes the formatter for **every** displayed distance — tables, map chips, popups, tooltips, narrative (fixes `1041.9 mi`, `732.146 mi`). Add `formatMoney(value, { compact })` beside `formatObjective` — compact `$169.06M` in chips/narrative, full `$169,061,531` in tables. The objective always carries currency or unit; `formatChenObjective` stays the Ch 4 authority. Latitude/longitude display at 4 dp everywhere (Edit dialog currently 6). Serialization (`roundForFile`) is untouched.

**5.2.2 Band labels (G6).** One `BandLabel` (range text + color swatch + pattern swatch, from `bands.ts` boundaries and `bandPalette.ts`) replaces every `Band N` string in Assignments, Flows, route popup and legend. Range text format: `≤ 200 mi`, `200–400 mi`, `> 1,600 mi` — one format everywhere.

**5.2.3 Units (G7, C1).** Units move to column headers; per-cell "Units" suffixes are removed (`CustomersTab`, `CapabilityMatrixTab`, `entityCells`, `FormattedNumberInput`, `CreateEntityDialog`). Transportation Costs keeps the header unit, drops the under-input repeat. Demand unit label is per model, defined studio-side on the chapter entry in `lib/chapters.ts` (`demandUnit`), **`"tons"` for `two-echelon-jade-us`**; all other models keep `"units"` until confirmed. No manifest change.

**5.2.4 Copy pass (G10).** Remove "(legacy result)"; "Quality: Unverified" gets a tooltip explaining what verification means, or is hidden when it carries no student-relevant meaning; capability "4 of 4" → "4 plants"; the header result-history pager reads "Run 1 of N" and hides at N = 1.

**5.2.5 Header and actions (G11, G12).** Header title = chapter `title` (not `description`); description moves to a subtitle/tooltip and never truncates the actions. One filled primary per view (Run Optimizer in the header; "Compare Scenario" on Solution Summary becomes outline). Output Map "Color lanes: Distance band" becomes a segmented control/select, separate from layer checkboxes. Save placement is left as-is until Phase 6 removes it (D7).

**5.2.6 Tables (G13, G14, G15, D5).** In the shared `DataTable`: sticky column header; pager pinned to the table's visible bottom edge so it is visible without scrolling; `PAGE_SIZE` stays 50. Loading renders a skeleton and never the empty-state copy (Distances flashed "No distance overrides yet" while loading). ID columns `nowrap` with a min width (no `customer-` / `1` wrap). Values repeated on every row (e.g. the "Plant → Warehouse" leg pill on Distances) become a filter/group header. All segmented status controls and checkboxes ≥ 24×24 CSS px (WCAG 2.5.8).

**5.2.7 Entity naming (G20, G24).** Every surface identifies an entity as **name + stable ID** using `formatLocation`/`EntityIdCell` conventions: tooltips, details card, Edit dialog ("Code: Kansas City" → name + `wh-27`), tables. Tooltip text drops the duplicate city (`Warehouse · Kansas City, MO · wh-27`). Input and Output map tooltips share one typography (sans body, mono for the ID only). City names are not unique — the ID is mandatory, not decorative.

**5.2.8 Parameters + footer (G16).** P presets are the current P ± 2 (clamped to 1 … active warehouse count) instead of the fixed `2 3 4 10` — manifests carry no default P (`two-echelon-jade-us/manifest.json:21`), so presets derive from the scenario's own value; one-line helper text under gap and time limit. Landing footer becomes non-sticky.

### 5.3 Phase 3 — Map interactions

**5.3.1 Touch/keyboard parity (G17, C2).** Every action in `MapActionMenu` (Edit / Move / Copy / Delete) is also reachable from a visible button row in `MapDetailsCard`. Right-click remains a shortcut, not the only path. The card's actions are keyboard-focusable; Escape closes the card.

**5.3.2 Truthful hints (G18).** The details-card hint is derived from the **same** action list the menu renders (one source), so a base entity never advertises Move/Delete. Today `MapDetailsCard.tsx:153` branches on `fixedGeography` while the menu filters base vs added entities independently.

**5.3.3 Selection (G19).** The selected marker shows the `--map-ring-select` ring on the Input Map as it does on the Output Map; the details card gets a close button and is positioned so it does not cover the selected marker.

**5.3.4 Output filter + route (G21, G22).** Selecting a warehouse dims **all** unrelated lanes on both legs (inbound lanes keep full opacity only if they feed the selected warehouse). The narrative panel shows the selected warehouse's figures while a filter is active and reverts on reset. The hover tooltip is suppressed for the entity whose popup is open. The customer route popup lists per-product rows for multi-product models (product → warehouse → feeding plant, distance via §5.2.1).

### 5.4 Phase 4 — Multi-echelon / multi-product (contains the only contract change)

**5.4.1 Per-leg bands (G9, D3).** Applies to the two models that are two-echelon **and** carry `distanceBands`: `two-echelon-jade-us` and `two-echelon-gold-au`.
- Add optional `inboundDistanceBands` (same item schema as `distanceBands`) to both manifests' `inputsSchema.properties`. **It must never enter `required[]`** — 284 production JADE rows lack it (root `CLAUDE.md` gotcha on `required[]`).
- Absent ⇒ inbound legs band against `distanceBands` (today's behaviour, so every existing scenario renders unchanged).
- Optimization Parameters shows a second band editor ("Inbound lanes (plant → warehouse)") beside the existing one ("Customer-facing lanes") for these two models only — driven by manifest capability, not a model-id ternary (`model-integration-precheck.md` is mandatory for this task).
- Map, Flows, Service Stats and the route popup classify each edge by semantic leg through `lib/legPalette.ts` (its existing inbound/outbound role sets) and pick the matching band set. Service Stats shows coverage per leg.
- Import/export: the key round-trips through scenario import/export like `distanceBands`. OpenAPI changes only if inputs are typed there; regenerate Orval in the same commit (hard rule #1).
- Bands stay a reporting lens — no solver input changes; `e2e_accuracy.py` must pass unmodified.

**5.4.2 Collapse product repetition (G8, D4).**
- Customer Assignments (multi-product): one row per customer; if all products go to one warehouse the row shows it; if they split, the row shows "split (n warehouses)" and expands to per-product rows. Client-side group-by over data already on the page.
- Plant Production (Service Stats): rows with zero enabled capacity are hidden behind a "Show disabled plant-products" toggle; "Remaining capacity" is replaced by "Utilization %".
- Capability Matrix: capacity printed only on enabled cells; no `0 Units`.
- Exports (CSV/JSON) keep the full flat shape — grouping is display-only.

### 5.5 Phase 5 — Dark mode (D6)

- Replace the current `.dark` block (unrelated blue palette, never applied) with a dark variant derived from the brand: ink surfaces (`--ink-900/800/700`), paper text, olive accents — the same family the Landing dark band already uses. Every semantic token from Phase 1 gets a dark value; contrast targets as §5.1.3 checked in both themes. Band ramp and patterns re-validated on dark tiles (map tile layer stays light unless a dark tile source already exists in the repo — no new tile provider).
- Theme control: follows `prefers-color-scheme` by default; a header toggle (light / dark / system) persists per viewer in `localStorage` (read/write wrapped in try/catch, render correctly without it).

### 5.6 Phase 6 — Autosave (D7, G23)

Behavioural change; lands last, after all visual phases.
- Every committed edit (the existing grammar-complete commit points in `useDistanceDraft` and the table/map edit paths) PATCHes scenario inputs after a 1 s debounce; edits within the window coalesce into one write.
- A header save-status indicator: "Saving…", "Saved", or the `describeWriteError` sentence on failure (never raw `err.message`, per the WF-9 guard), with retry.
- Undo: the last 20 committed edits per scenario are undoable within the session (Cmd/Ctrl+Z and a header control); undo issues a normal autosave write.
- The page Save button and `DirtyNavPrompt` are removed; the Edit dialog's button is renamed "Apply" (its meaning — apply to the scenario — is now the only meaning).
- Staleness stays timestamp-based (`isStale()`); each autosave bumps `inputsUpdatedAt`, so the stale badge appears after the first edit post-solve exactly as it does after a manual save today.
- Ownership: writes go through the existing PATCH route (user-scoped, 404 on non-owned) — no new endpoint.

## 6. Error handling

- Formatters return `—` for non-finite values (existing `formatDistanceDisplay` behaviour extended to `formatMoney`).
- Absent `inboundDistanceBands` is a valid state, never an error.
- Autosave failures never drop the edit: the draft stays in memory, the indicator shows the server's sentence, retry re-sends the coalesced payload.

## 7. Testing and QA

- **Per phase:** the root verification gate (`pnpm gate`) green; `e2e_accuracy.py` run directly and unchanged.
- **Source-reading guards** (pattern of `rawErrorMessageSurface.test.ts`: tree walk, asserted allow-list, non-vacuity case): no raw Tailwind palette classes (Phase 1); no `text-[9px|10px|10.5px]` (Phase 1); no `"Band "` + index label strings outside `BandLabel` (Phase 2).
- **Unit tests:** `formatMoney`, extended `formatDistanceDisplay` callers, `BandLabel` boundaries, assignment group-by (all-same vs split), per-leg band selection with and without `inboundDistanceBands`, autosave debounce/coalesce/undo.
- **Contract test (Phase 4):** a populated JADE and gold scenario with and without `inboundDistanceBands` validates against the manifest; a fixture lacking the key still validates (data compatibility).
- **Real-browser QA (qa-sdet, every phase):** CSS-only behaviour (sticky header, pinned pager, patterns, 24 px targets, hover/tooltip suppression, dark theme) is invisible to jsdom — verify in Playwright against local servers (`E2E_BASE_URL` set) across **all 8 chapters**, including a touch-emulated viewport for §5.3.1. Contrast ratios re-measured from the shipped tokens, not quoted from this spec.
- **Sibling e2e specs:** before each merge, grep `artifacts/studio/e2e/` for every testid/string the phase changes (band labels, "Units", Save button, pager, header title) and rewrite affected prior specs green (root `CLAUDE.md` gotcha).

## 8. Risks

| Risk | Mitigation |
|---|---|
| In-brand band ramp too low-contrast between steps | Hard numeric gate in §5.1.1 + patterns carry the signal independently |
| Deleting `Studio.tsx` breaks tests/allow-lists that reference it | Same-commit removal of `Studio.test.tsx` and the `rawErrorMessageSurface` allow-list entry |
| Per-leg bands forgotten in one consumer (map vs flows vs stats) | All classify through `legPalette.ts`; precheck doc gates 1/6/6.5 |
| Autosave write volume / race with solve | Debounce + coalesce; solve already reads the DB row as source of truth — a pending autosave is flushed before `POST /solve` |
| Phase 2 changes testids/strings in many e2e specs | Sibling-spec sweep per phase (§7) |

## 9. Open item for spec review

- Default values for `inboundDistanceBands` on **new** scenarios: this spec keeps "absent ⇒ use `distanceBands`" (no invented thresholds). If textbook inbound thresholds exist for JADE/gold, supply them and they become manifest defaults.
