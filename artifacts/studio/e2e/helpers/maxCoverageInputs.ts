/**
 * Shared helper — a Chapter 4 (`max-coverage-us`) scenario-create payload at
 * CH4O-8's round, MILES-canonical teaching defaults: p 3, high 450 mi,
 * max 3400 mi, avg-service-distance cap 650 mi, coverage floor 0.
 *
 * Read verbatim off `solvers/max-coverage-us`'s golden fixture
 * (`solver/tests/test_max_coverage.py::BASE`) — these are NOT conversions of
 * the retired kilometre seeds, so do not "correct" them by converting
 * anything.
 *
 * NO `objective` key, deliberately. CH4O-5 made `objective` server-owned: it
 * is derived from `coverageFloorDemand` via `deriveMaxCoverageObjective`
 * (floor 0 → "coverage", floor > 0 → "min_distance"), and
 * `assertNoServerOwnedFields` (`services/scenarioInputWrite.ts`) rejects a
 * create/update payload that carries the key at all — even as `null`. A spec
 * that re-adds it gets a 4xx on create.
 *
 * FU-8 — extracted from two byte-identical copies: `max-coverage.spec.ts`'s
 * `coverageInputs()` and `nonjade-servicestats-live-coverage.spec.ts`'s
 * `maxCoverageInputs()`.
 *
 * **`chen-bands-units-qa.spec.ts` keeps its own local `maxCoverageInputs()`
 * and must NOT be folded in here.** It looks like a third copy and is not:
 * it is deliberately 700 / 5500 / 1000 with `distanceBands: [700, 5500]`,
 * and every golden in that file (including the 91.2819 % coverage and the
 * {CMH, LBB, RNO} open set) was separately measured against *that* payload.
 * Sharing a factory between them would couple two specs whose payloads must
 * differ, and a single edit here would silently invalidate goldens over
 * there. If you ever find yourself adding a parameter so this factory can
 * serve that spec too, stop — that is the signal to leave it alone.
 *
 * Contrast with `solvedAt.ts`, which was extracted from seven copies that
 * bought nothing: the duplication there drifted in a *shape* (`id: string`
 * vs `id: number`) no assertion could see. Here a drift in *values* fails
 * loudly, because each spec asserts goldens computed from its own payload —
 * which is why these two coinciding copies were judged worth merging and the
 * third, differing one is not.
 */

/**
 * `overrides` is spread last, so a spec can vary one field without needing a
 * new factory — the same signature `chen-bands-units-qa.spec.ts`'s local copy
 * uses. Returns a fresh object on every call, so a caller mutating the result
 * cannot leak into another test.
 */
export function maxCoverageInputs(overrides: Record<string, unknown> = {}) {
  return {
    p: 3,
    highServiceDistMi: 450,
    maxDistMi: 3400,
    avgServiceDistCapMi: 650,
    coverageFloorDemand: 0,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [450, 900, 1800, 3400],
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
    ...overrides,
  };
}
