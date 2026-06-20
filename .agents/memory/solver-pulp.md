---
name: Network Studio PuLP/CBC ILP solver
description: How the solver works, the bridge pattern, and key performance facts
---

# Solver architecture

`artifacts/api-server/src/solver/solve.py` — Python ILP using PuLP/CBC.
`artifacts/api-server/src/solver/pmedian.ts` — TypeScript bridge: spawnSync("python3", [SOLVER_PY]) with JSON stdin/stdout.

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

SOLVER_PY = path.resolve(__dirname, "..", "src", "solver", "solve.py")
where __dirname is the dist/ directory of the bundled server. One level up → api-server root, then src/solver/solve.py.

## Validation

P=3 result: 382.9 miles, open=[BAL, DAL, LA] — matches Chapter 3 notebook output exactly.
