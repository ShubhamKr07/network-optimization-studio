// CH4-7 / CH4-23 / CH4-26 — pure step logic for max-coverage-us's two-step
// workflow. No DB access lives here: every function is a pure transform, so
// the epoch rule can be tested exhaustively without Postgres.

export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// A "Step 1 field" is any key in `inputs` other than these three. `step2` is
// Step 2's own parameters; `stepEpoch` is the marker itself; `distanceBands`
// is a reporting lens, not a model constraint, so it stays editable while
// Step 1 is frozen.
export const NON_STEP1_KEYS: ReadonlySet<string> = new Set(["step2", "stepEpoch", "distanceBands"]);

export function isStep1Key(key: string): boolean {
  return !NON_STEP1_KEYS.has(key);
}

// Per-key comparison via JSON.stringify, matching routes/scenarios.ts's own
// diffInputKeys: a key present on only one side always counts as changed,
// and one key's internal ordering cannot mask a change in a DIFFERENT key.
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) changed.push(key);
  }
  return changed;
}

export function readStepEpoch(inputs: Record<string, unknown> | null | undefined): number {
  const raw = inputs?.stepEpoch;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

// CH4-23 — the epoch is computed from the PERSISTED row and the candidate,
// never from a client value. Deliberately takes no `changedKeys` argument:
// an earlier draft did, which would have made the epoch boundary exactly as
// trustworthy as each caller's own diffing — and the whole point is that
// callers cannot be trusted (import/apply demonstrably isn't). A guard that
// accepts the guarded value as an argument is not a guard.
export function nextStepEpoch(
  persisted: Record<string, unknown>,
  next: Record<string, unknown>,
): number {
  const current = readStepEpoch(persisted);
  const touchedStep1 = changedKeys(persisted, next).some(isStep1Key);
  return touchedStep1 ? current + 1 : current;
}

// CH4-26 — create and clone both force epoch 1. For clone this is the whole
// point: carrying the source's epoch forward would make a fresh copy's epoch
// depend on how many times its SOURCE had been edited. Epoch is per-scenario
// workflow state, not user data, so it does not travel with a copy.
export function initialInputsForInsert(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  return { ...inputs, stepEpoch: 1 };
}

// CH4-10 — Step 2's SolveInput.inputs is built at enqueue and NEVER stored on
// the scenario. It is the synthesized object that gets validated and persisted
// as the job's `input_snapshot`, so:
//   - the snapshot's `objective` is what identifies which step a job belongs to;
//   - the floor the student was shown and the floor the solver was given come
//     from one source and cannot disagree.
// `coverageFloorDemand` is declared as an integer (maxCoverage.ts) and Step 1's
// `coveredDemand` is emitted as `int(covered)` (solve.py), so the injection
// needs no rounding and cannot fail shape validation.
export function synthesizeStep2Inputs(
  step1Inputs: Record<string, unknown>,
  coveredDemand: number,
): Record<string, unknown> {
  const { avgServiceDistCapKm: _dropped, step2, ...inherited } = step1Inputs;
  const overrides = (step2 ?? {}) as { gap?: number; timeLimitSec?: number };
  return {
    ...inherited,
    objective: "min_distance",
    coverageFloorDemand: coveredDemand,
    gap: overrides.gap ?? (inherited.gap as number),
    timeLimitSec: overrides.timeLimitSec ?? (inherited.timeLimitSec as number),
  };
}

export type MaxCoverageStep = 1 | 2;

// CH4-9 — the step a solve targets, derived from state alone. Step 1 unsolved
// → target Step 1; Step 1 solved → target Step 2. Because a Step 1 edit clears
// BOTH results (CH4-2), "Step 1 is solved" is the only question that needs
// asking.
export function deriveTargetStep(step1Solved: boolean): MaxCoverageStep {
  return step1Solved ? 2 : 1;
}
