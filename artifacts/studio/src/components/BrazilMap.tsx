import { useEffect, useRef } from "react";

interface BrazilMapProps {
  result?: {
    assignments: Array<{
      customerId: string;
      warehouseId: string;
      distanceMi: number;
      flowFraction?: number;
    }>;
    openWarehouseIds?: string[];
  } | null;
  showRoutes?: boolean;
}

export function BrazilMap({ result, showRoutes }: BrazilMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Minimal canvas setup — full implementation uses a Mapbox/Leaflet layer
    // configured for Brazil's bounding box (-35 to -73 lng, 5 to -35 lat)
  }, [result, showRoutes]);

  return (
    <div
      ref={canvasRef}
      data-testid="brazil-map"
      className="w-full h-full flex items-center justify-center bg-slate-50 text-muted-foreground text-sm"
    >
      {result ? (
        <span className="text-xs font-mono">
          {result.openWarehouseIds?.length ?? 0} DCs · {result.assignments.length} demand regions
        </span>
      ) : (
        <span className="text-xs">Brazil · {27} demand regions · 27 DC candidates</span>
      )}
    </div>
  );
}
