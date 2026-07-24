import { z } from "zod";

export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  mineCapacities: z.record(z.string(), z.number().nonnegative()).optional().default({}),
});

export type TransportLpInputs = z.infer<typeof transportLpInputsSchema>;
