// CH4UX-1 — shared Chapter 4 (max-coverage-us) test fixtures. Pulled out of
// Workspace.test.tsx into their own module because Task 4 (per the SDD plan)
// imports these same pure fixture builders; `renderCh4Workspace` itself stays
// in each consuming test file because it closes over that file's own module
// mocks (mockUseListScenarios/mockUseGetScenario/mockUseSearch), which this
// shared module has no access to.
//
// CH4O-2 — the server-derived `steps` projection and its two-step workflow
// are deleted; `ch4Scenario` no longer accepts or sets a `steps` field.

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

export function ch4Scenario(over: { id?: number; name?: string; result?: unknown; stale?: boolean } = {}) {
  return {
    id: over.id ?? 1,
    name: over.name ?? "Chen 1",
    modelId: "max-coverage-us",
    inputs: maxCoverageInputs,
    result: over.result ?? null,
    stale: over.stale ?? false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}
