import { z } from "zod";

export const twoEchelonInputsSchema = z.object({
  // .gt(1), not .positive(): a ratio at or below 1 means refining creates mass.
  // Rejecting at the edge beats debugging a nonsensical optimum later.
  bomRatio: z.number().gt(1).max(10),
  refineryOverrides: z.array(z.object({
    id: z.string(),
    status: z.enum(["active", "forced_open", "inactive"]),
  })).default([]),
  customerOverrides: z.array(z.object({
    id: z.string(),
    demand: z.number().min(0).nullable().optional(),
    status: z.enum(["active", "excluded"]),
  })).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),   // required -- NaN here kills every solve
});

export type TwoEchelonInputs = z.infer<typeof twoEchelonInputsSchema>;
