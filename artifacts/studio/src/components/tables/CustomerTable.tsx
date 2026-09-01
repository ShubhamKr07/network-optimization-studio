import { useState } from "react";
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
}

export function CustomerTable({ customers, overrides, onChange, demandEditable = true }: CustomerTableProps) {
  // Local draft text, keyed by customer id — decoupled from the committed
  // override so an in-progress invalid keystroke (e.g. typing "-5" one
  // character at a time) isn't snapped back to the last valid value before
  // the user finishes typing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

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
    setDrafts(prev => ({ ...prev, [id]: raw }));
    if (raw === "") {
      setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
      upsert(id, { demand: null });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrors(prev => ({ ...prev, [id]: "Demand must be ≥ 0" }));
      return;
    }
    setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    upsert(id, { demand: parsed });
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City</TableHead>
            <TableHead>State</TableHead>
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
                <TableCell className="text-xs">{c.state}</TableCell>
                <TableCell className="text-xs font-mono">{c.lat.toFixed(4)}</TableCell>
                <TableCell className="text-xs font-mono">{c.lng.toFixed(4)}</TableCell>
                {customers.some(x => x.zip) && <TableCell className="text-xs">{c.zip ?? "—"}</TableCell>}
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={drafts[c.id] ?? String(o?.demand ?? c.demand)}
                    onChange={e => handleDemandChange(c.id, e.target.value)}
                    disabled={!demandEditable}
                    title={demandEditable ? undefined : "Demand for this row is fixed by the textbook dataset and can't be edited."}
                    className="h-7 text-xs w-28"
                    data-testid={`input-customer-demand-${c.id}`}
                  />
                  {error && <p className="text-[10px] text-destructive mt-0.5" data-testid={`error-customer-demand-${c.id}`}>{error}</p>}
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
