// ORS path, Authorization header and the 3,500-pair limit are UNVERIFIED until a key is supplied (SM2-6); tests inject fetch only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  ORS_DEADLINE_MS, ORS_REQUEST_TIMEOUT_MS, ROAD_ERROR_STATUS, fetchRoadPairs, planBatches, runIfIdle, type OrsLocation,
} from "../services/orsClient.js";

/** Asymmetric coordinates (O5): lat and lng differ in sign and magnitude, so a swapped [lat, lng] cannot pass. */
const locs = (p: string, n: number, lat0: number, lng0: number): OrsLocation[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, lat: lat0 + i * 0.01, lng: lng0 - i * 0.01 }));
type Body = { locations: [number, number][]; sources: string[]; destinations: string[]; metrics: string[]; units: string };
/** Answers with distances[s][d] = 1000*s + d; records each parsed body; `nullAt` makes call #n return a null cell. */
function stub(bodies: Body[] = [], nullAt?: number) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body)) as Body;
    bodies.push(b);
    const d = b.sources.map((_, s) => b.destinations.map((_, j) => (bodies.length === nullAt && s === 0 && j === 0 ? null : 1000 * s + j)));
    return new Response(JSON.stringify({ distances: d }));
  }) as unknown as typeof fetch;
}
const expectBody = (b: Body, sources: OrsLocation[], dests: OrsLocation[]) =>
  expect(b).toEqual({
    locations: [...sources, ...dests].map(l => [l.lng, l.lat]),
    sources: sources.map((_, i) => String(i)), destinations: dests.map((_, j) => String(sources.length + j)),   // ORS MatrixRequest String[] (SM2-6)
    metrics: ["distance"], units: "mi",
  });
afterEach(() => vi.useRealTimers());

describe("constants and batching at the §3.3 caps", () => {
  it("defaults are 30 s per request and 120 s overall (O3)", () => {
    expect([ORS_REQUEST_TIMEOUT_MS, ORS_DEADLINE_MS]).toEqual([30_000, 120_000]);
  });
  it("O4: 20 plants / 50 WH / 500 customers -> exactly 9 fetches: one 20×50, eight chunks of ≤70 customers × 50 WH", async () => {
    const P = locs("P", 20, 40, -100), W = locs("W", 50, 35, -90), C = locs("C", 500, 30, -80);
    const bodies: Body[] = [];
    const f = stub(bodies);
    const pairs = await fetchRoadPairs({ apiKey: "KEY", batches: planBatches(P, W, C), fetchImpl: f });
    expect(vi.mocked(f)).toHaveBeenCalledTimes(9);
    expectBody(bodies[0], P, W);                                                     // O5: every body, both legs
    for (let k = 0; k < 8; k++) expectBody(bodies[k + 1], W, C.slice(k * 70, k * 70 + 70));
    expect(bodies.slice(1).map(b => b.destinations.length)).toEqual([70, 70, 70, 70, 70, 70, 70, 10]);
    expect(pairs).toHaveLength(20 * 50 + 50 * 500);
    expect(pairs[0]).toEqual({ fromId: "P1", toId: "W1", miles: 0 });
    expect(pairs.find(p => p.fromId === "W2" && p.toId === "C71")).toEqual({ fromId: "W2", toId: "C71", miles: 1000 });
  });
  it("R8: no warehouses, no customers, or neither -> no batches", () => {
    const P = locs("P", 2, 40, -100), W = locs("W", 2, 35, -90), C = locs("C", 2, 30, -80);
    expect(planBatches(P, [], C)).toEqual([]);
    expect(planBatches(P, W, [])).toEqual([]);
    expect(planBatches(P, [], [])).toEqual([]);
  });
  it("sends the key in Authorization to the driving-hgv matrix URL", async () => {
    const f = stub();
    await fetchRoadPairs({ apiKey: "KEY", batches: planBatches(locs("P", 1, 40, -100), locs("W", 1, 35, -90), locs("C", 1, 30, -80)), fetchImpl: f });
    const [url, init] = vi.mocked(f).mock.calls[0];
    expect(url).toBe("https://api.openrouteservice.org/v2/matrix/driving-hgv");
    expect((init!.headers as Record<string, string>).Authorization).toBe("KEY");
  });
});

describe("failures", () => {
  const small = () => planBatches(locs("P", 1, 40, -100), locs("W", 1, 35, -90), locs("C", 3, 30, -80));
  it("403 (daily quota or key rejected) and 429 (per-minute) -> quota with their own messages; 500 -> failed naming the batch; malformed -> failed", async () => {
    for (const [status, message] of [[403, "OpenRouteService refused the request: daily quota reached or API key rejected. Try again later or check ORS_API_KEY."], [429, "OpenRouteService per-minute quota reached, try again later"]] as const)
      await expect(fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: (async () => new Response("", { status })) as typeof fetch }))
        .rejects.toMatchObject({ code: "road_distances_quota", message });
    await expect(fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch }))
      .rejects.toMatchObject({ code: "road_distances_failed", message: expect.stringContaining("plants → warehouses") });
    await expect(fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: (async () => new Response("{}")) as typeof fetch }))
      .rejects.toMatchObject({ code: "road_distances_failed" });
  });
  it("the API key is never in an error message", async () => {
    for (const status of [403, 429, 500])
      await expect(fetchRoadPairs({ apiKey: "SECRETKEY", batches: small(), fetchImpl: (async () => new Response("SECRETKEY", { status })) as typeof fetch }))
        .rejects.toSatisfy((e: Error) => !e.message.includes("SECRETKEY"));
  });
  it("a null in the plant→warehouse leg is unroutable too (null in either leg)", async () => {
    const f = stub([], 1);
    await expect(fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: f }))
      .rejects.toMatchObject({ code: "road_distances_unroutable", message: expect.stringContaining("P1 to W1") });
    expect(vi.mocked(f)).toHaveBeenCalledTimes(1);
  });
  it("O6: a null in a warehouse→customer chunk names that pair and no later batch is requested", async () => {
    const P = locs("P", 1, 40, -100), W = locs("W", 50, 35, -90), C = locs("C", 200, 30, -80);   // 1 + 3 batches
    const f = stub([], 2);                                                                     // call #2 = first customer chunk
    await expect(fetchRoadPairs({ apiKey: "k", batches: planBatches(P, W, C), fetchImpl: f }))
      .rejects.toMatchObject({ code: "road_distances_unroutable", message: expect.stringContaining("W1 to C1") });
    expect(vi.mocked(f)).toHaveBeenCalledTimes(2);
  });
  it("a per-request timeout fails as road_distances_failed; no retries", async () => {
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: hang, requestTimeoutMs: 20 })).rejects.toMatchObject({ code: "road_distances_failed" });
    expect(vi.mocked(hang)).toHaveBeenCalledTimes(1);
  });
  it("O2: a completed request's timer is cleared — its signal never aborts later", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      const b = JSON.parse(String(init!.body)) as Body;
      return new Response(JSON.stringify({ distances: b.sources.map(() => b.destinations.map(() => 1)) }));
    }) as unknown as typeof fetch;
    await fetchRoadPairs({ apiKey: "k", batches: small(), fetchImpl: f });
    await vi.advanceTimersByTimeAsync(ORS_DEADLINE_MS * 2);
    expect(signals).toHaveLength(2);
    expect(signals.every(sg => !sg.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("O3: the shared 120 s deadline aborts a LATER request even though each request is under 30 s", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const slow = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      calls++;
      const b = JSON.parse(String(init!.body)) as Body;
      const t = setTimeout(() => resolve(new Response(JSON.stringify({ distances: b.sources.map(() => b.destinations.map(() => 1)) }))), 25_000);
      init!.signal!.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); });
    })) as unknown as typeof fetch;
    const P = locs("P", 1, 40, -100), W = locs("W", 50, 35, -90), C = locs("C", 500, 30, -80);   // 9 batches × 25 s > 120 s
    const run = fetchRoadPairs({ apiKey: "k", batches: planBatches(P, W, C), fetchImpl: slow });
    const settled = expect(run).rejects.toMatchObject({ code: "road_distances_failed" });
    await vi.advanceTimersByTimeAsync(ORS_DEADLINE_MS + 1);
    await settled;
    expect(calls).toBe(5);                     // requests at 0, 25, 50, 75, 100 s; the 5th is aborted at 120 s
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("O1/O7: one fetch at a time", () => {
  it("a second fetch while one runs is rejected immediately as busy (409)", async () => {
    let release!: () => void;
    const first = runIfIdle(() => new Promise<string>(r => { release = () => r("done"); }));
    await expect(runIfIdle(async () => "second")).rejects.toMatchObject({ code: "road_distances_busy" });
    expect(ROAD_ERROR_STATUS.road_distances_busy).toBe(409);
    release();
    await expect(first).resolves.toBe("done");
  });
  it("the flag is released after a failed task and after an aborted fetch", async () => {
    await expect(runIfIdle(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(runIfIdle(async () => "after-fail")).resolves.toBe("after-fail");
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const batches = planBatches(locs("P", 1, 40, -100), locs("W", 1, 35, -90), locs("C", 1, 30, -80));
    await expect(runIfIdle(() => fetchRoadPairs({ apiKey: "k", batches, fetchImpl: hang, requestTimeoutMs: 20 }))).rejects.toMatchObject({ code: "road_distances_failed" });
    await expect(runIfIdle(async () => "after-abort")).resolves.toBe("after-abort");
  });
});

it("the TS error-code union equals the OpenAPI enum", () => {
  const yaml = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
  const m = /RoadDistancesErrorCode:[\s\S]*?enum: \[([^\]]+)\]/.exec(yaml)!;
  expect(m[1].split(",").map(s => s.trim()).sort()).toEqual(Object.keys(ROAD_ERROR_STATUS).sort());
});
