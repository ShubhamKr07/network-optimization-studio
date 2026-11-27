import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";

/** Category tick: truncated with the full label as an SVG tooltip. */
export function LabelTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const v = payload?.value ?? "";
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--chart-axis-label)">
      <title>{v}</title>{v.length > 22 ? `${v.slice(0, 21)}…` : v}
    </text>
  );
}

/** One olive series of [label, value]; horizontal for ranked lists, vertical for time. */
export function BarListCard({ id, title, meta, items, fmt, horizontal, valueHead, wide }: {
  id: string; title: string; meta?: string; items: Array<[string, number]>; fmt: (v: number) => string;
  horizontal?: boolean; valueHead: string; wide?: boolean;
}) {
  const data = items.map(([label, value]) => ({ label, value }));
  return (
    <ChartCard id={id} title={title} meta={meta} wide={wide}
      table={{ cols: [horizontal ? "Item" : "Period", valueHead], rows: items.map(([l, v]) => [l, fmt(v)]) }}
      empty={!items.some(([, v]) => v > 0)}>
      <div style={{ width: "100%", height: horizontal ? items.length * 30 + 12 : 190 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={!horizontal} vertical={!!horizontal} stroke="var(--chart-grid)" />
            {/* axes are direct children: Recharts 2 silently drops axes wrapped in a Fragment */}
            {horizontal && <XAxis type="number" tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }} tickFormatter={fmt} />}
            {horizontal && <YAxis type="category" dataKey="label" width={150} interval={0} tick={<LabelTick />} />}
            {!horizontal && <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }} minTickGap={24} />}
            {!horizontal && <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis-label)" }} tickFormatter={fmt} width={48} />}
            <Tooltip cursor={{ fill: "hsl(var(--muted))" }} content={({ active, payload }) => active && payload?.length ? (
              <div className="rounded-lg border border-border bg-popover p-2 text-xs shadow-md">
                <div className="text-muted-foreground">{payload[0].payload.label}</div>
                <b>{fmt(payload[0].payload.value)}</b>
              </div>
            ) : null} />
            <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={3} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
