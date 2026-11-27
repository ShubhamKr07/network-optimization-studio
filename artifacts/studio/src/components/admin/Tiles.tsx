import type { ReactNode } from "react";
import type { AdminWatBotPeriod } from "@workspace/api-client-react";
import { delta, num, pct, rateOrDash, usd } from "@/lib/adminMetrics";

/** Neutral ink for every delta; olive only where it is an improvement. */
function Delta({ value, pts, better = 1 }: { value: number | null; pts?: boolean; better?: 1 | -1 }) {
  if (value == null) return <>no earlier data</>;
  const good = Math.abs(value) >= 0.5 && value * better > 0;
  return (
    <>
      <span className={good ? "text-primary" : "text-foreground/80"}>{value >= 0 ? "+" : "−"}{Math.abs(value).toFixed(pts ? 1 : 0)}{pts ? " pts" : "%"}</span> vs previous period
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[28px] font-semibold leading-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function Tiles({ period: p, prior }: { period: AdminWatBotPeriod; prior: AdminWatBotPeriod }) {
  const rate = rateOrDash(p.helped, p.ratings);
  const priorRate = rateOrDash(prior.helped, prior.ratings);
  const cpq = p.answered ? p.costUsd / p.answered : 0;
  const priorCpq = prior.answered ? prior.costUsd / prior.answered : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Questions answered" value={num(p.answered)} sub={<Delta value={delta(p.answered, prior.answered)} />} />
      <Tile label="Active students" value={num(p.activeStudents)} sub={<Delta value={delta(p.activeStudents, prior.activeStudents)} />} />
      <Tile label="Helped" value={rate == null ? "–" : pct(rate)}
        sub={rate == null ? `only ${p.ratings} rating${p.ratings === 1 ? "" : "s"}` : <>{num(p.ratings)} ratings · <Delta value={priorRate == null ? null : (rate - priorRate) * 100} pts /></>} />
      <Tile label="Cost per question" value={usd(cpq, 3)} sub={<Delta value={delta(cpq, priorCpq)} better={-1} />} />
    </div>
  );
}
