import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import type { SuperInputsLike, SuperTable } from "@/lib/superNetwork";
import { isEntityTable, superColumns, superRowKey, type Item, type Row, type SuperOptions } from "./superTables";
import { DownloadMenu, type DownloadFormat } from "@/components/data-table/DownloadMenu";
import { toast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/clientCsv";
import { describeWriteError } from "@/lib/describeWriteError";
import { superTableToFile } from "@/lib/superFiles";
import { SuperTableUploadDialog } from "./SuperTableUploadDialog";
import { SUPER_ADD_FORMS, superAddDisabledReason } from "./superAddForms";
import { SuperAddRowDialog } from "./SuperAddRowDialog";

const menuIds = (table: SuperTable, verb: "upload" | "download"): Record<DownloadFormat, string> =>
  ({ csv: `super-${table}-${verb}-csv`, json: `super-${table}-${verb}-json`, xlsx: `super-${table}-${verb}-xlsx` });

export interface SuperTableTabProps {
  table: SuperTable;
  rows: Row[];
  onChange(rows: Row[]): void;
  /** Entity tables only: the caller confirms and cascades. Without it the row is just filtered out. */
  onDelete?(row: Row): void;
  readOnly: boolean;
  options?: SuperOptions;
  /** The whole draft: location-ID uniqueness, the Add form's dropdown sources and the server limits read it.
   *  This table's own rows always come from `rows`. */
  network: SuperInputsLike;
}

export function SuperTableTab({ table, rows, onChange, onDelete, readOnly, options = {}, network }: SuperTableTabProps) {
  const items = useMemo<Item[]>(() => rows.map((r, i) => ({ r, i })), [rows]);
  const [adding, setAdding] = useState(false);
  const net = useMemo(() => ({ ...network, [table]: rows }) as SuperInputsLike, [network, table, rows]);
  const addBlocked = readOnly ? READ_ONLY_TITLE : superAddDisabledReason(table, net);
  const columns = superColumns(
    table, options, readOnly,
    (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r))),
    it => (isEntityTable(table) && onDelete ? onDelete(it.r) : onChange(rows.filter((_, j) => j !== it.i))),
  );
  // QFX-2b — per-table files. Upload writes only the draft (via onChange), through the Replace/Merge dialog.
  const [uploadFormat, setUploadFormat] = useState<DownloadFormat | null>(null);
  async function handleDownload(format: DownloadFormat) {
    try {
      const { blob, filename } = await superTableToFile(table, rows, format);
      downloadBlob(filename, blob, blob.type);
    } catch (err) {
      toast({ title: "Export failed", description: describeWriteError(err, "Could not export the table."), variant: "destructive" });
    }
  }
  return (
    <div data-testid={`super-tab-${table}`}>
      <DataTable
        rows={items}
        rowKey={it => String(it.i)}
        columns={columns}
        testIds={{ row: it => `super-row-${table}-${superRowKey(table, it.r)}`, empty: `super-${table}-empty` }}
        emptyState={<p className="text-sm text-muted-foreground p-4">No rows yet.</p>}
        toolbar={{
          upload: (
            <DownloadMenu label="Upload" testId={`super-${table}-upload`} itemTestIds={menuIds(table, "upload")}
              onDownload={setUploadFormat} disabledReason={readOnly ? READ_ONLY_TITLE : undefined} />
          ),
          download: (
            <DownloadMenu testId={`super-${table}-download`} itemTestIds={menuIds(table, "download")}
              onDownload={format => void handleDownload(format)} />
          ),
          add: (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={addBlocked !== null} title={addBlocked ?? undefined}
                data-testid={`super-${table}-add`} onClick={() => setAdding(true)}>
                {SUPER_ADD_FORMS[table].label}
              </Button>
              {addBlocked && !readOnly && <span className="text-xs text-muted-foreground" data-testid={`super-${table}-add-reason`}>{addBlocked}</span>}
            </span>
          ),
        }}
      />
      {adding && (
        <SuperAddRowDialog table={table} network={net}
          onAdd={row => { onChange([...rows, row]); setAdding(false); }}
          onCancel={() => setAdding(false)} />
      )}
      {uploadFormat && (
        <SuperTableUploadDialog table={table} format={uploadFormat} rows={rows} onApply={onChange} onClose={() => setUploadFormat(null)} />
      )}
    </div>
  );
}
