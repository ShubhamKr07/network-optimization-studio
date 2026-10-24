import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SuperInputsLike, SuperTable } from "@/lib/superNetwork";
import type { Row } from "./superTables";
import { SUPER_ADD_FORMS, superAddDefaults, superAddFields, superAddOptions, validateSuperAdd } from "./superAddForms";

export interface SuperAddRowDialogProps {
  table: SuperTable;
  /** The whole draft, with this table's on-screen rows. */
  network: SuperInputsLike;
  onAdd(row: Row): void;
  onCancel(): void;
}

/** QFX-6 — one renderer for every super tab's "Add …" form, driven by SUPER_ADD_FORMS + the table's SPECS. */
export function SuperAddRowDialog({ table, network, onAdd, onCancel }: SuperAddRowDialogProps) {
  const [values, setValues] = useState(() => superAddDefaults(table, network));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const check = validateSuperAdd(table, values, network);
  const set = (key: string, v: string) => {
    setTouched(t => new Set(t).add(key));
    setValues(prev => {
      const next = { ...prev, [key]: v };
      // To depends on From: drop a To the new From cannot reach.
      if (key === "fromId" && !superAddOptions("toId", next, network).includes(next.toId)) next.toId = "";
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={o => !o && onCancel()}>
      <DialogContent data-testid="super-add-dialog">
        <DialogHeader>
          <DialogTitle>{SUPER_ADD_FORMS[table].label}</DialogTitle>
          <DialogDescription>Fields marked * are required. The row is added to your unsaved changes.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3 text-sm" onSubmit={e => { e.preventDefault(); if (check.row) onAdd(check.row); }}>
          {superAddFields(table).map(f => {
            const id = `super-add-${f.key}`;
            const err = touched.has(f.key) ? check.errors[f.key] : undefined;
            const common = { id, value: values[f.key] ?? "", "data-testid": id, "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-error` : undefined };
            const opts = f.spec.kind === "select" ? superAddOptions(f.key, values, network) : f.spec.kind === "status" ? f.spec.values : null;
            return (
              <div key={f.key} className="space-y-1">
                <label htmlFor={id} className="block text-xs font-medium">{f.label}{f.required ? " *" : ""}</label>
                {opts ? (
                  <select {...common} className="w-full h-8 border rounded pl-2 text-sm" onChange={e => set(f.key, e.target.value)}>
                    {f.spec.kind === "select" && <option value="">Select…</option>}
                    {opts.map(o => <option key={o} value={o}>{f.spec.kind === "status" ? o.replace("_", " ") : o}</option>)}
                  </select>
                ) : (
                  <Input {...common} className="h-8" inputMode={f.spec.kind === "number" ? "decimal" : undefined} onChange={e => set(f.key, e.target.value)} />
                )}
                {err && <p id={`${id}-error`} className="text-xs text-destructive" data-testid={`${id}-error`}>{err}</p>}
              </div>
            );
          })}
          {check.formError && <p className="col-span-2 text-xs text-destructive" data-testid="super-add-form-error">{check.formError}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel} data-testid="super-add-cancel">Cancel</Button>
            <Button type="submit" size="sm" disabled={!check.row} data-testid="super-add-confirm">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
