import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, usersTable: {} }));

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.resetModules();
});

async function importAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import("../middlewares/auth");
}

describe("SESSION_SECRET boot guard", () => {
  it("refuses to load in production without SESSION_SECRET", async () => {
    await expect(importAuth({ NODE_ENV: "production", SESSION_SECRET: undefined })).rejects.toThrow(
      "SESSION_SECRET is required in production",
    );
  });

  it("refuses an empty SESSION_SECRET in production", async () => {
    await expect(importAuth({ NODE_ENV: "production", SESSION_SECRET: "" })).rejects.toThrow(
      "SESSION_SECRET is required in production",
    );
  });

  it("uses the configured secret in production", async () => {
    const auth = await importAuth({ NODE_ENV: "production", SESSION_SECRET: "configured-secret" });
    expect(auth.SESSION_SECRET).toBe("configured-secret");
  });

  it("keeps the dev fallback outside production", async () => {
    const auth = await importAuth({ NODE_ENV: "test", SESSION_SECRET: undefined });
    expect(auth.SESSION_SECRET).toBe("arcadia-dev-secret");
  });
});
