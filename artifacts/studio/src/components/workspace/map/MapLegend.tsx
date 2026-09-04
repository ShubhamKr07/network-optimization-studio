import { Fragment } from "react";
import type { SolveResult } from "@workspace/api-client-react";
import { warehouseStatusPresentation, type WhStatus } from "./statusPresentation";
import { demandTone, makeQuintileRadius, QUINTILE_RADII } from "./types";
import { warehouseTriangleSvg, customerBubbleSvg } from "./EntityMarkers";
import { getBandColor } from "@/lib/bandPalette";

const STATUSES: WhStatus[] = ["active", "forced_open", "inactive"];

// Fallback demo population, used only when no real `customers` prop is
// supplied (today's only call site, InputMapTab.tsx, doesn't wire this yet
// — a later task threads the scenario's real customers through). Chosen to
// populate all 5 quintile buckets distinctly so the legend still shows 5
// meaningful reference rows rather than one collapsed row.
const FALLBACK_DEMANDS = [1000, 4000, 8000, 12000, 18000, 25000, 35000, 50000];

// Bundle 6.1 (T1, resolution #1) — a uniform legend-only scale applied to
// every demand-bucket radius so every swatch fits its 24px (`w-6 h-6`) cell
// while preserving relative sizing across buckets: QUINTILE_RADII[4]=17
// would render at raw scale as a 2*17+4=38px SVG (clipping the cell); at
// LEGEND_DEMAND_SCALE=0.55 it's 2*(17*0.55)+4 ≈ 22.7px, fitting inside 24px.
const LEGEND_DEMAND_SCALE = 0.55;

// Bundle 6.1 (T1, resolution #7) — Output-variant-only SVG builders, moved
// here from NetworkMap.tsx's old inline legend so the shared legend can
// never drift from what the map actually renders for a solved-result view.
const MINE_STAR_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L14.2 8.9L21.5 8.9L15.6 13.2L17.9 20.1L12 15.8L6.1 20.1L8.4 13.2L2.5 8.9L9.8 8.9Z" fill="none" stroke="var(--map-default-stroke)" stroke-width="2" /></svg>`;

// Output "Potential" (un-opened candidate) marker: NetworkMap's
// createTriangleIcon("potential") strokes it with --map-default-stroke (gray),
// NOT --map-warehouse (dark ink) which warehouseTriangleSvg("outline") uses.
// A dedicated SVG here keeps the legend swatch's hue matching the actual map
// marker (the old inline NetworkMap legend used exactly this).
const POTENTIAL_OUTPUT_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12,2 22,20 2,20" fill="none" stroke="var(--map-default-stroke)" stroke-width="2" /></svg>`;
// Same --map-customer/--map-customer-stroke pair NetworkMap's own
// CircleMarker + customerBubbleSvg use for a solved-result customer dot
// (fill-opacity 0.8, stroke-width 1 — matches the unselected/unfocused
// marker state) — NOT the un-tokenized bg-slate-400/border-slate-500 the
// old inline legend used.
const CUSTOMER_DOT_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="5" fill="var(--map-customer)" fill-opacity="0.8" stroke="var(--map-customer-stroke)" stroke-width="1" /></svg>`;

function formatDemand(n: number): string {
  return Math.round(n).toLocaleString();
}

// bucket 0 = "<= p20"; bucket k (1-3) = "p_{20k} - p_{20(k+1)}"; bucket 4 = "> p80" —
// mirrors makeQuintileRadius's own lower-inclusive/upper-exclusive-of-next-threshold bucketing (types.ts).
function bucketLabel(bucket: number, thresholds: readonly [number, number, number, number]): string {
  if (bucket === 0) return `≤ ${formatDemand(thresholds[0])}`;
  if (bucket === 4) return `> ${formatDemand(thresholds[3])}`;
  return `${formatDemand(thresholds[bucket - 1])} – ${formatDemand(thresholds[bucket])}`;
}

interface StatusItem {
  key: string;
  testid: string;
  svg: string;
  label: string;
}

export interface MapLegendProps {
  /** Bundle 6.1 (T1) — which group set to render. "input" (default):
   * status (Potential/Fixed-Open/Inactive) + the size-encoding demand ramp.
   * "output": the states `NetworkMap`'s `getStatus` actually renders
   * (Potential/Open/Customer/Mine) + the distance-band route swatches; NO
   * demand ramp (Output has no size-by-demand toggle to show a scale for). */
  variant?: "input" | "output";
  /** Bundle 6.1 (T1) — which map corner the legend anchors to. Default "bl"
   * (today's Input Map position, unchanged); Output passes "br" (NetworkMap's
   * old inline-legend position). */
  corner?: "bl" | "br";
  /** Full scenario customer-demand population (base + added, INCLUDING
   * excluded) — same population EntityMarkers computes its scale from.
   * Optional; falls back to a static demo population when omitted. */
  customers?: { demand: number }[];
  /** R1: kept for backward-compatible call sites; demand swatches are green
   * for every model now (see types.ts's demandTone). */
  modelId?: string;
  /** T4 (Bundle 2) — capability gate seam (R3): the Potential/Fixed-Open/
   * Inactive status row only makes sense for a model whose warehouse-role
   * entity actually has a status field (capabilities.supportsFacilityStatus).
   * Defaults to true — today's exact p-median-us behavior, unchanged.
   * Input variant only — the Output variant's status set is fixed. */
  showStatusLegend?: boolean;
  /** T3 (Bundle 2.2, A1) / Bundle 6.1 (T1, resolution #3) — the LIVE
   * warehouse/mine/refinery layer-checkbox state. Input: ANDed with
   * `showStatusLegend`. Output: gates the facility (Potential/Open) and
   * Mine entries independently of the Customer entry — so toggling the
   * Warehouses layer off removes those legend rows without touching
   * Customer. Optional, default `true`. */
  showWarehouseLayer?: boolean;
  /** T3 (Bundle 2.2, A1) / Bundle 6.1 (T1, resolution #3) — the LIVE
   * customer/station layer-checkbox state. Input: ANDed with `sizeByDemand`
   * for the demand-bucket group. Output: gates the Customer status entry
   * independently of the warehouse/mine entries. Optional, default `true`. */
  showCustomerLayer?: boolean;
  /** T3 (Bundle 2.2, A2) — mirrors the "Size customers by demand" toggle.
   * Input variant only. `false` means every demand-bearing marker is now a
   * fixed radius, so there is no varying scale left to show a legend for —
   * the whole demand-bucket section is hidden. Optional, default `true`. */
  sizeByDemand?: boolean;
  /** Bundle 6.1 (T1) — Output variant only: whether the dataset has a fixed
   * mine (two-echelon-gold-au). Gates the "Mine (fixed)" status entry
   * (ANDed with `showWarehouseLayer` — a mine is a warehouse-role marker).
   * Optional, default `false`. */
  hasMine?: boolean;
  /** Bundle 6.1 (T1) — Output variant only: presence gates the distance-band
   * route-swatch group (alongside `showRoutes`). Optional, default `null`. */
  result?: SolveResult | null;
  /** Bundle 6.1 (T1) — Output variant only: whether routes are currently
   * shown on the map — ANDed with `result` for the route-swatch group.
   * Optional, default `false`. */
  showRoutes?: boolean;
  /** Bundle 6.1 (T1) — Output variant only: the live distance-band cut
   * points; one swatch per band, colored via `getBandColor(i)` (clamps past
   * the 5-entry BAND_COLORS palette, matching the map itself — resolution
   * #5). Optional, default `[]`. */
  bands?: number[];
  /** Contextual hint line rendered under every group, e.g. selection-mode
   * instructions. Optional, default `null`. */
  hintText?: string | null;
}

// Static overlay — status swatches + demand reference bubbles (Input) or
// solved-result status/route swatches (Output). Reuses the same
// warehouseTriangleSvg/customerBubbleSvg/makeQuintileRadius/getBandColor
// EntityMarkers/NetworkMap use (rather than a second hand-drawn copy) so the
// legend can never drift from what's actually rendered on the map. Styled
// with the semantic bg-card/border-border/text-muted-foreground utilities
// (resolve via the .scn-theme-scoped tokens set on Workspace.tsx's root,
// same as every other Workspace overlay component) — this component does
// not re-apply the .scn-theme class itself.
export function MapLegend({
  variant = "input",
  corner = "bl",
  customers,
  modelId = "p-median-us",
  showStatusLegend = true,
  showWarehouseLayer = true,
  showCustomerLayer = true,
  sizeByDemand = true,
  hasMine = false,
  result = null,
  showRoutes = false,
  bands = [],
  hintText = null,
}: MapLegendProps = {}) {
  const tone = demandTone(modelId);
  const demands = (customers ?? FALLBACK_DEMANDS.map((demand) => ({ demand }))).map((c) => c.demand);
  const scale = makeQuintileRadius(demands);

  // Bundle 6.1 (T1, resolution #7) — Output's status set is the states
  // `NetworkMap`'s `getStatus` actually renders: Potential/Open/Customer,
  // plus Mine when the dataset has one. Deliberately NO separate
  // "Forced Open" entry — a forced-open facility resolves to `open` in a
  // solved result, so a distinct entry would be misleading. Facility/mine
  // entries gate on `showWarehouseLayer`; Customer gates independently on
  // `showCustomerLayer` (resolution #3 — toggling a layer off removes its
  // legend entry).
  const statusItems: StatusItem[] = variant === "output"
    ? [
        ...(showWarehouseLayer && hasMine
          ? [{ key: "mine", testid: "legend-output-mine", svg: MINE_STAR_SVG, label: "Mine (fixed)" }]
          : []),
        ...(showWarehouseLayer
          ? [{ key: "potential", testid: "legend-output-potential", svg: POTENTIAL_OUTPUT_SVG, label: "Potential" }]
          : []),
        ...(showWarehouseLayer
          ? [{ key: "open", testid: "legend-output-open", svg: warehouseTriangleSvg("filled"), label: "Open" }]
          : []),
        ...(showCustomerLayer
          ? [{ key: "customer", testid: "legend-output-customer", svg: CUSTOMER_DOT_SVG, label: "Customer" }]
          : []),
      ]
    : showStatusLegend && showWarehouseLayer
      ? STATUSES.map((status) => {
          const { label, marker } = warehouseStatusPresentation[status];
          return { key: status, testid: `legend-status-${status}`, svg: warehouseTriangleSvg(marker), label };
        })
      : [];

  const showStatusGroup = statusItems.length > 0;
  // Demand size ramp is INPUT-ONLY (resolution #1): Output has no
  // "size customers by demand" toggle at all, so there is never a varying
  // scale to show a legend for.
  const showDemandGroup = variant === "input" && showCustomerLayer && sizeByDemand;
  // Route/distance-band swatches are OUTPUT-ONLY, and only meaningful once
  // there's a result to color routes from.
  const showRouteGroup = variant === "output" && !!result && showRoutes;

  return (
    <div
      // pointer-events-none: the legend is a purely informational overlay with
      // no interactive elements — without this its corner rect intercepts map
      // clicks (swallowing a "+ Add on map" pin drop near the corner). Let
      // clicks pass through to the Leaflet canvas underneath.
      className={`absolute bottom-4 ${corner === "br" ? "right-4" : "left-4"} bg-card border border-border rounded-md shadow p-2 z-10 text-xs pointer-events-none w-fit max-w-[260px] flex flex-col gap-2`}
      data-testid="map-legend"
    >
      {showStatusGroup && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Sites</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
            {statusItems.map((it) => (
              <Fragment key={it.key}>
                {/* cell >= the 22px triangle/star SVG so it never clips/overlaps (resolution #1) */}
                <span
                  className="w-6 h-6 flex items-center justify-center"
                  data-testid={it.testid}
                  // eslint-disable-next-line react/no-danger -- static, locally-built SVG string, no user input
                  dangerouslySetInnerHTML={{ __html: it.svg }}
                />
                <span className="text-muted-foreground">{it.label}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {showDemandGroup && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Demand</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
            {/* R2: only buckets a real customer actually occupies get a row — a
                collapsed/degenerate population (e.g. every demand identical)
                never renders an empty bucket row. */}
            {scale.usedBuckets.map((bucket) => (
              <Fragment key={bucket}>
                {/* uniform LEGEND_DEMAND_SCALE keeps relative sizing AND fits the 24px cell (resolution #1) */}
                <span
                  className="w-6 h-6 flex items-center justify-center"
                  data-testid={`legend-demand-bucket-${bucket}`}
                  // eslint-disable-next-line react/no-danger -- static, locally-built SVG string, no user input
                  dangerouslySetInnerHTML={{ __html: customerBubbleSvg(QUINTILE_RADII[bucket] * LEGEND_DEMAND_SCALE, tone) }}
                />
                <span className="text-muted-foreground font-mono">{bucketLabel(bucket, scale.thresholds)}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {showRouteGroup && (
        <div className="pt-1 border-t border-border">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Distance bands</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
            {bands.map((_, i) => (
              <Fragment key={i}>
                {/* getBandColor clamps past BAND_COLORS' 5 entries — matches the map (resolution #5) */}
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getBandColor(i) }}
                  data-testid={`legend-band-${i}`}
                />
                <span className="text-muted-foreground font-mono text-[10px]">Band {i + 1}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {hintText && <div className="text-[10px] text-muted-foreground pt-0.5 italic">{hintText}</div>}
    </div>
  );
}
