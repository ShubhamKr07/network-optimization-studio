import { useRef, useState } from "react";
import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { NetworkMap } from "@/components/NetworkMap";
import { BrazilMap } from "@/components/BrazilMap";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import type { CountryBounds } from "@/lib/mapBounds";
import { copyMapToClipboard, downloadMapAsPng, isClipboardImageWriteSupported } from "@/lib/copyMapToClipboard";
import { toast } from "@/hooks/use-toast";

// Local — mirrors NetworkMap's own (unexported) WarehouseStatusEntry shape;
// Studio.tsx derives the same inline shape at its call site rather than
// importing a type NetworkMap doesn't expose (D0.1: warehouseStatuses became
// a purely local rendering concept once Scenario.inputs went opaque).
interface WarehouseStatusEntry {
  warehouseId: string;
  status: "forced_open" | "inactive";
}

interface OutputMapTabProps {
  // Optional — undefined for p-median-brazil (useBrazilMap=true), which has
  // no `GET /dataset` support at all (see Workspace.tsx's comment on this
  // same gap). Required in practice for every other model; enforced by the
  // `!useBrazilMap && !dataset` loading-guard at Workspace.tsx's call site,
  // not by this component itself.
  dataset?: Dataset;
  warehouseStatuses: WarehouseStatusEntry[];
  // Null both pre-solve and whenever this tab isn't the active one — the
  // caller (Workspace.tsx) is responsible for that gating (mirrors Studio.
  // tsx's `activeTab === "output" ? result : null` pattern), so a stale
  // result never bleeds in from an unrelated tab even if this component were
  // ever kept mounted off-screen.
  result: SolveResult | null;
  // Reuses Workspace.tsx's distanceBandsFromInputs(localInputs) — same
  // source of truth as the Optimization Parameters tab, never recomputed a
  // second way. Empty when the scenario hasn't configured bands yet; DD-5's
  // 250/500/750 default is applied here, once, purely for lane-coloring
  // display — it is never written back onto the scenario.
  bands: number[];
  countryBounds?: CountryBounds;
  /** A5.2 — p-median-brazil renders the simplified BrazilMap (result/
   * showRoutes only, no dataset/markers/band-coloring — see BrazilMap.tsx)
   * instead of NetworkMap. Mirrors Studio.tsx's own `modelId ===
   * "p-median-brazil" ? <BrazilMap .../> : ...` branch (Studio.tsx:1542). */
  useBrazilMap?: boolean;
}

// A3.1 — Output Map tab: re-homes NetworkMap with independent layer toggles
// (warehouses / customers / lanes) and a plain-vs-distance-band lane-coloring
// control (DD-5). NetworkMap itself is reused as-is aside from two minimal,
// justified prop additions (showWarehouseMarkers/showCustomerMarkers — see
// NetworkMap.tsx's own comment for why dataset-filtering couldn't achieve
// the same result for those two layers without also silently dropping
// routes). The "Lanes" toggle needs no NetworkMap change at all — it maps
// directly onto the existing showRoutes prop. "Plain" lane coloring needs no
// NetworkMap change either — passing an empty bands array makes
// assignBand()/getBandColor() resolve every edge to the same band-0 color,
// which NetworkMap already does unmodified.
export function OutputMapTab({ dataset, warehouseStatuses, result, bands, countryBounds, useBrazilMap }: OutputMapTabProps) {
  const [showWarehouses, setShowWarehouses] = useState(true);
  const [showCustomers, setShowCustomers] = useState(true);
  const [showLanes, setShowLanes] = useState(true);
  const [colorByBand, setColorByBand] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const [clipboardSupported] = useState(() => isClipboardImageWriteSupported());

  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const mapBands = colorByBand ? effectiveBands : [];

  async function handleCopy() {
    if (!mapRef.current) return;
    const outcome = await copyMapToClipboard(mapRef.current);
    toast({
      title: outcome === "copied" ? "Map copied to clipboard" : "Clipboard unavailable — downloaded as PNG instead",
    });
  }

  async function handleDownload() {
    if (!mapRef.current) return;
    await downloadMapAsPng(mapRef.current);
  }

  const copyDownloadButtons = (
    <div className="flex items-center gap-2 ml-auto">
      <button
        type="button"
        data-testid="button-download-map-png"
        className="text-xs border rounded px-2 py-1 hover:bg-muted"
        onClick={handleDownload}
      >
        Download PNG
      </button>
      {clipboardSupported && (
        <button
          type="button"
          data-testid="button-copy-map-clipboard"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={handleCopy}
        >
          Copy to clipboard
        </button>
      )}
    </div>
  );

  // A5.2 — p-median-brazil's simplified map: BrazilMap has no marker/lane-
  // coloring layers of its own (see BrazilMap.tsx), so only the Lanes toggle
  // (mapped onto its own `showRoutes` prop) applies here — Warehouses/
  // Customers/Color-by-band controls are omitted rather than shown-but-inert.
  if (useBrazilMap) {
    return (
      <div className="h-full flex flex-col gap-3" data-testid="output-map-tab">
        <div className="flex items-center gap-5 flex-wrap flex-shrink-0" data-testid="output-map-toggles">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="output-map-toggle-lanes"
              checked={showLanes}
              onCheckedChange={checked => setShowLanes(checked === true)}
              data-testid="checkbox-toggle-lanes"
            />
            <Label htmlFor="output-map-toggle-lanes" className="text-xs">Lanes</Label>
          </div>
          {copyDownloadButtons}
          {!result && (
            <span className="text-xs text-muted-foreground" data-testid="output-map-no-result">
              No solve result yet — showing the input network.
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0" ref={mapRef}>
          <BrazilMap result={result} showRoutes={showLanes} />
        </div>
      </div>
    );
  }

  if (!dataset) return null;

  return (
    <div className="h-full flex flex-col gap-3" data-testid="output-map-tab">
      <div className="flex items-center gap-5 flex-wrap flex-shrink-0" data-testid="output-map-toggles">
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="output-map-toggle-warehouses"
            checked={showWarehouses}
            onCheckedChange={checked => setShowWarehouses(checked === true)}
            data-testid="checkbox-toggle-warehouses"
          />
          <Label htmlFor="output-map-toggle-warehouses" className="text-xs">Warehouses</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="output-map-toggle-customers"
            checked={showCustomers}
            onCheckedChange={checked => setShowCustomers(checked === true)}
            data-testid="checkbox-toggle-customers"
          />
          <Label htmlFor="output-map-toggle-customers" className="text-xs">Customers</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="output-map-toggle-lanes"
            checked={showLanes}
            onCheckedChange={checked => setShowLanes(checked === true)}
            data-testid="checkbox-toggle-lanes"
          />
          <Label htmlFor="output-map-toggle-lanes" className="text-xs">Lanes</Label>
        </div>
        <div className="flex items-center gap-1.5 pl-3 border-l">
          <Checkbox
            id="output-map-color-by-band"
            checked={colorByBand}
            onCheckedChange={checked => setColorByBand(checked === true)}
            disabled={!showLanes}
            data-testid="checkbox-color-lanes-band"
          />
          <Label htmlFor="output-map-color-by-band" className="text-xs">Color lanes: Distance band</Label>
        </div>
        {copyDownloadButtons}
        {!result && (
          <span className="text-xs text-muted-foreground" data-testid="output-map-no-result">
            No solve result yet — showing the input network.
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0" ref={mapRef}>
        <NetworkMap
          dataset={dataset}
          warehouseStatuses={warehouseStatuses}
          result={result}
          showRoutes={showLanes}
          bands={mapBands}
          countryBounds={countryBounds}
          showWarehouseMarkers={showWarehouses}
          showCustomerMarkers={showCustomers}
          multiSelectedWarehouseIds={[]}
          multiSelectedCustomerIds={[]}
          onToggleWarehouseMultiSelect={() => {}}
          onToggleCustomerMultiSelect={() => {}}
        />
      </div>
    </div>
  );
}
