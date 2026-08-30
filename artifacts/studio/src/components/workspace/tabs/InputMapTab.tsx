import { useState } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, useMapEvents } from "react-leaflet";
import { getMapBoundsProps, type CountryBounds } from "@/lib/mapBounds";
import { Button } from "@/components/ui/button";

interface PinEntity {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

interface PlacementOption {
  key: string; // matches inputEntriesForModel()'s own entity id ("warehouses", "customers", "mines", "stations", "refineries")
  label: string;
}

interface InputMapTabProps {
  /** Optional — GET /api/models (the source of countryBounds) can resolve
   * after this tab's first mount, same ordering gap NetworkMap.tsx/
   * OutputMapTab.tsx already document (E5.1/Round 3). getMapBoundsProps
   * degrades to a continental-US fallback until it arrives. */
  countryBounds?: CountryBounds;
  pins: { kind: string; entities: PinEntity[] }[];
  placementOptions: PlacementOption[];
  onPlacePoint: (lat: number, lng: number, kind: string) => void;
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Phase 3.2, Task 4 — pre-solve map: shows current base + added entities as
// pins, and lets a click drop a DRAFT marker with a Confirm/Cancel panel
// (rendered outside the Leaflet tree, in this component's own JSX, NOT
// inside a <Popup> nested in a <Marker> — a Popup there stays closed until
// the marker itself is clicked, real Leaflet behavior, which would make the
// controls invisible without an extra click nobody's told to make) before
// anything is actually added. Deliberately does not reuse NetworkMap.tsx,
// which is coupled to solve-result edges/bands/routes; this component only
// ever needs static pins + one click handler.
export function InputMapTab({ countryBounds, pins, placementOptions, onPlacePoint }: InputMapTabProps) {
  const [activeKind, setActiveKind] = useState(placementOptions[0]?.key ?? "");
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const boundsProps = getMapBoundsProps(countryBounds);
  // Same fix NetworkMap.tsx/OutputMapTab.tsx already carry (E5.1/Round 3):
  // MapContainer only applies center/maxBounds/minZoom at construction —
  // keying on the resolved bounds forces a remount once the real
  // countryBounds lands, instead of getting stuck on the fallback.
  const mapKey = countryBounds ? `${countryBounds.sw.join(",")}_${countryBounds.ne.join(",")}` : "fallback";

  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-shrink-0" data-testid="input-map-placement-toggle">
        <span className="text-xs text-muted-foreground">Placing:</span>
        <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
          {placementOptions.map(opt => (
            <button
              key={opt.key}
              type="button"
              data-testid={`button-input-map-place-${opt.key}`}
              onClick={() => setActiveKind(opt.key)}
              className={`px-2 py-1 transition-colors whitespace-nowrap ${
                activeKind === opt.key ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {draft && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1" data-testid="input-map-draft-panel">
            <span>Lat: {draft.lat.toFixed(4)}, Lng: {draft.lng.toFixed(4)} — placing {placementOptions.find(o => o.key === activeKind)?.label}</span>
            <Button
              size="sm"
              className="h-6 text-[10px]"
              data-testid="button-input-map-confirm"
              onClick={() => { onPlacePoint(draft.lat, draft.lng, activeKind); setDraft(null); }}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              data-testid="button-input-map-cancel"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CartoDB" />
          <ClickCapture onClick={(lat, lng) => setDraft({ lat, lng })} />
          {pins.map(group => group.entities.map(e => (
            <Marker key={`${group.kind}-${e.id}`} position={[e.lat, e.lng]} />
          )))}
          {/* Visually distinct from committed pins (dashed amber outline,
              CircleMarker rather than the default Marker icon) rather than
              a custom icon asset. No `data-testid` here — CircleMarkerProps
              doesn't extend any DOM-attribute interface (confirmed against
              @react-leaflet/core's own types), so an arbitrary data-* prop
              doesn't type-check; the draft panel's own
              `input-map-draft-panel` testid is what tests assert against. */}
          {draft && (
            <CircleMarker
              center={[draft.lat, draft.lng]}
              radius={8}
              pathOptions={{ color: "#f59e0b", dashArray: "4", fillOpacity: 0.3 }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
