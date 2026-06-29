import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const userProgressTable = pgTable("user_progress", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().default("guest"),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  streakDays: integer("streak_days").notNull().default(0),
  lastSolveDate: text("last_solve_date"),
  solvedScenarios: jsonb("solved_scenarios").notNull().default({}).$type<Record<string, unknown>>(),
  earnedBadges: jsonb("earned_badges").notNull().default([]).$type<string[]>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex("user_progress_user_id_unique").on(table.userId),
}));

export type UserProgress = typeof userProgressTable.$inferSelect;
export type InsertUserProgress = typeof userProgressTable.$inferInsert;
