# CLAUDE.md — Network Optimization Studio

Educational supply-chain network design tool. Students configure facility-location scenarios (p-median, transportation LP), solve them with a real ILP solver (PuLP/CBC), and compare results. Datasets and expected answers come from Watson et al., *Supply Chain Network Design* (Ch. 3 & 5).

Active work is governed by `IMPLEMENTATION_PLAN.md` (task IDs like A2.1, D5.1) with scope defined in `PRD-network-optimization-studio-v2.md`. When executing a task, follow the plan's per-task file lists, tests, and Definition of Done. Section 0 of the plan is the operating contract — read it first.

## Architecture (30 seconds)

pnpm monorepo. Contract-first: `lib/api-spec/openapi.yaml` is the single source of truth for the API; Orval generates the Zod validators and React Query client from it.

```
lib/api-spec/          OpenAPI contract + orval.config.ts (codegen)
lib/api-zod/           GENERATED Zod schemas        — never hand-edit src/generated/
lib/api-client-react/  GENERATED React Query hooks  — never hand-edit src/generated/
lib/db/                Drizzle schema (Postgres) — schema sync via drizzle-kit push, no migration files
artifacts/api-server/  Express 5 API. Routes in src/routes/, solver bridge in src/solver/
artifacts/studio/      React + Vite + Tailwind + Radix + Leaflet + wouter + TanStack Query
```

Solve path: frontend PATCHes inputs onto the scenario row → `POST /scenarios/:id/solve` (empty body; **DB row is the source of truth**) → route builds `SolveInput` → `pmedian.ts` pipes JSON via stdin to `python3 solve.py` (`spawnSync`, blocking) → PuLP/CBC solves → JSON on stdout → result cached as JSONB on the scenario row → response → React Query renders. The cached JSONB is what the Compare feature reads.

## Commands

```bash
pnpm install                                  # pnpm ONLY (preinstall blocks npm/yarn)
pnpm run typecheck                            # whole workspace
pnpm --filter api-server test                 # API tests (vitest + supertest)
pnpm --filter studio test                     # frontend tests (vitest + RTL)
pnpm --filter studio test:e2e                 # Playwright
pnpm --filter @workspace/db push              # apply Drizzle schema to DB
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x   # solver tests
```

Python needs `pulp` and `pytest` (`pip install pulp pytest --break-system-packages`). Postgres via `DATABASE_URL`.

**Verification gate — run before considering any task done:**
```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

## Hard rules

1. **Never edit generated code.** Anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` comes from codegen. To change API shapes: edit `lib/api-spec/openapi.yaml`, re-run Orval (config: `lib/api-spec/orval.config.ts`), commit spec + regenerated output together.
2. **`e2e_accuracy.py` is sacred.** `artifacts/api-server/src/solver/tests/e2e_accuracy.py` validates solver output against the textbook's published answers. It must pass unmodified after every change. If your change breaks it, your change is wrong — do not adjust the expected values without explicit human approval.
3. **Schema changes that add NOT NULL columns to populated tables** must use the two-step protocol (add nullable → backfill → enforce NOT NULL), because `drizzle-kit push` has no migration history.
4. **One task = one commit.** Message format: `[<task-id>] <imperative summary>` (e.g. `[A2.1] add user_id ownership to scenarios`). Regenerated codegen output goes in the same commit as its spec change.
5. **Ownership filtering is security-critical.** Every scenario query must filter by the authenticated `user_id`; non-owned resources return **404** (never 403 — avoid ID enumeration). Any new scenario-scoped endpoint inherits this.
6. **Solver changes enter as data, not branches.** Business rules (forced-open, inactive, demand overrides, capacities) become variable bounds or coefficient changes in the PuLP model — never new if/else code paths in `solve.py`.
7. **Don't touch** `attached_assets/` (textbook source material) or Replit deploy files (`.replit`, `replit.md`, `push-to-github.mjs`) unless a plan task explicitly says so.
8. When the plan conflicts with the repo's actual state, trust the repo, make the smallest correct fix, and note the deviation in the commit body. If a genuinely ambiguous product decision arises, stop and ask — don't guess.

## Gotchas

- `spawnSync` in `pmedian.ts` blocks the Node event loop for the entire solve (up to time limit + 15s grace). Do not add long-running sync work elsewhere; async solve is planned as Phase 6 (X2).
- The solver wrapper never throws — crashes, timeouts, and unparseable stdout all degrade to a well-formed `{status: "error", infeasibilityReason: ...}`. Preserve this contract.
- Distance bands are a **reporting lens**, not model constraints — they're computed in post-processing from per-assignment distances and can be recomputed client-side without re-solving.
- Customer city names are NOT unique (two Arlingtons, two Kansas Citys, two Springfields…). Stable IDs are the only valid join key for imports/exports; city/state are display-only.
- Known dataset label defects (WH23 "San Francisco, MO", WH25 "St. Louis, FL") are under a stop-and-ask protocol (task C2) — do not "fix" them opportunistically; the textbook distance matrix may be the authority.
- Cached `result` JSONB can drift from edited inputs until the staleness guard (X1) lands — don't trust `result` on a scenario whose inputs changed after solving.
- `problemType` is hidden from the UI but must NOT be removed from DB/API — solver dispatch and Compare validation depend on it.
- Tests live per package: API in `artifacts/api-server` (vitest/supertest), frontend in `artifacts/studio` (vitest/RTL + Playwright), solver in `artifacts/api-server/src/solver/tests/` (pytest).
