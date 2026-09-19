---
name: Network Optimization Studio tech stack decisions
description: Key architectural decisions and environment constraints for the Network Optimization Studio
---

# Solver decision

The solver is Python (PuLP + CBC), invoked via `artifacts/api-server/src/solver/jobRunner.ts` spawning `solve.py` as a child process. `pulp` is a genuine runtime dependency (pinned `pulp==3.3.2` in `artifacts/api-server/src/solver/requirements.txt`) — not a label-only stand-in for a TypeScript heuristic.

**Why this matters:** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` is sacred (CLAUDE.md hard rule #2) and exercises the real PuLP/CBC solve path — it must pass unmodified after every change.

# Schema: result stored in scenarios table

Solver results are stored as JSONB in the `scenarios` table (`result` column) rather than a separate `solve_results` table. This keeps the data model simple for an educational app with modest scale.

# Utilization: API returns 0-100 integers

`result.utilization[i].utilization` is already a percentage (0-100 integer). Do not multiply by 100 in the frontend. This is distinct from band coverage fractions which are 0.0-1.0.
