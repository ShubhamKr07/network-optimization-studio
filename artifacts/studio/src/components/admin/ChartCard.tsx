import { useState, type ReactNode } from "react";

export interface TableData { cols: string[]; rows: string[][] }

export function DataTable({ cols, rows }: TableData) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>{cols.map((c, i) => (
            <th key={c} className={`border-b border-border px-2 py-1.5 text-xs font-medium text-muted-foreground ${i ? "text-right" : "text-left"}`}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((v, i) => (
              <td key={i} className={`border-b border-border px-2 py-1.5 ${i ? "text-right" : ""}`}>{v}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card with a heading and a Table toggle that swaps the chart for the same rows as text (D7). */
export function ChartCard({ id, title, meta, table, wide, empty, children }: {
  id: string; title: string; meta?: string; table?: TableData; wide?: boolean; empty?: boolean; children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section aria-labelledby={`${id}-h`} className={`min-w-0 rounded-lg border border-border bg-card p-4 ${wide ? "col-span-full" : ""}`} data-testid={`card-${id}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <h3 id={`${id}-h`} className="text-[15px] font-semibold">{title}</h3>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
        {table && (
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}
            className="rounded-md border border-input px-2 py-0.5 text-xs text-muted-foreground hover:border-primary aria-pressed:border-primary aria-pressed:bg-secondary aria-pressed:text-foreground">
            Table
          </button>
        )}
      </div>
      {empty ? <div className="py-6 text-center text-[13px] text-muted-foreground">Nothing in this range.</div>
        : asTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}
