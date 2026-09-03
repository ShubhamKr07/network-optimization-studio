# SCND Optimization Studio — Design System

Design system for **SCND Optimization Studio** ("By Prof. Michael Watson"), an educational web app for learning supply chain network optimization: build a scenario on a map, solve it with a real ILP/LP solver (p-median facility location, transportation LP, two-echelon), and compare results chapter by chapter.

Visual identity is drawn from the cover of *Supply Chain Network Design: Applying Optimization and Analytics to the Global Supply Chain* (Watson, Lewis, Cacioppi, Jayaraman): leaf green + near-black bands + paper white, a serif title voice, and the grayscale world-map network motif. Light theme only.

**Sources**
- GitHub: `ShubhamKr07/network-optimization-studio` (branch `main`) — frontend at `artifacts/studio/src` (React + Tailwind + shadcn/Radix + Leaflet). Component inventory and screen structure come from this codebase; the visual skin comes from the book cover.
- Book cover reference image: `uploads/pasted-1788245307614-0.png`.

## Content fundamentals

Tone is **academic and textbook-like**: plain statements, no hype, no exclamation points, no emoji. Copy teaches.

- Sentence case everywhere except uppercase kicker labels ("CHAPTER 3", "SCENARIOS").
- Definitions lead with the concept, colon, then the plain-English task: *"Facility-location: choose which warehouses to open to minimize weighted distance to customers."*
- Status statements, not alerts: *"Stale — inputs changed since this solve."* / *"Not yet solved."*
- Instructional imperative for empty states: *"Pick a chapter to start or continue a scenario."*
- Numbers are data: mono font, explicit units (`obj 2.38e+6`, `412.7 mi`, `run 0.24s`), lowercase stat labels.
- Speak to "you" sparingly; prefer describing the model or the scenario.
- Chapters are the organizing vocabulary: Chapter 3, Chapter 5, Chapter 10 — mirrored from the book.

## Visual foundations

- **Color.** Paper-white pages (`--surface-page #FCFCFA`), white cards, warm near-black ink (`#181A15`). One accent family: the cover's leaf green (`--green-400 #93B747` for marks/fills, `--green-600 #5F7F28` for text/buttons — AA on white). The near-black **band** is the signature motif: full-width dark strips (app header, hero, section headers) with paper/green text, straight from the cover's title band. Max two background colors per view (paper + white; band as chrome).
- **Type.** `Source Serif 4` for display/headings (the cover's serif voice, often in green or on the dark band); `IBM Plex Sans` for UI and body; `IBM Plex Mono` for every number, stat, chip, axis label, and uppercase kicker. Kickers: mono, 10–11px, `letter-spacing 0.14–0.22em`, uppercase, muted.
- **Shape.** Rectilinear and print-like: radii 3/4/6px only, never pills (except demand bubbles on maps). No pill buttons.
- **Borders & shadows.** 1px `--line #E2E4DA` hairlines do the structural work (the app is tables, panes, and rules). Shadows are minimal: `--shadow-sm` on cards, `--shadow-overlay` only on dialogs/popovers. Flat, printed feel.
- **Backgrounds.** Solid colors only — no gradients. The only texture allowed is the map field itself and the striped image placeholder. Dark band sections may carry a faint green rule (`2px solid --green-400`) at their bottom edge, echoing the cover's green rules.
- **Spacing.** 4px grid (`--space-1..16`). Dense, analyst-grade layouts: 36px controls, 30px compact controls, 12px cell padding in tables.
- **Interaction.** Hover: background shifts to `--surface-sunken` or border darkens; primary buttons darken one step (`--primary-hover`). Active: one more step darker. Focus: 2px ring in `--focus-ring` offset 1px. Transitions 120–160ms ease; no bounces, no scale effects.
- **Selection.** Selected rows/nav items: `--surface-selected` (pale green) + `--green-700` text or a 2px inset left rule in green.
- **Data-viz.** Distance bands are the fixed 5-color scale `--band-0..4` (green→red, index 0 = nearest). Charts default to `--chart-1` green + ink; gridlines `--chart-grid`; axis labels mono. Map: warehouses = triangles (outline = potential, filled = fixed-open, dashed = inactive), customers = green demand bubbles sized by demand, flows = thin green lines.
- **Imagery.** No photography. The world-map network graphic from the cover is represented with a striped placeholder (`assets/map-placeholder.svg`) until real map tiles/artwork are supplied.

## Iconography

- **Lucide** (stroke icons, 1.5–2px stroke) — the app's own icon set (`lucide-react`). In HTML use the CDN: `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()` with `<i data-lucide="plus"></i>`.
- Common glyphs: `plus`, `pencil`, `copy`, `trash-2`, `x`, `alert-triangle`, `play`, `map-pin`, `table`, `git-compare`.
- Sizes 12/14/16px in chrome; never above 24px. Color inherits text color. No emoji, no unicode dingbats.
- **No logo exists** in the provided sources: render "SCND Optimization Studio" in type (serif display, or sans semibold in chrome) wherever a mark would go.

## Index

- `styles.css` — global entry; imports all tokens below.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `dataviz.css`, `fonts.css`.
- `guidelines/` — foundation specimen cards (colors, type, spacing, bands, data-viz).
- `assets/` — `map-placeholder.svg` (striped stand-in for map imagery), `ds-loader.js` (card/UI-kit loader: uses `_ds_bundle.js` when present, else compiles the `.jsx` sources in-browser).
- `components/core/` — Button, Badge, Input, Select, Checkbox, Card, Table, Tabs, Dialog.
- `components/studio/` — ObjectiveBar, ConstraintChips, MapLegend, SidebarTree, TabBar, StaleOutputBanner.
- `ui_kits/studio/` — the Studio app UI kit (Labs landing + tabbed scenario Workspace), interactive.
- `SKILL.md` — agent-facing usage guide.

**Intentional additions:** none. Component list mirrors what `artifacts/studio/src` actually uses (the repo's full shadcn folder is stock boilerplate; only used families are styled here).
