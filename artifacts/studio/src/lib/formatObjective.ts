// C4.14 (D14) — Chen's Cosmetics (chens-cosmetics-cn) reports its objective in
// two different UNITS depending on the solve mode, carried on the envelope's
// `details.objective` discriminator:
//   coverage      -> the objective IS a coverage percentage  (NN.NN %)
//   min_distance  -> the objective is total demand-weighted distance (demand-km)
// Every other model (and Chen before it's solved) has no `details.objective`,
// so this returns null and each caller applies its own pre-existing default
// number format unchanged — a single source of truth for the two Chen modes,
// shared by ObjectiveBar, CostSummaryTab and Landing so the three never drift.
export function formatChenObjective(
  objective: number,
  objectiveMode: string | null | undefined,
): string | null {
  if (objectiveMode === "coverage") return `${objective.toFixed(2)} %`;
  if (objectiveMode === "min_distance") return `${objective.toExponential(2)} demand-km`;
  return null;
}

// Reads the mode discriminator off an opaque envelope `details` record.
// `details.objective` is the Chen mode string ("coverage" | "min_distance");
// absent (every non-Chen model) -> null.
export function objectiveModeOfDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const raw = (details as { objective?: unknown }).objective;
  return typeof raw === "string" ? raw : null;
}
