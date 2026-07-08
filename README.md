# Network Optimization Studio

Educational web app for learning network optimization (facility location / p-median and transportation LP) through interactive scenarios and gamified quests ("Arcadia"). Build a scenario on a map, solve it with a real ILP/LP solver, compare results, and progress through quests, badges, and a leaderboard.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5, PostgreSQL + Drizzle ORM, Zod validation, Orval-generated API client/hooks from OpenAPI spec
- **Solver**: Python (PuLP/CBC) invoked from the API server — p-median (capacitated) and transportation LP models
- **Frontend**: React, Vite, Tailwind, Radix UI, Leaflet/react-leaflet (maps), TanStack Query, wouter (routing), Recharts
- **Testing**: Vitest + Supertest (API), Vitest + React Testing Library (frontend), pytest (solver), Playwright (E2E)

## Repo layout

```
artifacts/
  api-server/   Express API — routes, auth, solver wrapper, Drizzle DB access
    src/routes/       health, dataset, auth, scenarios (CRUD/clone/solve/compare), progress
    src/solver/        pmedian.ts (TS wrapper) + solve.py (PuLP/CBC), tests/ (pytest incl. E2E)
  studio/        React frontend (the actual "Studio" app)
    src/pages/         Studio.tsx (scenario builder/solver), Compare.tsx
    src/pages/arcadia/ LoginPage, Dashboard, QuestMap, Leaderboard, Badges (gamification)
    src/components/    NetworkMap, BrazilMap, ObjectiveBar, ArcadiaShell, UI primitives
    src/context/       GamificationContext
    e2e/               Playwright specs
  mockup-sandbox/ design/prototype sandbox
lib/
  db/             Drizzle schema (scenarios, auth, user_progress)
  api-spec/       OpenAPI spec (source of truth for the API contract)
  api-client-react/ Orval-generated React Query hooks + Zod schemas
  api-zod/        generated Zod validators shared by API + frontend
scripts/          misc project scripts
```

## Run & operate

```
pnpm install
pnpm --filter @workspace/api-server run dev   # API server, port 5000
pnpm --filter @workspace/studio run dev       # frontend dev server
```

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/Zod schemas from the OpenAPI spec after changing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Testing

```
pnpm --filter @workspace/api-server run test        # Vitest: solver wrapper + routes
pnpm --filter @workspace/studio run test             # Vitest + RTL: components, hooks, context
pnpm --filter @workspace/studio run test:e2e         # Playwright E2E
python -m pytest artifacts/api-server/src/solver/tests  # solver correctness + E2E accuracy/journey suites
```

## Product

Two optimization models are playable as "labs":

- **P-Median** (facility location) — capacitated warehouse/region placement, distance-band coverage, forced-open/inactive constraints. Reference dataset validated against the source textbook's full distance matrix.
- **Transportation LP** — coal mine/station supply-demand routing.

On top of the solver sits **Arcadia**, a gamification layer: quests tied to problem type, a quest map, XP/badges/leaderboard, and session-persistent progress (login, dashboard, progress tracked per user in Postgres).

## Contributing notes

- API contract changes start in `lib/api-spec/openapi.yaml`, then run the codegen script — don't hand-edit generated files in `lib/api-client-react` or `lib/api-zod`.
- Solver logic lives in Python (`solve.py`); the TS wrapper (`pmedian.ts`) just shells out to it — keep model correctness changes in Python and covered by the pytest suite (including `e2e_accuracy.py` and `e2e_journey.py`).
