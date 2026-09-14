import type { Plant, Product, PlantProductCapability } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

// T11 (Chapter 9 JADE) — matches `jadeInputsSchema`'s
// `plantProductCapability[]` shape exactly (`{plantId, productId, enabled}`,
// pair-unique). A sparse override array over the base 16-cell matrix
// (`Dataset.plantProductCapabilities`).
export interface CapabilityOverride {
  plantId: string;
  productId: string;
  enabled: boolean;
}

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

function baseEnabled(baseCapabilities: PlantProductCapability[], plantId: string, productId: string): boolean {
  const cell = baseCapabilities.find(c => c.plantId === plantId && c.productId === productId);
  return (cell?.capacity ?? 0) > 0;
}

// T11 — the Capability Matrix input tab: an effective-plants × 4-products
// checkbox grid. Each toggle writes (if it now differs from the base
// default) or removes (if it now matches the base default) a sparse
// `plantProductCapability` override entry — same "upsert-or-remove" pattern
// every other override table in this codebase already uses (WarehouseTable/
// CustomerTable's own `isNoOp` checks), just keyed by a (plantId, productId)
// pair instead of a single id.
export function CapabilityMatrixTab({
  plants,
  products,
  baseCapabilities,
  overrides,
  onChange,
  locationById,
}: CapabilityMatrixTabProps) {
  function getOverride(plantId: string, productId: string) {
    return overrides.find(o => o.plantId === plantId && o.productId === productId);
  }

  function effectiveEnabled(plantId: string, productId: string): boolean {
    const o = getOverride(plantId, productId);
    if (o) return o.enabled;
    return baseEnabled(baseCapabilities, plantId, productId);
  }

  function toggle(plantId: string, productId: string) {
    const current = effectiveEnabled(plantId, productId);
    const next = !current;
    const base = baseEnabled(baseCapabilities, plantId, productId);
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
    <div className="max-h-[60vh] overflow-y-auto" data-testid="capability-matrix-tab">
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
          {plants.map(plant => (
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
                return (
                  <TableCell key={product.id}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(plant.id, product.id)}
                      data-testid={`checkbox-capability-${plant.id}-${product.id}`}
                      aria-label={`${plant.name ?? plant.id} can make ${product.name}`}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
