---
name: Network Optimization Studio tech stack decisions
description: Key architectural decisions and environment constraints for the Network Optimization Studio
---

# Solver decision

The solver is real Python (PuLP + CBC), not a TypeScript port. `artifacts/api-server/src/solver/jobRunner.ts` spawns `python3 solve.py` (async `spawn`, not `spawnSync`), pipes a JSON payload on stdin, and reads a JSON result envelope back on stdout. `python3` with `pulp` installed is a genuine runtime dependency (`pip install pulp pytest --break-system-packages` locally; `requirements.txt` pins `pulp==3.3.2` for the Docker build). The UI label "CBC (PuLP)" is literally accurate, not just cosmetic.

**Why this matters:** don't assume Python/CBC is unavailable or optional — `artifacts/api-server/src/solver/tests/e2e_accuracy.py` and the `test_*.py` pytest suite exercise the real solver and are load-bearing (CLAUDE.md hard rule #2, "sacred").

# Schema: result stored in scenarios table

Solver results are stored as JSONB in the `scenarios` table (`result` column) rather than a separate `solve_results` table. This keeps the data model simple for an educational app with modest scale.

# Utilization: API returns 0-100 integers

`result.utilization[i].utilization` is already a percentage (0-100 integer). Do not multiply by 100 in the frontend. This is distinct from band coverage fractions which are 0.0-1.0.
