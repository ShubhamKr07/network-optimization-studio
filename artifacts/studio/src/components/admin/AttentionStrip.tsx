import { AlertTriangle, Check } from "lucide-react";
import type { AdminWatBotMetrics } from "@workspace/api-client-react";
import { pct, rateOrDash, usd } from "@/lib/adminMetrics";

const FAIL_LIMIT = 0.04;
const chip = "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px]";

export function AttentionStrip({ m, to, weekAgo, windowLabel, flaggedThisWeek, siteThisWeek, voiceCount, onTab, onVoice }: {
  m: AdminWatBotMetrics; to: string; weekAgo: string; windowLabel: string; flaggedThisWeek: number; siteThisWeek: number; voiceCount: number;
  onTab: (t: "cost" | "reliability") => void; onVoice: (v: "flagged" | "site") => void;
}) {
  const { spendUsd, capUsd, month } = m.monthToDate;
  const share = capUsd ? spendUsd / capUsd : 0;
  const hot = share >= 0.8;
  const last7 = m.days.filter((d) => d.date >= weekAgo && d.date <= to);
  const asked = last7.reduce((a, d) => a + d.asked, 0);
  const bad = last7.reduce((a, d) => a + d.cancelled + d.unavailable + d.limitReached, 0);
  const fail = rateOrDash(bad, asked);
  const failHot = fail != null && fail > FAIL_LIMIT;
  const ok = "border-input bg-card hover:border-primary";
  const warn = "border-warning-border bg-warning-bg text-warning";
  return (
    <div role="group" className="mb-4 flex flex-wrap gap-2" aria-label="Needs attention">
      <button type="button" className={`${chip} ${hot ? warn : ok}`} onClick={() => onTab("cost")}>
        {hot ? <AlertTriangle size={16} aria-hidden /> : <Check size={16} aria-hidden />}
        <span>Spend {usd(spendUsd)} of the {usd(capUsd, 0)} cap, UTC month {month} ({pct(share)}){hot ? " · near the cap" : " · normal"}</span>
      </button>
      <button type="button" className={`${chip} ${failHot ? warn : ok}`} onClick={() => onTab("reliability")}>
        {failHot ? <AlertTriangle size={16} aria-hidden /> : <Check size={16} aria-hidden />}
        <span>Not answered, {windowLabel}: {fail == null ? "–" : pct(fail)} (n = {asked}){failHot ? " · above 4%" : fail == null ? "" : " · normal"}</span>
      </button>
      <button type="button" className={`${chip} ${ok}`} onClick={() => onVoice("flagged")}>
        <b className="tabular-nums">{flaggedThisWeek}</b> flagged answer{flaggedThisWeek === 1 ? "" : "s"}, {windowLabel}
      </button>
      <button type="button" className={`${chip} ${ok}`} onClick={() => onVoice("site")}>
        <b className="tabular-nums">{siteThisWeek}</b> site feedback message{siteThisWeek === 1 ? "" : "s"}, {windowLabel}
      </button>
      <a href="#voice" className={`${chip} ${ok} min-[1100px]:hidden`}>Read what students said <b className="tabular-nums">({voiceCount})</b></a>
    </div>
  );
}
