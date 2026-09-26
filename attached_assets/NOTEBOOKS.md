# Source notebooks — provenance

The textbook notebooks (Watson et al., *Supply Chain Network Design*) that each solver model was
derived from. They are reference material: nothing in the build, the test suites, or the running app
reads them. `CLAUDE.md` hard rule 7 puts this directory off-limits to routine edits.

**One file here is not byte-faithful to its source.** Read the Chapter 9 row before treating it as an
archival original.

| Chapter | File | Model(s) | Fidelity |
|---|---|---|---|
| 3 | `Chapter_3_Network_Design_Book_1781928344506.ipynb` | `p-median-us` | verbatim (pre-existing) |
| 4 | `ChensCosmeticsV1.ipynb` | `chens-cosmetics-cn` | **verbatim** |
| 4 | `ChensCosmeticsV1 Step 2.ipynb` | `chens-cosmetics-cn` | **verbatim** |
| 4 | `ChensCosmeticsV1 Step 3.ipynb` | `chens-cosmetics-cn` | **verbatim** |
| 5 | — | `transport-coal`, `p-median-brazil` | **no notebook exists** (see below) |
| 9 | `JADE_case_Chapter_9_Network_Design_Book.ipynb` | `two-echelon-jade-us` | **MODIFIED** (see below) |
| 10 | `../Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb` | `two-echelon-gold-au` | verbatim, but lives at the **repo root**, not here |

## Chapter 4 — verbatim

Source sha256, for anyone checking a copy against what was committed:

```
30350071beaf497d55bce1f95a491793535553e6b2e12c60267670437c7a09bf  ChensCosmeticsV1.ipynb
fc3db43ccca3ad0c5a4ae9d456139866391b6dd0397bab80749f6e40b6544f4d  ChensCosmeticsV1 Step 2.ipynb
5d03ff5a06b6bd43bca9b1c6a50ca72b480902a0908447a8abca869c7fb43955  ChensCosmeticsV1 Step 3.ipynb
```

These are the files `scripts/src/extract-chens-dataset.ts` consumes. Until now they lived only on one
developer's machine and the extractor took the path as a runtime argument, so the first step of
dataset extraction could not be run from a clean clone at all. It can now:

```bash
pnpm tsx scripts/src/extract-chens-dataset.ts "attached_assets/ChensCosmeticsV1 Step 3.ipynb"
```

**That command alone does NOT reproduce the committed dataset — it is step 1 of 2.** Verified by
running it: it emits 25 warehouses / 197 customers / 4925 pairs correctly, but writes
`version.json` at `version: 1` and omits the `zip` field on every warehouse and customer. The
committed dataset is `version: 3` with zips present, because `scripts/src/geocode-chens.ts` runs
afterwards and adds them (D9/D26 — geocoded once against Nominatim, accepted on normalized city
match alone; zips are display-only and never affect goldens).

So: extraction is now reproducible, the full dataset is not reproducible offline — the geocode step
needs network access and a live Nominatim, and re-running it could in principle return different
results than the one-time pass that produced what is committed. Treat
`solvers/chens-cosmetics-cn/dataset/*.json` as the authority and the notebook as its provenance, not
as a build input. Do not commit the output of a bare extractor run; it is a regression.

The three files share byte-identical data and Model-2 code; their Model-1 formulations are
mathematically equivalent. Steps 2 and 3 comment out the Model-2 driver invocation and set an
infeasible `coverageFloorDemand` (`500100100`, above total demand `199269881`) — only the original
invokes both models. Step 3 is the final pedagogical coverage refactor, not a both-modes executable.
See `docs/superpowers/specs/2026-09-14-chapter-4-chens-cosmetics-coverage-model-design.md`.

## Chapter 9 — MODIFIED: plotly.js replaced with a CDN reference

The original is **23.73 MB**, of which **22.79 MB (96%) is five identical copies of the plotly.js
v2.35.2 bundle** — one injected by `plotly.offline.init_notebook_mode()` in cell 7, and one
re-embedded in each of the four self-contained map renders (cells 24, 26, 28, 30). The actual figure
payload across all four maps is 268,633 chars (0.27 MB, ~1%).

Committing 24 MB permanently to git history to store five copies of a JavaScript library was not
worth it. Each library `<script>` body was replaced with:

```html
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
```

The version is pinned to the one that generated the figures, not `plotly-latest`.

```
original  5220861accef2ab296717a4cf6ec4467b0703c7f50bda65f524f27f02bbf545e   23.73 MB
committed f3e3e3c4b900f97d850c6fd828924243b759574e4c03b1b930d7ed6f768a5fd0    0.42 MB
```

**What changed:** only `outputs[].data["text/html"]`, and within it only `<script>` bodies larger than
1,000,000 chars that self-identify as `plotly.js v…` in their first 400 characters. Five matched.

**What did not change**, verified by diffing the parsed notebooks cell by cell:

- every one of the 31 cells' `source` — including cell 13's 70,840-char `get_data()`
- every `cell_type` and `execution_count`
- every non-HTML output (`text/plain`, `stream`) byte for byte
- `nbformat` and notebook-level `metadata` (kernelspec)
- all 268,633 chars of figure payload — traces, coordinates, layout

**Consequence:** the four saved maps need network access to render, where the original rendered
offline. To restore full offline fidelity, re-run the notebook (it is self-contained — `get_data()`
embeds every dict inline, there is no `read_csv`, and the only file I/O is writing a summary `.txt`;
it needs `pandas`, `ticdat`, `plotly`, `pulp`).

The maps are a *view* of data this repo already holds: `get_data()` carries 100 customers, 25
warehouses and 4 plants, matching `solvers/two-echelon-jade-us/dataset/` exactly (customers 100,
warehouses 25, plants 4, products 4, distances 2600).

## Chapter 5 — no notebook

`transport-coal` and `p-median-brazil` have no source notebook. A search of `~/Downloads`,
`~/Desktop`, `~/Documents` and the home tree found none, and unlike Chapter 4 there is no
`scripts/src/extract-*` for either model — their `solvers/*/dataset/*.json` were produced some other
way. If a Chapter 5 notebook surfaces, add it here and update this table.
