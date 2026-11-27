import { useState } from "react";
import { ChartCard } from "./ChartCard";
import { heatBins, num } from "@/lib/adminMetrics";

export function Heatmap({ rows, cols, counts }: { rows: string[]; cols: string[]; counts: number[][] }) {
  const [focus, setFocus] = useState<string | null>(null);
  const bins = heatBins(counts.flat());
  const empty = !counts.flat().some((v) => v > 0);
  return (
    <ChartCard id="heat" title="Chapter × message type" meta="Answered questions; see the key below"
      table={{ cols: ["Chapter", ...cols], rows: rows.map((r, i) => [r, ...counts[i].map(num)]) }} empty={empty}>
      <div role="group" aria-label="Questions by chapter and message type; stronger colour means more"
        className="grid gap-0.5" style={{ gridTemplateColumns: `minmax(64px,auto) repeat(${cols.length}, minmax(0,1fr))` }}>
        <span />
        {cols.map((c) => <span key={c} className="text-center text-[11px] text-muted-foreground">{c}</span>)}
        {rows.map((r, i) => (
          <div key={r} className="contents">
            <span className="self-center pr-2 text-[13px]">{r}</span>
            {cols.map((c, j) => {
              const b = bins[i * cols.length + j];
              return (
                <button key={c} type="button" aria-label={`${r}, ${c}: ${counts[i][j]} questions`}
                  onFocus={() => setFocus(`${r} · ${c}: ${num(counts[i][j])} questions`)} onBlur={() => setFocus(null)}
                  onMouseEnter={() => setFocus(`${r} · ${c}: ${num(counts[i][j])} questions`)} onMouseLeave={() => setFocus(null)}
                  className="h-8 rounded text-xs font-semibold tabular-nums hover:opacity-80"
                  style={b < 0 ? { background: "var(--surface-sunken)", color: "hsl(var(--muted-foreground))" } : { background: `var(--heat-${b})`, color: `var(--heat-ink-${b})` }}>
                  {num(counts[i][j])}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 min-h-4 text-xs text-foreground" role="status" aria-live="polite">{focus}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>None</span><i className="inline-block h-3 w-5 rounded-sm border border-border" style={{ background: "var(--surface-sunken)" }} />
        <span>· fewer</span>
        {[0, 1, 2, 3, 4].map((s) => <i key={s} className="inline-block h-3 w-5 rounded-sm" style={{ background: `var(--heat-${s})` }} />)}
        <span>more</span>
      </div>
    </ChartCard>
  );
}
