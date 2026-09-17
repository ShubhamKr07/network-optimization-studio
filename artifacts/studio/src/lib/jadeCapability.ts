// A2 (JADE Ch.9 Workspace bundle) — shared plant×product capability helpers.
//
// Single source of truth for "is this (plantId, productId) cell enabled?"
// and "what capacity does it carry?", used by CapabilityMatrixTab (B5) and
// the ServiceStatsTab Plant Production section (B4) so both surfaces agree
// exactly. Mirrors `merge_inputs.py`'s merge semantics (~line 869):
//   merged_capability[(pid, k)] = capability.get((pid, k), 0)          # base
//   for override in capability_overrides:
//       merged_capability[(pid, k)] = 210_000_000 if enabled else 0    # override
//
// In practice a `plantProductCapability` override is only ever written
// (CapabilityMatrixTab's upsert-or-remove `toggle`) when the requested
// state DIFFERS from the base default — so an `enabled:true` override only
// ever exists for a cell whose base capacity was 0 (a base off-diagonal
// cell, or any cell for an added plant, which has no base-matrix entry at
// all). `cellCapacity` still checks the base capacity defensively for any
// enabled cell (matching the spec's stated contract), not just the
// override-implies-base-was-zero case that happens to hold today.

import type { PlantProductCapability } from "@workspace/api-client-react";

/** Sparse scenario-local override entry — matches `jadeInputsSchema`'s
 * `plantProductCapability[]` shape exactly (pair-unique). Re-declared here
 * (not imported) to avoid a dependency on CapabilityMatrixTab.tsx, which
 * this module must not import from or be edited alongside (A2 is a
 * leaf/shared helper; CapabilityMatrixTab is a Wave-B single-writer file
 * this task does not touch). */
export interface CapabilityOverride {
  plantId: string;
  productId: string;
  enabled: boolean;
}

// The Big-M-style capacity assigned to ANY enabled cell that has no real
// base capacity (a base off-diagonal cell turned on, or any cell for an
// added plant) — matches `merge_inputs.py:869`'s `210_000_000` literal.
export const JADE_ENABLED_CAPACITY = 210_000_000;

function findBaseCapability(
  baseCapabilities: PlantProductCapability[],
  plantId: string,
  productId: string,
): PlantProductCapability | undefined {
  return baseCapabilities.find(c => c.plantId === plantId && c.productId === productId);
}

/** Base-only enabled check: a cell is enabled by default iff its base
 * capacity is > 0. A missing base entry (e.g. every cell for an added
 * plant, which never has a base-matrix row) defaults to disabled. */
function baseEnabled(baseCapabilities: PlantProductCapability[], plantId: string, productId: string): boolean {
  const cell = findBaseCapability(baseCapabilities, plantId, productId);
  return (cell?.capacity ?? 0) > 0;
}

/** Effective enabled state for (plantId, productId): a matching override
 * wins outright (its own `enabled` value); otherwise falls back to the
 * base default (`capacity > 0`). */
export function isCellEnabled(
  baseCapabilities: PlantProductCapability[],
  overrides: CapabilityOverride[],
  plantId: string,
  productId: string,
): boolean {
  const override = overrides.find(o => o.plantId === plantId && o.productId === productId);
  if (override) return override.enabled;
  return baseEnabled(baseCapabilities, plantId, productId);
}

/** Effective capacity for (plantId, productId) given its resolved `enabled`
 * state (typically `isCellEnabled(...)`'s result for the same cell):
 * - disabled -> 0.
 * - enabled -> the base cell's own capacity if it is > 0, else
 *   `JADE_ENABLED_CAPACITY` — covers both a base off-diagonal cell that
 *   gets enabled (base capacity 0) and any cell for an added plant (no
 *   base entry at all), matching `merge_inputs.py:869` exactly. */
export function cellCapacity(
  baseCapabilities: PlantProductCapability[],
  plantId: string,
  productId: string,
  enabled: boolean,
): number {
  if (!enabled) return 0;
  const cell = findBaseCapability(baseCapabilities, plantId, productId);
  const baseCapacity = cell?.capacity ?? 0;
  return baseCapacity > 0 ? baseCapacity : JADE_ENABLED_CAPACITY;
}
