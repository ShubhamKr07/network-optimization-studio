# Design Upgrade — Design Spec (v2)

**Date:** 2026-10-24 · **Branch:** `design-upgrade-spec` · **Scope:** `artifacts/studio` (all 8 chapters incl. Super Model); Phase 4 additionally touches `artifacts/api-server` (Zod input schemas, export templates), `lib/api-spec` + Orval output, `@workspace/units`, and two solver manifests.

v2 folds Codex review round 1 (14 findings, 13 accepted, 1 rejected) and decisions Q1–Q7. Disposition log: §10.

## 1. Why

A design critique — token audit of `artifacts/studio/src/index.css`, grep counts across `src/`, and a live production walk of Ch 3 and Ch 9 (every tab plus the Input/Output Map interactions) — found 24 cross-cutting problems. The visual identity (olive/ink "book-cover" palette, Source Serif 4 display, IBM Plex Sans/Mono) is right and is **kept**. What's wrong sits underneath it:

- three token systems where only one is live;
- colours that carry meaning but are ambiguous;
- inconsistent number, ID and unit formats;
- map actions reachable only by right-click;
- multi-product and multi-echelon outputs shown as raw repetition.

The findings were dispositioned in Lavish review sessions (`.lavish/design-upgrade-review.html`, `.lavish/spec-review-codex.html`). Every G-finding is included. The decisions in §3 are normative.

### Evidence boundary
Walked live: Ch 3 and Ch 9. Not walked: Ch 4, Ch 5 transport and delivery, Brazil, Ch 10 gold, Super Model. Per C4 the changes apply to all chapters. They land in shared components (tokens, `DataTable`, `NetworkMap`/`EntityMarkers`, formatters, `@workspace/units`), so QA (§8) catches any per-chapter divergence, not a pre-spec walk.

### Correction recorded
The first review page claimed tables paginate at 10 rows. That was **wrong**. `components/data-table/usePagedRows.ts:20` sets `PAGE_SIZE = 50` for every `DataTable`; the screenshots showed only the first viewport of rows. D5 was re-decided on the corrected fact.

## 2. Non-goals and contract boundary

- **`solve.py` and every result envelope are untouched.** The solver's own `band_coverage` (`solve.py:345-501`, outbound-only, from `distanceBands`) stays as-is. Inbound band reporting is computed in TypeScript from result edges (hard rule #6: no new solver branches). `e2e_accuracy.py` and `e2e_journey.py` pass unmodified.
- There are exactly **two** contract changes, both in Phase 4 (§5.4):
  - an optional `inboundDistanceBands` scenario input;
  - a new `distance_band` label format in exports, with a template version bump.
- No new brand palette (C3). No new component library and no new dependency.
- No change to which entities or parameters exist; only to how they're presented and edited.
- Not in scope: deleting the 32 unused `components/ui/*` primitives (Q6 / CR-13). They're harmless, and removing them doesn't close any design gap.

## 3. Decisions (normative)

| ID | Decision | Consequence |
|---|---|---|
| D1 | Phased: foundations → shared components → maps → multi-echelon → dark mode → autosave | §5 phases; task/commit matrix §6 |
| D2 | Band ramp in **brand hues + stroke patterns** (C3 wins over cividis) | Colour is never the only band signal (§5.1.1) |
| D3 / Q1 | **Separate band sets per leg**, kept at full cost as its own Phase 4 task set | §5.4.1 |
| D4 | Multi-product assignments: one row per customer, expanding when products split | §5.4.2 |
| D5 | Keep 50 rows/page; **sticky column header and a pager that's visible without scrolling** | §5.2.6 |
| D6 | **Keep dark mode and redesign it to the brand** (and actually wire it up; today `.dark` is never applied) | Phase 5 |
| D7 | **Autosave as its own phase**, with debounce, undo and a save-status indicator | Phase 6 |
| D8 | Remove dead `Studio.tsx` styling **in this upgrade** | §5.1.2 |
| C1 | JADE (Ch 9) demand **is in tons** (user-confirmed) | §5.2.3 |
| C2 | Viewing context: **all** (laptop, projector, tablet/touch) | Touch parity required (§5.3.1); AA minimum |
| C3 | Olive/ink palette **fixed** | Contrast fixes use existing palette shades only |
| C4 | Apply to every chapter; no pre-spec walk | QA covers all 8 chapters |
| Q2 | Service Stats: outbound coverage **unchanged**; add an **inbound table of flow volume per inbound band** | §5.4.1 |
| Q3 | Inbound-band edits are **reporting-only** (they don't bump `inputsUpdatedAt`; `stale` stays false), the same as `distanceBands` | §5.4.1, §5.6 |
| Q4 | **No import round-trip.** The key persists through GET/PATCH plus a dedicated field-scoped route. Entity import stays unchanged. Exports emit the derived inbound band labels. | §5.4.1 |
| Q5 | The unified band label applies to the **UI and the exports** | §5.2.2, §5.4.3 (export contract change) |
| Q6 | Don't delete the unused `components/ui/*` files | §2 |
| Q7 | No known textbook inbound thresholds. **When the key is absent, inbound bands fall back to `distanceBands`.** | §5.4.1 |

## 4. Findings → phase map

| ID | Finding (short) | Phase |
|---|---|---|
| G1 | Meaning colours ambiguous (band ramp, entity hues, red for a neutral choice) | 1 |
| G2 | Three token systems, only one live; dead Arcadia/`.studio-lab`/`.scn-theme`/Studio page | 1 |
| G3 | Status tokens bypassed (~150 raw Tailwind palette classes) | 1 |
| G4 | Contrast and text size below AA | 1 |
| G5 | Same quantity, many formats | 2 |
| G6 | Band labels disconnected from the map (UI part) | 2 |
| G7 | Units repeated per cell, or wrong | 2 |
| G10 | Internal jargon on student-facing surfaces | 2 |
| G11 | Header title and action placement | 2 |
| G12 | Action hierarchy inverted; a mode shown as a checkbox | 2 |
| G13 | Targets smaller than 24×24 | 2 |
| G14 | Loading state shows empty-state copy | 2 |
| G15 | Repeated row chrome; ID columns wrap | 2 |
| G16 | No parameter guidance; Landing footer is sticky | 2 |
| G20 | Entity named differently in tooltip, dialog and tables | 2 |
| G24 | Tooltip wording, typography and precision inconsistent | 2 |
| G17 | Entity actions are right-click only (no touch path) | 3 |
| G18 | Details-card hint lists actions the menu doesn't offer | 3 |
| G19 | No visible selection ring on the Input Map; card can't be closed | 3 |
| G21 | Output warehouse filter leaves inbound lanes bright; narrative ignores the selection | 3 |
| G22 | Route popup collides with the tooltip; no per-product breakdown | 3 |
| G6 (export part) | Export `distance_band` label format | 4 |
| G8 | Multi-dimension tables explode into repetition | 4 |
| G9 | Multi-leg models judged against one band lens | 4 |
| G23 | Two "Save" buttons with different meanings | 6 |

## 5. Design

### 5.1 Phase 1: Foundations (tokens and dead code; no layout changes)

**5.1.1 Meaning colours (G1).**
- **Bands:** replace `--band-0..4` (`index.css:343`; green→red traffic light; band-3 vs band-4 contrast 1.28:1) with a 5-step ramp drawn from the existing olive/ink families (`--green-300…800`, `--ink-*`):
  - Near = light, far = dark.
  - Each band also gets a **stroke pattern**: solid, long-dash, dash, dot, dash-dot.
  - `--band-overflow` stays violet `#7C3AED`.
  - Numeric gate: adjacent steps differ by ≥ 1.4:1, and every step reaches ≥ 3:1 against the map tile background (WCAG 1.4.11).
  - The pattern array lives in `lib/bandPalette.ts` beside `BAND_COLORS`, under the same index contract.
- **Entities:**
  - Warehouse markers use ink (`--map-warehouse`).
  - Customers stay green.
  - Plants get a shape and fill that don't depend on green-vs-green.
  - The selection and forced-open rings keep their distinct hues.
- **Red is for errors only.** Neutral modelling states ("Inactive", "Excluded") use a neutral filled segment.

**5.1.2 Dead systems (G2, D8).** Delete the following:
- the `--arc-*` tokens, `.arc-*` classes and keyframes;
- `.studio-lab` and the empty `.scn-theme {}`;
- `pages/Studio.tsx`.

The deletion list is **rg-verified at task time**, not fixed by this spec. At minimum it includes:
- the `App.tsx:10` import and the Studio branch at `App.tsx:67-88`;
- the `App.test.tsx:17` mock of `@/pages/Studio`;
- `__tests__/Studio.test.tsx`;
- the Studio entry in the `rawErrorMessageSurface.test.ts` allow-list (4 entries; the other 3 stay).

Run the routing suite (`App.test.tsx`) after the removal. The old `.dark` block is replaced in Phase 5, not deleted here.

**5.1.3 Status tokens and contrast (G3, G4).**
- Map `--success`, `--warning` and `--danger` (plus their `-bg` and `-border` variants) into `@theme inline`.
- Replace every raw `(bg|text|border)-(amber|red|green|emerald|yellow|sky|slate)-NNN` class in non-test `src/` with the token.
- Add a source-reading guard. It walks `src/`, keeps an asserted allow-list, and includes a non-vacuity case.
- Primary-coloured **text** uses the existing `--green-700` `#48611E`. Filled primary buttons keep `--primary` (white on primary is 4.56:1, which passes). No palette value changes.
- `--text-faint` (3.58:1) is limited to non-essential text.
- `--input` moves to `--line-strong`.
- Add `--text-2xs: 0.6875rem` (11px). It replaces every `text-[9px]`, `text-[10px]` and `text-[10.5px]`, and `.scnd-kicker` goes to 11px. A second guard forbids sub-11px arbitrary sizes.

### 5.2 Phase 2: Shared components and copy (display only)

**5.2.1 One formatter set (G5, G24).**
- Broaden `formatDistanceDisplay`'s documented scope (today it's limited to Distances grids, `formatDistanceDisplay.ts:1-14`) to cover **every displayed distance**. It stays display-only; `roundForFile` (serialization) and the server export number formats are untouched.
- Add `formatMoney(value, { compact })` beside `formatObjective`:
  - compact `$169.06M` for chips and the narrative;
  - full `$169,061,531` for tables.
- The objective always carries a currency or a unit. `formatChenObjective` stays the Ch 4 authority.
- Latitude/longitude display at 4 dp.

**Call-site inventory (each one must switch; verified at task time with rg):**

| Area | Call sites |
|---|---|
| Tabs | `AssignmentsTab.tsx:190`, `FlowsTab.tsx:131`, `JadeAssignmentsTab.tsx:239`, `JadeFlowsTab.tsx:227`, `CostSummaryTab.tsx:32-61` |
| Maps | `OutputMapTab.tsx:204` (objective/avg chip), plus the NetworkMap tooltips and popups |
| Narrative | `resultNarrative.ts:44,61,117` |
| Elsewhere | Edit dialog lat/lng; Compare; Landing |

**5.2.2 Band labels in the UI (G6 UI part, Q5).** There are four representations today:

| Representation | Where |
|---|---|
| `Band N: range` | `bands.ts:109-132` |
| `0–200` / `> 1,600` | `bands.ts:152-170` |
| `Band N` / `Overflow` in cells | `JadeAssignmentsTab.tsx:242-248`, `JadeFlowsTab.tsx:272-319` |
| `≤ X` plus a separate overflow row | `MapLegend.tsx:295-335` |

They're replaced by **one range-label authority in `@workspace/units`**, beside the existing `bandLabelOrOverflow` and shared with the server so the UI and exports can't drift. It follows these semantics:

- **Upper-inclusive boundaries** (unchanged): a value equal to a boundary belongs to the lower band.
- **Text:** first band `≤ 200 mi`, middle bands `200–400 mi`, overflow `> 1,600 mi`. The unit is the display unit, and boundaries are converted with the existing unit API.
- **No "Band N" numbering** anywhere in the UI.

A studio `BandLabel` component renders that text plus a colour swatch and pattern swatch. It's used in table cells, filter options, the map legend, the route popup and Service Stats. A guard forbids `Band ${…}` label construction outside the authority. These are rewritten in the same task: `bands.test.ts:267-316`, `JadeFlowsTab.test.tsx:366-370`, and every e2e spec asserting `Band N` or `Overflow` (grep `artifacts/studio/e2e/`). The export side of Q5 is Phase 4 (§5.4.3), because it's a contract change.

**5.2.3 Units (G7, C1, CR-9).**
- Units move into column headers. Per-cell "Units" suffixes are removed from `CustomersTab`, `CapabilityMatrixTab`, `entityCells`, `FormattedNumberInput` and `CreateEntityDialog`.
- Transportation Costs keeps the header unit and drops the repeat under each input.
- Add `demandUnit: "tons" | "units"` to the `Chapter` type (`lib/chapters.ts:3-37`). It's **required**, so the compiler catches every entry:
  - `two-echelon-jade-us` → `"tons"` (user-confirmed, C1);
  - the other 7 → `"units"` until confirmed otherwise.
- The consumers are the five files above plus any header that renders a demand column (rg at task time).
- No manifest change.

**5.2.4 Copy pass (G10).**
- Remove "(legacy result)".
- "Quality: Unverified" gets an explanatory tooltip, or is hidden when it means nothing to a student.
- "4 of 4" becomes "4 plants".
- The result-history pager reads "Run 1 of N" and is hidden when N = 1.

**5.2.5 Header and actions (G11, G12).**
- The header title is the chapter `title`. The description moves to a subtitle or tooltip and never truncates the actions.
- One filled primary action per view. "Compare Scenario" becomes an outline button.
- The Output Map lane-colour mode becomes a segmented control or select.
- Save placement is untouched until Phase 6 removes the button.

**5.2.6 Tables (G13, G14, G15, D5).** In the shared `DataTable`:
- Sticky column header.
- The pager is pinned to the table's visible bottom edge. `PAGE_SIZE` stays 50.
- While loading, show a skeleton, never the empty-state copy.
- ID columns `nowrap`, with a minimum width.
- A value repeated on every row (for example the Distances leg pill) becomes a filter or group header.
- Status segments and checkboxes are at least 24×24 CSS px (WCAG 2.5.8).

**5.2.7 Entity naming (G20, G24).**
- Every surface shows **name + stable ID** (the `formatLocation`/`EntityIdCell` conventions): tooltips, the details card, the Edit dialog ("Code: Kansas City" becomes name + `wh-27`), and tables.
- Tooltips drop the duplicated city.
- One tooltip typography for both maps: sans for text, mono for the ID only.
- City names aren't unique, so the ID is mandatory.

**5.2.8 Parameters and footer (G16).**
- The P presets become the current P ± 2, clamped to 1 … active warehouse count. Manifests carry no default P (`two-echelon-jade-us/manifest.json:21`).
- One-line helper text under the gap and time-limit fields.
- The Landing footer is no longer sticky.

### 5.3 Phase 3: Map interactions (display/interaction only)

**5.3.1 Touch and keyboard parity (G17, C2).**
- Every `MapActionMenu` action is also available as a visible button row in `MapDetailsCard`. Right-click stays as a shortcut.
- The card's actions are keyboard-focusable, and Escape closes the card.

**5.3.2 Truthful hints (G18).** The hint is derived from the same action list the menu renders. Today `MapDetailsCard.tsx:153` branches on `fixedGeography`, while the menu filters base vs added entities independently.

**5.3.3 Selection (G19).**
- Use the `--map-ring-select` ring on the Input Map too.
- Add a close button to the card.
- Position the card so it doesn't cover the selected marker.

**5.3.4 Output filter and route (G21, G22).**
- Selecting a warehouse dims every lane not connected to it, on both legs.
- While a filter is active, the narrative shows the selected warehouse's figures.
- The hover tooltip is suppressed for the entity whose popup is open.
- In multi-product models, the route popup lists product → warehouse → feeding plant, with distances via §5.2.1.
- In the popup, inbound lanes take their band from §5.4.1 when Phase 4 lands. Until then they use the current shared lens.

### 5.4 Phase 4: Multi-echelon and multi-product (both contract changes live here)

**5.4.1 Per-leg bands (G9, D3/Q1, CR-1/2/3/8, Q2/Q3/Q4/Q7).** This applies to the models that are two-echelon **and** carry `distanceBands`: `two-echelon-jade-us` and `two-echelon-gold-au`. `docs/model-integration-precheck.md` is mandatory for this task set.

- **Validation (CR-1).**
  - Add optional `inboundDistanceBands: z.array(z.number().positive()).min(1).optional()` to the hand-written Zod input schemas, `jadeInputs.ts:193-244` and `twoEchelon.ts:86-122`. These are the executable validators. The manifest `inputsSchema` is descriptive only (`modelRegistry.ts:14-20`), and without this the key is silently stripped by `z.object()` (`modelRegistry.ts:134-150`).
  - Mirror the key in both manifests' `inputsSchema.properties`.
  - **Never add it to `required[]`.** 284 production JADE rows lacked comparable keys when last measured (root `CLAUDE.md` gotcha, measured 2026-10-10). Re-count the production rows before Phase 4 ships.
  - No OpenAPI or codegen change is needed for the input itself, because generated `ScenarioInputs` is opaque (`lib/api-zod/src/generated/types/scenarioInputs.ts:10-12`).
- **Persistence (Q4, CR-3).**
  - Readable and writable via the existing scenario GET/PATCH.
  - Edits from the studio go through a **dedicated field-scoped route** modelled on `routes/distanceBands.ts`: a single `jsonb_set`, user-scoped, 404 when the scenario isn't owned.
  - Entity CSV/JSON import is unchanged, and no scenario-level import format is added (`routes/scenarios.ts:1957-1968`: bands are never imported entities).
- **Staleness (Q3).** Inbound-band writes don't bump `inputsUpdatedAt`, so `stale` stays false. This mirrors the reporting-lens exception pinned by `scenarioSolveAtomicity.test.ts:499-525`.
- **Fallback (Q7).** If `inboundDistanceBands` is absent, inbound legs band against `distanceBands`. Every existing scenario therefore renders exactly as it does today.
- **One selection adapter (CR-2).**
  - `bandsForLeg(leg, inputs)` lives in `@workspace/units`, so the studio and the server share it.
  - It classifies `edge.leg` using the same inbound/outbound role sets as `lib/legPalette.ts:20-21`. Move those sets into `@workspace/units` and have `legPalette.ts` import them, so there's one authority.
  - It returns `inboundDistanceBands ?? distanceBands` for inbound legs and `distanceBands` for outbound legs.
  - Every consumer calls it, and nothing re-implements the choice:

| Side | Consumers |
|---|---|
| Server | `routes/scenarios.ts:771-825` (today reads only `inputs.distanceBands`); the `templates.ts` builders at `1810-1831`, `1890-1905` and `2072-2113` (service stats, generic flows, JADE assignments and flows) |
| Studio | NetworkMap lanes and legend; `JadeFlowsTab`; `FlowsTab`; the route popup; `ServiceStatsTab`; the narrative |

  - rg for `distanceBands` and `bandLabelOrOverflow` at task time, and list any extra consumers in the task.
- **Editor.** Optimization Parameters shows a second band editor, "Inbound lanes (plant → warehouse / mine → refinery)", beside the existing "Customer-facing lanes" editor. It's driven by a manifest/registry capability, not a model-id ternary.
- **Service Stats (Q2, CR-8).**
  - The outbound coverage bars are **unchanged**. They're outbound-only on purpose (`ServiceStatsTab.tsx:199-205`) and match `solve.py`'s `band_coverage`.
  - Add an "Inbound lanes" table:

| Column | Meaning |
|---|---|
| `inbound band` | `BandLabel` text |
| `flow` | inbound flow volume summed over inbound edges in that band, in the model's demand unit |
| `share` | % of total inbound flow |

  - It's computed in TypeScript from `result.edges` through `bandsForLeg`.
  - It's exported as a new Service Stats section. Its row shape is defined in §5.4.3.

**5.4.2 Collapse product repetition (G8, D4).** All of this is display-only; exports keep the full flat shape.
- **Customer Assignments** (multi-product): one row per customer. If all products go to one warehouse, the row shows that warehouse. Otherwise it shows "split (n warehouses)" and expands to per-product rows. This is a client-side group-by.
- **Plant Production:** rows with zero enabled capacity are hidden behind a "Show disabled plant-products" toggle. "Remaining capacity" becomes "Utilization %".
- **Capability Matrix:** capacity is printed only on enabled cells.

**5.4.3 Export contract (G6 export part, Q5).** The export `distance_band` values change from `"Band N"` / `"Overflow"` to the §5.2.2 range text, produced by the shared `@workspace/units` authority. Per-leg JADE/gold exports use `bandsForLeg`, and the Service Stats export gains the inbound section.

The contract parts must stay in step, so all of the following land in **one task and one commit**:
- In `templates.ts`, introduce a **grid-local version constant** for the grids whose `distance_band` or row shape changes. This follows the `COST_SUMMARY_TEMPLATE_VERSION` precedent, because `OUTPUT_TEMPLATE_VERSION = 3` is shared by grids that don't change (`templates.ts:57-72`). Enumerate the affected grids by rg for `bandLabelOrOverflow` and `distance_band` in `templates.ts`.
- Update `lib/api-spec/openapi.yaml`: the version enums (today `enum: [3]` at `:2578`, `:2600`, `:2655` as applicable) and the export descriptions at `:697-720`, which document the `"Band N"` format.
- Regenerate the Orval output (hard rule #1).
- Add contract tests **pinned to the constant, never a literal**, validating **at least one populated row returned by the production builder**. This applies the root `CLAUDE.md` gotcha on version bumps.

### 5.5 Phase 5: Dark mode (D6)

- Replace the current `.dark` block (unrelated blue palette, never applied) with a brand-derived dark variant: ink surfaces, paper text, olive accents.
- Every Phase 1 semantic token gets a dark value. Both themes are checked against the §5.1.3 targets.
- Re-validate the band ramp and patterns on the map tiles. No new tile provider.
- Theme control:
  - follows `prefers-color-scheme` by default;
  - a header toggle (light / dark / system) persists per viewer in `localStorage`, with try/catch around every read and write and a correct render without storage.

### 5.6 Phase 6: Autosave (D7, G23, CR-4/CR-5)

This is a behavioural change and lands last.

- **One serialized write queue per scenario** in `Workspace`:
  - It keeps one in-flight request at a time, with a monotonically increasing revision ID.
  - A response for an older revision than the latest one sent never overwrites newer local state.
  - Committed edits — the existing grammar-complete commit points of `useDistanceDraft` and the table/map edit paths — are enqueued after a 1 s debounce. Edits to the same field within the window coalesce.
- **Field-scoped writers (CR-4).** Each edit goes through the writer the code already uses for that field.
  - Geometric/model edits go through the PATCH path and bump `inputsUpdatedAt`, so `stale` can flip.
  - Band edits (`distanceBands`, `inboundDistanceBands`) go through their field-scoped routes and **don't bump it**.
  - Staleness stays timestamp-based (`isStale()`).
- **`flushAutosave()` (CR-5)** returns once the queue is empty and the last write was acknowledged. It is awaited by:
  - Run Optimizer, before `POST /solve`. This replaces today's save-dirty-then-solve at `Workspace.tsx:3074-3118`.
  - Save-as-scenario.
  - Scenario switch.
  - Route navigation.
  - Unmount: best-effort flush, and on `pagehide` a beacon/keepalive request.

  This addresses the earlier 600 ms autosave regression that dropped edits on a scenario switch (`Workspace.tsx:1593-1601`).
- **Failure:**
  - The edit is retained in memory.
  - The indicator shows the `describeWriteError` sentence (never the raw `err.message`).
  - Retry re-sends the coalesced payload.
  - Solve is blocked, with the message shown, while unsaved failures exist.
- **Indicator:** "Saving…" / "Saved" / the error sentence with a Retry action, in the header.
- **Undo:**
  - The last 20 committed edits per scenario, for the current session.
  - Available via Cmd/Ctrl+Z (when focus isn't in a text input) and a header control.
  - An undo enqueues a normal write.
- **Removed:**
  - the page Save button;
  - `DirtyNavPrompt` (`Workspace.tsx:4718-4728`) — navigation awaits the flush instead;
  - the Edit dialog's "Save", which is renamed "Apply".
- **Security:** writes use the existing user-scoped routes (404 when not owned). There's no new endpoint beyond §5.4.1's.

## 6. Task / commit matrix (CR-6)

A phase holds several tasks. **Each task is exactly one commit** (`[DU-<phase>.<n>] …`). A task that crosses a layer boundary — Zod, server, studio, OpenAPI, codegen — is **one atomic task**, never split across layers (root `CLAUDE.md`: a contract change is one commit; remove consumers before producers). Phases merge only per the root branch-discipline pipeline.

| Phase | Tasks (indicative; the plan finalizes them) | Atomic cross-layer seam |
|---|---|---|
| 1 | colour tokens + patterns; status tokens + sweep + guard; contrast + type floor + guard; Studio removal | none |
| 2 | formatter set + inventory; BandLabel UI + `@workspace/units` range authority; units + `demandUnit`; copy pass; header/actions; DataTable sticky/pager/loading/ID/targets; entity naming; params/footer | the `@workspace/units` range helper is display-only in Phase 2 (server exports don't use it yet) |
| 3 | details-card actions + hints; selection ring + card; output filter + narrative; route popup + tooltip suppression | none |
| 4 | **DU-4.1:** `inboundDistanceBands` across Zod + manifests + field-scoped route + `bandsForLeg` + studio consumers + editor + tests (one commit). **DU-4.2:** export contract — label format + grid-local version + OpenAPI + Orval + contract tests (one commit). **DU-4.3:** inbound Service Stats table + export section (one commit, or folded into DU-4.2 if the row shape changes together). **DU-4.4:** product-repetition collapse (studio only). | DU-4.1, DU-4.2 |
| 5 | dark tokens; theme toggle | none |
| 6 | write queue + flush + indicator + undo + Save/DirtyNavPrompt removal | the studio-only behaviour change uses existing routes |

## 7. Error handling

- Formatters return `—` for non-finite values. This is the existing `formatDistanceDisplay` behaviour, extended to `formatMoney`.
- An absent `inboundDistanceBands` is a valid state, never an error.
- Autosave failures never drop the edit (§5.6).

## 8. Testing and QA (CR-11)

**Every task:** `pnpm gate` is green. Run `e2e_accuracy.py` **and** `e2e_journey.py` directly and confirm both pass unmodified. They aren't pytest-discovered (precheck `:317-347`).

**Acceptance matrix:**

| Area | Required tests |
|---|---|
| Guards (Phase 1–2) | no raw palette classes; no sub-11px arbitrary text; no `Band ${…}` label construction outside the authority. Each is a tree walk with an asserted allow-list and a non-vacuity case |
| Formatters | `formatMoney`; each inventoried call site renders the shared format |
| Band labels | boundary inclusivity, first/middle/overflow text, unit conversion, identical output from studio and server |
| Inbound bands (DU-4.1) | Zod retains the key on create and PATCH (API test); the field-scoped route keeps `stale=false` and leaves `inputsUpdatedAt` unchanged; non-owner gets 404; fallback to `distanceBands` when absent; a fixture without the key still validates; `bandsForLeg` on both legs for JADE and gold |
| Export contract (DU-4.2) | test pinned to the new constant; at least one populated row from the production builder; OpenAPI enum matches the constant |
| Service Stats | the inbound table sums to total inbound flow; outbound bars unchanged vs `solve.py` `band_coverage` |
| Group-by (DU-4.4) | all-same vs split customers; the export stays flat |
| Autosave (Phase 6) | debounce + coalesce; out-of-order responses rejected; solve during the debounce window waits for the flush; scenario-switch flush; failure retention + retry; solve blocked while failures are unsaved; undo; band edits don't flip `stale` |
| Rewritten tests | `bands.test.ts`, `JadeFlowsTab.test.tsx`, `Workspace.Integration.test.tsx:280-291,605-627` (Save behaviour), `App.test.tsx` (Studio mock) |

**Real-browser QA (qa-sdet, every phase).**
- CSS-only behaviour is invisible to jsdom, so check it in Playwright against local servers (`E2E_BASE_URL` set) across **all 8 chapters**: sticky header, pinned pager, patterns, 24px targets, tooltip suppression, dark theme, touch-emulated map actions.
- Re-measure contrast from the shipped tokens.

**Sibling e2e specs.** Before each merge, grep `artifacts/studio/e2e/` for every testid or string the task changes — `Band N`, `Overflow`, `Units`, the Save button, the pager, the header title, Studio — and rewrite the affected specs so they pass.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The in-brand ramp has too little contrast between steps | Numeric gate (§5.1.1); patterns carry the signal independently |
| The new key is stripped or lost on write | Zod change + API retention test (DU-4.1) |
| One consumer keeps reading the wrong band set | One `bandsForLeg` adapter + rg inventory + the precheck gates |
| Export consumers break on the new label format | Grid-local version bump + OpenAPI enum + contract test pinned to the constant |
| Autosave races solve, switch or navigation | Serialized queue + awaited `flushAutosave()` + out-of-order tests |
| A UI string or testid change breaks prior e2e specs | Per-task sibling-spec sweep |

## 10. Review log: Codex round 1 (high effort, 2026-10-24)

| ID | Disposition | Where folded / reason |
|---|---|---|
| CR-1 Zod strips the key | accept | §5.4.1 Validation; §8 |
| CR-2 server exports/stats hard-code one band set | accept | §5.4.1 adapter + consumer list |
| CR-3 import round-trip claim false | accept | §5.4.1 Persistence (Q4) |
| CR-4 autosave staleness vs band lens | accept | §5.6 field-scoped writers; Q3 |
| CR-5 flush-before-solve unspecified | accept | §5.6 queue + `flushAutosave()` |
| CR-6 phase vs one-task-one-commit | accept | §6 |
| CR-7 BandLabel ambiguous | accept | §5.2.2 semantics + test list; Q5 |
| CR-8 per-leg coverage semantics | accept | §5.4.1 Service Stats (Q2) |
| CR-9 `demandUnit` missing | accept | §5.2.3 |
| CR-10 formatter inventory missing | accept | §5.2.1 |
| CR-11 test plan gaps | accept | §8 |
| CR-12 Studio deletion misses a test mock | accept | §5.1.2 |
| CR-13 unused ui deletion is overkill | accept | §2 (Q6) |
| CR-14 "284 rows" unverifiable | **reject** | The count is recorded in the root `CLAUDE.md` gotcha (measured 2026-10-10). §5.4.1 cites that source and date and requires a re-count before Phase 4 ships |
