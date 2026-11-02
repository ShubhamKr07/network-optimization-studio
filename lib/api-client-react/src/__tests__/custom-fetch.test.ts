import { describe, it, expect, vi, beforeEach } from "vitest";
import { customFetch, NetworkError } from "../custom-fetch.js";

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

// fetch() rejects (with a browser-specific TypeError) when the request never
// got a response: offline, DNS, a corporate gateway dropping it. customFetch
// names that at the source, so the UI never has to guess from `TypeError`,
// which client-side bugs also throw.
describe("customFetch network failure", () => {
  it.each(["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."])(
    "rejects with a NetworkError when fetch rejects with %j",
    async (message) => {
      const cause = new TypeError(message);
      vi.stubGlobal("fetch", vi.fn(async () => { throw cause; }));
      const err = await customFetch("/api/whatever").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkError);
      expect((err as NetworkError).name).toBe("NetworkError");
      expect((err as NetworkError).cause).toBe(cause);
    },
  );

  it("lets an abort through unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));
    await expect(customFetch("/api/whatever")).rejects.toBe(abort);
  });
});
