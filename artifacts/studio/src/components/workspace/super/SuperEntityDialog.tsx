import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LocKind, LocationDraft } from "@/lib/superNetwork";

const LABEL: Record<LocKind, string> = { pl: "plant", wh: "warehouse", cs: "customer" };
const STATUS: Partial<Record<LocKind, string[]>> = { wh: ["active", "forced_open", "inactive"], cs: ["active", "excluded"] };

export interface SuperEntityDialogProps {
  mode: "create" | "edit"; kind: LocKind; initial: LocationDraft; initialDemand: Record<string, number>;
  products: { id: string; name: string }[]; takenIds: Set<string>;
  onSubmit(row: LocationDraft, demand: Record<string, number>): void; onCancel(): void;
}

export function SuperEntityDialog(p: SuperEntityDialogProps) {
  const [row, setRow] = useState<LocationDraft>(p.initial);
  const [demand, setDemand] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(p.initialDemand).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof LocationDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setRow(r => ({ ...r, [k]: e.target.value }));

  function submit() {
    const id = row.id.trim(), name = row.name.trim();
    if (!id) return setError("ID is required.");
    if (p.mode === "create" && p.takenIds.has(id)) return setError(`ID "${id}" is already used by a plant, warehouse or customer.`);
    if (!name) return setError("Name is required.");
    const out: Record<string, number> = {};
    for (const k of p.products) {
      const raw = (demand[k.id] ?? "").trim();
      if (raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return setError(`Demand for ${k.name} must be a number ≥ 0.`);
      if (v > 0) out[k.id] = v;
    }
    p.onSubmit({ ...row, id, name, city: row.city?.trim() || undefined, state: row.state?.trim() || undefined }, out);
  }

  return (
    <Dialog open onOpenChange={o => !o && p.onCancel()}>
      <DialogContent data-testid="super-entity-dialog">
        <DialogHeader><DialogTitle>{p.mode === "create" ? `New ${LABEL[p.kind]}` : `Edit ${LABEL[p.kind]} ${p.initial.id}`}</DialogTitle><DialogDescription>Enter the {LABEL[p.kind]} details.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>ID<input className="w-full border rounded px-2 h-8" data-testid="super-entity-id" value={row.id} readOnly={p.mode === "edit"} onChange={set("id")} /></label>
          <label>Name<input className="w-full border rounded px-2 h-8" data-testid="super-entity-name" value={row.name} onChange={set("name")} /></label>
          <label>City<input className="w-full border rounded px-2 h-8" data-testid="super-entity-city" value={row.city ?? ""} onChange={set("city")} /></label>
          <label>State<input className="w-full border rounded px-2 h-8" data-testid="super-entity-state" value={row.state ?? ""} onChange={set("state")} /></label>
          {STATUS[p.kind] && (
            <label>Status<select className="w-full border rounded pl-2 h-8" data-testid="super-entity-status" value={row.status ?? "active"} onChange={set("status")}>
              {STATUS[p.kind]!.map(s => <option key={s} value={s}>{s}</option>)}
            </select></label>
          )}
          {p.kind === "cs" && p.products.map(k => (
            <label key={k.id}>Demand — {k.name}<input type="number" min={0} className="w-full border rounded px-2 h-8" data-testid={`super-entity-demand-${k.id}`}
              value={demand[k.id] ?? ""} onChange={e => setDemand(d => ({ ...d, [k.id]: e.target.value }))} /></label>
          ))}
        </div>
        {error && <p className="text-xs text-destructive" data-testid="super-entity-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={p.onCancel} data-testid="super-entity-cancel">Cancel</Button>
          <Button size="sm" onClick={submit} data-testid="super-entity-submit">{p.mode === "create" ? "Add" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
