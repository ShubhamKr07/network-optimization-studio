import { warehouseStatusPresentation, type WhStatus } from "./statusPresentation";
import { demandTone, makeQuintileRadius, QUINTILE_RADII } from "./types";
import { warehouseTriangleSvg, customerBubbleSvg } from "./EntityMarkers";

const STATUSES: WhStatus[] = ["active", "forced_open", "inactive"];

// Fallback demo population, used only when no real `customers` prop is
// supplied (today's only call site, InputMapTab.tsx, doesn't wire this yet
// — a later task threads the scenario's real customers through). Chosen to
// populate all 5 quintile buckets distinctly so the legend still shows 5
// meaningful reference rows rather than one collapsed row.
const FALLBACK_DEMANDS = [1000, 4000, 8000, 12000, 18000, 25000, 35000, 50000];

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

export interface MapLegendProps {
  /** Full scenario customer-demand population (base + added, INCLUDING
   * excluded) — same population EntityMarkers computes its scale from.
   * Optional; falls back to a static demo population when omitted. */
  customers?: { demand: number }[];
  /** R1: drives blue-vs-green demand swatches. Defaults to "p-median-us"
   * to match EntityMarkers' own default (see its own prop doc). */
  modelId?: string;
}

// Static overlay — status swatches + demand reference bubbles. Reuses the
// same warehouseTriangleSvg/customerBubbleSvg/makeQuintileRadius
// EntityMarkers uses (rather than a second hand-drawn copy) so the legend
// can never drift from what's actually rendered on the map. Styled with the
// semantic bg-card/border-border/text-muted-foreground utilities (resolve
// via the .scn-theme-scoped tokens set on Workspace.tsx's root, same as
// every other Workspace overlay component) — this component does not
// re-apply the .scn-theme class itself.
export function MapLegend({ customers, modelId = "p-median-us" }: MapLegendProps = {}) {
  const tone = demandTone(modelId);
  const demands = (customers ?? FALLBACK_DEMANDS.map((demand) => ({ demand }))).map((c) => c.demand);
  const scale = makeQuintileRadius(demands);

  return (
    <div
      // pointer-events-none: the legend is a purely informational overlay with
      // no interactive elements — without this its bottom-left rect intercepts
      // map clicks (swallowing a "+ Add on map" pin drop near the corner). Let
      // clicks pass through to the Leaflet canvas underneath.
      className="absolute bottom-4 left-4 bg-card border border-border rounded-md shadow p-2 flex flex-col gap-2 z-10 text-xs pointer-events-none"
      data-testid="map-legend"
    >
      <div className="flex items-center gap-3">
        {STATUSES.map((status) => {
          const { label, marker } = warehouseStatusPresentation[status];
          return (
            <div key={status} className="flex items-center gap-1" data-testid={`legend-status-${status}`}>
              <span
                className="inline-block w-[18px] h-[18px]"
                // eslint-disable-next-line react/no-danger -- static, locally-built SVG string, no user input
                dangerouslySetInnerHTML={{ __html: warehouseTriangleSvg(marker) }}
              />
              <span className="text-muted-foreground">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {/* R2: only buckets a real customer actually occupies get a row — a
            collapsed/degenerate population (e.g. every demand identical)
            never renders an empty bucket row. */}
        {scale.usedBuckets.map((bucket) => {
          const radius = QUINTILE_RADII[bucket];
          const size = Math.ceil(radius * 2) + 4;
          return (
            <div key={bucket} className="flex items-center gap-1" data-testid={`legend-demand-bucket-${bucket}`}>
              <span
                className="inline-block"
                style={{ width: size, height: size }}
                dangerouslySetInnerHTML={{ __html: customerBubbleSvg(radius, tone) }}
              />
              <span className="text-muted-foreground">{bucketLabel(bucket, scale.thresholds)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
