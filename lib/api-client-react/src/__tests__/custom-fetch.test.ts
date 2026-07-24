import { describe, it, expect, vi, beforeEach } from "vitest";
import { customFetch } from "../custom-fetch.js";

describe("customFetch default credentials", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  it("defaults credentials to 'include' when the caller doesn't specify one", async () => {
    await customFetch("/api/whatever");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("include");
  });

  it("respects an explicit credentials value if the caller passes one", async () => {
    await customFetch("/api/whatever", { credentials: "omit" } as RequestInit);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("omit");
  });
});
