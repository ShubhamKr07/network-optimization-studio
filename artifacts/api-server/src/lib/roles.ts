import { logger } from "./logger.js";

export const ROLES = ["student", "instructor", "admin"] as const;
export type Role = (typeof ROLES)[number];

// The DB CHECK keeps users.role inside ROLES; this is the belt to that brace, so a
// value written before the constraint (or by hand) can never 500 a log-in response.
export function parseRole(raw: unknown): Role {
  if (typeof raw === "string" && (ROLES as readonly string[]).includes(raw)) return raw as Role;
  logger.warn({ roleType: typeof raw }, "users.role holds an unknown value; treated as student");
  return "student";
}
