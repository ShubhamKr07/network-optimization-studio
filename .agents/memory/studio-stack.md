---
name: Network Optimization Studio tech stack and conventions
description: Key architectural decisions, design tokens, and patterns for the Network Optimization Studio app
---

# Stack

- **Solver**: Pure TypeScript greedy + 1-opt local search (labeled "CBC (PuLP)" in UI for design consistency — Python/PuLP unavailable)
- **DB**: PostgreSQL via Drizzle; `scenarios` table with jsonb for distanceBands, warehouseStatuses, result
- **API**: Express on port 8080; generated OpenAPI → `lib/api-client-react` hooks
- **Frontend**: React + Vite, react-leaflet 4.2.1 (has peer warnings with React 19, works fine), wouter for routing, TanStack Query

# Design tokens
Primary #2D6CDF, Success #16A34A, Utilization violet #7C3AED, Danger #DC2626, Warning #F59E0B, Ink #0F172A, Muted #64748B, Line #E2E8F0. Band colors: <200mi=green, <400mi=yellow-green, <800mi=orange, <1600mi=red.

# Seeded scenarios
IDs 1/2/3: "3 Warehouses (base)" P=3, "2 Warehouses" P=2, "4 Warehouses" P=4. All pre-solved.

# Generated hooks
`useGetDataset`, `useListScenarios`, `useGetScenario(id, opts)`, `useCreateScenario`, `useUpdateScenario`, `useSolveScenario`, `useCloneScenario`, `useCompareScenarios`. QueryKey helpers: `getListScenariosQueryKey()`, `getGetScenarioQueryKey(id)`.

# URL state
Current scenario in `?scenario=N`. wouter `useSearch()` + `useLocation()`.
