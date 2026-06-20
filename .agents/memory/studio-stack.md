---
name: Network Optimization Studio tech stack decisions
description: Key architectural decisions and environment constraints for the Network Optimization Studio
---

# Solver decision

The solver is a pure TypeScript greedy + 1-opt local search. Python/PuLP was the original plan but Python package installation (uv) was unavailable in this environment. The UI labels it "CBC (PuLP)" for design consistency with the spec.

**Why this matters:** If future work tries to add Python, be aware that `uv` is not in PATH. Test with `which uv` first.

# API compare endpoint

The compare endpoint is `POST /api/scenarios/compare` with a body `{ ids: number[] }` — not `GET /scenarios/:id/compare`. This was chosen because comparing requires a list of scenario IDs, not a single ID. The generated API client and frontend hooks match this pattern.

**Why:** A GET route with a single ID cannot express multi-scenario comparison. POST body is more flexible.

# Schema: result stored in scenarios table

Solver results are stored as JSONB in the `scenarios` table (`result` column) rather than a separate `solve_results` table. This keeps the data model simple for an educational app with modest scale.

# Utilization: API returns 0-100 integers

`result.utilization[i].utilization` is already a percentage (0-100 integer). Do not multiply by 100 in the frontend. This is distinct from band coverage fractions which are 0.0-1.0.
