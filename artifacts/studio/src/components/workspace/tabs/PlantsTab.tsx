import { useState } from "react";
import type { Plant, Scenario } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

// T11 — matches `jadeInputsSchema`'s `addedPlants[]` shape exactly
// (`{ id, displayCode?, city, state, lat, lng }`, spec §5): geometry only.
// A plant has no status and no capacity of its own — every bit of its
// editable behavior (which product(s) it can make) lives in the Capability
// Matrix tab (T11's `CapabilityMatrixTab`), driven by `plantProductCapability`
// overrides keyed by this same `id`.
export interface AddedPlant {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  displayCode?: string;
}

interface PlantsTabProps {
  /** Base dataset plants (Chapter 9 JADE only — `Dataset.plants`, absent for
   * every other model). Read-only: id/city/state/lat/lng, no status/capacity
   * column at all (spec §6 — "id, city/state, lat/lon (read-only base +
   * added rows)"). */
  plants: Plant[];
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Scenario-local addedPlants. Fired on both add (append) and in-row edits
   * — full replacement array, same `onChange`-out convention as every other
   * tab. Gates the "Added plants" section's render (capability-based, not
   * `modelId ===` — Gate 6/1.9). */
  addedPlants?: AddedPlant[];
  onAddedPlantsChange?: (next: AddedPlant[]) => void;
  /** Fired on delete only — kept separate from onAddedPlantsChange because
   * the caller (Workspace.tsx) also needs to purge any
   * `plantProductCapability` overrides AND plant→warehouse
   * `distanceOverrides` referencing this id in the SAME atomic inputs
   * update (spec §6's plant delete/copy reconciliation — T12's job to wire,
   * this tab only fires the intent). */
  onDeletePlant?: (id: string) => void;
  /** SCU-2.P4.12 (D2) — browsing result history: the delete buttons and the
   * "+ Add plant" trigger are disabled (base plants have no editable cells). */
  readOnly?: boolean;
}

/** One effective row: a base dataset plant (read-only) or an added plant. */
interface PlantRow {
  id: string;
  /** Base: `name ?? id` (unchanged); added: `displayCode ?? id`. Also the ID filter value. */
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  added: boolean;
}

// T11 → SCU-2.P4.12 (spec B2.1–B2.4, B2.8, D2) — JADE's Plants tab on the
// shared DataTable: base (read-only) and added plants are two sections under
// ONE toolbar and ONE filter menu (user decision 2026-10-17 — it had two
// independent menus), "+ Add plant" opens the CreateEntityDialog modal (the
// plant uid/code helpers this file used to carry are lib/entityId's `pl`
// kind, `ap-` / `PL-…`, identical output).
export function PlantsTab({
  plants,
  scenarioId,
  onImportApplied,
  addedPlants = [],
  onAddedPlantsChange,
  onDeletePlant,
  readOnly = false,
}: PlantsTabProps) {
  const files = useEntityFileMenus({
    entity: "plants",
    testIdEntity: "plants",
    modelId: "two-echelon-jade-us",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  const rows: PlantRow[] = [
    ...plants.map(p => ({
      id: p.id,
      displayId: p.name ?? p.id,
      city: p.city,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      added: false,
    })),
    ...addedPlants.map(p => ({
      id: p.id,
      displayId: p.displayCode ?? p.id,
      city: p.city,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      added: true,
    })),
  ];

  const columns: ColumnDef<PlantRow>[] = [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => r.displayId,
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
  const addedColumns: ColumnDef<PlantRow>[] = [
    ...columns,
    {
      id: "delete",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added plant ${r.id}`}
          onClick={() => onDeletePlant?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-plant-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedPlantsChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-plant-row"
    >
      + Add plant
    </Button>
  );

  return (
    <div data-testid="plants-tab">
      <DataTable<PlantRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={columns}
        testIds={{
          toolbar: "plants-tab-toolbar",
          pagerPrev: "button-plants-prev",
          pagerNext: "button-plants-next",
          pageIndicator: "plants-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="plants-tab-empty">
                No plants in this dataset.
              </p>
            ),
          },
          ...(onAddedPlantsChange != null
            ? [
                {
                  id: "added",
                  title: "Added plants",
                  testId: "added-plants-section",
                  includes: (r: PlantRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: PlantRow) => `row-added-plant-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-plants-empty">
                      No added plants yet — use "+ Add plant" above to create one.
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
          entityKind="plant"
          existingCodes={addedPlants.map(p => p.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "plant") onAddedPlantsChange?.([...addedPlants, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
