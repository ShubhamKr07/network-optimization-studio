import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { LoginUserResponse, GetCurrentAuthUserResponse, ResetPasswordResponse } from "@workspace/api-zod";
import { parseRole, ROLES } from "../lib/roles.js";
import { logger } from "../lib/logger.js";

describe("parseRole", () => {
  it("keeps the three known roles", () => {
    expect(parseRole("student")).toBe("student");
    expect(parseRole("instructor")).toBe("instructor");
    expect(parseRole("admin")).toBe("admin");
  });
  it("maps unknown values to student and warns without the value's owner", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    try {
      for (const raw of ["Admin", "", "teacher", null, undefined, 7]) expect(parseRole(raw)).toBe("student");
      expect(warn).toHaveBeenCalledTimes(6);
      for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toMatch(/userId|email/);
    } finally {
      warn.mockRestore();
    }
  });
});

// Spec 3.1 rollout trap: a contract without a role would 500 that role's log-in.
describe("auth response contracts accept every role", () => {
  it.each([...ROLES])("%s", (role) => {
    const body = { user: { id: "x", email: "a@b.test", role } };
    for (const schema of [LoginUserResponse, GetCurrentAuthUserResponse, ResetPasswordResponse]) {
      expect(() => schema.parse(body)).not.toThrow();
    }
  });
});

describe("users.role CHECK", () => {
  it("exists in the live database and rejects 'Admin'", async () => {
    const rows = await db.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CK_users_role'`);
    expect(String((rows.rows[0] as { def: string }).def)).toContain("'admin'");
    const id = `ck-role-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const err = await db
        .execute(sql`INSERT INTO users (id, email, role) VALUES (${id}, ${id + "@probe.test"}, 'Admin')`)
        .then(() => null, (e: unknown) => e as { cause?: { code?: string }; message?: string });
      expect(err).not.toBeNull();
      expect(err!.cause?.code === "23514" || String(err!.message).includes("CK_users_role")).toBe(true);
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
  });
});
