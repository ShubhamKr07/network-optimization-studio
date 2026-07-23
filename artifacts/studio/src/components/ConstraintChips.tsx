import { Badge } from "@/components/ui/badge";

interface ConstraintChipsProps {
  pValue: number;
  capacityMode: "none" | "uniform" | "per_wh";
  uniformCapacity: number | null;
  forcedOpenCount: number;
  inactiveCount: number;
  excludedCount: number;
  demandEditedCount: number;
  stale: boolean;
  onFocusP: () => void;
  onFocusCapacity: () => void;
  onFocusWarehouses: () => void;
  onFocusCustomers: () => void;
}

function capacityLabel(mode: "none" | "uniform" | "per_wh", uniformCapacity: number | null): string {
  if (mode === "none") return "Capacity: none";
  if (mode === "per_wh") return "Capacity: per-warehouse";
  if (uniformCapacity == null) return "Capacity: uniform";
  return `Capacity: uniform ${uniformCapacity >= 1_000_000 ? `${(uniformCapacity / 1_000_000).toFixed(0)}M` : uniformCapacity.toLocaleString()}`;
}

// E2.1 — slim chip bar above the map (replaces a rejected floating-overlay
// design that stole map drag/scroll events and occluded markers). Derived
// entirely from scenario state, no new API. Each chip focuses/opens its
// source input on click.
export function ConstraintChips({
  pValue, capacityMode, uniformCapacity, forcedOpenCount, inactiveCount,
  excludedCount, demandEditedCount, stale, onFocusP, onFocusCapacity,
  onFocusWarehouses, onFocusCustomers,
}: ConstraintChipsProps) {
  return (
    <div className="px-3 py-1.5 border-b flex items-center gap-1.5 flex-wrap flex-shrink-0 bg-muted/30" data-testid="constraint-chips">
      <Chip testid="chip-p" onClick={onFocusP}>p = {pValue}</Chip>
      <Chip testid="chip-capacity" onClick={onFocusCapacity}>{capacityLabel(capacityMode, uniformCapacity)}</Chip>
      {forcedOpenCount > 0 && (
        <Chip testid="chip-forced-open" onClick={onFocusWarehouses}>{forcedOpenCount} forced open</Chip>
      )}
      {inactiveCount > 0 && (
        <Chip testid="chip-inactive" onClick={onFocusWarehouses}>{inactiveCount} inactive</Chip>
      )}
      {excludedCount > 0 && (
        <Chip testid="chip-excluded" onClick={onFocusCustomers}>{excludedCount} customers excluded</Chip>
      )}
      {demandEditedCount > 0 && (
        <Chip testid="chip-demand-edited" onClick={onFocusCustomers}>demand edited ({demandEditedCount})</Chip>
      )}
      {stale && (
        <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50" data-testid="chip-stale">
          Stale
        </Badge>
      )}
    </div>
  );
}

function Chip({ children, onClick, testid }: { children: React.ReactNode; onClick: () => void; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}
