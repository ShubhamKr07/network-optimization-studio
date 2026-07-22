import { z } from "zod";

const warehouseOverrideSchema = z.object({
  id: z.string(),
  capacity: z.number().positive().nullable().optional(),
  status: z.enum(["active", "forced_open", "inactive"]),
});

const customerOverrideSchema = z.object({
  id: z.string(),
  demand: z.number().nonnegative().nullable().optional(),
  status: z.enum(["active", "excluded"]),
});

export const pMedianInputsSchema = z.object({
  p: z.number().int().min(1).max(50),
  capacityMode: z.enum(["none", "uniform", "per_wh"]),
  uniformCapacity: z.number().positive().nullable().optional(),
  warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
  customerOverrides: z.array(customerOverrideSchema).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  // p-median-brazil only (solve_capacitated_pmedian reads this; plain
  // p-median's dispatch ignores it). Kept on the shared schema per D0.3
  // rather than forking a second validator for one extra field.
  singleSource: z.boolean().optional(),
});

export type PMedianInputs = z.infer<typeof pMedianInputsSchema>;
