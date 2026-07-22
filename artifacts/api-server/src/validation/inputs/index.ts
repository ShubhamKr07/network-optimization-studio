import type { ZodType } from "zod";
import { pMedianInputsSchema } from "./pMedian.js";
import { transportLpInputsSchema } from "./transportLp.js";

// Keyed by model_id (filesystem-registry-validated, see solvers/<model-id>/).
// Phase 3.5's model registry replaces this lookup with manifest-driven
// schemas without changing validateInputsForModel's call sites.
const SCHEMAS_BY_MODEL_ID: Record<string, ZodType> = {
  "p-median-us": pMedianInputsSchema,
  "p-median-brazil": pMedianInputsSchema,
  "transport-coal": transportLpInputsSchema,
};

export type ValidateInputsResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

export function validateInputsForModel(modelId: string, inputs: unknown): ValidateInputsResult {
  const schema = SCHEMAS_BY_MODEL_ID[modelId];
  if (!schema) {
    return { success: false, error: `Unknown model_id: ${modelId}` };
  }
  const result = schema.safeParse(inputs);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true, data: result.data as Record<string, unknown> };
}
