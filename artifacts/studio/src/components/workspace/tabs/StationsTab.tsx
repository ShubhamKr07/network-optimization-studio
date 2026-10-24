import { formatCoord } from "@/lib/formatLocation";
import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { StationOverride } from "@/components/tables/StationTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForStation, idCollisionMessageForStation, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DemandCell, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

interface StationRow {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
}

// Task 30 (B6.1 stage 4) — matches `addedStationSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. `demand`
// is required (non-nullable), unlike AddedMine's optional capacity — a
// brand-new station can't be added with no demand at all, same rule
// addedCustomerSchema already enforces for customers.
// T11 (Input Map v2 identity model, Step A) — `id` is now a hidden T3
// stable uid (`as-<uuid>`, minted via `newUid("st")`), never typed;
// `displayCode` is the human-facing, collision-checked label, matching
// CustomersTab.tsx's own T9 migration exactly.
export interface AddedStation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  displayCode?: string;
}

interface StationsTabProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedStations. Fired on both add (append) and in-row demand edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedStations?: AddedStation[];
  onAddedStationsChange?: (next: AddedStation[]) => void;
  /** Fired on delete only — kept separate from onAddedStationsChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteStation?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "N mines lack a lane cost" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** SCU-2.P4.14 (D2) — browsing result history: base and added demand,
   * delete and the "+ Add station" trigger are disabled (no disabled prop before). */
  readOnly?: boolean;
}

/** One effective row: a base station with its demand override, or an added station. */
interface StationTableRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Base: the override only (blank = base demand, unchanged); added: the stored demand. */
  demand: number | null;
  added: boolean;
}

// Task 30 → SCU-2.P4.14 (spec B2.1–B2.4, B2.8, B2.9, D2) — transport-coal's
// Stations tab on the shared DataTable: base and added stations under ONE
// toolbar (Upload ▾, Download ▾, "+ Add station" modal, FilterMenu above 10
// rows) and one pager. Station demand is a FormattedNumberInput in INTEGER
// mode (user decision 2026-10-17; it parsed with parseInt before): grouped,
// "tons" suffix (user decision), "." rejected. Emptying a base demand clears the override
// (blank = base demand, as before); emptying an ADDED demand saves nothing
// and reverts on blur (it committed 0 before). The legacy `StationTable` is
// no longer rendered here.
export function StationsTab({
  stations,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedStations = [],
  onAddedStationsChange,
  onDeleteStation,
  precheckErrors = [],
  readOnly = false,
}: StationsTabProps) {
  const files = useEntityFileMenus({
    entity: "stations",
    testIdEntity: "stations",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  function upsertBase(id: string, demand: number | null) {
    if (readOnly) return;
    const rest = overrides.filter(o => o.id !== id);
    onChange(demand == null ? rest : [...rest, { id, demand }]);
  }
  function upsertAdded(id: string, demand: number) {
    if (readOnly) return;
    onAddedStationsChange?.(addedStations.map(s => (s.id === id ? { ...s, demand } : s)));
  }

  const rows: StationTableRow[] = [
    ...stations.map(s => ({ ...s, displayId: s.id, demand: overrides.find(o => o.id === s.id)?.demand ?? null, added: false })),
    ...addedStations.map(s => ({
      id: s.id,
      displayId: s.displayCode ?? s.id,
      city: s.city,
      state: s.state,
      lat: s.lat,
      lng: s.lng,
      demand: s.demand,
      added: true,
    })),
  ];

  const location = (added: boolean): ColumnDef<StationTableRow>[] => [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => {
        if (!added) return r.displayId;
        const missing = completenessCountForStation(precheckErrors, r.id);
        const collision = idCollisionMessageForStation(precheckErrors, r.id);
        return (
          <div className="flex items-center gap-1">
            {r.displayId}
            {(missing > 0 || collision) && (
              <span
                title={
                  collision ??
                  `${missing} mine${missing === 1 ? " lacks" : "s lack"} a lane cost to this station — see the Lane costs tab, or download/upload a template.`
                }
                data-testid={`warning-precheck-added-station-${r.id}`}
                className="inline-flex items-center gap-0.5 text-2xs text-warning bg-warning-bg border border-warning-border rounded px-1"
              >
                <AlertTriangle className="w-3 h-3" />
                {collision ? "ID collision" : `Missing ${missing} lane cost${missing === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        );
      },
    },
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    {
      id: "state",
      header: "State",
      kind: "text",
      filter: "text",
      value: r => r.state || null,
      cellClassName: "text-xs",
      cell: r => r.state,
    },
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
  const demand = (added: boolean): ColumnDef<StationTableRow> => ({
    id: "demand",
    header: added ? "Demand" : "Demand override (tons)",
    filterLabel: "Demand",
    kind: "number",
    value: r => r.demand,
    cell: r => (
      <DemandCell
        suffix="tons"
        value={r.demand}
        integer
        clearCommits={!added}
        onCommit={v => (added ? v !== null && upsertAdded(r.id, v) : upsertBase(r.id, v))}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        placeholder={added ? undefined : "base demand"}
        testId={added ? `input-added-station-demand-${r.id}` : `input-station-demand-${r.id}`}
      />
    ),
  });
  const hasZip = stations.some(s => s.zip);
  const baseColumns: ColumnDef<StationTableRow>[] = [
    ...location(false),
    ...(hasZip
      ? [
          {
            id: "zip",
            header: "Zip",
            kind: "text",
            filter: "text",
            value: r => r.zip ?? null,
            cellClassName: "text-xs font-mono",
            cell: r => r.zip ?? "—",
          } satisfies ColumnDef<StationTableRow>,
        ]
      : []),
    demand(false),
  ];
  const addedColumns: ColumnDef<StationTableRow>[] = [
    ...location(true),
    demand(true),
    {
      id: "delete",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added station ${r.id}`}
          onClick={() => onDeleteStation?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-station-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedStationsChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-station-row"
    >
      + Add station
    </Button>
  );

  return (
    <div data-testid="stations-tab">
      <DataTable<StationTableRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        testIds={{
          toolbar: "stations-tab-toolbar",
          pagerPrev: "button-stations-prev",
          pagerNext: "button-stations-next",
          pageIndicator: "stations-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="stations-tab-empty">
                No stations in this dataset.
              </p>
            ),
          },
          ...(onAddedStationsChange != null
            ? [
                {
                  id: "added",
                  title: "Added stations",
                  testId: "added-stations-section",
                  includes: (r: StationTableRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: StationTableRow) => `row-added-station-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-stations-empty">
                      No added stations yet — use "+ Add station" above to create one.
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
          readOnly={readOnly}
          entityKind="station"
          existingCodes={addedStations.map(s => s.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "station") onAddedStationsChange?.([...addedStations, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
