import { pgTable, serial, text, integer, jsonb, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth.js";

export const scenariosTable = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  modelId: text("model_id").notNull(),
  inputs: jsonb("inputs").notNull().default({}).$type<Record<string, unknown>>(),
  inputsVersion: integer("inputs_version").notNull().default(1),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  solvedAt: timestamp("solved_at"),
  inputsUpdatedAt: timestamp("inputs_updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("IDX_scenarios_user_id").on(table.userId)]);

export type Scenario = typeof scenariosTable.$inferSelect;
export type InsertScenario = typeof scenariosTable.$inferInsert;
