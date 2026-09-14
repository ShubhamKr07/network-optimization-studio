# Chapter 9 JADE — Execution Ledger

Dynamic status of `2026-09-13-chapter-9-jade-two-echelon.md`. Agent-team dispatch; controller (main thread) re-gates each task on the merged `jade-ch9` state. Per-task gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`; +solver pytest & `e2e_accuracy.py` when Python/dataset changes.

Status key: ⬜ todo · 🟡 in-progress · ✅ done+gated · ⛔ blocked

## Wave 1 — Data + registry (listable, not solvable)
| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| T1 canonical dataset + extractor | solver-engineer | ✅ | `06902b0` | 8/8 test, all invariants matched. Notebook is EXTERNAL: `~/Downloads/network-optimization-studio/JADE_case_Chapter_9_Network_Design_Book.ipynb` (not in repo). Note: notebook has 2 `plant_product_info` defs — extractor targets the real 16-cell one. solver pytest 139/139, e2e_accuracy 87/87. |
| T2 dataset-schema + PACKAGE_SPECS + manifest | backend-engineer | ✅ | `73c96af` | 34/34, typecheck clean. countryBounds lat 25.78–47.61, lng -122.69..-71.05. |
| T3 registry listability | backend-engineer | ✅ | `ba9e059` | 28/28. Registry scans manifests dynamically, no hardcoded list. GET /api/models=5. SOLVABLE untouched. |
| T3.5 OpenAPI contract + codegen | backend-engineer | ✅ | `2b861cc` | cherry-picked (orig `1dabc7f`). 694/694 in-worktree; codegen 100%. ModelInfo.id is plain string (no enum site) — capability field added. |

**Wave 1 merged gate** (`3e9c7b9`): typecheck ✅ · api-server 705 pass (needs `DATABASE_URL` inline; cors/import failures were env/contention only) · studio 1225/1225. Collateral fix `3e9c7b9`: registry.test.ts + datasets.test.ts updated 4→5 models.

## Wave 2 — Solver + backend (solvable). Order: T4→T5→T6→T7 (routes/scenarios.ts serial)
| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| T4 solve_jade + merge + dispatcher + envelope | solver-engineer | ✅ | `6d5cdac` | (orig `24bbfab`) obj `254060828.6157` EXACT. 26/26 new + 165 full pytest, e2e_accuracy 99/99 (87+12). Dispatcher explicit p_median + unknown→error. Merged gate: solver 165, api 709, typecheck ✅. |
| T5 TS wiring (Zod+KNOWN_SCHEMAS+VALID_MODEL_IDS+buildPayload+SOLVABLE) | backend-engineer | ⬜ | | atomic; activates OBS-5 |
| T6 semantic precheck | backend-engineer | ✅ | `23aef24` | (orig `da06c41`) precheckJadeInputs, both sites via shared runNetworkEditsPrecheck. 789/790 (1 Brazil resultEnvelope timeout flake). FOLLOWUP: p_range/capacity error codes TS-only, not in openapi enum (inert — precheck not schema-validated outgoing). |
| T7 import/export/reset (+legDistances) | backend-engineer | ✅ | `0455f8e` | (orig `7333eb9`) plants/plantCapabilities/legDistances registered; mergeJadeDistanceChangesIntoOverrides attaches leg server-side. 850/851 (Brazil flake). DEVIATIONS: reset-to-baseline already removed in SCN 3.2 (nothing to register); JADE customers CSV add-mode disabled (needs 4-product demands). |

**Wave 2 complete (T4–T7).** JADE solvable + editable via API end-to-end.

## Wave 3 — Frontend. Order: T9→T10→(T11∥T12∥T13∥T14∥T15 file-disjoint)→T15.5
| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| T9 chapter reg + header + bounds | frontend-engineer | ✅ | `e0a9575` | (orig `36356bc`) 1231/1231. App.tsx/Landing/mapBounds all generic — no changes needed. Header uses chapterForModelId (no ternary). |
| T10 dataset + reference-distances endpoints | backend-engineer | ✅ | `ad2d841` | (orig `1f174be`) new data/jadeDataset.ts + routes/dataset.ts branch (capability-gated). 709/709 api, 7/7 client. reference-distances 2600 pairs w/ leg. scenarios.ts untouched. |
| T11 input tabs + capability matrix | frontend-engineer | ✅ | `b37eaf0` | (orig `73e07af`) PlantsTab+CapabilityMatrixTab new; CustomersTab per-product demand; OptParams pMax prop. Plant id minting local (T12 consolidates). 1275/1275. |
| T12 map editor (3 entity kinds) + autoDistance | frontend-engineer | ✅ | `d678329` | (orig `3d97e3d`) MapPlant kind, ap-/PL- ids, plant square marker, fillEstimatedJadeDistances (circuity 1.1791 both legs, recon err 1.5e-5). Plant-delete reconciliation regression passes. e2e_accuracy 99/99. Studio 1374, api 864. FLAG: map quick-create splits customer demand evenly across 4 products (granular=Customers tab). |
| T13 output map + leg palette | frontend-engineer | ✅ | `3984dba` | (orig `ea79a08`) new lib/legPalette.ts (semantic-role classifier, not modelId). NetworkMap `visibleLegs?` prop + per-product edge coalescing. 1243/1243. |
| T14 output grids + band overflow | frontend-engineer | ✅ | `8e2a501` | (orig `766a583`) 5 grids + bands.ts additive overflow (OVERFLOW_BAND/computeCumulativeBandCoverage). Fixed 2 pre-existing semantic-leg bugs (Assignments/Flows). 1306/1306. |
| T5 backend TS wiring | backend-engineer | ✅ | `d9ea2e0` | (orig `aa20d51`) agent watchdog-stalled AFTER completing (181 subset pass); controller committed the finished uncommitted work + re-gated. OBS-5 GREEN. api-server 766, 3 fails = known cors/resultEnvelope timeout flake (isolated 8/8). |
| T15 Distances tab | frontend-engineer | ✅ | `fdce686` | (orig `e73ae9b`) new standalone JadeDistancesTab.tsx (Leg col, (leg,fromId,toId) identity, 50/page, legDistances export/import). 33 RTL, 1339 studio. Props list documented for T15.5. |
| T15.5 Workspace integration | frontend-engineer | ✅ | `524eb7b` | (orig `7c1e9fd`) tab registry + effective-row projection + Save reconciliation. 1383/1383. GAP → T15.6: per-leg layer-toggle UI unwired (visibleLegs prop has no OutputMapTab checkboxes). |
| T15.6 output-map layer toggles (gap fix) | frontend-engineer | ✅ | `25e1435` | (orig `6085ae5`) per-leg checkboxes, generic legLabel (splits _to_), no NetworkMap/Workspace edits. 29/29. |

**Wave 3 complete (T9–T15.6).** Merged full gate (`25e1435`): typecheck ✅ · studio 1388 · solver pytest 165 · e2e_accuracy 99/99 · api-server 863/866 (3 = resultEnvelope/cors timeout flake, isolated 8/8).

## Wave 4 — QA + rollout
| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| T16 QA Playwright + full gate | qa-sdet | ✅ | `8c762d1` | (orig `f6eba7c`) Playwright 3× green, obj `254060828.6157` exact. Full gate: typecheck ✅, studio 1388, solver 165, e2e_accuracy 99/99, api 866 (flakes isolated 8/8). No product bugs. |
| T17 verify gate → unhide + deploy | controller | 🟡 | | AWAITING USER: unhide + merge-to-main + deploy decision |

**Whole-branch review (pre-T17):** Ready to merge, 0 Critical / 0 Important, 2 Minor (both non-issues: deleted-doc = false alarm/absent both refs; p_range/capacity TS-only enum = deferred by design).
