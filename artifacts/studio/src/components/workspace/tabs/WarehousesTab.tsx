import { formatCoord } from "@/lib/formatLocation";
import { useState } from "react";
import type { WarehouseCandidate, Scenario } from "@workspace/api-client-react";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForWarehouse, idCollisionMessageForWarehouse, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { warehouseStatusPresentation } from "@/components/workspace/map/statusPresentation";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DraftNumberInput, READ_ONLY_TITLE, StatusToggle } from "@/components/data-table/entityCells";

// B5.2 — matches `addedWarehouseSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape).
export interface AddedWarehouse {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  status: "active" | "forced_open" | "inactive";
  /** T9 — grid-mirror's auto-computed cosmetic label (T3's nextDisplayCode), same optional field CreateEntityDialog's map-click flow already writes. */
  displayCode?: string;
}

const STATUSES = ["active", "forced_open", "inactive"] as const;
type Status = (typeof STATUSES)[number];
const statusActiveClass = (s: Status) =>
  s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-foreground text-background" : "bg-secondary text-foreground";

interface WarehousesTabProps {
  warehouses: WarehouseCandidate[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** A5.3 — this same component (WarehouseTable + Upload/Download toolbar) is
   * reused as two-echelon-gold-au's Refineries tab: `dataset.warehouses`
   * already carries both models' facility candidates (mine rows are filtered
   * out below regardless of entity), and the backend's import/export routes
   * already accept `entity=refineries` (routes/scenarios.ts) — only the
   * entity string threaded through here, the testids, and the ImportDialog
   * title need to change per model. Defaults to "warehouses" so every
   * existing p-median-us call site (and its tests) is unaffected. */
  entity?: "warehouses" | "refineries";
  /** B5.2/B6.2 — scenario-local addedWarehouses (`PMedianInputs`) or
   * addedRefineries (`TwoEchelonInputs`, B6.2 — Workspace.tsx binds this
   * same prop name to `inputs.addedRefineries` for the entity="refineries"
   * reuse; the shape happens to match exactly, `capacity` simply stays
   * unset/ignored since capacityMode is always "none" for refineries). This
   * section renders whenever the caller actually wires
   * `onAddedWarehousesChange` — capability-gated (see that prop's own
   * comment), not `entity`-gated, so it's a no-op unless a model has this
   * concept wired at all. */
  addedWarehouses?: AddedWarehouse[];
  /** Fired on both add (append) and in-row edits (status/capacity) — full
   * replacement array, same `onChange`-out convention as every other tab.
   * Whether this is wired at all is the actual gate on rendering the
   * "Added ..." section below (see `addedSection`'s own comment — fix,
   * mirroring CustomersTab.tsx's B5.2 gating bug fix: a per-model gate on
   * `entity` alone silently missed the next reuse, exactly this repo's
   * most-recurring bug class per CLAUDE.md's Rounds 1-5). */
  onAddedWarehousesChange?: (next: AddedWarehouse[]) => void;
  /** Fired on delete only — kept separate from onAddedWarehousesChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update, which a generic "here's the new array" diff can't express cleanly. */
  onDeleteWarehouse?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** Originally written for chens-cosmetics-cn's retired China dataset,
   * where every row's `state` was "". Defensive, not currently true of any
   * shipped dataset — measured 2026-09-28: every base warehouse/customer
   * row across all six models carries a non-blank state (max-coverage-us
   * included, since its US dataset swap). Gate on DATA PRESENCE
   * (Workspace.tsx computes this from the resolved dataset), not modelId —
   * drops the State column from the base table and the Added-warehouses
   * table, and drops the state-required check from the add-row form, for a
   * future dataset (or a scenario-added entity) that omits state. Defaults
   * true (every existing caller has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B6 (JADE) — now only the ImportDialog preview grids' FilterMenu opt-in.
   * SCU-2.P4.10 (B2.2): the table's own FilterMenu shows on every model
   * above 10 rows, so it no longer reads this. */
  enableFilters?: boolean;
  /** SCU-2.P4.10 — narrows the Upload/Download expected-fields panel. */
  modelId?: string;
  /** History read-only (chen-bands-units decision 1h; SCU-2.P4.10 D2): every
   * capacity input, status button, delete button and the "+ Add" trigger —
   * base AND added rows — is disabled. Defaults false. */
  disabled?: boolean;
}

/** One effective row: a base candidate merged with its override, or an added entity. */
interface WarehouseRow {
  id: string;
  /** Added rows show their display code (pre-T9 data falls back to the uid). */
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  capacity: number | null | undefined;
  status: Status;
  added: boolean;
}

// A1.1 → SCU-2.P4.10 (spec B2.1–B2.4, B2.8, D2) — the Warehouses tab (and,
// with entity="refineries", two-echelon-gold-au's Refineries tab) on the
// shared DataTable: base and added rows are two sections under ONE toolbar
// (Upload ▾, Download ▾, "+ Add {entity}" modal, FilterMenu above 10 rows on
// every model) and one pager (above 50 rows). The Workspace no longer renders
// the legacy `WarehouseTable` (still used by Studio.tsx).
export function WarehousesTab({
  warehouses,
  overrides,
  capacityMode,
  onChange,
  scenarioId,
  onImportApplied,
  entity = "warehouses",
  addedWarehouses = [],
  onAddedWarehousesChange,
  onDeleteWarehouse,
  precheckErrors = [],
  hasStateColumn = true,
  enableFilters = false,
  disabled = false,
  modelId,
}: WarehousesTabProps) {
  const files = useEntityFileMenus({ entity, testIdEntity: entity, modelId, scenarioId, onImportApplied, enableFilters });
  const [adding, setAdding] = useState(false);
  const candidates = warehouses.filter(w => w.kind !== "mine");
  const emptyLabel =
    entity === "refineries" ? "No refinery candidates in this dataset." : "No warehouse candidates in this dataset.";
  // B6.2 — singular label for the added section's copy (testids stay warehouse-worded, D4).
  const addedEntityLabel = entity === "refineries" ? "refinery" : "warehouse";
  const showCapacity = capacityMode === "per_wh";

  function upsertBase(id: string, patch: Partial<WarehouseOverride>) {
    if (disabled) return;
    const existing = overrides.find(o => o.id === id);
    const merged: WarehouseOverride = { id, status: existing?.status ?? "active", capacity: existing?.capacity, ...patch };
    const rest = overrides.filter(o => o.id !== id);
    onChange(merged.status === "active" && merged.capacity == null ? rest : [...rest, merged]);
  }
  function upsertAdded(id: string, patch: Partial<AddedWarehouse>) {
    if (disabled || !onAddedWarehousesChange) return;
    onAddedWarehousesChange(addedWarehouses.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }

  const rows: WarehouseRow[] = [
    ...candidates.map(w => {
      const o = overrides.find(x => x.id === w.id);
      return {
        id: w.id,
        displayId: w.id,
        city: w.city,
        state: w.state,
        lat: w.lat,
        lng: w.lng,
        zip: w.zip ?? undefined,
        capacity: o?.capacity,
        status: o?.status ?? "active",
        added: false,
      };
    }),
    ...addedWarehouses.map(w => ({
      id: w.id,
      displayId: w.displayCode ?? w.id,
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity: w.capacity,
      status: w.status,
      added: true,
    })),
  ];

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const idColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "id",
    header: "ID",
    kind: "text",
    filter: "text",
    value: r => r.displayId,
    cellClassName: "font-mono text-xs whitespace-nowrap min-w-[6rem]",
    cell: r => {
      if (!added) return r.displayId;
      const missing = completenessCountForWarehouse(precheckErrors, r.id);
      const collision = idCollisionMessageForWarehouse(precheckErrors, r.id);
      return (
        <div className="flex items-center gap-1">
          {r.displayId}
          {(missing != null || collision) && (
            <span
              title={
                collision ??
                `Missing distances to ${missing} customer${missing === 1 ? "" : "s"} — see the Distances tab, or download/upload a template.`
              }
              data-testid={`warning-precheck-added-warehouse-${r.id}`}
              className="inline-flex items-center gap-0.5 text-2xs text-warning bg-warning-bg border border-warning-border rounded px-1"
            >
              <AlertTriangle className="w-3 h-3" />
              {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      );
    },
  });
  const commonColumns = (added: boolean): ColumnDef<WarehouseRow>[] => [
    idColumn(added),
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    ...(hasStateColumn
      ? [
          {
            id: "state",
            header: "State",
            kind: "text",
            filter: "select",
            value: r => r.state || null,
            cellClassName: "text-xs",
            cell: r => r.state,
          } satisfies ColumnDef<WarehouseRow>,
        ]
      : []),
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => formatCoord(r.lat),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => formatCoord(r.lng),
    },
  ];
  const hasZip = candidates.some(w => w.zip);
  const zipColumn: ColumnDef<WarehouseRow> = {
    id: "zip",
    header: "Zip",
    kind: "text",
    filter: "text",
    value: r => r.zip ?? null,
    cellClassName: "text-xs font-mono",
    cell: r => r.zip ?? "—",
  };
  const capacityColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "capacity",
    header: "Capacity",
    kind: "number",
    value: r => r.capacity ?? null,
    cell: r => (
      <DraftNumberInput
        value={r.capacity}
        // base: integer (WarehouseTable's parseInt); added: decimal (the added section's parseFloat)
        parse={raw => (raw === "" ? null : Math.max(0, (added ? parseFloat(raw) : parseInt(raw, 10)) || 0))}
        onCommit={capacity => (added ? upsertAdded(r.id, { capacity }) : upsertBase(r.id, { capacity }))}
        disabled={disabled}
        placeholder="uniform"
        testId={added ? `input-added-wh-capacity-${r.id}` : `input-wh-capacity-${r.id}`}
      />
    ),
  });
  const statusColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "status",
    header: "Status",
    kind: "enum",
    // The filter option value is the presentation LABEL (e2e ticks `checkbox-filter-status-Fixed-Open`).
    value: r => warehouseStatusPresentation[r.status].label,
    cell: r => (
      <StatusToggle
        options={STATUSES}
        value={r.status}
        labelOf={s => warehouseStatusPresentation[s].label}
        activeClassOf={statusActiveClass}
        onChange={status => (added ? upsertAdded(r.id, { status }) : upsertBase(r.id, { status }))}
        disabled={disabled}
        testIdOf={s => (added ? `button-added-wh-${r.id}-${s}` : `button-wh-${r.id}-${s}`)}
      />
    ),
  });
  const baseColumns: ColumnDef<WarehouseRow>[] = [
    ...commonColumns(false),
    ...(hasZip ? [zipColumn] : []),
    ...(showCapacity ? [capacityColumn(false)] : []),
    statusColumn(false),
  ];
  const addedColumns: ColumnDef<WarehouseRow>[] = [
    ...commonColumns(true),
    ...(showCapacity ? [capacityColumn(true)] : []),
    statusColumn(true),
    {
      id: "delete",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added warehouse ${r.id}`}
          onClick={() => onDeleteWarehouse?.(r.id)}
          disabled={disabled}
          testId={`button-delete-added-warehouse-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedWarehousesChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-warehouse-row"
    >
      + Add {addedEntityLabel}
    </Button>
  );

  return (
    <div data-testid={`${entity}-tab`}>
      <DataTable<WarehouseRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        testIds={{
          toolbar: `${entity}-tab-toolbar`,
          pagerPrev: `button-${entity}-prev`,
          pagerNext: `button-${entity}-next`,
          pageIndicator: `${entity}-page-indicator`,
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid={`${entity}-tab-empty`}>
                {emptyLabel}
              </p>
            ),
          },
          ...(onAddedWarehousesChange != null
            ? [
                {
                  id: "added",
                  title: entity === "refineries" ? "Added refineries" : "Added warehouses",
                  testId: "added-warehouses-section",
                  includes: (r: WarehouseRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: WarehouseRow) => `row-added-warehouse-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-warehouses-empty">
                      No added {addedEntityLabel}s yet — use "+ Add {addedEntityLabel}" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          readOnly={disabled}
          entityKind={entity === "refineries" ? "refinery" : "warehouse"}
          capacityMode={capacityMode}
          hasStateColumn={hasStateColumn}
          existingCodes={addedWarehouses.map(w => w.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "warehouse" || r.kind === "refinery") onAddedWarehousesChange?.([...addedWarehouses, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
