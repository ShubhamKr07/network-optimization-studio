import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPoolCtor = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  default: { Pool: mockPoolCtor },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({})),
}));

describe("db pool SSL configuration", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgresql://localhost/test" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("does not set ssl when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    await import("../index.js");
    expect(mockPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: undefined }),
    );
  });

  it("sets ssl with rejectUnauthorized:false when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    await import("../index.js");
    expect(mockPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } }),
    );
  });
});
