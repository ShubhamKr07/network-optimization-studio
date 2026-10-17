import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// A real EventEmitter, so emit("error") with no listener throws — the exact
// way pg's Pool turns an idle-client error into an uncaught exception.
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
    mockPoolCtor.mockImplementation(() => new EventEmitter());
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

// NOS-API-3 (2026-09-24): a Postgres restart ("terminating connection due to
// administrator command") reached the pool as an idle-client error with no
// listener, which Node raises as an uncaught exception.
describe("db pool idle-client errors", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockPoolCtor.mockImplementation(() => new EventEmitter());
    process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgresql://localhost/test" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it("logs an idle-client error instead of throwing it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = await import("../index.js");
    const err = new Error("terminating connection due to administrator command");

    expect(() => pool.emit("error", err)).not.toThrow();
    expect(logged).toHaveBeenCalledWith(expect.any(String), err);
  });
});
