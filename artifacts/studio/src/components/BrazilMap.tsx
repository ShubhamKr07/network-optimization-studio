import { useEffect, useRef } from "react";
import type { SolveResult } from "@workspace/api-client-react";

interface BrazilMapProps {
  result?: SolveResult | null;
  showRoutes?: boolean;
}

export function BrazilMap({ result, showRoutes }: BrazilMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Minimal canvas setup — full implementation uses a Mapbox/Leaflet layer
    // configured for Brazil's bounding box (-35 to -73 lng, 5 to -35 lat)
  }, [result, showRoutes]);

  const openWarehouseIds = (result?.details as { openWarehouseIds?: string[] } | undefined)?.openWarehouseIds;

  return (
    <div
      ref={canvasRef}
      data-testid="brazil-map"
      className="w-full h-full flex items-center justify-center bg-slate-50 text-muted-foreground text-sm"
    >
      {result ? (
        <span className="text-xs font-mono">
          {openWarehouseIds?.length ?? 0} DCs · {result.edges.length} demand regions
        </span>
      ) : (
        <span className="text-xs">Brazil · {27} demand regions · 27 DC candidates</span>
      )}
    </div>
  );
}
