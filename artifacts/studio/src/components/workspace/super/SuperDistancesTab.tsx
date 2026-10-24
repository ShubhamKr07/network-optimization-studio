import { DraftNumberInput, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { Button } from "@/components/ui/button";
import { SuperTableTab } from "./SuperTableTab";
import type { Row } from "./superTables";

export interface SuperDistancesTabProps {
  distanceMethod: "haversine" | "circuity" | "road";
  onFetchRoad(): void;
  /** Non-null disables the fetch button and is its title. */
  fetchDisabledReason: string | null;
  circuityFactor: number;
  overrides: Row[];
  /** A partial patch of `distanceMethod` / `circuityFactor` / `distanceOverrides`. */
  onChange(patch: Record<string, unknown>): void;
  readOnly: boolean;
  plantIds: string[]; warehouseIds: string[]; customerIds: string[];
}

export function SuperDistancesTab(p: SuperDistancesTabProps) {
  return (
    <div className="space-y-4" data-testid="super-distances-tab">
      <div className="flex items-center gap-3 text-sm">
        <select data-testid="super-distance-method" className="h-8 border rounded pl-2 text-xs" value={p.distanceMethod}
          disabled={p.readOnly} title={p.readOnly ? READ_ONLY_TITLE : undefined}
          onChange={e => p.onChange({ distanceMethod: e.target.value })}>
          <option value="haversine">Straight line (haversine)</option>
          <option value="circuity">Straight line × circuity factor</option>
          <option value="road">Road (OpenRouteService, truck)</option>
        </select>
        <DraftNumberInput testId="super-circuity-factor" value={p.circuityFactor}
          disabled={p.readOnly || p.distanceMethod !== "circuity"}
          parse={raw => { const n = Number(raw); return raw !== "" && n >= 1 && n <= 3 ? n : null; }}
          onCommit={n => { if (n != null) p.onChange({ circuityFactor: n }); }} />
        {p.distanceMethod === "road" && (
          <Button size="sm" variant="outline" data-testid="super-road-fetch" onClick={p.onFetchRoad}
            disabled={p.readOnly || p.fetchDisabledReason !== null} title={p.fetchDisabledReason ?? undefined}>
            Fetch road distances
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Pairs without an override use the method above. Overrides always win. Road pairs are checked by the readiness panel.</p>
      <SuperTableTab table="distanceOverrides" rows={p.overrides} readOnly={p.readOnly}
        onChange={rows => p.onChange({ distanceOverrides: rows })}
        options={{ fromIds: [...p.plantIds, ...p.warehouseIds], toIds: [...p.warehouseIds, ...p.customerIds] }} />
    </div>
  );
}
