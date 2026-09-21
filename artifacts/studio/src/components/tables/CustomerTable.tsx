import { useRef, useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }

interface CustomerRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; demand: number; }

interface CustomerTableProps {
  customers: CustomerRow[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
  /** T5 (Bundle 2, Step 2b) — the active model's `capabilities.demandEditable`.
   * false (p-median-brazil — textbook-fixed region demand) makes this row's
   * demand field read-only; status (Active/Excluded) stays editable
   * regardless. Defaults true — every other existing caller (p-median-us,
   * two-echelon-gold-au) is unaffected. Mirrors EditCustomerDialog.tsx's own
   * Step 1b gate on the Input Map side — same locked decision, second
   * surface. */
  demandEditable?: boolean;
  /** Chen's Cosmetics (chens-cosmetics-cn) has no state data — every row's `state` is "". Gates the State column on/off; defaults true (every existing caller has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** chen-bands-units follow-up (QA defect) — decision 1h says ordinary
   * editors are disabled while browsing result history; that was only true
   * at the write layer (Workspace.tsx's `updateInputsField` already no-ops
   * while `isBrowsingHistoryNow`), never surfaced visually here, so a
   * keystroke typed while browsing history looked like it "took" even
   * though nothing was ever persisted. `true` disables every demand input
   * outright (regardless of `demandEditable`) and ignores any in-progress
   * draft for display. Defaults false — every existing caller is
   * unaffected. */
  disabled?: boolean;
}

export function CustomerTable({ customers, overrides, onChange, demandEditable = true, hasStateColumn = true, disabled = false }: CustomerTableProps) {
  // Local draft text, keyed by customer id — decoupled from the committed
  // override so an in-progress invalid keystroke (e.g. typing "-5" one
  // character at a time) isn't snapped back to the last valid value before
  // the user finishes typing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  // chen-bands-units follow-up (QA defect) — per-id "what we last actually
  // committed" (as the exact string the display formula below would render
  // for it), recorded synchronously in handleDemandChange, NOT derived from
  // props. A draft is only ever cleared when the incoming effective value
  // diverges from this ref — i.e. from an EXTERNAL mutation of `overrides`
  // (Discard reverting to `savedInputsRef`, or a result-history step), never
  // from the user's own keystroke, because that keystroke's own commit is
  // exactly what set this ref to match. An id with no entry here has never
  // been committed by this component and is deliberately never
  // auto-cleared — otherwise a row's very first (still-invalid, e.g. "-5"
  // mid-type) keystroke would be wiped before the student finishes typing,
  // since there'd be nothing yet to compare the untouched baseline against.
  const lastCommittedRef = useRef<Record<string, string>>({});

  function upsert(id: string, patch: Partial<CustomerOverride>) {
    const existing = getOverride(id);
    const merged: CustomerOverride = {
      id,
      status: existing?.status ?? "active",
      demand: existing?.demand,
      ...patch,
    };
    const rest = overrides.filter(o => o.id !== id);
    const isNoOp = merged.status === "active" && merged.demand == null;
    onChange(isNoOp ? rest : [...rest, merged]);
  }

  function handleDemandChange(id: string, raw: string) {
    if (disabled) return;
    setDrafts(prev => ({ ...prev, [id]: raw }));
    if (raw === "") {
      setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
      upsert(id, { demand: null });
      // A cleared field always collapses to the row's textbook baseline
      // (see `upsert`'s isNoOp/getOverride('??') fallback) regardless of
      // status, so that's the effective value props will echo back.
      const c = customers.find(x => x.id === id);
      if (c) lastCommittedRef.current[id] = String(c.demand);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrors(prev => ({ ...prev, [id]: "Demand must be ≥ 0" }));
      return;
    }
    setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    upsert(id, { demand: parsed });
    lastCommittedRef.current[id] = String(parsed);
  }

  // React-sanctioned "adjust state during render in response to a prop
  // change" pattern (see useDistanceDraft.ts's own use of this same
  // pattern) — no effect, no extra paint. Runs once per divergence: after
  // the stale ids are cleared from `drafts`, the very next render finds
  // nothing left to compare against `lastCommittedRef`, so this can't loop.
  const staleDraftIds = Object.keys(drafts).filter(id => {
    const committed = lastCommittedRef.current[id];
    if (committed === undefined) return false;
    const c = customers.find(x => x.id === id);
    if (!c) return false;
    const effective = String(getOverride(id)?.demand ?? c.demand);
    return committed !== effective;
  });
  if (staleDraftIds.length > 0) {
    setDrafts(prev => {
      const next = { ...prev };
      for (const id of staleDraftIds) delete next[id];
      return next;
    });
    setErrors(prev => {
      const next = { ...prev };
      for (const id of staleDraftIds) delete next[id];
      return next;
    });
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City</TableHead>
            {hasStateColumn && <TableHead>State</TableHead>}
            <TableHead>Latitude</TableHead>
            <TableHead>Longitude</TableHead>
            {customers.some(c => c.zip) && <TableHead>Zip</TableHead>}
            <TableHead>Demand</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map(c => {
            const o = getOverride(c.id);
            const status = o?.status ?? "active";
            const error = errors[c.id];
            return (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">{c.id}</TableCell>
                <TableCell className="text-xs">{c.city}</TableCell>
                {hasStateColumn && <TableCell className="text-xs">{c.state}</TableCell>}
                <TableCell className="text-xs font-mono">{c.lat.toFixed(4)}</TableCell>
                <TableCell className="text-xs font-mono">{c.lng.toFixed(4)}</TableCell>
                {customers.some(x => x.zip) && <TableCell className="text-xs font-mono">{c.zip ?? "—"}</TableCell>}
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={disabled ? String(o?.demand ?? c.demand) : drafts[c.id] ?? String(o?.demand ?? c.demand)}
                    onChange={e => handleDemandChange(c.id, e.target.value)}
                    disabled={disabled || !demandEditable}
                    title={disabled ? "Read-only while browsing result history." : demandEditable ? undefined : "Demand for this row is fixed by the textbook dataset and can't be edited."}
                    className="h-7 text-xs w-28 font-mono"
                    data-testid={`input-customer-demand-${c.id}`}
                  />
                  {!disabled && error && <p className="text-[10px] text-destructive mt-0.5" data-testid={`error-customer-demand-${c.id}`}>{error}</p>}
                </TableCell>
                <TableCell>
                  <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
                    {(["active", "excluded"] as const).map(s => (
                      <button
                        key={s}
                        data-testid={`button-customer-${c.id}-${s}`}
                        onClick={() => upsert(c.id, { status: s })}
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
  );
}
