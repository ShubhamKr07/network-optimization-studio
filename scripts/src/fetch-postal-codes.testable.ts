// Split out from fetch-postal-codes.ts (which runs main() at module load)
// so the one function worth unit testing in isolation can be imported
// without triggering a real run.
export type GeocodeOutcome =
  | { kind: "hit"; postcode: string }
  | { kind: "miss" } // genuine: a real 200 response with no postcode in the address
  | { kind: "failure"; reason: string }; // transient: timeout, non-2xx, network error, malformed JSON — retry, don't count as a miss

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeOutcome> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "nos-dataset-script/1.0 (one-time postal-code sourcing)" } });
  } catch (err) {
    return { kind: "failure", reason: `network error: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return { kind: "failure", reason: `HTTP ${res.status}` };
  }
  let body: { address?: { postcode?: string } };
  try {
    body = (await res.json()) as { address?: { postcode?: string } };
  } catch {
    return { kind: "failure", reason: "malformed JSON response" };
  }
  const postcode = body.address?.postcode;
  return postcode ? { kind: "hit", postcode } : { kind: "miss" };
}
