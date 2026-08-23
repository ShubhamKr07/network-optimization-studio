// DD-3 (SCN v0.3 plan) — baseline by convention: the scenario named
// "Baseline" (case/whitespace-insensitive), else oldest by createdAt.
// One pure function, one call site (ReportsTab). No isBaseline column, no
// set-baseline endpoint, no uniqueness invariant — revisit only when a
// server-side consumer needs it.
export interface BaselineCandidateScenario {
  id: number;
  name: string;
  createdAt: string;
}

export function pickBaseline<T extends BaselineCandidateScenario>(scenarios: T[]): T | null {
  if (scenarios.length === 0) return null;
  const named = scenarios.find(s => s.name.trim().toLowerCase() === "baseline");
  if (named) return named;
  return [...scenarios].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
}
