import { useMemo } from "react";
import type { Plant, Product, PlantProductCapability } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { isCellEnabled, cellCapacity, type CapabilityOverride } from "@/lib/jadeCapability";

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
   * `jadeLocationMapFromInputs`. When present, the plant row header shows
   * "City, ST" as the primary label with the plant id as a mono sub-label
   * (mirrors JadeDistancesTab.tsx), replacing the plain
   * `{name} ({city}, {state})` format below. Absent (undefined, the
   * back-compat default) -> unchanged rendering. */
  locationById?: Record<string, { city: string; state: string }>;
}

// B5 — a plant row (not a product column) is this table's filterable unit
// (spec §10: "the Capability Matrix's 16 *cells* render as 4 plant *rows*").
// A single text descriptor covers name/id/city/state via one combined
// search string (mirrors JadeDistancesTab's own `searchText` helper), plus
// a select descriptor on State for a quick narrow-down.
function buildFilterDescriptors(
  locationById: Record<string, { city: string; state: string }> | undefined,
): ColumnFilterDescriptor<Plant>[] {
  return [
    {
      key: "plant",
      label: "Plant",
      type: "text",
      accessor: plant => {
        const loc = locationById?.[plant.id];
        return [plant.name ?? plant.id, plant.id, loc?.city ?? plant.city, loc?.state ?? plant.state]
          .filter(Boolean)
          .join(" ");
      },
    },
    {
      key: "state",
      label: "State",
      type: "select",
      accessor: plant => locationById?.[plant.id]?.state ?? plant.state,
    },
  ];
}

// T11 — the Capability Matrix input tab: an effective-plants × 4-products
// checkbox grid. Each toggle writes (if it now differs from the base
// default) or removes (if it now matches the base default) a sparse
// `plantProductCapability` override entry — same "upsert-or-remove" pattern
// every other override table in this codebase already uses (WarehouseTable/
// CustomerTable's own `isNoOp` checks), just keyed by a (plantId, productId)
// pair instead of a single id.
//
// B5 — each cell ALSO shows a read-only capacity readout (`cellCapacity`,
// A2): enabled -> the base cell's own capacity if >0, else the shared
// `JADE_ENABLED_CAPACITY` (210,000,000) constant — including a base
// off-diagonal cell (base capacity 0) the scenario enables, not only
// added-plant cells (spec §7, matches `merge_inputs.py:869`); disabled -> 0.
// No numeric editing — the checkbox remains the sole control.
export function CapabilityMatrixTab({
  plants,
  products,
  baseCapabilities,
  overrides,
  onChange,
  locationById,
}: CapabilityMatrixTabProps) {
  const filterDescriptors = useMemo(() => buildFilterDescriptors(locationById), [locationById]);
  const tableFilters = useTableFilters(plants, filterDescriptors);
  const { filteredRows, totalCount, filteredCount } = tableFilters;

  function effectiveEnabled(plantId: string, productId: string): boolean {
    return isCellEnabled(baseCapabilities, overrides, plantId, productId);
  }

  function toggle(plantId: string, productId: string) {
    const current = effectiveEnabled(plantId, productId);
    const next = !current;
    // Base-only default (empty overrides) — the "does this differ from the
    // base?" check the upsert-or-remove logic below needs.
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

  return (
    <div data-testid="capability-matrix-tab">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <p className="text-xs text-muted-foreground max-w-md" data-testid="text-capability-capacity-label">
          Capacity shown below each checkbox is the capacity per plant-product
          combination — not the plant's total capacity.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="text-capability-count">
            {filteredCount} of {totalCount}
          </span>
          {totalCount > 10 && <FilterMenu descriptors={filterDescriptors} tableFilters={tableFilters} />}
        </div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plant</TableHead>
              {products.map(product => (
                <TableHead key={product.id}>{product.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map(plant => (
              <TableRow key={plant.id} data-testid={`row-capability-${plant.id}`}>
                <TableCell className="text-xs">
                  {locationById?.[plant.id] ? (
                    <div className="flex flex-col">
                      <span>{locationById[plant.id].city}, {locationById[plant.id].state}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{plant.id}</span>
                    </div>
                  ) : (
                    <>
                      <span className="font-mono">{plant.name ?? plant.id}</span>
                      {plant.city && (
                        <span className="text-muted-foreground ml-1">
                          ({plant.city}, {plant.state})
                        </span>
                      )}
                    </>
                  )}
                </TableCell>
                {products.map(product => {
                  const checked = effectiveEnabled(plant.id, product.id);
                  const capacity = cellCapacity(baseCapabilities, plant.id, product.id, checked);
                  return (
                    <TableCell key={product.id}>
                      <div className="flex flex-col items-start gap-0.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(plant.id, product.id)}
                          data-testid={`checkbox-capability-${plant.id}-${product.id}`}
                          aria-label={`${plant.name ?? plant.id} can make ${product.name}`}
                        />
                        <span
                          className="font-mono text-[10px] text-muted-foreground"
                          data-testid={`text-capability-capacity-${plant.id}-${product.id}`}
                        >
                          {capacity.toLocaleString()}
                        </span>
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={products.length + 1} className="text-xs text-muted-foreground text-center py-3">
                  No plants match the current filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
