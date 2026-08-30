import { describe, it, expect, vi, beforeEach } from "vitest";
import { reverseGeocode } from "../fetch-postal-codes.testable.js";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("reverseGeocode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns a hit with the postcode on a successful response", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ address: { postcode: "18101" } }) });
    expect(await reverseGeocode(40.6, -75.5)).toEqual({ kind: "hit", postcode: "18101" });
  });

  it("returns a genuine miss when the address block has no postcode", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ address: {} }) });
    expect(await reverseGeocode(0, 0)).toEqual({ kind: "miss" });
  });

  it("returns a failure (not a miss) on a non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const outcome = await reverseGeocode(0, 0);
    expect(outcome.kind).toBe("failure");
  });

  it("returns a failure (not a miss) when fetch itself throws", async () => {
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));
    const outcome = await reverseGeocode(0, 0);
    expect(outcome.kind).toBe("failure");
  });

  it("returns a failure (not a miss) on malformed JSON", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => { throw new Error("bad json"); } });
    const outcome = await reverseGeocode(0, 0);
    expect(outcome.kind).toBe("failure");
  });
});
