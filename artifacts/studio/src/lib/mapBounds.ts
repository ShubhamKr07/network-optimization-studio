// E5.1 — map bounds derived from the model's manifest (GET /api/models)
// instead of a hardcoded per-page constant, so a new model's map is
// correctly bounded with zero map-component changes as long as its
// manifest sets countryBounds.

export interface CountryBounds {
  sw: number[];
  ne: number[];
}

export interface MapBoundsProps {
  maxBounds: [[number, number], [number, number]];
  center: [number, number];
  minZoom: number;
}

// Continental US — used only if a model's manifest is missing/not yet
// loaded (e.g. GET /api/models hasn't resolved), never as a silent
// substitute for a real per-model value once one exists.
const FALLBACK_BOUNDS: MapBoundsProps = {
  maxBounds: [[24, -125], [50, -66]],
  center: [39.5, -98.35],
  minZoom: 3,
};

export function getMapBoundsProps(countryBounds: CountryBounds | undefined): MapBoundsProps {
  if (!countryBounds || countryBounds.sw.length !== 2 || countryBounds.ne.length !== 2) {
    return FALLBACK_BOUNDS;
  }
  const [swLat, swLng] = countryBounds.sw;
  const [neLat, neLng] = countryBounds.ne;
  return {
    maxBounds: [[swLat, swLng], [neLat, neLng]],
    center: [(swLat + neLat) / 2, (swLng + neLng) / 2],
    minZoom: 3,
  };
}
