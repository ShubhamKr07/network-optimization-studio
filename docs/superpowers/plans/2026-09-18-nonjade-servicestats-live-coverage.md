# Non-JADE ServiceStats live coverage — Plan

**Date:** 2026-09-18 · **Base:** `main` (`d38361b`) · **Spec:** `docs/superpowers/specs/2026-09-18-nonjade-servicestats-live-coverage-design.md`
**Execution:** agent-team. Frontend-only, contained (2 files) — one build task + QA + review. **No solver/Python** → `e2e_accuracy.py` not run.

## Process
- Base guard on every agent (JADE-bundle lesson): `git merge-base --is-ancestor <main-tip> HEAD` before implementing; `main` is now current so no retarget needed.
- Explicit-pathspec commits, `git status` before commit, no push/main edits by agents (controller cherry-picks + re-gates).
- Docs merged to local `main` on creation.

## Tasks

### T1 — ServiceStats generalization + Workspace wiring (frontend)
**Files:** `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx`, `artifacts/studio/src/pages/Workspace.tsx` (+ their tests). Spec §4.
- **ServiceStatsTab:** (a) `useLiveCoverage = presentationBands != null && presentationBands.length > 0` (drop the `supportsPlantProductCapability` gate — model selection now lives in the caller); (b) general `serviceEdges` = if any edge has a `leg` → `edges.filter(e => isOutboundLeg(e.leg))` (import `isOutboundLeg` from `lib/legPalette.ts`), else all `edges`; (c) `bandCoverage = useLiveCoverage ? computeCumulativeBandCoverage(serviceEdges, presentationBands) : (result.metrics.bandCoverage ?? [])`; (d) refresh the JADE-only comments to reflect the generalization. Plant Production section untouched (still `supportsPlantProductCapability`-gated).
- **Workspace:** pass `presentationBands` (= `distanceBandsFromInputs(localInputs)`, the live value already fed to the Output Map) to `ServiceStatsTab` for **every model except `chens-cosmetics-cn`** (gate `modelId !== "chens-cosmetics-cn"`). Extend the existing JADE-only wiring to the other-model ServiceStats render path.
**DoD/tests (spec §5):** single-echelon live recompute over ALL edges + overflow row; `two-echelon-gold-au` over `refinery_to_customer` ONLY (inbound `mine_to_refinery` excluded); edited boundary reclassifies with zero network calls; chens stays frozen; JADE unchanged (W→C only); Workspace passes `presentationBands` to a non-JADE distance-band model and NOT to chens. Gate: `pnpm run typecheck` + `pnpm --filter studio test`.

### T2 — QA (qa-sdet, real browser)
**File:** `artifacts/studio/e2e/nonjade-servicestats-live-coverage.spec.ts`. Spec §6.
Post-solve band edit on `p-median-us` (single-echelon) and `two-echelon-gold-au` (two-echelon): ServiceStats coverage bars re-bucket live with **no** `/solve` call; map + bars agree. `chens-cosmetics-cn` bars do NOT change on a band edit. Run twice; report product bugs to controller.

### Review — whole-diff review before merge
Independent reviewer over `main..HEAD`: verify the edge-selection is correct per model (outbound-only for two-echelon, all for single-echelon), chens genuinely excluded (both at the gate AND at the Workspace wiring), no regression to the frozen path or Plant Production, semantics match. Report-only.

## Gate
typecheck · studio vitest · (api-server/pytest unaffected — frontend-only). Full whole-branch review → merge to local `main`. Deploy held unless approved (frontend-only → `nos-studio`).
