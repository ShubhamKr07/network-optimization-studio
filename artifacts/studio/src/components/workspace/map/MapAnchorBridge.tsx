import { useCallback, useLayoutEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { Point } from "./placeCard";

/** Reports the selected entity's marker position in the map container's pixel space (useMap().latLngToContainerPoint),
 *  re-reporting on the map's `move`/`zoom`/`resize` while a selection exists. Render INSIDE <MapContainer>. */
export function MapAnchorBridge({ latLng, onAnchor }: { latLng: [number, number] | null; onAnchor: (p: Point | null) => void }): null {
  const map = useMap();
  const lat = latLng?.[0];
  const lng = latLng?.[1];
  const report = useCallback(() => {
    if (lat == null || lng == null) return onAnchor(null);
    const p = map.latLngToContainerPoint([lat, lng]);
    onAnchor({ x: p.x, y: p.y });
  }, [map, lat, lng, onAnchor]);
  useLayoutEffect(report, [report]);
  useMapEvents({ move: report, zoom: report, resize: report });
  return null;
}
