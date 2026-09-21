import { useState } from "react";
import type { Customer, Product, Scenario } from "@workspace/api-client-react";
import { CustomerTable, type CustomerOverride } from "@/components/tables/CustomerTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { useExport } from "@/contexts/ExportContext";
import {
  completenessCountForCustomer,
  idCollisionMessageForCustomer,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";
import { lookupCity } from "@/lib/gazetteer";
import { newUid, nextDisplayCode } from "@/lib/entityId";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";

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
  /** Chen's Cosmetics (chens-cosmetics-cn) has no state data — every row's `state` is "". Gate on DATA PRESENCE (Workspace.tsx computes this from the resolved dataset), not modelId — drops the State column from the base table and the Added-customers table, and drops the state-required check from the add-row form. Defaults true (every other model has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in gate for the shared
   * A3 `FilterMenu`/`useTableFilters`. Defaults `false` so every existing
   * caller (p-median-us, two-echelon-gold-au) is byte-identical to before
   * this task; the JADE Workspace path (INT, #9) supplies `true`. When
   * `false`, `useTableFilters` is still called (Rules of Hooks) but its
   * `filterState` can never become non-empty (no control is ever mounted to
   * set it), so `filteredRows === rows` always — zero behavior change. The
   * FilterMenu itself is additionally gated on the base table's unfiltered
   * row count `>10` (runtime rule, spec §10) — only the "Customers input"
   * base table is wired; the separate "Added customers" table isn't named
   * in spec §10's JADE table list. */
  enableFilters?: boolean;
  /** chen-bands-units follow-up (QA defect) — threaded straight through to
   * the base (non-JADE) `CustomerTable` only; JADE's own inline per-product
   * table (this component's `productMode` branch) has a separate,
   * analogous local-draft pattern (`productDrafts`) that this task does not
   * touch — out of the fix's authorized scope, flagged separately, not
   * silently left inconsistent. The "Added customers" section has no local
   * draft state of its own (reads straight off props) and isn't affected
   * either. Defaults false — every existing caller is unaffected. */
  disabled?: boolean;
}

// A1.1 — thin Workspace-tab wrapper around the existing CustomerTable (built
// for Studio.tsx's Overrides dialog, D3.1). Re-homed as-is, no fork.
//
// A1.3 — Upload/Download toolbar, wired to the existing ImportDialog
// (preview -> apply flow, reused as-is) and the existing exportScenario
// fetch function (via lib/exportEntity's shared download helper) — same
// components/flow Studio.tsx already uses, replicated here rather than
// rebuilt.
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
  products = [],
  productOverrides = [],
  onProductOverridesChange,
  hasStateColumn = true,
  enableFilters = false,
  disabled = false,
}: CustomersTabProps) {
  const [importOpen, setImportOpen] = useState(false);
  const { download, disabledReasonFor } = useExport();
  // T11 — the actual switch: per-product mode only renders when the caller
  // has ACTUALLY wired the full capability (data + callback), not merely
  // passed a non-empty `products` array with no override plumbing behind
  // it — same defensive posture as `onAddedCustomersChange != null` below.
  const productMode = products.length > 0 && onProductOverridesChange != null;

  function getProductOverride(id: string) {
    return productOverrides.find(o => o.id === id);
  }

  function upsertProductOverride(id: string, patch: Partial<CustomerProductOverride>) {
    if (!onProductOverridesChange) return;
    const existing = getProductOverride(id);
    const merged: CustomerProductOverride = {
      id,
      status: existing?.status ?? "active",
      demands: existing?.demands,
      ...patch,
    };
    const rest = productOverrides.filter(o => o.id !== id);
    const hasDemands = merged.demands != null && Object.keys(merged.demands).length > 0;
    const isNoOp = merged.status === "active" && !hasDemands;
    onProductOverridesChange(isNoOp ? rest : [...rest, merged]);
  }

  // Draft text per (customerId, productId) cell — same "decouple in-progress
  // keystroke from committed override" rationale as CustomerTable's own
  // `drafts` state.
  const [productDrafts, setProductDrafts] = useState<Record<string, string>>({});
  const [productErrors, setProductErrors] = useState<Record<string, string>>({});

  function handleProductDemandChange(customerId: string, productId: string, raw: string) {
    const key = `${customerId}:${productId}`;
    setProductDrafts(prev => ({ ...prev, [key]: raw }));
    const existing = getProductOverride(customerId);
    const nextDemands = { ...(existing?.demands ?? {}) };
    if (raw === "") {
      delete nextDemands[productId];
      setProductErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
      upsertProductOverride(customerId, { demands: Object.keys(nextDemands).length ? nextDemands : undefined });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setProductErrors(prev => ({ ...prev, [key]: "Demand must be ≥ 0" }));
      return;
    }
    setProductErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    nextDemands[productId] = parsed;
    upsertProductOverride(customerId, { demands: nextDemands });
  }

  // B5.2 — add-row form draft state, mirroring WarehousesTab.tsx/
  // DistancesTab.tsx's own addingRow/newX/addError pattern verbatim.
  const [addingRow, setAddingRow] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newDemand, setNewDemand] = useState("");
  const [newDisplayCode, setNewDisplayCode] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // T9 — grid-mirror: matches WarehousesTab.tsx's own T9 comment exactly —
  // `id` is now a hidden T3 stable uid minted at commit time (never typed),
  // `displayCode` is the human-facing label, auto-filled from City/State
  // via T2's gazetteer, same "touched" tracking as WarehousesTab.
  const [latTouched, setLatTouched] = useState(false);
  const [lngTouched, setLngTouched] = useState(false);
  const [displayCodeTouched, setDisplayCodeTouched] = useState(false);

  function touchLat() {
    if (!latTouched) {
      setLatTouched(true);
      setNewLat("");
    }
  }
  function touchLng() {
    if (!lngTouched) {
      setLngTouched(true);
      setNewLng("");
    }
  }
  function touchDisplayCode() {
    if (!displayCodeTouched) {
      setDisplayCodeTouched(true);
      setNewDisplayCode("");
    }
  }

  function handleCityStateBlur() {
    const city = newCity.trim();
    const state = newState.trim();
    if (!city || !state) return;
    const hit = lookupCity(city, state);
    if (!hit) return;
    if (!latTouched) setNewLat(String(hit.lat));
    if (!lngTouched) setNewLng(String(hit.lng));
    if (!displayCodeTouched) {
      const existingCodes = addedCustomers.map(c => c.displayCode).filter((c): c is string => !!c);
      setNewDisplayCode(nextDisplayCode("cs", state, city, existingCodes));
    }
  }

  function upsertAddedDemand(id: string, demand: number) {
    onAddedCustomersChange?.(addedCustomers.map(c => (c.id === id ? { ...c, demand } : c)));
  }

  // T11 — per-product equivalent of upsertAddedDemand, for an added
  // customer's row in the "Added customers" section under productMode.
  // Recomputes the scalar `demand` as the sum of `demands`' values on every
  // edit (see AddedCustomer's own header comment on why `demand` stays
  // required/kept-in-sync rather than made optional).
  function upsertAddedProductDemand(id: string, productId: string, value: number) {
    onAddedCustomersChange?.(
      addedCustomers.map(c => {
        if (c.id !== id) return c;
        const demands = { ...(c.demands ?? {}), [productId]: value };
        const demand = Object.values(demands).reduce((sum, v) => sum + v, 0);
        return { ...c, demands, demand };
      }),
    );
  }

  // T11 — add-row form's per-product demand drafts, keyed by product id.
  // Only populated/read when productMode is active; harmless empty object
  // otherwise.
  const [newProductDemands, setNewProductDemands] = useState<Record<string, string>>({});

  function resetAddForm() {
    setAddingRow(false);
    setNewCity("");
    setNewState("");
    setNewLat("");
    setNewLng("");
    setNewDemand("");
    setNewProductDemands({});
    setNewDisplayCode("");
    setLatTouched(false);
    setLngTouched(false);
    setDisplayCodeTouched(false);
    setAddError(null);
  }

  function handleAddRow() {
    const city = newCity.trim();
    const state = newState.trim();
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);

    if (!city || (hasStateColumn && !state)) {
      setAddError(hasStateColumn ? "City and state are both required." : "City is required.");
      return;
    }
    // T9 (team-lead decision) — displayCode is now the user-facing,
    // collision-checked field (the old "ID" input's role), since `id` is a
    // hidden uid that can't meaningfully collide. Mirrors WarehousesTab's
    // own T9 comment exactly.
    const displayCode = newDisplayCode.trim() || undefined;
    if (displayCode && addedCustomers.some(c => c.displayCode === displayCode)) {
      setAddError(`Display code '${displayCode}' is already in use by another customer in this scenario.`);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddError("Latitude and longitude must both be numbers.");
      return;
    }

    const id = newUid("cs");

    if (productMode) {
      // T11 — every product key is required on a JADE added customer
      // (matches `addedCustomerSchema.demands`, all 4 canonical product
      // ids); a blank cell defaults to 0 rather than blocking the add.
      const demands: Record<string, number> = {};
      for (const product of products) {
        const raw = (newProductDemands[product.id] ?? "").trim();
        if (raw === "") {
          demands[product.id] = 0;
          continue;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setAddError(`Demand for ${product.name} must be a number ≥ 0.`);
          return;
        }
        demands[product.id] = parsed;
      }
      const demand = Object.values(demands).reduce((sum, v) => sum + v, 0);
      onAddedCustomersChange?.([...addedCustomers, { id, city, state, lat, lng, demand, demands, displayCode }]);
      resetAddForm();
      return;
    }

    const demand = parseFloat(newDemand);
    if (!Number.isFinite(demand) || demand < 0) {
      setAddError("Demand must be a number ≥ 0.");
      return;
    }
    onAddedCustomersChange?.([...addedCustomers, { id, city, state, lat, lng, demand, displayCode }]);
    resetAddForm();
  }

  // B7 — descriptors for the BASE customers table only (spec §10's JADE
  // table list names "Customers input", not the separate "Added customers"
  // section). ID/City/(State) text; demand number — per-product columns
  // under productMode, a single scalar column otherwise. Built fresh every
  // render (not memoized) — same pattern as every other *Tab.tsx's inline
  // JSX, cheap at this table's row counts.
  const customerFilterDescriptors: ColumnFilterDescriptor<Customer>[] = [
    { key: "id", label: "ID", type: "text", accessor: c => c.id },
    { key: "city", label: "City", type: "text", accessor: c => c.city },
  ];
  if (hasStateColumn) {
    customerFilterDescriptors.push({ key: "state", label: "State", type: "text", accessor: c => c.state });
  }
  if (productMode) {
    for (const product of products) {
      customerFilterDescriptors.push({
        key: `demand:${product.id}`,
        label: product.name,
        type: "number",
        accessor: c => getProductOverride(c.id)?.demands?.[product.id] ?? c.demands?.[product.id] ?? 0,
      });
    }
  } else {
    customerFilterDescriptors.push({
      key: "demand",
      label: "Demand",
      type: "number",
      accessor: c => overrides.find(o => o.id === c.id)?.demand ?? c.demand,
    });
  }
  // Called unconditionally (Rules of Hooks). When `enableFilters` is false,
  // no `<FilterMenu>` is ever mounted, so `filterState` can never become
  // non-empty and `filteredRows` stays byte-identical to `customers` —
  // every existing (non-JADE) caller sees zero behavior change.
  const customerTableFilters = useTableFilters(customers, customerFilterDescriptors);
  const displayedCustomers = customerTableFilters.filteredRows;
  const showCustomerFilterMenu = enableFilters && customers.length > 10;

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="customers-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => download("customers", "csv")}
        disabled={disabledReasonFor("customers") != null}
        title={disabledReasonFor("customers")}
        data-testid="button-export-customers-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => download("customers", "json")}
        disabled={disabledReasonFor("customers") != null}
        title={disabledReasonFor("customers")}
        data-testid="button-export-customers-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-customers"
        className="h-7 text-xs"
      >
        <Upload className="w-3.5 h-3.5 mr-1" /> Upload
      </Button>
      {showCustomerFilterMenu && (
        <div className="ml-auto">
          <FilterMenu descriptors={customerFilterDescriptors} tableFilters={customerTableFilters} />
        </div>
      )}
    </div>
  );

  // Mounted only while actually open (not always-mounted-but-closed) —
  // ImportDialog calls its preview/apply mutation hooks unconditionally on
  // render, so keeping it out of the tree until the student clicks Upload
  // avoids firing those hooks (and needing a QueryClientProvider ancestor)
  // just from opening this tab. Mirrors Studio.tsx's own
  // `{importEntity && scenarioId && <ImportDialog .../>}` gating.
  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="customers"
      onApplied={onImportApplied}
      enableFilters={enableFilters}
    />
  );

  // B5.2 — the "Added customers" section (add-row form + delete/precheck per
  // row), mirroring WarehousesTab.tsx's own addedSection. Base dataset rows
  // (CustomerTable, above) keep their existing status-toggle-only
  // affordance untouched; only entries actually present in addedCustomers
  // ever get a delete button. No status column here — addedCustomerSchema
  // has no status field (see the AddedCustomer type comment above).
  //
  // Fix (code review) — gated on `onAddedCustomersChange != null`, mirroring
  // WarehousesTab's own `entity === "warehouses"` gate. CustomersTab has no
  // `entity` prop to key off (it's shared as-is by p-median-us AND
  // two-echelon-gold-au, unlike WarehousesTab's warehouses/refineries
  // split), so the added-entity capability itself — whether the caller
  // actually wired onAddedCustomersChange — is the correct signal:
  // Workspace.tsx already omits ALL THREE added-* props together for
  // two-echelon-gold-au (addedCustomers is a p-median-us-only field on
  // PMedianInputs), so this is equivalent to "only p-median-us" today
  // without hardcoding a model check here. Without this gate, two-echelon
  // rendered a live-looking "+ Add customer" button whose Add click called
  // an undefined onAddedCustomersChange (silently no-op'd) while
  // resetAddForm() still cleared the form unconditionally — the student saw
  // no error and nothing was added. Exactly this repo's most-documented
  // recurring bug class (CLAUDE.md's Rounds 1-5): a per-model gate added on
  // one branch (WarehousesTab) but not its sibling (CustomersTab).
  const addedSection = onAddedCustomersChange != null && (
    <div className="mt-4" data-testid="added-customers-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Added customers</h3>
      {addedCustomers.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-customers-empty">
          No added customers yet — use "+ Add customer" below to create one.
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto mb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>City</TableHead>
                {hasStateColumn && <TableHead>State</TableHead>}
                <TableHead>Latitude</TableHead>
                <TableHead>Longitude</TableHead>
                {productMode
                  ? products.map(p => <TableHead key={p.id}>{p.name}</TableHead>)
                  : <TableHead>Demand</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedCustomers.map(c => {
                const missing = completenessCountForCustomer(precheckErrors, c.id);
                const collision = idCollisionMessageForCustomer(precheckErrors, c.id);
                return (
                  <TableRow key={c.id} data-testid={`row-added-customer-${c.id}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {/* T9 — `id` is now a hidden T3 stable uid (see the
                          * grid-mirror comment above); `displayCode` is the
                          * human-facing label. Falls back to `id` only for
                          * pre-T9 data that never got one. */}
                        {c.displayCode ?? c.id}
                        {(missing > 0 || collision) && (
                          <span
                            title={collision ?? `${missing} warehouse${missing === 1 ? " lacks" : "s lack"} a distance to this customer — see the Distances tab, or download/upload a template.`}
                            data-testid={`warning-precheck-added-customer-${c.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{c.city}</TableCell>
                    {hasStateColumn && <TableCell className="text-xs">{c.state}</TableCell>}
                    <TableCell className="text-xs font-mono">{c.lat.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono">{c.lng.toFixed(4)}</TableCell>
                    {productMode ? (
                      products.map(p => (
                        <TableCell key={p.id}>
                          <Input
                            type="number"
                            min={0}
                            value={c.demands?.[p.id] ?? 0}
                            onChange={e => {
                              const parsed = Number(e.target.value);
                              if (Number.isFinite(parsed) && parsed >= 0) upsertAddedProductDemand(c.id, p.id, parsed);
                            }}
                            className="h-7 text-xs w-24 font-mono"
                            data-testid={`input-added-customer-demand-${c.id}-${p.id}`}
                          />
                        </TableCell>
                      ))
                    ) : (
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={c.demand}
                          onChange={e => {
                            const parsed = Number(e.target.value);
                            if (Number.isFinite(parsed) && parsed >= 0) upsertAddedDemand(c.id, parsed);
                          }}
                          className="h-7 text-xs w-28 font-mono"
                          data-testid={`input-added-customer-demand-${c.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Delete added customer ${c.id}`}
                        onClick={() => onDeleteCustomer?.(c.id)}
                        data-testid={`button-delete-added-customer-${c.id}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {addingRow ? (
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-customer-row-form">
          <Input
            placeholder="City"
            value={newCity}
            onChange={e => setNewCity(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-28"
            data-testid="input-new-customer-city"
          />
          {hasStateColumn && (
            <Input
              placeholder="State"
              value={newState}
              onChange={e => setNewState(e.target.value)}
              onBlur={handleCityStateBlur}
              className="h-7 text-xs w-16"
              data-testid="input-new-customer-state"
            />
          )}
          <Input
            type="number"
            placeholder="Lat"
            value={newLat}
            onChange={e => setNewLat(e.target.value)}
            onFocus={touchLat}
            className={`h-7 text-xs w-20 font-mono ${!latTouched && newLat ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-customer-lat"
          />
          <Input
            type="number"
            placeholder="Lng"
            value={newLng}
            onChange={e => setNewLng(e.target.value)}
            onFocus={touchLng}
            className={`h-7 text-xs w-20 font-mono ${!lngTouched && newLng ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-customer-lng"
          />
          <Input
            placeholder="Display code (auto)"
            value={newDisplayCode}
            onChange={e => setNewDisplayCode(e.target.value)}
            onFocus={touchDisplayCode}
            className={`h-7 text-xs w-32 ${!displayCodeTouched && newDisplayCode ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-customer-display-code"
          />
          {productMode ? (
            products.map(p => (
              <Input
                key={p.id}
                type="number"
                placeholder={p.name}
                value={newProductDemands[p.id] ?? ""}
                onChange={e => setNewProductDemands(prev => ({ ...prev, [p.id]: e.target.value }))}
                className="h-7 text-xs w-24 font-mono"
                data-testid={`input-new-customer-demand-${p.id}`}
              />
            ))
          ) : (
            <Input type="number" placeholder="Demand" value={newDemand} onChange={e => setNewDemand(e.target.value)} className="h-7 text-xs w-24 font-mono" data-testid="input-new-customer-demand" />
          )}
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-customer-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-customer-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-customer-row">
          + Add customer
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-customer-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (customers.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
          No customers in this dataset.
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="customers-tab">
      {toolbar}
      {productMode ? (
        <div className="max-h-[60vh] overflow-y-auto" data-testid="customer-product-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Latitude</TableHead>
                <TableHead>Longitude</TableHead>
                {products.map(p => <TableHead key={p.id}>{p.name}</TableHead>)}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedCustomers.map(c => {
                const o = getProductOverride(c.id);
                const status = o?.status ?? "active";
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.id}</TableCell>
                    <TableCell className="text-xs">{c.city}</TableCell>
                    <TableCell className="text-xs">{c.state}</TableCell>
                    <TableCell className="text-xs font-mono">{c.lat.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono">{c.lng.toFixed(4)}</TableCell>
                    {products.map(p => {
                      const key = `${c.id}:${p.id}`;
                      const baseValue = c.demands?.[p.id] ?? 0;
                      const overrideValue = o?.demands?.[p.id];
                      const error = productErrors[key];
                      return (
                        <TableCell key={p.id}>
                          <Input
                            type="number"
                            min={0}
                            value={productDrafts[key] ?? String(overrideValue ?? baseValue)}
                            onChange={e => handleProductDemandChange(c.id, p.id, e.target.value)}
                            className="h-7 text-xs w-24 font-mono"
                            data-testid={`input-customer-demand-${c.id}-${p.id}`}
                          />
                          {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
                        {(["active", "excluded"] as const).map(s => (
                          <button
                            key={s}
                            data-testid={`button-customer-${c.id}-${s}`}
                            onClick={() => upsertProductOverride(c.id, { status: s })}
                            className={`px-2 py-1 transition-colors whitespace-nowrap ${
                              status === s
                                ? s === "excluded" ? "bg-destructive text-white" : "bg-slate-200 text-foreground"
                                : "bg-white text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {s === "active" ? "Active" : "Excluded"}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <CustomerTable customers={displayedCustomers} overrides={overrides} onChange={onChange} demandEditable={demandEditable} hasStateColumn={hasStateColumn} disabled={disabled} />
      )}
      {addedSection}
      {importDialog}
    </div>
  );
}
