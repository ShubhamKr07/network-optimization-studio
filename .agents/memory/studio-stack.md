---
name: Network Optimization Studio tech stack decisions
description: Key architectural decisions and environment constraints for the Network Optimization Studio
---

# Solver decision

The solver is a real ILP solved by PuLP/CBC (`artifacts/api-server/src/solver/solve.py`), not a heuristic — replaced the original TypeScript greedy + 1-opt local search in commit `3b3fc1c`. It runs async via `jobRunner.ts`'s worker-pool `spawn` (blocking `spawnSync` was removed in G3.1). The UI's "CBC (PuLP)" label matches the actual implementation.

**Why this matters:** Python 3 with `pulp` (and `pytest` for the solver test suite) is a real runtime dependency, not optional — `pip install pulp pytest --break-system-packages` per `CLAUDE.md`.

# Schema: result stored in scenarios table

Solver results are stored as JSONB in the `scenarios` table (`result` column) rather than a separate `solve_results` table. This keeps the data model simple for an educational app with modest scale.

# Utilization: API returns 0-100 integers

`result.utilization[i].utilization` is already a percentage (0-100 integer). Do not multiply by 100 in the frontend. This is distinct from band coverage fractions which are 0.0-1.0.
