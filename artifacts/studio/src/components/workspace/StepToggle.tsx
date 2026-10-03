import { Lock } from "lucide-react";
import type { ScenarioSteps } from "@workspace/api-client-react";

interface StepToggleProps {
  selected: 1 | 2;
  onSelect: (step: 1 | 2) => void;
  solvedCount: 0 | 1 | 2;
  steps: ScenarioSteps;
}

const LABELS: Record<1 | 2, string> = { 1: "1. Max Coverage", 2: "2. Min Distance" };

// CH4-15 — always selectable. At `0 of 2` Step 2 is VIEWABLE with a lock icon;
// what is locked is its Solve, not the act of looking at it (frame 3a).
export function StepToggle({ selected, onSelect, solvedCount, steps }: StepToggleProps) {
  return (
    // COSM-2 — `flex-wrap` so the "N of 2 solved" counter drops onto its own
    // line instead of being pushed off the right edge. This component used to
    // sit in the full-width page header; it now sits in the toolbar row
    // INSIDE the content column, which at a 375 px viewport is only ~151 px
    // wide (the sidebar is a fixed 224 px). A no-op at any width where the
    // counter already fits beside the group.
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded border border-border overflow-hidden"
        role="group"
        aria-label="Workflow step"
        data-testid="step-toggle"
      >
        {([1, 2] as const).map((step) => {
          const state = step === 1 ? steps.step1 : steps.step2;
          const locked = step === 2 && !steps.step1.solved;
          return (
            <button
              key={step}
              type="button"
              data-testid={`step-toggle-${step}`}
              aria-pressed={selected === step}
              onClick={() => onSelect(step)}
              className={`flex items-center gap-1 text-xs px-3 py-1 transition-colors ${
                selected === step
                  ? "bg-primary text-white"
                  : "bg-transparent text-muted-foreground hover:bg-muted"
              }`}
            >
              {LABELS[step]}
              {locked && <Lock className="w-3 h-3" data-testid={`step-toggle-${step}-lock`} />}
              {/* CH4-3 — staleness exists in exactly one place: Step 2, after
                  Step 2 has solved. Step 1 can never be stale, because the only
                  thing that can change it also clears it. */}
              {step === 2 && state.stale && (
                <span data-testid="step-toggle-2-stale" className="text-[10px] uppercase tracking-wide">
                  stale
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className="text-xs font-mono text-muted-foreground" data-testid="text-steps-solved-counter">
        {solvedCount} of 2 solved
      </span>
    </div>
  );
}
