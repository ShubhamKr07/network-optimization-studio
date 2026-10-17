import type { Plant, Product, PlantProductCapability } from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { isCellEnabled, cellCapacity, type CapabilityOverride } from "@/lib/jadeCapability";
import { EntityIdCell } from "@/components/tables/EntityIdCell";

// T11 (Chapter 9 JADE) — matches `jadeInputsSchema`'s
// `plantProductCapability[]` shape exactly (`{plantId, productId, enabled}`,
// pair-unique). A sparse override array over the base 16-cell matrix
// (`Dataset.plantProductCapabilities`).
//
// B5 (JADE Ch.9 Workspace Bundle, spec §7) — re-exported from
// `lib/jadeCapability.ts` (A2), which is now the single source of truth for
// this shape and the enabled/capacity math (`isCellEnabled`/`cellCapacity`).
// Re-exported (not re-declared) so existing consumers
// (`InputMapTab.tsx`/`Workspace.tsx`) that import `CapabilityOverride` from
// THIS file keep working unchanged.
export type { CapabilityOverride };

interface CapabilityMatrixTabProps {
  /** Effective plants — base ∪ added, projection built by Workspace.tsx
   * (T15.5, spec §6/Gate 6.5's "effective-row projection"). This component
   * only renders whatever rows it's given; it doesn't know or care whether
   * a row is a base or an added plant. */
  plants: Plant[];
  products: Product[];
  /** Base 16-cell matrix (`Dataset.plantProductCapabilities`). A cell with
   * `capacity > 0` is enabled by default; a missing cell (e.g. every cell
   * for an added plant, which never has a base-matrix entry) defaults to
   * disabled — matches spec §6: "base rows default from the 16-cell
   * matrix and added-plant rows default off." */
  baseCapabilities: PlantProductCapability[];
  /** Sparse scenario-local overrides. */
  overrides: CapabilityOverride[];
  onChange: (next: CapabilityOverride[]) => void;
  /** JADE-only — id -> {city, state}, built by Workspace.tsx's
   * `jadeLocationMapFromInputs`. Used by `buildFilterDescriptors` below to
   * widen the filter search text, and (T11, compatibility resolver) as a
   * fallback location source for the row header when `identityById` is
   * unset. */
  locationById?: Record<string, { city: string; state: string }>;
  /** T11 (workspace-fixups-2, item 2 — "CapabilityMatrix aligns to
   * EntityIdCell") — canonical id -> {city, state, displayId} (base dataset
   * ∪ scenario-local addedPlants), built by Workspace.tsx's
   * `buildEntityIdentityById(modelId, dataset, localInputs)` (the LIVE
   * draft — this is an INPUT tab). The per-plant row header now renders via
   * the shared `EntityIdCell` (stacked City/State + mono display-id,
   * matching Open WHs) instead of the old single-line `plantIdCityState`
   * format. COMPATIBILITY RESOLVER: prefer this map's entry, else fall back
   * to `locationById`/the `plants` prop's own city/state (and the raw
   * canonical id for displayId — `plant.name` is still never shown, matching
   * the pre-existing contract) — unset is the SAME underlying data as
   * before, just rendered in the new stacked shape. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** SCU-2.P4.9 (D2) — browsing result history: every checkbox is disabled. */
  readOnly?: boolean;
}

// B5 — a plant row (not a product column) is this table's filterable unit
// (spec §10: "the Capability Matrix's 16 *cells* render as 4 plant *rows*").
// A single text descriptor covers name/id/city/state via one combined
// search string (mirrors JadeDistancesTab's own `searchText` helper), plus
// a select descriptor on State for a quick narrow-down.
const READ_ONLY_TITLE = "Read-only while browsing result history.";

// SCU-2.P4.9 (B2.1/B2.2) — the plants × products pivot on the shared
// DataTable. The plant search text and the filter-only `state` select are
// kept exactly (column ids `plant` / `state`, so `input-filter-plant` /
// `select-filter-state` survive); product columns are not filterable. No
// Upload / Download (spec scope). History read-only (D2) is new.
export function CapabilityMatrixTab({
  plants,
  products,
  baseCapabilities,
  overrides,
  onChange,
  locationById,
  identityById,
  readOnly = false,
}: CapabilityMatrixTabProps) {
  function resolvedPlantLocation(plant: Plant): { city: string; state: string } {
    const entry = identityById?.[plant.id];
    if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    return { city: plant.city, state: plant.state };
  }
  function resolvedPlantDisplayId(plant: Plant): string {
    return identityById?.[plant.id]?.displayId ?? plant.id;
  }

  function effectiveEnabled(plantId: string, productId: string): boolean {
    return isCellEnabled(baseCapabilities, overrides, plantId, productId);
  }

  function toggle(plantId: string, productId: string) {
    const current = effectiveEnabled(plantId, productId);
    const next = !current;
    const base = isCellEnabled(baseCapabilities, [], plantId, productId);
    const rest = overrides.filter(o => !(o.plantId === plantId && o.productId === productId));
    onChange(next === base ? rest : [...rest, { plantId, productId, enabled: next }]);
  }

  if (plants.length === 0 || products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="capability-matrix-empty">
        No plants or products in this dataset.
      </p>
    );
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<Plant>[] = [
    {
      id: "plant",
      header: "Plant",
      kind: "text",
      filter: "text",
      value: plant => {
        const loc = locationById?.[plant.id];
        return [plant.name ?? plant.id, plant.id, loc?.city ?? plant.city, loc?.state ?? plant.state].filter(Boolean).join(" ");
      },
      cellClassName: "text-xs",
      cellTestId: plant => `text-capability-plant-${plant.id}`,
      cell: plant => (
        <EntityIdCell entityId={plant.id} displayId={resolvedPlantDisplayId(plant)} location={resolvedPlantLocation(plant)} />
      ),
    },
    {
      id: "state",
      header: "State",
      hidden: true,
      kind: "text",
      filter: "select",
      value: plant => locationById?.[plant.id]?.state ?? plant.state,
      cell: () => null,
    },
    ...products.map(
      (product): ColumnDef<Plant> => ({
        id: `product:${product.id}`,
        header: product.name,
        kind: "enum",
        filter: false,
        value: plant => (effectiveEnabled(plant.id, product.id) ? "enabled" : "disabled"),
        cell: plant => {
          const checked = effectiveEnabled(plant.id, product.id);
          const capacity = cellCapacity(baseCapabilities, plant.id, product.id, checked);
          return (
            <div className="flex flex-col items-start gap-0.5">
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(plant.id, product.id)}
                disabled={readOnly}
                title={readOnly ? READ_ONLY_TITLE : undefined}
                data-testid={`checkbox-capability-${plant.id}-${product.id}`}
                aria-label={`${plant.name ?? plant.id} can make ${product.name}`}
              />
              <span
                className="font-mono text-[10px] text-muted-foreground"
                data-testid={`text-capability-capacity-${plant.id}-${product.id}`}
              >
                {capacity.toLocaleString()} Units
              </span>
            </div>
          );
        },
      }),
    ),
  ];

  return (
    <div data-testid="capability-matrix-tab">
      <DataTable<Plant>
        rows={plants}
        rowKey={plant => plant.id}
        columns={columns}
        ctx={{ readOnly, demandEditable: false }}
        testIds={{ row: plant => `row-capability-${plant.id}`, count: "text-capability-count" }}
        toolbar={{
          extra: (
            <p className="text-xs text-muted-foreground md:whitespace-nowrap" data-testid="text-capability-capacity-label">
              Capacity shown below each checkbox is the capacity per plant-product combination — not the plant's total capacity.
            </p>
          ),
        }}
        scrollClassName="max-h-[60vh] overflow-y-auto"
        noMatchText="No plants match the current filter."
      />
    </div>
  );
}
