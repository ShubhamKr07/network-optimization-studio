import { pgTable, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";

// Phase 6 (P1.2) — write-through cache for byte-identical repeated solves
// (common in a classroom where many students start from the textbook
// baseline). Keyed on jobRunner.ts's `computeInputsHash()` (modelId +
// dataset version + canonical JSON of inputs), so a cache hit is exactly
// "same model, same dataset version, same inputs" — not an approximation.
// `result` stores the full standardized result envelope (ResultEnvelope),
// validated again on read (schema can drift between when an entry was
// cached and now) — see jobRunner.ts's check-before-dispatch in runJob().
export const resultCacheTable = pgTable("result_cache", {
  inputsHash: varchar("inputs_hash").primaryKey(),
  modelId: varchar("model_id").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ResultCache = typeof resultCacheTable.$inferSelect;
export type InsertResultCache = typeof resultCacheTable.$inferInsert;
