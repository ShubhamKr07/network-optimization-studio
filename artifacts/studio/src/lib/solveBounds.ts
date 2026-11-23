import type { SolveResult } from "@workspace/api-client-react";
import { objectiveModeOfDetails } from "@/lib/formatObjective";
import { classifyResultOutcome, hasIncumbent } from "@/lib/resultOutcome";

export type SolveBounds = { upper: number | null; lower: number | null; gap: number | null; provenOptimal: boolean };

// OMQ-1 — upper/lower bound of the displayed solve, in the SAME units as
// result.objective. Derived from the unitless relative gap, never from
// solverBestBound directly: CBC's raw LP objective can differ from the
// displayed one (Ch4 coverage: % vs covered demand). Proven optimal means
// bound == objective (D3), although CBC rarely prints a bound then.
export function solveBounds(result: SolveResult): SolveBounds | null {
  const outcome = classifyResultOutcome(result);
  if (!hasIncumbent(outcome)) return null;
  const obj = result.objective;
  if (outcome === "optimal") return { upper: obj, lower: obj, gap: 0, provenOptimal: true };
  const gap = result.achievedGap ?? null;
  const maximise = objectiveModeOfDetails(result.details) === "coverage";
  const other = gap == null ? null : maximise ? obj * (1 + gap) : obj * (1 - gap);
  return maximise
    ? { upper: other, lower: obj, gap, provenOptimal: false }
    : { upper: obj, lower: other, gap, provenOptimal: false };
}
