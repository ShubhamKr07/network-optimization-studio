// QFX-2b (spec decision L1) — apply one parsed per-table file to the DRAFT only: Replace the table or Merge (upsert by
// the server's key). Nothing is persisted here; the toolbar Save writes it through the normal whole-input PATCH.
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
import { FILE_ACCEPT } from "@/lib/clientCsv";
import { parseSuperTableFile, SUPER_TABLE_FILES, superRowKey, type TableKey, type TableParseResult } from "@/lib/superFiles";
import type { Row } from "./superTables";

/** A file row whose key exists overwrites that row in place; a new key is appended (file order); other rows are kept. */
export function mergeSuperRows(table: TableKey, existing: Row[], incoming: Row[]): Row[] {
  const byKey = new Map(incoming.map(r => [superRowKey(table, r), r]));
  const have = new Set(existing.map(r => superRowKey(table, r)));
  return [...existing.map(r => byKey.get(superRowKey(table, r)) ?? r), ...incoming.filter(r => !have.has(superRowKey(table, r)))];
}

export interface SuperTableUploadDialogProps {
  table: TableKey;
  format: DownloadFormat;
  /** The table's current draft rows. */
  rows: Row[];
  onApply(rows: Row[]): void;
  onClose(): void;
}

export function SuperTableUploadDialog({ table, format, rows, onApply, onClose }: SuperTableUploadDialogProps) {
  const [result, setResult] = useState<TableParseResult | null>(null);
  const selection = useRef(0); // a slower read from an older selection must not overwrite a newer one
  const file = SUPER_TABLE_FILES.find(t => t.key === table)!.file;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const mine = ++selection.current;
    setResult(null);
    const r = await parseSuperTableFile(table, f);
    if (mine === selection.current) setResult(r);
  }

  const parsed = result?.ok ? result.rows : null;
  const fileKeys = new Set((parsed ?? []).map(r => superRowKey(table, r)));
  const have = new Set(rows.map(r => superRowKey(table, r)));
  const updated = (parsed ?? []).filter(r => have.has(superRowKey(table, r))).length;
  const untouched = rows.filter(r => !fileKeys.has(superRowKey(table, r))).length;   // Replace removes them; Merge keeps them
  const apply = (next: Row[]) => { onApply(next); onClose(); };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="super-upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload {file} ({format.toUpperCase()})</DialogTitle>
          <DialogDescription>Changes apply to the unsaved draft. Press Save to keep them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <input type="file" accept={FILE_ACCEPT[format]} aria-label={`${file} file`} data-testid={`super-upload-file-${table}`}
            className="text-xs" onChange={e => void handleFile(e)} />
          {result && !result.ok && (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-upload-errors">
              {result.errors.map((x, i) => <li key={i}>{x.where}: {x.message}</li>)}
            </ul>
          )}
          {parsed && (
            <ul className="text-xs space-y-1">
              <li data-testid="super-upload-replace-count">Replace: {parsed.length} rows ({untouched} removed)</li>
              <li data-testid="super-upload-merge-count">Merge: {parsed.length - updated} added, {updated} updated, {untouched} kept</li>
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="super-upload-cancel">Cancel</Button>
          {parsed && (
            <>
              <Button variant="outline" onClick={() => apply(mergeSuperRows(table, rows, parsed))} data-testid="super-upload-merge">Merge</Button>
              <Button onClick={() => apply(parsed)} data-testid="super-upload-replace">Replace</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
