import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import type { SuperTable } from "@/lib/superNetwork";
import { blankRow, isEntityTable, superColumns, superRowKey, type Item, type Row, type SuperOptions } from "./superTables";

export interface SuperTableTabProps {
  table: SuperTable;
  rows: Row[];
  onChange(rows: Row[]): void;
  /** Entity tables only: the caller confirms and cascades. Without it the row is just filtered out. */
  onDelete?(row: Row): void;
  readOnly: boolean;
  options?: SuperOptions;
}

export function SuperTableTab({ table, rows, onChange, onDelete, readOnly, options = {} }: SuperTableTabProps) {
  const items = useMemo<Item[]>(() => rows.map((r, i) => ({ r, i })), [rows]);
  const columns = superColumns(
    table, options, readOnly,
    (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r))),
    it => (isEntityTable(table) && onDelete ? onDelete(it.r) : onChange(rows.filter((_, j) => j !== it.i))),
  );
  return (
    <div data-testid={`super-tab-${table}`}>
      <DataTable
        rows={items}
        rowKey={it => String(it.i)}
        columns={columns}
        testIds={{ row: it => `super-row-${table}-${superRowKey(table, it.r)}`, empty: `super-${table}-empty` }}
        emptyState={<p className="text-sm text-muted-foreground p-4">No rows yet.</p>}
        toolbar={{
          add: (
            <Button size="sm" variant="outline" disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined}
              data-testid={`super-${table}-add`} onClick={() => onChange([...rows, blankRow(table, options)])}>
              + Add row
            </Button>
          ),
        }}
      />
    </div>
  );
}
