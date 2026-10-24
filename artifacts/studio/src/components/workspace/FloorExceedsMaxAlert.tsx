import type { SolveResult } from "@workspace/api-client-react";
import { classifyResultOutcome } from "@/lib/resultOutcome";

// CH4OS (spec 2026-10-10 §6.3) — the floor-too-high alert, ONE component shared
// by Solution Summary and the Output Map so the two surfaces cannot word it
// differently. Shown only for an infeasible result carrying Model 1's summary
// — i.e. a sequential max-coverage run whose floor exceeded what Model 1
// covered. Gated on the envelope's SHAPE (only solve.py's sequential run emits
// `maxCoverableDemand`), never on modelId. Appears only after solving; nothing
// is precomputed on the form.
export interface Model1Summary {
  openWarehouseIds: string[];
  coveredDemand: number;
  coveragePct: number;
  weightedAvgDistance: number;
  optimal: boolean;
}

export function floorExceedsMax(
  result: SolveResult | null,
): { floor: number; max: number; model1: Model1Summary } | null {
  if (!result || classifyResultOutcome(result) !== "infeasible") return null;
  const d = result.details as { coverageFloorDemand?: unknown; maxCoverableDemand?: unknown; model1?: unknown } | undefined;
  if (typeof d?.maxCoverableDemand !== "number" || typeof d.coverageFloorDemand !== "number") return null;
  if (d.model1 == null || typeof d.model1 !== "object") return null;
  return { floor: d.coverageFloorDemand, max: d.maxCoverableDemand, model1: d.model1 as Model1Summary };
}

export function FloorExceedsMaxAlert({
  result,
  formatDistance,
  className = "mb-2",
}: {
  result: SolveResult | null;
  /** Canonical distance -> display text, from the host tab (unit-aware). */
  formatDistance: (canonical: number) => string;
  className?: string;
}) {
  const info = floorExceedsMax(result);
  if (!info) return null;
  const { floor, max, model1 } = info;
  const n = floor.toLocaleString();
  const m = max.toLocaleString();
  const model1Line =
    `Model 1 (max coverage): sites ${model1.openWarehouseIds.join(", ")} · coverage ${model1.coveragePct.toFixed(2)} % ` +
    `(${model1.coveredDemand.toLocaleString()} demand) · avg distance ${formatDistance(model1.weightedAvgDistance)}.`;
  return (
    <div
      role="alert"
      data-testid="floor-exceeds-max-alert"
      className={`${className} rounded-md border border-warning-border bg-warning-bg p-2 text-xs text-warning`}
    >
      {model1.optimal ? (
        <>
          <strong>Coverage floor {n} exceeds the maximum coverable demand {m}.</strong>{" "}
          Model 2 is infeasible. {model1Line} Lower the floor to at most {m}.
        </>
      ) : (
        <>
          <strong>Coverage floor {n} could not be met.</strong>{" "}
          Model 2 is infeasible. Model 1&apos;s best coverable demand found was {m}; the exact maximum was not
          proven within the time/gap limit. {model1Line}
        </>
      )}
    </div>
  );
}
