import { useEffect, useRef } from "react";
import { warehouseStatusPresentation } from "./statusPresentation";
import type { MapEntity } from "./types";

// Fixed-size heuristic, not a measured DOM rect (jsdom reports 0 for
// offsetWidth/offsetHeight anyway, and a two-pass measure-then-position
// render would flash at the wrong spot first) — matches the mockup's own
// approach (`input-map-mockup.html`'s `onLeftClick`: `Math.min(p[0]+22,
// wrap.clientWidth-240)`). Close enough to the card's real rendered size to
// keep it inside the map viewport; doesn't need to be exact.
const CARD_WIDTH = 224;
const CARD_HEIGHT = 190;
const OFFSET = 14;

export interface MapDetailsCardProps {
  entity: MapEntity;
  containerPoint: { x: number; y: number };
  containerSize?: { width: number; height: number };
  onClose: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// Read-only "inspect" card shown on a left-click, rendered as a plain
// absolutely-positioned overlay OVER the Leaflet container (never a Leaflet
// `<Popup>` — a Popup lives inside Leaflet's own pane stack and doesn't
// compose with React state/portals the way the rest of Workspace does).
export function MapDetailsCard({ entity, containerPoint, containerSize, onClose }: MapDetailsCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  // Clamp/flip at the container edges: default position is offset
  // down-right of the click point; flips to up-left once the card would
  // overflow that edge, then clamps so it never goes negative either.
  let left = containerPoint.x + OFFSET;
  let flippedX = false;
  if (containerSize && left + CARD_WIDTH > containerSize.width) {
    left = containerPoint.x - CARD_WIDTH - OFFSET;
    flippedX = true;
  }
  let top = containerPoint.y - OFFSET;
  let flippedY = false;
  if (containerSize && top + CARD_HEIGHT > containerSize.height) {
    top = containerPoint.y - CARD_HEIGHT + OFFSET;
    flippedY = true;
  }
  if (containerSize) {
    left = Math.max(4, Math.min(left, containerSize.width - CARD_WIDTH - 4));
    top = Math.max(4, Math.min(top, containerSize.height - CARD_HEIGHT - 4));
  }

  const { entity: e, kind } = entity;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${e.displayCode} details`}
      tabIndex={-1}
      data-testid="map-details-card"
      data-flipped-x={flippedX || undefined}
      data-flipped-y={flippedY || undefined}
      className="absolute bg-card border border-border shadow-md text-xs z-30"
      style={{ left, top, width: CARD_WIDTH }}
    >
      <div
        className="flex items-center justify-between gap-2.5 px-3 py-2 border-b border-border font-heading font-semibold tracking-wide text-sm"
        data-testid="map-details-code"
      >
        <span>{e.displayCode}</span>
        {/* T4 (Bundle 2) — kind==="wh" no longer implies a status: a role
            with hasStatus:false (e.g. a mine) never populates `status` at
            all (see MapWarehouse's own comment), so this must check for its
            presence too, not just the marker shape. */}
        {kind === "wh" && e.status != null && (
          <span className="text-[10px] px-1.5 py-0.5 bg-accent-100 text-accent-800" data-testid="map-details-status">
            {warehouseStatusPresentation[e.status].label}
          </span>
        )}
      </div>
      <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-city">
        <span className="text-muted-foreground">City</span>
        <span>{e.city}, {e.state}</span>
      </div>
      <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-lat">
        <span className="text-muted-foreground">Latitude</span>
        <span className="font-mono">{e.lat.toFixed(4)}</span>
      </div>
      <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-lng">
        <span className="text-muted-foreground">Longitude</span>
        <span className="font-mono">{e.lng.toFixed(4)}</span>
      </div>
      {kind === "wh" ? (
        <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-capacity">
          <span className="text-muted-foreground">Capacity</span>
          <span className="font-mono">{e.capacity != null ? `${fmt(e.capacity)} units` : "—"}</span>
        </div>
      ) : (
        <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-demand">
          <span className="text-muted-foreground">Demand</span>
          <span className="font-mono">{fmt(e.demand)} units</span>
        </div>
      )}
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="map-details-footer">
        Right-click for Edit · Move · Copy · Delete
      </div>
    </div>
  );
}
