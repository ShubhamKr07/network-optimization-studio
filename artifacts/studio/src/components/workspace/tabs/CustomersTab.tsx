import { formatCoord } from "@/lib/formatLocation";
import { demandHeader, type Chapter } from "@/lib/chapters";
import { useState } from "react";
import type { Customer, Product, Scenario } from "@workspace/api-client-react";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForCustomer, idCollisionMessageForCustomer, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DemandCell, READ_ONLY_TITLE, StatusToggle } from "@/components/data-table/entityCells";

// B5.2 — matches `addedCustomerSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape). No `status` field — precheck.ts's own
// comment: "v1 has no way to add a customer and mark it excluded in the
// same breath" — every added customer counts as active, always.
//
// T11 (Chapter 9 JADE) — a parallel `demands` (per-product,
// `{productId: tons}`) is added, matching `jadeInputsSchema`'s
// `addedCustomers[].demands` (T5) exactly. `demand` STAYS required (not
// widened to optional) — it's a load-bearing field for other consumers of
// this exact exported type (e.g. `Workspace.tsx`'s `addedCustomersFromInputs`
// feeds `OutputMapTab.tsx`'s `EffectiveAddedCustomer`, which also requires a
// numeric `demand` for customer-bubble sizing); making it optional here would
// silently break that unrelated consumer's typecheck. For a JADE added
// customer, this component computes `demand` as the sum of `demands`' values
// — the exact same "scalar total = Σ of the 4 products" convention the base
// `Customer.demand`/`demands` fields already document (openapi.yaml).
export interface AddedCustomer {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  /** T11 — Chapter 9 JADE per-product demand breakdown, keyed by product id. Always kept in sync with `demand` (its sum) when present. */
  demands?: Record<string, number>;
  /** T9 — grid-mirror's auto-computed cosmetic label (T3's nextDisplayCode), same optional field CreateEntityDialog's map-click flow already writes. */
  displayCode?: string;
}

// T11 — Chapter 9 JADE's per-product customer override, parallel to
// `CustomerOverride` (CustomerTable.tsx) which only carries a scalar
// `demand`. Matches `jadeInputsSchema`'s `customerOverrides[]` shape
// (`{id, demands?: Record<productId, tons>, status}`) exactly. Kept as its
// own type/prop pair (`productOverrides`/`onProductOverridesChange`) rather
// than widening `CustomerOverride` itself, so every non-JADE caller
// (p-median-us, two-echelon-gold-au) stays byte-identical to before this
// task.
export interface CustomerProductOverride {
  id: string;
  demands?: Record<string, number>;
  status: "active" | "excluded";
}

interface CustomersTabProps {
  customers: Customer[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** B5.2 — scenario-local addedCustomers (B1.1), p-median-us only (two-echelon-gold-au's CustomersTab call site omits these props — its own inputs schema has no addedCustomers field). */
  addedCustomers?: AddedCustomer[];
  /** Fired on both add (append) and in-row edits (demand) — full replacement array, same `onChange`-out convention as every other tab. */
  onAddedCustomersChange?: (next: AddedCustomer[]) => void;
  /** Fired on delete only — kept separate from onAddedCustomersChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update. */
  onDeleteCustomer?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. */
  precheckErrors?: PrecheckErrorLike[];
  /** T5 (Bundle 2, Step 2b) — threaded straight through to CustomerTable
   * (see its own comment); the "Added customers" section below is NEVER
   * gated by this — an added region has no textbook demand to protect.
   * Defaults true, unaffected for every existing caller. */
  demandEditable?: boolean;
  /** D30 — whole-number demand (max-coverage-us): scalar demand cells and the Add dialog reject ".". */
  integerDemand?: boolean;
  /** T11 (Chapter 9 JADE) — presence (non-empty array) is what switches this
   * whole component into per-product demand mode: base rows render one
   * demand column per product instead of `CustomerTable`'s single scalar
   * Demand column, and the "Added customers" section does the same. Every
   * existing model (p-median-us, two-echelon-gold-au, transport-coal,
   * p-median-brazil) omits this prop entirely and is completely unaffected
   * — gated on the data's presence, never `modelId ===` (Gate 6). */
  products?: Product[];
  /** T11 — sparse per-customer per-product demand + active/excluded
   * overrides, parallel to `overrides`/`onChange` (scalar-demand models).
   * Required (with `products`) to actually render the per-product base
   * table; without it, base rows fall back to the scalar `CustomerTable`
   * even if `products` happens to be set (defensive — mirrors every other
   * tab's "gate on the actual wired capability" fix). */
  productOverrides?: CustomerProductOverride[];
  onProductOverridesChange?: (next: CustomerProductOverride[]) => void;
  /** Chen's Cosmetics (max-coverage-us) has no state data — every row's `state` is "". Gate on DATA PRESENCE (Workspace.tsx computes this from the resolved dataset), not modelId — drops the State column from the base table and the Added-customers table, and drops the state-required check from the add-row form. Defaults true (every other model has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B7 (JADE) — now only the ImportDialog preview grids' FilterMenu opt-in.
   * SCU-2.P4.11 (B2.2): the table's own FilterMenu shows on every model
   * above 10 rows (base + added rows, one menu), so it no longer reads this. */
  enableFilters?: boolean;
  /** SCU-2.P4.11 — narrows the Upload/Download expected-fields panel. */
  modelId?: string;
  /** Active chapter's demand unit; goes in the demand column headers. */
  demandUnit?: Chapter["demandUnit"];
  /** History read-only (decision 1h; SCU-2.P4.11 D2): every demand input,
   * status button, delete button and the "+ Add customer" trigger — base,
   * added and JADE per-product rows alike — is disabled. Defaults false. */
  disabled?: boolean;
}

/** One effective row: a base customer merged with its override, or an added customer. */
interface CustomerRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Effective scalar demand (base: override ?? dataset; added: stored). */
  demand: number;
  /** JADE: effective per-product demand. */
  demands: Record<string, number>;
  status: "active" | "excluded";
  added: boolean;
}

const CUSTOMER_STATUSES = ["active", "excluded"] as const;
const customerStatusClass = (s: "active" | "excluded") =>
  s === "excluded" ? "bg-foreground text-background" : "bg-secondary text-foreground";
const BRAZIL_LOCK_TITLE = "Demand for this row is fixed by the textbook dataset and can't be edited.";

// A1.1 → SCU-2.P4.11 (spec B2.1–B2.4, B2.8, B2.9, D2) — Customers on the
// shared DataTable, scalar models and JADE (per-product demand, `productMode`)
// alike: base and added rows are two sections under ONE toolbar (Upload ▾,
// Download ▾, "+ Add customer" modal, one FilterMenu above 10 rows on every
// model) and one pager. Every demand cell is a FormattedNumberInput (grouped,
// "Units" suffix, no aria-label); history read-only covers base, added and
// JADE rows; the Brazil lock (`!demandEditable`) stays base-only. The legacy
// `CustomerTable` is no longer rendered here (Studio.tsx still uses it).
export function CustomersTab({
  customers,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedCustomers = [],
  onAddedCustomersChange,
  onDeleteCustomer,
  precheckErrors = [],
  demandEditable = true,
  integerDemand = false,
  products = [],
  productOverrides = [],
  onProductOverridesChange,
  hasStateColumn = true,
  enableFilters = false,
  disabled = false,
  modelId,
  demandUnit = "units",
}: CustomersTabProps) {
  const files = useEntityFileMenus({
    entity: "customers",
    testIdEntity: "customers",
    modelId,
    scenarioId,
    onImportApplied,
    enableFilters,
  });
  const [adding, setAdding] = useState(false);
  // T11 (JADE) — per-product mode needs both the products AND the per-product override channel.
  const productMode = products.length > 0 && onProductOverridesChange != null;
  // JADE's base table always shows State (unchanged); scalar models follow hasStateColumn.
  const showState = productMode || hasStateColumn;

  function upsertScalar(id: string, patch: Partial<CustomerOverride>) {
    if (disabled) return;
    const existing = overrides.find(o => o.id === id);
    const merged: CustomerOverride = { id, status: existing?.status ?? "active", demand: existing?.demand, ...patch };
    const rest = overrides.filter(o => o.id !== id);
    onChange(merged.status === "active" && merged.demand == null ? rest : [...rest, merged]);
  }

  function upsertProduct(id: string, patch: Partial<CustomerProductOverride>) {
    if (disabled || !onProductOverridesChange) return;
    const existing = productOverrides.find(o => o.id === id);
    const merged: CustomerProductOverride = { id, status: existing?.status ?? "active", demands: existing?.demands, ...patch };
    const rest = productOverrides.filter(o => o.id !== id);
    const hasDemands = merged.demands != null && Object.keys(merged.demands).length > 0;
    onProductOverridesChange(merged.status === "active" && !hasDemands ? rest : [...rest, merged]);
  }

  /** JADE base per-product demand: null (emptied) deletes that product's override (D3). */
  function setProductDemand(customerId: string, productId: string, value: number | null) {
    const nextDemands = { ...(productOverrides.find(o => o.id === customerId)?.demands ?? {}) };
    if (value === null) delete nextDemands[productId];
    else nextDemands[productId] = value;
    upsertProduct(customerId, { demands: Object.keys(nextDemands).length ? nextDemands : undefined });
  }

  function upsertAdded(id: string, patch: (c: AddedCustomer) => AddedCustomer) {
    if (disabled) return;
    onAddedCustomersChange?.(addedCustomers.map(c => (c.id === id ? patch(c) : c)));
  }

  const rows: CustomerRow[] = [
    ...customers.map(c => {
      const scalar = overrides.find(o => o.id === c.id);
      const perProduct = productOverrides.find(o => o.id === c.id);
      const demands: Record<string, number> = {};
      for (const p of products) demands[p.id] = perProduct?.demands?.[p.id] ?? c.demands?.[p.id] ?? 0;
      return {
        id: c.id,
        displayId: c.id,
        city: c.city,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        zip: c.zip,
        demand: scalar?.demand ?? c.demand,
        demands,
        status: (productMode ? perProduct?.status : scalar?.status) ?? "active",
        added: false,
      };
    }),
    ...addedCustomers.map(c => ({
      id: c.id,
      displayId: c.displayCode ?? c.id,
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand: c.demand,
      demands: Object.fromEntries(products.map(p => [p.id, c.demands?.[p.id] ?? 0])),
      status: "active" as const,
      added: true,
    })),
  ];

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const idColumn = (added: boolean): ColumnDef<CustomerRow> => ({
    id: "id",
    header: "ID",
    kind: "text",
    filter: "text",
    value: r => r.displayId,
    cellClassName: "font-mono text-xs whitespace-nowrap min-w-[6rem]",
    cell: r => {
      if (!added) return r.displayId;
      const missing = completenessCountForCustomer(precheckErrors, r.id);
      const collision = idCollisionMessageForCustomer(precheckErrors, r.id);
      return (
        <div className="flex items-center gap-1">
          {r.displayId}
          {(missing > 0 || collision) && (
            <span
              title={
                collision ??
                `${missing} warehouse${missing === 1 ? " lacks" : "s lack"} a distance to this customer — see the Distances tab, or download/upload a template.`
              }
              data-testid={`warning-precheck-added-customer-${r.id}`}
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
  const locationColumns = (added: boolean): ColumnDef<CustomerRow>[] => [
    idColumn(added),
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    // Customers' State filter stays a TEXT filter (today's type), unlike Warehouses' select.
    ...((added ? hasStateColumn : showState)
      ? [
          {
            id: "state",
            header: "State",
            kind: "text",
            filter: "text",
            value: r => r.state || null,
            cellClassName: "text-xs",
            cell: r => r.state,
          } satisfies ColumnDef<CustomerRow>,
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

  // Base demand: history disables it; the Brazil lock disables it on BASE rows only.
  const baseDemandTitle = disabled ? READ_ONLY_TITLE : demandEditable ? undefined : BRAZIL_LOCK_TITLE;
  const demandColumns = (added: boolean): ColumnDef<CustomerRow>[] =>
    productMode
      ? products.map(p => ({
          // Descriptor key `demand:{productId}` is today's JADE filter key.
          id: `demand:${p.id}`,
          header: `${p.name} (${demandUnit})`,
          kind: "number" as const,
          value: (r: CustomerRow) => r.demands[p.id] ?? 0,
          cell: (r: CustomerRow) => (
            <DemandCell
              value={r.demands[p.id] ?? 0}
              clearCommits={!added}
              onCommit={v =>
                added
                  ? v !== null &&
                    upsertAdded(r.id, c => {
                      const demands = { ...(c.demands ?? {}), [p.id]: v };
                      return { ...c, demands, demand: Object.values(demands).reduce((sum, x) => sum + x, 0) };
                    })
                  : setProductDemand(r.id, p.id, v)
              }
              disabled={disabled}
              title={disabled ? READ_ONLY_TITLE : undefined}
              testId={added ? `input-added-customer-demand-${r.id}-${p.id}` : `input-customer-demand-${r.id}-${p.id}`}
            />
          ),
        }))
      : [
          {
            id: "demand",
            header: demandHeader(demandUnit),
            kind: "number",
            value: r => r.demand,
            cell: r => (
              <DemandCell
                integer={integerDemand}
                value={r.demand}
                clearCommits={!added}
                onCommit={v =>
                  added ? v !== null && upsertAdded(r.id, c => ({ ...c, demand: v })) : upsertScalar(r.id, { demand: v })
                }
                disabled={disabled || (!added && !demandEditable)}
                title={added ? (disabled ? READ_ONLY_TITLE : undefined) : baseDemandTitle}
                testId={added ? `input-added-customer-demand-${r.id}` : `input-customer-demand-${r.id}`}
              />
            ),
          },
        ];

  const hasZip = !productMode && customers.some(c => c.zip);
  const baseColumns: ColumnDef<CustomerRow>[] = [
    ...locationColumns(false),
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
          } satisfies ColumnDef<CustomerRow>,
        ]
      : []),
    ...demandColumns(false),
    {
      id: "status",
      header: "Status",
      kind: "enum",
      value: r => (r.status === "active" ? "Active" : "Excluded"),
      cell: r => (
        <StatusToggle
          options={CUSTOMER_STATUSES}
          value={r.status}
          labelOf={s => (s === "active" ? "Active" : "Excluded")}
          activeClassOf={customerStatusClass}
          onChange={status => (productMode ? upsertProduct(r.id, { status }) : upsertScalar(r.id, { status }))}
          disabled={disabled}
          testIdOf={s => `button-customer-${r.id}-${s}`}
        />
      ),
    },
  ];
  const addedColumns: ColumnDef<CustomerRow>[] = [
    ...locationColumns(true),
    ...demandColumns(true),
    {
      id: "delete",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added customer ${r.id}`}
          onClick={() => onDeleteCustomer?.(r.id)}
          disabled={disabled}
          testId={`button-delete-added-customer-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedCustomersChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-customer-row"
    >
      + Add customer
    </Button>
  );

  return (
    <div data-testid="customers-tab">
      <DataTable<CustomerRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        testIds={{
          toolbar: "customers-tab-toolbar",
          pagerPrev: "button-customers-prev",
          pagerNext: "button-customers-next",
          pageIndicator: "customers-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            // JADE's per-product base table keeps its wrapper testid.
            scrollTestId: productMode ? "customer-product-table" : undefined,
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
                No customers in this dataset.
              </p>
            ),
          },
          ...(onAddedCustomersChange != null
            ? [
                {
                  id: "added",
                  title: "Added customers",
                  testId: "added-customers-section",
                  includes: (r: CustomerRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: CustomerRow) => `row-added-customer-${r.id}`,
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-customers-empty">
                      No added customers yet — use "+ Add customer" above to create one.
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
          entityKind="customer"
          demandUnit={demandUnit}
          integerDemand={integerDemand}
          hasStateColumn={hasStateColumn}
          products={productMode ? products : undefined}
          existingCodes={addedCustomers.map(c => c.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "customer") onAddedCustomersChange?.([...addedCustomers, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
