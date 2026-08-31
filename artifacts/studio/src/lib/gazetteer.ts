// Offline US gazetteer: reverse (lat/lng -> nearest city) and forward
// (city+state -> lat/lng) lookup, sourced from the US Census Bureau's 2023
// Gazetteer Files (Places) — see `scripts/build-gazetteer.mjs` for the
// extraction pipeline and provenance. Public domain, no network calls.
import gazetteerData from "./gazetteer-us.json";

export interface GazCity {
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export const GAZETTEER: readonly GazCity[] = gazetteerData;

const EARTH_RADIUS_MI = 3959;

/** Great-circle distance in miles, matching the backend's haversine formula. */
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

/** Reverse lookup: the gazetteer city nearest to (lat, lng) by true great-circle distance. */
export function nearestCity(lat: number, lng: number): GazCity {
  let nearest = GAZETTEER[0];
  let nearestDist = haversineMi(lat, lng, nearest.lat, nearest.lng);
  for (let i = 1; i < GAZETTEER.length; i++) {
    const candidate = GAZETTEER[i];
    const dist = haversineMi(lat, lng, candidate.lat, candidate.lng);
    if (dist < nearestDist) {
      nearest = candidate;
      nearestDist = dist;
    }
  }
  return nearest;
}

/** Forward lookup: exact (case-insensitive) city+state match, or null if not in the gazetteer. */
export function lookupCity(city: string, state: string): { lat: number; lng: number } | null {
  const cityLower = city.trim().toLowerCase();
  const stateLower = state.trim().toLowerCase();
  const match = GAZETTEER.find(
    (g) => g.city.toLowerCase() === cityLower && g.state.toLowerCase() === stateLower,
  );
  return match ? { lat: match.lat, lng: match.lng } : null;
}
