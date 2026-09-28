import { useMemo } from "react";
import type { Scenario, ScenarioSteps } from "@workspace/api-client-react";

export interface MaxCoverageStepState {
  isMaxCoverage: boolean;
  steps: ScenarioSteps | null;
  solvedCount: 0 | 1 | 2;
  /** CH4-9 — derived from the SAME rule the server applies, so the Solve
   *  button's label cannot disagree with what actually runs. */
  targetStep: 1 | 2;
  /** §3 — Step 1 is frozen the moment it is solved, whichever step the
   *  toggle points at. */
  step1Frozen: boolean;
  solveLabel: string;
}

// CH4-17 — reads the server-derived per-step state (Task 5's `Scenario.steps`,
// present only for max-coverage-us) so the UI never re-derives which step is
// "next" on its own. `scenario.steps` is undefined for every other model —
// `isMaxCoverage` is exactly that presence check, not a modelId comparison.
export function useMaxCoverageSteps(scenario: Scenario | null | undefined): MaxCoverageStepState {
  return useMemo(() => {
    const steps = (scenario?.steps ?? null) as ScenarioSteps | null;
    if (!steps) {
      return {
        isMaxCoverage: false, steps: null, solvedCount: 0,
        targetStep: 1, step1Frozen: false, solveLabel: "Run Optimizer",
      };
    }
    const solvedCount = ((steps.step1.solved ? 1 : 0) + (steps.step2.solved ? 1 : 0)) as 0 | 1 | 2;
    const targetStep: 1 | 2 = steps.step1.solved ? 2 : 1;
    return {
      isMaxCoverage: true,
      steps,
      solvedCount,
      targetStep,
      step1Frozen: steps.step1.solved,
      solveLabel: `Solve Step ${targetStep}`,
    };
  }, [scenario]);
}
