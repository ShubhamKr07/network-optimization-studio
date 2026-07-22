# Dataset label audit (C2.1)

**Scope:** `solvers/p-median-us/dataset/{warehouses,customers}.json` (26 warehouses, 200 customers — Al's Athletics, Chapter 3). The other two model packages (`transport-coal`, `p-median-brazil`) were not in scope for this audit; the plan's known-suspect list (WH23, WH25) is specific to this dataset.

## Why this ran now, out of its normal Phase 2 sequence position

C1.3 (API serving canonical data) was about to point `/api/dataset` at `solvers/p-median-us/dataset/`, replacing a duplicated TS copy in `artifacts/api-server/src/data/dataset.ts`. Diffing the two copies before doing that revealed they'd already diverged: the TS copy has different, geographically-correct labels for exactly the entries this audit was going to look for. Since unifying the two without fixing the canonical copy first would have **regressed** what students currently see (the TS-served API) back to the broken labels, this audit ran now rather than waiting for its originally-planned slot later in Phase 2. Confirmed with a human before touching anything (stop-and-ask, per policy).

## Methodology

Two independent checks, both automated:

1. **Cross-reference against `artifacts/api-server/src/data/dataset.ts`.** This file is a second, independently-maintained copy of the same p-median-us warehouse/customer data that currently backs `/api/dataset`. Diffed field-by-field (id, city, state, lat, lng, demand) against `solvers/p-median-us/dataset/*.json` by warehouse index / customer id.
2. **State bounding-box sanity check.** For every entry, checked whether its stored `(lat, lng)` falls within a ±1° pad of its stated US state's approximate bounding box. Catches gross state/coordinate mismatches independent of the TS copy.

## Findings

**Customers (200 entries):** zero discrepancies between the two copies; zero bounding-box flags. No action needed.

**Warehouses (26 entries):** both checks agree on exactly these 3:

| idx | field | before (solve.py / canonical JSON) | after (fixed, matches `dataset.ts`) |
|---|---|---|---|
| 23 | `id` | `STL` | `SFO` |
| 23 | `state` | `MO` | `CA` |
| 25 | `id` | `TPA` | `STL` |
| 25 | `state` | `FL` | `MO` |
| 26 | `id` | `LUB` | `LBB` |
| 26 | `city` | `Lubbock` | `Lubbock - Current WH` |

**idx 23 and 25** are the plan's known suspects ("San Francisco, MO" / "St. Louis, FL"). In both cases `city` and `lat`/`lng` were already correct (San Francisco's real coordinates, St. Louis's real coordinates) — only `id` and `state` had been cross-swapped between the two entries at some point. The bounding-box check independently flags both: San Francisco's coordinates fall well outside Missouri, St. Louis's fall well outside Florida.

**idx 26** is not a coordinate defect (Lubbock, TX's coordinates are correct and within TX) — `LBB` is Lubbock's real airport code (consistent with every other warehouse's id, which are all real airport codes; `LUB` is not a real code), and "Lubbock - Current WH" is a business-meaningful label from the textbook exercise (this is the one warehouse that already exists in the "before" state of the facility-location problem, as opposed to a candidate site) that the canonical copy had lost. Included in the fix for the same reason: the two copies disagree, and the TS copy's version is more informative and consistent with the rest of the dataset's naming convention.

## What was fixed and what was not

Only `id`, `city`, `state` string fields for these 3 entries, in `solvers/p-median-us/dataset/warehouses.json`. **Coordinates (`lat`/`lng`) and the distance matrix (`distances.json`) were not touched.** This matters because:

- `DISTANCE` in `solve.py` is keyed by **integer warehouse/customer index** (e.g. `(23, 47)`), not by the `id` string — relabeling `id`/`state` cannot change any distance lookup, objective value, or assignment the solver computes.
- The textbook's distance matrix (per Watson et al.) is untouched and remains the authority for validation.

Re-ran the full verification chain after the fix: `pytest tests/` (46/46), `e2e_accuracy.py` (102/102, unmodified expected values), and the new `datasets.test.ts` drift-guard (updated `version.json` sha256 to match). All green — confirms the fix is display/labeling-only and doesn't move any number the accuracy suite checks.

## Resolution of PRD open question OQ3

OQ3 asked whether the textbook's distance matrix or the city label should be authoritative when they disagree. In this case they didn't actually disagree in a way that required picking one over the other: the coordinates were already correct for the intended city in both entries, and only the bookkeeping fields (`id`, `state`) had been transposed. No case arose here where the distance matrix and a label pointed to genuinely different real-world locations.
