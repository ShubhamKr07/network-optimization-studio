import { warehouseStatusPresentation, type WhStatus } from "./statusPresentation";
import { demandRadius } from "./types";
import { warehouseTriangleSvg, customerBubbleSvg } from "./EntityMarkers";

const STATUSES: WhStatus[] = ["active", "forced_open", "inactive"];
const DEMAND_REFS = [5000, 15000, 30000];

// Static overlay — status swatches + demand reference bubbles. Reuses the
// same warehouseTriangleSvg/customerBubbleSvg/demandRadius EntityMarkers
// uses (rather than a second hand-drawn copy) so the legend can never drift
// from what's actually rendered on the map. Styled with the semantic
// bg-card/border-border/text-muted-foreground utilities (resolve via the
// .scn-theme-scoped tokens set on Workspace.tsx's root, same as every other
// Workspace overlay component) — this component does not re-apply the
// .scn-theme class itself.
export function MapLegend() {
  return (
    <div
      className="absolute bottom-4 left-4 bg-card border border-border rounded-md shadow p-2 flex flex-col gap-2 z-10 text-xs"
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
      <div className="flex items-center gap-3">
        {DEMAND_REFS.map((demand) => {
          const radius = demandRadius(demand);
          const size = Math.ceil(radius * 2) + 4;
          return (
            <div key={demand} className="flex items-center gap-1" data-testid={`legend-demand-${demand}`}>
              <span
                className="inline-block"
                style={{ width: size, height: size }}
                dangerouslySetInnerHTML={{ __html: customerBubbleSvg(radius) }}
              />
              <span className="text-muted-foreground">{demand.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
