import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

/** Counts open tooltips/popups (floored at 0) and reports `count > 0`. Render INSIDE <MapContainer>. */
export function MapOverlayEvents({ onChange }: { onChange(open: boolean): void }): null {
  const map = useMap();
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let n = 0;
    const bump = (d: number) => () => {
      n = Math.max(0, n + d);
      cb.current(n > 0);
    };
    const open = bump(1);
    const close = bump(-1);
    map.on("tooltipopen popupopen", open);
    map.on("tooltipclose popupclose", close);
    return () => {
      map.off("tooltipopen popupopen", open);
      map.off("tooltipclose popupclose", close);
      cb.current(false);
    };
  }, [map]);
  return null;
}
