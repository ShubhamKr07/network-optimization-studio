// CH4UX-1 — shared Chapter 4 (max-coverage-us) test fixtures. Pulled out of
// Workspace.test.tsx into their own module because Task 4 (per the SDD plan)
// imports these same pure fixture builders; `renderCh4Workspace` itself stays
// in Workspace.test.tsx because it closes over that file's own module mocks
// (mockUseListScenarios/mockUseGetScenario/mockUseSearch), which this shared
// module has no access to.
//
// `Ch4Steps` is deliberately narrower than the generated `ScenarioSteps` type
// (`stale`/`jobId` optional, `summary` shape loosened) — every consumer here
// passes fixtures through an `as never`/`as unknown as ...` cast at the mock
// boundary, so the real `ScenarioSteps` contract is enforced by
// `useMaxCoverageSteps.ts`'s own consumption of `scenario.steps`, not by this
// fixture's type.
export type Ch4Steps = {
  step1: { solved: boolean; jobId?: number | null; summary?: { coveredDemand: number } | null };
  step2: { solved: boolean; jobId?: number | null; summary?: unknown | null };
};

export const maxCoverageInputs = {
  p: 5,
  distanceBands: [200, 400],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
  objective: "coverage",
  highServiceDistKm: 200,
  maxDistKm: 400,
  avgServiceDistCapKm: 300,
};

export function ch4Scenario(over: { id?: number; name?: string; steps: Ch4Steps; result?: unknown; stale?: boolean }) {
  return {
    id: over.id ?? 1,
    name: over.name ?? "Chen 1",
    modelId: "max-coverage-us",
    inputs: maxCoverageInputs,
    result: over.result ?? null,
    stale: over.stale ?? false,
    steps: over.steps,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}
