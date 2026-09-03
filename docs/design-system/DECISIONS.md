# Bundle 3 — Book-cover design system: locked decisions

Date: 2026-09-03. Source design package: this folder (`nos-design-system`), drawn from the
*Supply Chain Network Design* book cover (leaf green + near-black bands + paper white, serif title
voice, grayscale map motif). These decisions were locked with the user during brainstorming, before
any spec was written. They govern the forthcoming Bundle 3 spec/plan/build.

## Goal

Replace the app's current blue shadcn / `.scn-theme` (Phase 3.1 blue-gray Barlow wireframe) look with
the textbook-cover brand across all live surfaces. Pure presentation change — no behavior, contract,
API, or solver changes. Light theme only.

## Locked decisions

1. **Supersede `.scn-theme`.** The book-cover system *replaces* the Phase 3.1 `.scn-theme`
   (blue-gray / Barlow / radius-0), which was a different visual direction. Its values get
   overwritten with the green/serif/band palette. One theme, not two — no selectable-theme toggle.

2. **Scope: app-wide.** Landing + auth (Login/Register) + Workspace all reskinned in one coherent
   pass. The current global blue `:root` look is retired. `Studio.tsx` / `.studio-lab` are **excluded**
   — dead code (all four chapters are `workspace: true`, so Studio is unreachable via navigation).

3. **Fidelity: token-retarget + close-match the 6 studio components.**
   - Retarget the app's existing shadcn HSL variables to the book-cover palette, swap the three
     fonts, set print radii, keep hairline borders — the Phase 3.1 proven, low-risk path. Radix
     accessibility, focus, keyboard nav, and the ~677 studio tests stay intact.
   - The package's reference components (`components/**`) are **non-shadcn specimens** (inline-styled,
     no Radix a11y, no test IDs, compiled in-browser by `ds-loader.js` for the kit only). They are a
     **visual spec, not drop-in code.**
   - Additionally close-match the 6 brand-carrying, non-Radix studio components to the reference:
     `SidebarTree`, `TabBar`, `ObjectiveBar`, `ConstraintChips`, `StaleOutputBanner`, `MapLegend`.
   - Explicitly **rejected:** pixel-matching / rebuilding every shadcn component to the reference JSX
     (high regression + a11y risk for imperceptible pixel gain).

## Design shape (3 layers → 3 build waves)

### Layer 1 — Foundations (tokens + fonts), promoted to global `:root`
- Palette → shadcn HSL triples at global `:root` (replace blue boilerplate): `--background`=paper
  `#FCFCFA`, `--card`=white, `--foreground`=ink `#181A15`, `--primary`=green-600 `#5F7F28`,
  `--primary-foreground`=white, `--muted`=paper-2, `--muted-foreground`=ink-500, `--accent`=green-400,
  `--border`/`--input`=line `#E2E4DA`, `--ring`=green-500, `--secondary`=green-050. `--destructive`
  stays red.
- Additive raw hex tokens shadcn lacks (consumed directly): `--green-050..800` scale, `--ink-*`,
  `--surface-band` / `--surface-band-fg` / `--surface-selected`, `--band-0..4` (5-color, replaces
  today's 4), map-entity colors, chart tokens.
- Radii: `--radius: 4px` (shadcn sm/md/lg → 3/4/6).
- Fonts: `@import` Source Serif 4 + IBM Plex Sans + IBM Plex Mono. `--app-font-sans`=Plex Sans,
  `--app-font-heading` (+ new `--app-font-display`)=Source Serif 4, `--app-font-mono`=Plex Mono.
- Retire `.scn-theme` scope: fold its role into `:root`; leave the class on Workspace as a no-op
  (avoid touching Workspace.tsx + its test just to drop a className).

### Layer 2 — Band motif + chrome (markup, not just CSS)
- **Dark band** utility (`--surface-band` bg + `--surface-band-fg` text, optional 2px green bottom
  rule): Landing hero ("Network Design Labs" in green Source Serif + mono kicker "OPTIMIZATION STUDIO
  BY PROF. MICHAEL WATSON"), Workspace top header, auth header strip.
- **Kicker label** utility: mono, 10–11px, `letter-spacing 0.14em`, uppercase, muted — for
  "CHAPTER 3", "SCENARIOS", section headers.
- Serif display for page/section titles (green, or on the band).
- Existing `AppFooter` ("© Developed by hx1") restyled to match; copy unchanged.

### Layer 3 — Studio components close-match + mono-numbers
- Close-match the 6 studio components (Tailwind-only, no behavior change): `SidebarTree` (green
  left-rule active row + mono uppercase section headers), `TabBar`, `ObjectiveBar`, `ConstraintChips`,
  `StaleOutputBanner`, `MapLegend`.
- **Mono-numbers pass:** `font-mono` on numeric/stat displays — ObjectiveBar & map metric overlay
  (`obj 2.38e+6 · 412.7 mi · run 0.24s`), table numeric cells, chips, badges-with-numbers, solve
  stats, kickers. Prose stays sans. (Enumerated concretely in the plan.)
- Data-viz alignment: distance bands → fixed 5-color `--band-0..4`; reconcile map
  marker/bubble/flow colors to the exact token values.

## Execution

- **One Bundle-3 spec, 3 waves** (Foundations → Band/Chrome → Studio+mono), each independently
  gate-green-able. Agent team, single-writer on `index.css` (Wave 1 only), per-file ownership
  elsewhere — same two-lane model as Bundle 2.2. May split into separate merges if smaller deploys
  are preferred; one bundle is recommended.
- **No behavior/contract/API/solver changes.** `e2e_accuracy.py` untouched. Test churn limited to
  class/snapshot assertions.
- **Recurring-bug-class guard:** any per-model style branch stays capability / `chapters.ts`-driven,
  never `modelId === "..."`.

## Open item (decide at spec time)

- The package is light-theme only; the dead `.studio-lab` / `Studio.tsx` are the only dark surface.
  Recommendation: **leave untouched** (zero-risk dead code) rather than delete — deletion is a
  separate cleanup. To be confirmed when the spec is written.
