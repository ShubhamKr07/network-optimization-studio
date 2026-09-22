// E3.1 (superseded by B4) — achieved-quality statement.
//
// B4: derives its wording from the SOLVER's OWN termination evidence
// (`terminationReason`/`achievedGap`, from B1/B2's captured-CBC-log
// classification) instead of the previously-hardcoded "gap=0 -> proven"
// assumption keyed off the *requested* gap. A gap-limited solve now
// correctly reads "Feasible — within gap" even when the student configured
// gap=0 (CBC can still legitimately stop short of a proof), and a solve
// that hit a time/node limit is distinguished from one that proved
// optimality or closed the configured gap.
//
// Callers must only invoke this when there IS a real incumbent (solutionStatus
// "optimal"/"feasible", or a legacy-unverified result assumed to have one) —
// it has no opinion on infeasible/no_solution/unbounded/error outcomes,
// which the caller renders as a distinct "No incumbent" state instead (see
// Studio.tsx's `classifyResultOutcome`). A null/undefined/"unknown"
// `terminationReason` (legacy rows, or solutionStatus "error") returns null —
// no unverifiable claim is ever printed.
export function qualityStatement(
  terminationReason: string | null | undefined,
  achievedGap: number | null | undefined,
): string | null {
  switch (terminationReason) {
    case "optimality_proven":
      return "Proven optimal";
    case "gap_limit": {
      if (achievedGap == null) return "Feasible — within gap";
      const pct = achievedGap * 100;
      const formatted = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
      return `Feasible — within gap (${formatted}%)`;
    }
    case "time_limit":
      return "Feasible — time limit reached";
    case "node_limit":
      return "Feasible — node limit reached";
    case "infeasible":
      return "Infeasible";
    case "unbounded":
      return "Unbounded";
    default:
      // null/undefined (legacy-unverified, or no incumbent ever attempted)
      // or "unknown" (legacy sentinel) — no claim we can stand behind.
      return null;
  }
}
