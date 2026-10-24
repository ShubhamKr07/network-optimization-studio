import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { MineOverride } from "@/components/tables/MineTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForMine, idCollisionMessageForMine, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DraftNumberInput, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

interface MineRow {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
}

// Task 30 (B6.1 stage 4) — matches `addedMineSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. No
// `status` field: mines have no forced-open/inactive concept anywhere in
// this LP (stage 1-3's own report, confirmed against solve_transport and
// mines.json) — a "closed" mine is a capacity override of 0, same precedent
// templates.ts's MineOverride comment already documents. `capacity` stays
// nullable/optional — a blank capacity on an added mine is a deliberate,
// valid "unconstrained" state (matches solve.py's get_base_capacity
// None-means-unconstrained convention), NOT a required field.
// T11 (Input Map v2 identity model, Step A) — `id` is now a hidden T3
// stable uid (`am-<uuid>`, minted via `newUid("mn")`), never typed;
// `displayCode` is the human-facing, collision-checked label, matching
// WarehousesTab.tsx's own T9 migration exactly.
export interface AddedMine {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  displayCode?: string;
}

interface MinesTabProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedMines. Fired on both add (append) and in-row capacity edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedMines?: AddedMine[];
  onAddedMinesChange?: (next: AddedMine[]) => void;
  /** Fired on delete only — kept separate from onAddedMinesChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteMine?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "missing N lane costs" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** SCU-2.P4.13 (D2) — browsing result history: base and added capacity,
   * delete and the "+ Add mine" trigger are disabled (no disabled prop before). */
  readOnly?: boolean;
}

/** One effective row: a base mine with its capacity override, or an added mine. */
interface MineTableRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Base: the override only (blank = base capacity); added: the stored value (blank = unconstrained). */
  capacity: number | null | undefined;
  added: boolean;
}

// Task 30 → SCU-2.P4.13 (spec B2.1–B2.4, B2.8, D2) — transport-coal's Mines
// tab on the shared DataTable: base and added mines are two sections under
// ONE toolbar (Upload ▾, Download ▾, "+ Add mine" modal, FilterMenu above 10
// rows) and one pager. The legacy `MineTable` is no longer rendered here.
export function MinesTab({
  mines,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedMines = [],
  onAddedMinesChange,
  onDeleteMine,
  precheckErrors = [],
  readOnly = false,
}: MinesTabProps) {
  const files = useEntityFileMenus({
    entity: "mines",
    testIdEntity: "mines",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  function upsertBase(id: string, capacity: number | null) {
    if (readOnly) return;
    const rest = overrides.filter(o => o.id !== id);
    onChange(capacity == null ? rest : [...rest, { id, capacity }]);
  }
  function upsertAdded(id: string, capacity: number | null) {
    if (readOnly) return;
    onAddedMinesChange?.(addedMines.map(m => (m.id === id ? { ...m, capacity } : m)));
  }

  const rows: MineTableRow[] = [
    ...mines.map(m => ({ ...m, displayId: m.id, capacity: overrides.find(o => o.id === m.id)?.capacity, added: false })),
    ...addedMines.map(m => ({
      id: m.id,
      displayId: m.displayCode ?? m.id,
      city: m.city,
      state: m.state,
      lat: m.lat,
      lng: m.lng,
      capacity: m.capacity,
      added: true,
    })),
  ];

  const location = (added: boolean): ColumnDef<MineTableRow>[] => [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => {
        if (!added) return r.displayId;
        const missing = completenessCountForMine(precheckErrors, r.id);
        const collision = idCollisionMessageForMine(precheckErrors, r.id);
        return (
          <div className="flex items-center gap-1">
            {r.displayId}
            {(missing != null || collision) && (
              <span
                title={
                  collision ??
                  `Missing lane costs to ${missing} station${missing === 1 ? "" : "s"} — see the Lane costs tab, or download/upload a template.`
                }
                data-testid={`warning-precheck-added-mine-${r.id}`}
                className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
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
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];
  const capacity = (added: boolean): ColumnDef<MineTableRow> => ({
    id: "capacity",
    header: added ? "Capacity" : "Capacity override (tons)",
    filterLabel: "Capacity",
    kind: "number",
    value: r => r.capacity ?? null,
    cell: r => (
      <DraftNumberInput
        value={r.capacity}
        // base: integer (MineTable's parseInt); added: decimal (the added section's parseFloat)
        parse={raw => (raw === "" ? null : Math.max(0, (added ? parseFloat(raw) : parseInt(raw, 10)) || 0))}
        onCommit={v => (added ? upsertAdded(r.id, v) : upsertBase(r.id, v))}
        disabled={readOnly}
        placeholder={added ? "unconstrained" : "base capacity"}
        testId={added ? `input-added-mine-capacity-${r.id}` : `input-mine-capacity-${r.id}`}
      />
    ),
  });
  const hasZip = mines.some(m => m.zip);
  const baseColumns: ColumnDef<MineTableRow>[] = [
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
          } satisfies ColumnDef<MineTableRow>,
        ]
      : []),
    capacity(false),
  ];
  const addedColumns: ColumnDef<MineTableRow>[] = [
    ...location(true),
    capacity(true),
    {
      id: "delete",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added mine ${r.id}`}
          onClick={() => onDeleteMine?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-mine-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedMinesChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-mine-row"
    >
      + Add mine
    </Button>
  );

  return (
    <div data-testid="mines-tab">
      <DataTable<MineTableRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        testIds={{
          toolbar: "mines-tab-toolbar",
          pagerPrev: "button-mines-prev",
          pagerNext: "button-mines-next",
          pageIndicator: "mines-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="mines-tab-empty">
                No mines in this dataset.
              </p>
            ),
          },
          ...(onAddedMinesChange != null
            ? [
                {
                  id: "added",
                  title: "Added mines",
                  testId: "added-mines-section",
                  includes: (r: MineTableRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: MineTableRow) => `row-added-mine-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-mines-empty">
                      No added mines yet — use "+ Add mine" above to create one.
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
          entityKind="mine"
          existingCodes={addedMines.map(m => m.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "mine") onAddedMinesChange?.([...addedMines, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
