import type { SolveResult } from "@workspace/api-client-react";
import { qualityStatement } from "@/lib/quality";

// B4/B4.1 — truthful solve-outcome classification, shared by every Workspace/
// Studio surface that renders a solve result's status/quality (originally
// built in Studio.tsx for B4, extracted here in B4.1 once CostSummaryTab.tsx
// — the actually-reachable live rendering path, since every chapter routes
// through Workspace.tsx, not Studio.tsx — needed the same logic; do not
// duplicate this in a third place).
//
// `solutionStatus` (B2/B3) is the real CBC-derived classification; a stored
// result that predates B2 has `solutionStatus: null` (stamped by the
// api-server read-path guard) and must never be rendered as a verified
// "optimal"/"proven" claim. For such legacy rows, the pre-B2 `status` field
// is still trustworthy for infeasible/error (those were never mislabeled —
// only "optimal" was hardcoded regardless of gap/time-limit outcome), so we
// fall back to it for those two cases only; anything else legacy becomes a
// neutral "unverified" outcome rather than a guessed-at optimal/feasible
// claim.
export type ResultOutcome =
  | "optimal"
  | "feasible"
  | "infeasible"
  | "no_solution"
  | "unbounded"
  | "error"
  | "legacy_unverified";

export function classifyResultOutcome(result: SolveResult): ResultOutcome {
  if (result.solutionStatus != null) return result.solutionStatus;
  if (result.status === "infeasible") return "infeasible";
  if (result.status === "error") return "error";
  return "legacy_unverified";
}

// A real incumbent objective/edges/metrics exist to render only for these
// three outcomes — infeasible/no_solution/unbounded/error all carry a
// meaningless `objective: 0` sentinel from solve.py (hard rule 6 — solver
// changes enter as data, not branches — so the sentinel itself isn't going
// away; the frontend's job is to stop presenting it as a real number).
export function hasIncumbent(outcome: ResultOutcome): boolean {
  return outcome === "optimal" || outcome === "feasible" || outcome === "legacy_unverified";
}

// Shared single-line "Quality" cell text (CostSummaryTab's Solution Summary
// row + its compare-mode column) — NEVER the raw `result.quality` string
// (solve.py's own possibly pre-B2/legacy-optimistic text) for an outcome this
// module can classify truthfully.
export function resultQualityText(result: SolveResult): string {
  const outcome = classifyResultOutcome(result);
  if (outcome === "legacy_unverified") return "Unverified";
  if (!hasIncumbent(outcome)) return "No incumbent";
  return qualityStatement(result.terminationReason, result.achievedGap) ?? result.quality;
}
