import { pgTable, serial, text, integer, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const scenariosTable = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  problemType: text("problem_type").notNull().default("p_median"),
  pValue: integer("p_value").notNull().default(3),
  distanceBands: jsonb("distance_bands").notNull().default([200, 400, 800, 1600]).$type<number[]>(),
  solver: text("solver").notNull().default("cbc"),
  gap: real("gap").notNull().default(0.0),
  timeLimitSec: integer("time_limit_sec").notNull().default(120),
  capacityMode: text("capacity_mode").notNull().default("uniform"),
  uniformCapacity: integer("uniform_capacity"),
  warehouseStatuses: jsonb("warehouse_statuses").notNull().default([]).$type<Array<{ warehouseId: string; status: string }>>(),
  // Chapter 5 transport LP fields
  capacityFactor: real("capacity_factor").notNull().default(1.0),
  singleSource: boolean("single_source").notNull().default(false),
  capacityInactive: boolean("capacity_inactive").notNull().default(false),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Scenario = typeof scenariosTable.$inferSelect;
export type InsertScenario = typeof scenariosTable.$inferInsert;
