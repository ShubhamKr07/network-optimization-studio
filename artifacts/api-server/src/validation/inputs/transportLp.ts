import { z } from "zod";

export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
});

export type TransportLpInputs = z.infer<typeof transportLpInputsSchema>;
