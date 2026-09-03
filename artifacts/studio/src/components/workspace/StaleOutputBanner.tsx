import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StaleOutputBannerProps {
  onRunOptimizer: () => void;
}

// A3.2 — blanks output-kind tab content (Output Map today; Reports & Compare
// once C2.1/C3.1 build it) whenever the active scenario's outputs aren't
// trustworthy: unsolved (`result == null`) or stale (`result` present but no
// longer reflects current inputs, X1.1's `Scenario.stale`). Wording matches
// Studio.tsx's existing stale-badge convention ("Stale — inputs changed
// since this solve", `lib/quality.ts`-style status-statement tone) rather
// than inventing new copy. Wireframe screen 1a·5.
export function StaleOutputBanner({ onRunOptimizer }: StaleOutputBannerProps) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-3 text-center px-4"
      data-testid="stale-output-banner"
    >
      <AlertTriangle className="w-6 h-6 text-amber-500" />
      <p className="text-sm font-medium text-[color:var(--text-body)]">Inputs changed since last solve</p>
      <p className="text-xs text-[color:var(--text-muted)] max-w-sm">
        This scenario's outputs no longer reflect its current inputs. Re-run the optimizer to see up-to-date results.
      </p>
      <Button size="sm" onClick={onRunOptimizer} data-testid="button-stale-banner-run-optimizer">
        Run Optimizer
      </Button>
    </div>
  );
}
