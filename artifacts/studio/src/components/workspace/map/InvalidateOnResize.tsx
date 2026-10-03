import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Quiet period after the last resize before the map is told to recompute. */
export const INVALIDATE_DEBOUNCE_MS = 120;

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
 *
 * DEBOUNCED because the rail's width is ANIMATED (`transition-[width]
 * duration-200` on the nav), so one toggle resizes this container on every
 * frame of that animation. Undebounced, that is ~60 full Leaflet size
 * recomputations — each repositioning every layer and potentially requesting
 * tiles — for a single click. Coalescing to one call once resizing has settled
 * means one recomputation per toggle, landing just after the animation ends.
 *
 * Record correction (SBR-5 QA): this debounce was first written believing it
 * fixed a sidebar that got STUCK at the wrong width mid-toggle. It does not,
 * because that symptom was never real — it was an artifact of driving the page
 * in a BACKGROUND tab, where Chrome freezes CSS transitions (the width
 * animation reported playState "running" with currentTime pinned at 0, and
 * `document.hidden` was true). In a visible tab the width tracks the class
 * correctly with or without this debounce. The debounce is kept on its own
 * merits — 60 redundant recomputations per click is worth removing — not as a
 * fix for a bug that did not exist.
 *
 * Do not "simplify" this back to a direct call. If you shorten the delay below
 * the nav's 200ms transition, the map will recompute mid-animation again.
 */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const element = map.getContainer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        map.invalidateSize();
      }, INVALIDATE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);
  return null;
}
