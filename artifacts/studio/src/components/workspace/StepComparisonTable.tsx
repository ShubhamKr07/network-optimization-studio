import type { ScenarioStepSummary } from "@workspace/api-client-react";

interface StepComparisonTableProps {
  step1: ScenarioStepSummary;
  step2: ScenarioStepSummary;
}

// CH4-13 — with both summaries already on the scenario, this renders from data
// the UI holds. No extra fetch when it unlocks at `2 of 2`.
const ROWS = [
  { key: "objective" as const, label: "Objective" },
  { key: "coveragePct" as const, label: "Coverage %" },
  { key: "coveredDemand" as const, label: "Covered demand" },
  { key: "weightedAvgDistance" as const, label: "Weighted avg distance" },
  { key: "runTimeSec" as const, label: "Run time (s)" },
  { key: "quality" as const, label: "Quality" },
];

function format(summary: ScenarioStepSummary, key: (typeof ROWS)[number]["key"]): string {
  const value = summary[key];
  if (value == null) return "—";
  switch (key) {
    case "objective": return value === "coverage" ? "Max coverage" : "Min distance";
    // 4 dp matches solve.py's own `round(covered * 100 / total, 4)` — do not
    // re-round to 2 here or the UI and the envelope disagree.
    case "coveragePct": return Number(value).toFixed(4);
    case "coveredDemand": return Number(value).toLocaleString();
    case "weightedAvgDistance": return `${Number(value).toFixed(2)} ${summary.distanceUnit}`;
    case "runTimeSec": return Number(value).toFixed(2);
    default: return String(value);
  }
}

export function StepComparisonTable({ step1, step2 }: StepComparisonTableProps) {
  return (
    <table className="w-full text-sm border-collapse" data-testid="step-comparison">
      <thead>
        <tr className="text-left border-b border-border">
          <th className="py-1.5 pr-3 font-semibold">Metric</th>
          <th className="py-1.5 pr-3 font-semibold">1. Max Coverage</th>
          <th className="py-1.5 font-semibold">2. Min Distance</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.key} className="border-b border-border/50">
            <td className="py-1.5 pr-3 text-muted-foreground">{row.label}</td>
            <td className="py-1.5 pr-3 font-mono" data-testid={`step-comparison-${row.key}-1`}>
              {format(step1, row.key)}
            </td>
            <td className="py-1.5 font-mono" data-testid={`step-comparison-${row.key}-2`}>
              {format(step2, row.key)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
