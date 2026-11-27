import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";

export interface LineSeries {
  name: string;
  /** "olive" is the one data series; "grey" is context. No other colours exist (D7). */
  tone: "olive" | "grey";
  values: Array<number | null>;
  /** Observations behind each point; shown in the tooltip and the table. */
  n?: number[];
}
const TONE = { olive: "hsl(var(--chart-1))", grey: "hsl(var(--chart-5))" };

export function LineCard({ id, title, meta, xs, series, fmt, yMax, refLine, wide, xHead }: {
  id: string; title: string; meta?: string; xs: string[]; series: LineSeries[]; fmt: (v: number) => string;
  yMax?: number; refLine?: { y: number; label: string }; wide?: boolean; xHead: string;
}) {
  const data = xs.map((x, i) => {
    const row: Record<string, string | number | null> = { x };
    series.forEach((s, k) => { row[`v${k}`] = s.values[i]; row[`n${k}`] = s.n?.[i] ?? null; });
    return row;
  });
  const table = {
    cols: [xHead, ...series.flatMap((s) => (s.n ? [`${s.name} n`, s.name] : [s.name]))],
    rows: xs.map((x, i) => [x, ...series.flatMap((s) => {
      const v = s.values[i] == null ? "–" : fmt(s.values[i] as number);
      return s.n ? [String(s.n[i]), v] : [v];
    })]),
  };
  return (
    <ChartCard id={id} title={title} meta={meta} table={table} wide={wide} empty={series.every((s) => s.values.every((v) => v == null) && (s.n ?? []).every((n) => n === 0))}>
      <div style={{ width: "100%", height: 190 }}>
        <ResponsiveContainer>
          <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }} minTickGap={32} />
            <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }} tickFormatter={fmt} width={48} domain={[0, yMax ?? "auto"]} />
            {refLine && <ReferenceLine y={refLine.y} stroke="hsl(var(--chart-5))" label={{ value: refLine.label, fontSize: 11, position: "insideTopRight" }} />}
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
              <div className="rounded-lg border border-border bg-popover p-2 text-xs shadow-md">
                <div className="mb-1 text-muted-foreground">{label}</div>
                {series.map((s, k) => {
                  const p = payload[0]?.payload as Record<string, number | null>;
                  const v = p[`v${k}`];
                  return <div key={s.name} className="flex justify-between gap-3"><span>{s.name}{s.n ? ` (n = ${p[`n${k}`]})` : ""}</span><b>{v == null ? "–" : fmt(v)}</b></div>;
                })}
              </div>
            ) : null} />
            {series.map((s, k) => (
              <Line key={s.name} dataKey={`v${k}`} name={s.name} stroke={TONE[s.tone]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="mt-1.5 flex gap-3.5 text-xs text-muted-foreground">
          {series.map((s) => <span key={s.name}><i className="mr-1 inline-block h-0.5 w-3.5 align-middle" style={{ background: TONE[s.tone] }} />{s.name}</span>)}
        </div>
      )}
    </ChartCard>
  );
}
