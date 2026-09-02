import { describe, it, expect, vi, beforeEach } from "vitest";
import { getReferenceDistances } from "../generated/api.js";
import { ApiError } from "../custom-fetch.js";

// Bundle 2.2 (B2.2-T2) — generated-client coverage for the two conditional
// (non-200) responses documented on GET /models/{id}/reference-distances:
// 304 (If-None-Match matched) and 422 (known-but-unsupported model). The
// generated getReferenceDistances() is a thin wrapper over customFetch,
// which throws ApiError for any non-2xx status (304 included, since
// fetch's response.ok is only true for 200-299) — this is the real,
// already-shipped customFetch contract, not something new to this route.
describe("generated getReferenceDistances — 304/422 handling", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiError(304) when the server returns 304 Not Modified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );

    await expect(getReferenceDistances("p-median-us")).rejects.toMatchObject({
      name: "ApiError",
      status: 304,
    });
    await expect(getReferenceDistances("p-median-us")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError(422) with the error body when the model is known-but-unsupported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Model transport-coal does not support reference distances" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const err = await getReferenceDistances("transport-coal").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.data).toMatchObject({ error: expect.stringContaining("does not support reference distances") });
  });

  it("returns the parsed body on 200", async () => {
    const body = { pairs: [{ fromId: "ALN", fromCode: "ALN", toId: "C1", toCode: "C1", distance: 374 }], distanceUnit: "mi" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await getReferenceDistances("p-median-us");
    expect(result).toEqual(body);
  });
});
