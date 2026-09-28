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
    <div className="flex items-center gap-2">
      <div
        className="inline-flex rounded border border-[color:var(--ink-500)] overflow-hidden"
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
                  : "bg-transparent text-[color:var(--ink-300)] hover:bg-white/10"
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
      <span className="text-xs font-mono text-[color:var(--ink-300)]" data-testid="text-steps-solved-counter">
        {solvedCount} of 2 solved
      </span>
    </div>
  );
}
