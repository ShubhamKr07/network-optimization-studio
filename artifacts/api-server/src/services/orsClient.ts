// SM2-9 (spec §8, D7/D9) — OpenRouteService matrix client. Tests inject fetch; nothing here ever logs the key.
import type { RoadPair } from "./superRoad.js";

export type RoadDistancesErrorCode =
  | "road_distances_unavailable" | "road_distances_quota" | "road_distances_failed" | "road_distances_unroutable" | "road_distances_busy";
export const ROAD_ERROR_STATUS: Record<RoadDistancesErrorCode, number> = {
  road_distances_unavailable: 503, road_distances_quota: 429, road_distances_failed: 502, road_distances_unroutable: 422, road_distances_busy: 409,
};
export class RoadDistancesError extends Error {
  constructor(readonly code: RoadDistancesErrorCode, message: string) { super(message); this.name = "RoadDistancesError"; }
}
// UNVERIFIED until a real ORS key is supplied (SM2-6): the /v2/matrix/driving-hgv path, the Authorization header carrying the key,
// and the hosted 3,500-pair limit. The self-hosted default is 2,500; if the live check disagrees, change ORS_MAX_PAIRS only.
export const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-hgv";
export const ORS_MAX_PAIRS = 3500;
export const ORS_REQUEST_TIMEOUT_MS = 30_000;
export const ORS_DEADLINE_MS = 120_000;
const QUOTA = "OpenRouteService per-minute quota reached, try again later";
const REFUSED = "OpenRouteService refused the request: daily quota reached or API key rejected. Try again later or check ORS_API_KEY.";
const BUSY = "Road distances are already being fetched on this server. Try again in a minute.";

export interface OrsLocation { id: string; lat: number; lng: number }
export interface OrsBatch { label: string; sources: OrsLocation[]; destinations: OrsLocation[] }

/** §8: all plants × all warehouses, then customers in chunks of floor(3500 / warehouses) with every warehouse as a source.
 *  R8: no warehouses or no customers => nothing to fetch (the network cannot be solved anyway). */
export function planBatches(plants: OrsLocation[], warehouses: OrsLocation[], customers: OrsLocation[]): OrsBatch[] {
  if (warehouses.length === 0 || customers.length === 0) return [];
  const out: OrsBatch[] = [];
  if (plants.length > 0) out.push({ label: "plants → warehouses", sources: plants, destinations: warehouses });
  const chunk = Math.floor(ORS_MAX_PAIRS / warehouses.length);
  for (let i = 0; i < customers.length; i += chunk)
    out.push({ label: `warehouses → customers ${i + 1}–${Math.min(i + chunk, customers.length)}`, sources: warehouses, destinations: customers.slice(i, i + chunk) });
  return out;
}

const failed = (b: OrsBatch, why: string) => new RoadDistancesError("road_distances_failed", `OpenRouteService ${why} for ${b.label}.`);

export async function fetchRoadPairs(o: { apiKey: string; batches: OrsBatch[]; fetchImpl?: typeof fetch; requestTimeoutMs?: number; deadlineMs?: number }): Promise<RoadPair[]> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), o.deadlineMs ?? ORS_DEADLINE_MS);
  const pairs: RoadPair[] = [];
  try {
    for (const b of o.batches) {                                     // serial, no retries (§8)
      const body = {
        locations: [...b.sources, ...b.destinations].map(l => [l.lng, l.lat]),   // ORS wants [longitude, latitude]
        sources: b.sources.map((_, i) => String(i)),             // ORS MatrixRequest types these String[]
        destinations: b.destinations.map((_, j) => String(b.sources.length + j)),
        metrics: ["distance"], units: "mi",
      };
      // O2: per-request controller + cancellable timer, cleared in finally, so a finished request can never abort later.
      const request = new AbortController();
      const requestTimer = setTimeout(() => request.abort(), o.requestTimeoutMs ?? ORS_REQUEST_TIMEOUT_MS);
      let d: unknown;
      try {
        let res: Response;
        try {
          res = await fetchImpl(ORS_MATRIX_URL, {
            method: "POST",
            headers: { Authorization: o.apiKey, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.any([deadline.signal, request.signal]),
          });
        } catch {                                                     // no binding: nothing from the request can leak
          throw failed(b, "did not answer (timed out or unreachable)");
        }
        // 403 = daily quota, 429 = per-minute (ORS FAQ); one code for both
        if (res.status === 429 || res.status === 403) throw new RoadDistancesError("road_distances_quota", res.status === 403 ? REFUSED : QUOTA);
        if (!res.ok) throw failed(b, `failed (HTTP ${res.status})`);
        d = ((await res.json().catch(() => null)) as { distances?: unknown } | null)?.distances;
      } finally {
        clearTimeout(requestTimer);
      }
      if (!Array.isArray(d) || d.length !== b.sources.length) throw failed(b, "returned an unexpected response");
      b.sources.forEach((s, i) => b.destinations.forEach((t, j) => {
        const miles = (d[i] as unknown[] | undefined)?.[j];
        if (miles === null) throw new RoadDistancesError("road_distances_unroutable", `No road route from ${s.id} to ${t.id}. Add a distance override for that pair.`);
        if (typeof miles !== "number" || !Number.isFinite(miles)) throw failed(b, "returned an unexpected response");
        pairs.push({ fromId: s.id, toId: t.id, miles });             // unrounded (§8)
      }));
    }
    return pairs;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

// ponytail: single-instance busy flag; a shared limiter is needed only if nos-api scales past one instance.
let busy = false;
/** O1 (spec §8 Concurrency): never two ORS fetches at once in this process, and never a waiting request. */
export async function runIfIdle<T>(task: () => Promise<T>): Promise<T> {
  if (busy) throw new RoadDistancesError("road_distances_busy", BUSY);
  busy = true;
  try { return await task(); } finally { busy = false; }
}

let fetchForTests: typeof fetch | null = null;
/** Test-only seam (module variable, not an env var or config flag), same pattern as setLockedModelsForTests. */
export function setOrsFetchForTests(f: typeof fetch | null): void { fetchForTests = f; }
export function orsFetch(): typeof fetch { return fetchForTests ?? fetch; }
