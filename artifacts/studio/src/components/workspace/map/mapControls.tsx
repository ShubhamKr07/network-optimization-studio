import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleMarker, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { Checkbox } from "@/components/ui/checkbox";

export type OverlayAnchor = { containerPoint: { x: number; y: number }; containerSize?: { width: number; height: number } };

// Bridges react-leaflet's imperative `useMapEvents` (must be a child of
// `MapContainer`) into plain callback props for the parent component.
export function MapEventsBridge({
  onClick,
  onContextMenu,
  onMoveOrZoomStart,
}: {
  onClick: (e: L.LeafletMouseEvent) => void;
  onContextMenu: (e: L.LeafletMouseEvent) => void;
  onMoveOrZoomStart: () => void;
}) {
  useMapEvents({
    click: onClick,
    // Defensive only, not load-bearing: EntityMarkers already stops native
    // propagation on a marker's own contextmenu (see its own comment), and
    // Leaflet's Marker defaults to `bubblingMouseEvents: false` — a marker
    // right-click never reaches this handler in the first place.
    contextmenu: onContextMenu,
    movestart: onMoveOrZoomStart,
    zoomstart: onMoveOrZoomStart,
  });
  return null;
}

// Renders a dashed "ghost" circle that tracks the cursor while a Move/Copy
// is armed, and reports the next map click as the drop destination — the
// mousemove-handler half of the "ghost marker follows the cursor" state
// machine (T8's brief explicitly allows either a draggable-marker ghost or a
// mousemove handler; this is the latter).
export function GhostFollower({ tint }: { tint: string }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useMapEvents({
    mousemove(e) {
      setPos(e.latlng);
    },
  });
  if (!pos) return null;
  return (
    <CircleMarker
      center={[pos.lat, pos.lng]}
      radius={8}
      pathOptions={{ color: tint, dashArray: "4", fillOpacity: 0.25 }}
    />
  );
}

// Right-click-on-empty-space menu — "Add warehouse here" / "Add customer
// here". Deliberately its own small component (not a reuse of
// MapActionMenu, which is entity-specific) since it has no MapEntity to
// operate on, only a raw lat/lng.
export function AddEntityMenu({
  containerPoint,
  containerSize,
  onAdd,
  onClose,
  showPlantOption = false,
}: OverlayAnchor & {
  onAdd: (kind: "wh" | "cs" | "pl") => void;
  onClose: () => void;
  /** jade-T12 (Chapter 9 JADE) — a third "Add plant here" menu item.
   * Optional, default `false` — every non-JADE caller is unaffected. */
  showPlantOption?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  let left = containerPoint.x + 6;
  let top = containerPoint.y + 6;
  if (containerSize) {
    left = Math.max(4, Math.min(left, containerSize.width - 170));
    top = Math.max(4, Math.min(top, containerSize.height - 90));
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Add entity here"
      data-testid="map-add-menu"
      className="absolute bg-card border border-border shadow-md text-xs min-w-[150px] z-40"
      style={{ left, top }}
    >
      <button type="button" role="menuitem" data-testid="map-add-menu-wh" className="w-full text-left px-3 py-1.5 hover:bg-accent-100" onClick={() => onAdd("wh")}>
        Add warehouse here
      </button>
      <button type="button" role="menuitem" data-testid="map-add-menu-cs" className="w-full text-left px-3 py-1.5 hover:bg-accent-100" onClick={() => onAdd("cs")}>
        Add customer here
      </button>
      {showPlantOption && (
        <button type="button" role="menuitem" data-testid="map-add-menu-pl" className="w-full text-left px-3 py-1.5 hover:bg-accent-100" onClick={() => onAdd("pl")}>
          Add plant here
        </button>
      )}
    </div>
  );
}

export function ToggleChip({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`px-2 py-1 rounded text-2xs border transition-colors whitespace-nowrap ${
        active ? "bg-primary text-white border-primary" : "bg-white text-muted-foreground border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// T3 (Bundle 2.2, A1) — layer-visibility toggles (Warehouses/Customers/
// Mines/Stations/Refineries/Show-inactive/Size-by-demand) render as real
// shadcn `Checkbox`es now, not `ToggleChip` buttons — only the "Add on map:"
// place-pin controls stay `ToggleChip`s (they're a mode selector, not a
// layer-visibility flag). The outer wrapper is a plain `<div role="checkbox">`
// (deliberately NOT a `<label>`): a `<label>` wrapping a labelable descendant
// (the inner `Checkbox` renders a real `<button>`, which IS a labelable
// element per the HTML spec) triggers jsdom's native label-activation
// forwarding on click, which swallows the label's OWN `onClick` handler
// entirely (verified empirically — reproduced and confirmed root-caused
// before choosing this shape) — a `<div>` has no such forwarding behavior,
// so a click anywhere in the row (text or the box) reliably reaches this
// component's one `onClick`. `data-testid` sits on that same outer element,
// so it resolves to a node whose `textContent` includes the visible label
// (existing two-echelon coverage asserts `toHaveTextContent`). The nested
// `Checkbox` is a controlled, purely-visual/`aria-hidden` reflection of
// `checked` (no `onCheckedChange` of its own, `pointer-events-none`), so a
// direct click on the box can't double-fire the toggle via bubbling.
export function LayerCheckbox({
  checked,
  onToggle,
  testId,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex items-center gap-1.5 text-2xs text-muted-foreground whitespace-nowrap cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
    >
      <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" className="h-3.5 w-3.5 pointer-events-none" />
      {children}
    </div>
  );
}

