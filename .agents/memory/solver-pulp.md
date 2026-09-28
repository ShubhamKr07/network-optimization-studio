---
name: Network Studio PuLP/CBC ILP solver
description: How the solver works, the bridge pattern, and key performance facts
---

# Solver architecture

`artifacts/api-server/src/solver/solve.py` — Python ILP using PuLP/CBC.
`artifacts/api-server/src/solver/jobRunner.ts` — async job runner: an in-process worker pool that `spawn`s `python3 solve.py` detached, with JSON stdin/stdout plus a structured fd3 channel. The old blocking `spawnSync` bridge was removed in G3.1 — do not reintroduce sync child-process calls on the request path. `pmedian.ts` is now only the payload builder (`buildPayload`) and the `SolveInput` type.

## ILP formulation (from Al's Athletics notebook Chapter 3)

Minimize: sum(demand[c] × distance[w,c] × assign[w,c]) for all w,c
Subject to:
- sum_w(assign[w,c]) = 1 for all c  (each customer served once)
- sum_w(open[w]) ≤ P  (at most P facilities)
- sum_c(demand[c] × assign[w,c]) ≤ capacity × open[w]  for all w  (capacity)
- open[w] ≥ lower_bound[w]  (forced-open lower bound)
- open[w] ≤ upper_bound[w]  (inactive upper bound)
- assign[w,c] ≤ open[w]  for all w,c  (route linkage)

## Performance

P=2: ~0.7s, P=3: ~0.3s, P=4: ~0.4s in this environment (much faster than Colab's 221s).

## Path resolution

SOLVER_PY = path.join(findRepoRoot(__dirname), "artifacts", "api-server", "src", "solver", "solve.py")
in `jobRunner.ts`. `findRepoRoot` walks up to `pnpm-workspace.yaml`, which is correct both unbundled (vitest) and inside the esbuild-bundled `dist/index.mjs`, where `import.meta.url`/`__dirname` resolve to the single output file rather than the original source path. Do not go back to a source-layout-relative `path.resolve`.

## Validation

P=3 result: 382.9 miles, open=[BAL, DAL, LA] — matches Chapter 3 notebook output exactly.
