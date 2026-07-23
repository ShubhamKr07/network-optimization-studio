import { validateInputs } from "../../registry/modelRegistry.js";
import type { ValidateInputsResult } from "../../registry/modelRegistry.js";

export type { ValidateInputsResult };

// Delegates to the model registry (Phase 3.5, G1.2) — same signature as
// before, so no call sites in routes.ts change.
export function validateInputsForModel(modelId: string, inputs: unknown): ValidateInputsResult {
  return validateInputs(modelId, inputs);
}
