import { formatCityState, formatCoord } from "@/lib/formatLocation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeCard, type Point, type Size } from "./placeCard";
import type { EntityAction, EntityActionKey } from "./MapActionMenu";
import { warehouseStatusPresentation } from "./statusPresentation";
import type { MapEntity } from "./types";

// Width is fixed; height is measured after mount (jsdom reports 0, so this is
// also the fallback) and includes the action row.
const CARD_WIDTH = 224;
const CARD_HEIGHT = 230;

export interface MapDetailsCardProps {
  entity: MapEntity;
  /** The selected MARKER's point in the map container's pixel space (MapAnchorBridge). */
  anchor: Point;
  /** The marker's rendered icon size in px (markerEnvelope), so the card keeps clear of it. */
  markerSize: number;
  containerSize: Size;
  onClose: () => void;
  /** The entity's actions (from actionsInContext): drives the button row and the footer hint. */
  actions: EntityAction[];
  onAction: (key: EntityActionKey) => void;
  /** Two-step local delete (default true). false when the caller confirms itself (Super's cascade dialog). */
  confirmDelete?: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// Read-only "inspect" card shown on a left-click, rendered as a plain
// absolutely-positioned overlay OVER the Leaflet container (never a Leaflet
// `<Popup>` — a Popup lives inside Leaflet's own pane stack and doesn't
// compose with React state/portals the way the rest of Workspace does).
export function MapDetailsCard({ entity, anchor, markerSize, containerSize, onClose, actions, onAction, confirmDelete = true }: MapDetailsCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // A re-select that keeps the card mounted must not inherit an armed Delete.
  useEffect(() => setConfirmingDelete(false), [entity.kind, entity.entity.id]);

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
    // Close on an outside press that RELEASES in place; a drag (pan) keeps the
    // card, which re-anchors to its marker (DU-3.2). Decided at mouseup, which
    // still precedes the click that may select another marker.
    let down: { x: number; y: number } | null = null;
    function handleMouseDown(e: MouseEvent) {
      down = rootRef.current && !rootRef.current.contains(e.target as Node) ? { x: e.clientX, y: e.clientY } : null;
    }
    function handleMouseUp(e: MouseEvent) {
      const d = down;
      down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const h = rootRef.current?.offsetHeight;
    if (h && h !== cardHeight) setCardHeight(h);
  });

  // Live bounds: the anchor re-reports on map resize, which re-renders here; the click-time prop is the first-paint/jsdom fallback.
  const op = rootRef.current?.offsetParent as HTMLElement | null | undefined;
  const bounds = op?.clientWidth ? { width: op.clientWidth, height: op.clientHeight } : containerSize;
  const { left, top, flippedX, flippedY } = placeCard(anchor, { width: CARD_WIDTH, height: cardHeight }, bounds, markerSize);

  const { entity: e, kind } = entity;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${formatCityState(e.city, e.state)} (${e.displayCode}) details`}
      tabIndex={-1}
      data-testid="map-details-card"
      data-flipped-x={flippedX || undefined}
      data-flipped-y={flippedY || undefined}
      className="absolute bg-card border border-border shadow-md text-xs z-30"
      style={{ left, top, width: CARD_WIDTH }}
    >
      <div
        className="flex items-center justify-between gap-2.5 px-3 py-2 border-b border-border font-heading font-semibold tracking-wide text-sm"
      >
        <span data-testid="map-details-name">
          {formatCityState(e.city, e.state)}
          {" · "}
          <span className="font-mono" data-testid="map-details-code">{e.displayCode}</span>
        </span>
        {/* T4 (Bundle 2) — kind==="wh" no longer implies a status: a role
            with hasStatus:false (e.g. a mine) never populates `status` at
            all (see MapWarehouse's own comment), so this must check for its
            presence too, not just the marker shape. */}
        {kind === "wh" && e.status != null && (
          <span className="text-2xs px-1.5 py-0.5 bg-accent-100 text-accent-800" data-testid="map-details-status">
            {warehouseStatusPresentation[e.status].label}
          </span>
        )}
        <button
          type="button"
          aria-label="Close"
          data-testid="map-details-close"
          className="min-h-6 min-w-6 ml-auto text-muted-foreground hover:bg-accent-100"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-lat">
        <span className="text-muted-foreground">Latitude</span>
        <span className="font-mono">{formatCoord(e.lat)}</span>
      </div>
      <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-lng">
        <span className="text-muted-foreground">Longitude</span>
        <span className="font-mono">{formatCoord(e.lng)}</span>
      </div>
      {/* jade-T12 — a THREE-way check now (was a 2-way `kind === "wh" ? : `),
          since a plain `else` branch would try to read `.demand` off a
          MapPlant (which has neither `.capacity` nor `.demand` — see
          types.ts's `MapPlant`). A plant shows neither row: its only
          editable attribute (which products it can make) lives in the
          Capability Matrix tab, not this inspect card. */}
      {kind === "wh" ? (
        <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-capacity">
          <span className="text-muted-foreground">Capacity</span>
          <span className="font-mono">{e.capacity != null ? `${fmt(e.capacity)} units` : "—"}</span>
        </div>
      ) : kind === "cs" ? (
        <div className="flex justify-between gap-4 px-3 py-1.5" data-testid="map-details-demand">
          <span className="text-muted-foreground">Demand</span>
          <span className="font-mono">{fmt(e.demand)} units</span>
        </div>
      ) : null}
      {actions.length > 0 && (
        <>
          <div role="group" aria-label="Actions" data-testid="map-details-actions" className="flex flex-wrap gap-1 border-t border-border px-3 py-1.5">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                data-testid={`map-details-action-${a.key}`}
                className={`min-h-6 px-2 text-xs border border-border hover:bg-accent-100 ${a.danger ? "text-danger" : ""}`}
                onClick={() => {
                  if (a.key === "delete" && confirmDelete && !confirmingDelete) setConfirmingDelete(true);
                  else onAction(a.key);
                }}
              >
                {a.key === "delete" && confirmingDelete ? "Confirm delete?" : a.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="map-details-footer">
            Right-click for {actions.map((a) => a.label.replace("…", "")).join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}
