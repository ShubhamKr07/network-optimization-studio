import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * SBR-3 — leaflet 1.9.4's `trackResize` subscribes to **window** resize only
 * (node_modules/leaflet/src/map/Map.js:1324-1326), so a container that changes
 * width without the window changing — exactly what collapsing or expanding the
 * sidebar rail does — leaves the map rendered at its old width: a blank strip or
 * cropped tiles until the window itself is resized. Input Map is auto-opened on
 * entry to a model page, so this is the default state, not an edge case.
 *
 * Must be rendered as a child of a <MapContainer> (it calls useMap()). Mounted
 * in all five production map containers: NetworkMap.tsx and InputMapTab.tsx's
 * four. InputMapTab does NOT go through NetworkMap, which is why this lives in
 * its own module rather than inside NetworkMap.
 */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const element = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map]);
  return null;
}
