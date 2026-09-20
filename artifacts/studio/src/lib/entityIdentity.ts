// SCN v0.3 workspace-fixups-2, item 2 (T3) — the one canonical-id -> display
// identity projection shared by every output/input grid that needs BOTH a
// human-readable location AND a display id for an entity that may be a base
// dataset row OR a scenario-local "added" row (SCN v0.3 Phase B).
//
// Why not a location-only map: several consumers have no other source for a
// scenario-added entity's display code today (verified against FlowsTab/
// JadeFlowsTab/AssignmentsTab — see the spec). A location-only map would
// silently fall back to the raw `aw-...` uid even when a real display code
// exists, violating the "prefer displayCode" contract this task exists to
// establish. So this helper returns BOTH in one record, keyed by the
// canonical id every `result.edges`/override array actually uses to join.
//
// PURE: no React, no fetching — Workspace.tsx (INT) calls this twice per
// render, once against `displayedInputs` (the solved snapshot -> output
// tables) and once against `localInputs` (the live draft -> input tables).
import type { Dataset } from "@workspace/api-client-react";

export interface EntityIdentity {
  city: string;
  state: string;
  displayId: string;
}

// A scenario-local "added" row's minimal shared shape across every model's
// added-entity family (addedWarehouses/addedCustomers/addedMines/
// addedStations/addedRefineries/addedPlants all share exactly this shape —
// see WarehousesTab.tsx's AddedWarehouse, CustomersTab.tsx's AddedCustomer,
// PlantsTab.tsx's AddedPlant). `inputs` is opaque JSONB at this boundary, so
// this is read defensively rather than imported from any one tab's local
// type (importing a *Tab.tsx type into a `lib/` helper would invert this
// codebase's dependency direction).
interface AddedEntityRow {
  id: string;
  city?: string;
  state?: string;
  displayCode?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAddedRows(inputs: Record<string, unknown> | null | undefined, key: string): AddedEntityRow[] {
  const raw = inputs?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is AddedEntityRow => isRecord(row) && typeof row.id === "string");
}

// Every scenario-local "added" entity family this codebase has, across all
// 6 models (p-median-us/brazil, transport-coal, two-echelon-gold-au,
// two-echelon-jade-us, chens-cosmetics-cn). A model that has no concept of a
// given family (e.g. p-median-us has no addedMines) simply never has that
// key on its `inputs`, so `readAddedRows` returns `[]` for it — safe to
// probe unconditionally rather than switch on `modelId`.
const ADDED_ENTITY_KEYS = [
  "addedWarehouses",
  "addedCustomers",
  "addedMines",
  "addedStations",
  "addedRefineries",
  "addedPlants",
] as const;

interface BaseDatasetRow {
  id: string;
  city: string;
  state: string;
}

// Every base entity family a `Dataset` response can carry. Mines/refineries
// live in `warehouses` (distinguished by `WarehouseCandidate.kind`, not a
// separate array); transport-coal's stations live in `customers`. `plants`
// is Chapter 9 JADE only and optional on `Dataset`.
function baseRows(dataset: Pick<Dataset, "warehouses" | "customers" | "plants"> | null | undefined): BaseDatasetRow[] {
  return [
    ...(dataset?.warehouses ?? []),
    ...(dataset?.customers ?? []),
    ...(dataset?.plants ?? []),
  ];
}

/**
 * Union every base entity (`dataset.warehouses` incl. mines/refineries via
 * `kind`, `dataset.customers` incl. stations, `dataset.plants`) with every
 * scenario-local "added" entity (`inputs.added*`) into one canonical-id ->
 * {city, state, displayId} lookup.
 *
 * Precedence: **base wins on id collision** — a base dataset row's identity
 * is authoritative even if an added-row array happens to carry a colliding
 * id (shouldn't normally happen, but base data is never less trustworthy
 * than a scenario-local override array).
 *
 * `displayId`: an added row's `displayCode` if present, else its canonical
 * `id` (added rows have no other id to fall back to). A base row's
 * `displayId` is always its canonical `id` — the base `WarehouseCandidate`/
 * `Customer`/`Plant` schemas carry no separate display-code field.
 *
 * `modelId` is accepted for interface parity with call sites and to
 * document that this is a model-scoped projection, but is not needed to
 * compute the result — `dataset` already carries exactly the entity arrays
 * the given model exposes (mines/refineries as `kind`-tagged warehouses,
 * stations as customers), so no per-model branch is required here.
 */
export function buildEntityIdentityById(
  modelId: string | undefined,
  dataset: Pick<Dataset, "warehouses" | "customers" | "plants"> | null | undefined,
  inputs: Record<string, unknown> | null | undefined,
): Record<string, EntityIdentity> {
  void modelId;
  const map: Record<string, EntityIdentity> = {};

  // Added rows first (lower precedence) — base rows below overwrite on id
  // collision.
  for (const key of ADDED_ENTITY_KEYS) {
    for (const row of readAddedRows(inputs, key)) {
      map[row.id] = {
        city: row.city ?? "",
        state: row.state ?? "",
        displayId: row.displayCode ?? row.id,
      };
    }
  }

  // Base rows always win.
  for (const row of baseRows(dataset)) {
    map[row.id] = {
      city: row.city ?? "",
      state: row.state ?? "",
      displayId: row.id,
    };
  }

  return map;
}
