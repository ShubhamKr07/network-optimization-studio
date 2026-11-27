import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  type AdminWatBotMetrics,
  getGetAdminFeedbackQueryKey, getGetAdminWatBotFlaggedQueryKey, getGetAdminWatBotMetricsQueryKey,
  useGetAdminFeedback, useGetAdminWatBotFlagged, useGetAdminWatBotMetrics, useListModels,
} from "@workspace/api-client-react";
import { AttentionStrip } from "@/components/admin/AttentionStrip";
import { BarListCard } from "@/components/admin/BarListCard";
import { ChartCard, DataTable } from "@/components/admin/ChartCard";
import { Heatmap } from "@/components/admin/Heatmap";
import { LineCard } from "@/components/admin/LineCard";
import { Tiles } from "@/components/admin/Tiles";
import { VoiceColumn, type VoiceTab } from "@/components/admin/VoiceColumn";
import {
  addDays, cacheShare, chicagoToday, isIsoDate, REASON, dayLabel, MESSAGE_TYPE_LABEL, num, pct, presetRange, rateOrDash, UNRECORDED, usd, weekly,
} from "@/lib/adminMetrics";

type Preset = 7 | 30 | 90 | "custom";
type Tab = "usage" | "quality" | "cost" | "reliability";
const TABS: Array<[Tab, string]> = [["usage", "Usage"], ["quality", "Quality"], ["cost", "Cost"], ["reliability", "Reliability"]];
const KNOWN_TYPES = Object.keys(MESSAGE_TYPE_LABEL);
const keep = { placeholderData: keepPreviousData };
const seg = "rounded-md border border-input px-3 py-1 text-[13px] aria-pressed:border-primary aria-pressed:bg-secondary aria-pressed:font-semibold";

export function AdminDashboard() {
  const today = chicagoToday();
  const [preset, setPreset] = useState<Preset>(30);
  const [custom, setCustom] = useState({ from: addDays(today, -13), to: today });
  const [modelId, setModelId] = useState("");
  const [tab, setTab] = useState<Tab>("usage");
  const [vtab, setVtab] = useState<VoiceTab>("all");

  const { from, to } = preset === "custom" ? custom : presetRange(preset);
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to && to <= today && addDays(from, 89) >= to;
  const base = { from, to };
  const withModel = modelId ? { ...base, modelId } : base;
  const opts = (queryKey: readonly unknown[]) => ({ query: { queryKey, enabled: valid, ...keep } });
  const metrics = useGetAdminWatBotMetrics(withModel, opts(getGetAdminWatBotMetricsQueryKey(withModel)));
  const flagged = useGetAdminWatBotFlagged(withModel, opts(getGetAdminWatBotFlaggedQueryKey(withModel)));
  const site = useGetAdminFeedback(base, opts(getGetAdminFeedbackQueryKey(base)));
  const { data: models } = useListModels();
  const modelName = (id: string) => models?.find((m) => m.id === id)?.name ?? id;

  const m = metrics.data;
  // The three 7-day chips are anchored to the range end, [to-6, to] (Chicago dates).
  const weekAgo = valid ? addDays(to, -6) : "";
  const inWeek = (iso: string) => { const d = chicagoToday(new Date(iso)); return d >= weekAgo && d <= to; };
  const flaggedThisWeek = (flagged.data?.items ?? []).filter((f) => inWeek(f.at)).length;
  const siteThisWeek = (site.data?.items ?? []).filter((s) => inWeek(s.createdAt)).length;
  const voiceCount = (flagged.data?.items.length ?? 0) + (site.data?.items.length ?? 0);
  const scope = !valid ? "" : `${dayLabel(from)} – ${dayLabel(to)} · ${modelId ? modelName(modelId) : "all chapters"} · same filters as the charts`;

  return (
    <div data-testid="admin-dashboard">
      <div role="region" aria-label="Filters" className="flex flex-wrap items-center gap-2.5 border-b border-border bg-card px-7 py-3">
        <Link href="/" data-testid="link-back-to-labs" className="inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to labs
        </Link>
        <h1 className="mr-2 text-base font-semibold">Admin · WatBot and feedback</h1>
        <div role="group" aria-label="Date range" className="flex gap-1">
          {([7, 30, 90, "custom"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} className={seg} onClick={() => setPreset(p)}>{p === "custom" ? "Custom" : `${p} days`}</button>
          ))}
        </div>
        {preset === "custom" && (
          <span className="flex items-center gap-1.5 text-[13px]">
            <label>From <input type="date" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="rounded-md border border-input bg-card px-2 py-1" /></label>
            <label>to <input type="date" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="rounded-md border border-input bg-card px-2 py-1" /></label>
          </span>
        )}
        <label className="max-w-full text-[13px]">Chapter{" "}
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-auto max-w-[min(100%,16rem)] rounded-md py-1">
            <option value="">All chapters</option>
            {(models ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">Days in US Central time · today is {dayLabel(today)}</span>
      </div>
      {!valid && <p className="px-7 pt-4 text-[13px]" role="alert">Pick a range of at most 90 days that ends today or earlier.</p>}

      <div className="grid min-[1100px]:grid-cols-[minmax(0,1fr)_440px]">
        <main className="min-w-0 px-7 pb-10 pt-4" style={{ opacity: metrics.isPlaceholderData ? 0.6 : 1 }} aria-busy={metrics.isPlaceholderData}>
          {metrics.isError ? (
            <div className="py-10 text-center text-sm">Couldn't load the dashboard. Try again. <button type="button" className="ml-1 underline" onClick={() => void metrics.refetch()}>Retry</button></div>
          ) : !m ? (
            valid && <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <AttentionStrip m={m} to={to} windowLabel={to === today ? "last 7 days" : `7 days to ${dayLabel(to)}`} weekAgo={weekAgo} flaggedThisWeek={flaggedThisWeek} siteThisWeek={siteThisWeek} voiceCount={voiceCount}
                onTab={setTab} onVoice={setVtab} />
              <Tiles period={m.period} prior={m.prior} />
              <div role="tablist" aria-label="Metric groups" className="mb-3.5 mt-5 flex gap-0.5 border-b border-border">
                {TABS.map(([k, label]) => (
                  <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-3.5 py-2 text-sm ${tab === k ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}>{label}</button>
                ))}
              </div>
              <div role="tabpanel" className="grid gap-3 md:grid-cols-2"><Panel tab={tab} m={m} modelName={modelName} /></div>
            </>
          )}
        </main>
        <VoiceColumn flagged={flagged.data} site={site.data} tab={vtab} onTab={setVtab} modelId={modelId} modelName={modelName} scope={scope}
          failed={flagged.isError || site.isError} onRetry={() => { void flagged.refetch(); void site.refetch(); }} />
      </div>
    </div>
  );
}

function Panel({ tab, m, modelName }: { tab: Tab; m: AdminWatBotMetrics; modelName: (id: string) => string }) {
  const { days, period: p } = m;
  const xs = days.map((d) => dayLabel(d.date));
  const weeks = weekly(days, ["answered", "ratings", "helped", "notices", "costUsd"]);
  const wx = weeks.map((w) => `Week of ${dayLabel(w.weekStart)}`);
  const sum = (k: "cancelled" | "unavailable" | "limitReached" | "asked" | "answered" | "refused" | "stopped" | "estimated") => days.reduce((a, d) => a + d[k], 0);

  if (tab === "usage") {
    const types = [...KNOWN_TYPES, ...(m.matrix.some((c) => c.messageType == null) ? [null] : [])];
    const rows = [...new Set(m.matrix.map((c) => c.modelId))];
    const counts = rows.map((r) => types.map((t) => m.matrix.filter((c) => c.modelId === r && c.messageType === t).reduce((a, c) => a + c.answered, 0)));
    return <>
      <LineCard id="u1" title="Questions per day" meta="Answered questions" xHead="Day" xs={xs} fmt={num} series={[{ name: "Questions", tone: "olive", values: days.map((d) => d.answered) }]} />
      <Heatmap rows={rows.map(modelName)} cols={types.map((t) => (t ? MESSAGE_TYPE_LABEL[t] : UNRECORDED))} counts={counts} />
      <BarListCard id="u3" title="Sessions per week" valueHead="Sessions" horizontal={false} fmt={num}
        meta={`Median ${Math.round(p.sessionMedianMinutes)} min · ${+p.sessionMedianQuestions.toFixed(1)} question${p.sessionMedianQuestions === 1 ? "" : "s"} per session · sessions crossing the range edge are cut`}
        items={m.sessionsByWeek.map((w) => [dayLabel(w.weekStart), w.sessions])} />
      <BarListCard id="u4" title="Students per chapter" meta="Asked at least one question" valueHead="Students" horizontal fmt={num}
        items={p.studentsByModel.map((s) => [modelName(s.modelId), s.students])} />
    </>;
  }
  if (tab === "quality") {
    const helped = weeks.map((w) => rateOrDash(w.helped, w.ratings));
    const notice = weeks.map((w) => rateOrDash(w.notices, w.answered));
    return <>
      <LineCard id="q1" title="Helped rate by week" meta="Weeks with fewer than 5 ratings show no value" xHead="Week" xs={wx} fmt={pct} yMax={1}
        series={[{ name: "Helped", tone: "olive", values: helped, n: weeks.map((w) => w.ratings) }]} />
      <BarListCard id="q2" title="Why answers didn't help" valueHead="Ratings" horizontal fmt={num}
        meta={`${num(p.ratings - p.helped)} not-helped ratings · ${num(p.reanswered)} re-answered`}
        items={p.notHelpedByReason.map((r) => [REASON[r.reason] ?? r.reason, r.count])} />
      <LineCard id="q3" title="Answers with a removed part" meta="Share showing the drop notice, by week; under 5 answers shows no value" xHead="Week" xs={wx} fmt={pct} yMax={1}
        series={[{ name: "Drop notice", tone: "olive", values: notice, n: weeks.map((w) => w.answered) }]} />
      <BarListCard id="q4" title="Reports by reason" valueHead="Reports" horizontal fmt={num}
        meta={`${num(p.reportsByReason.reduce((a, r) => a + r.count, 0))} reports`}
        items={p.reportsByReason.map((r) => [REASON[r.reason] ?? r.reason, r.count])} />
      <ChartCard id="q5" title="Coverage gaps" meta="Logged when a question falls outside the course materials" wide empty={!p.gapTopics.length}>
        <DataTable cols={["Topic WatBot couldn't find in the course", "Nearest covered topic", "Times asked"]}
          rows={p.gapTopics.map((g) => [g.topic, g.nearestCovered ?? "–", num(g.count)])} />
      </ChartCard>
    </>;
  }
  if (tab === "cost") {
    const { spendUsd, capUsd, month } = m.monthToDate;
    const share = capUsd ? spendUsd / capUsd : 0;
    const hot = share >= 0.8;
    const cpq = weeks.map((w) => (w.answered ? w.costUsd / w.answered : null));
    return <>
      <BarListCard id="c1" title="Spend per day" meta="Model cost of answered questions" valueHead="Spend" horizontal={false} fmt={(v) => usd(v)}
        items={days.map((d, i) => [xs[i], d.costUsd])} />
      <ChartCard id="c2" title={`UTC month ${month} so far`} meta="Month to date against the monthly cap (all chapters)">
        <div className="text-[28px] font-semibold tabular-nums">{usd(spendUsd)} of {usd(capUsd, 0)}</div>
        <div role="meter" aria-valuemin={0} aria-valuemax={capUsd} aria-valuenow={spendUsd} aria-label="Spend against cap"
          className="my-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full" style={{ width: `${Math.min(100, share * 100)}%`, background: hot ? "var(--warning)" : "hsl(var(--chart-1))" }} />
        </div>
        <div className="text-[13px]">{hot ? `Near the cap: ${pct(share)} used.` : `${pct(share)} of the cap used.`}</div>
      </ChartCard>
      <LineCard id="c3" title="Cost per question by week" xHead="Week" xs={wx} fmt={(v) => usd(v, 3)} series={[{ name: "Cost per question", tone: "olive", values: cpq }]} />
      <ChartCard id="c4" title="Tokens" meta={`Cache reads cover ${pct(cacheShare(p.tokens))} of input`}>
        <DataTable cols={["Kind", "Tokens"]} rows={[["Input", num(p.tokens.input)], ["Output", num(p.tokens.output)], ["Cache read", num(p.tokens.cacheRead)], ["Cache write", num(p.tokens.cacheWrite)]]} />
      </ChartCard>
    </>;
  }
  const secs = (v: number | null) => (v == null ? null : v / 1000);
  const failed = days.map((d) => rateOrDash(d.cancelled + d.unavailable + d.limitReached, d.asked));
  const outcomes: Array<[string, number]> = [
    ["Answered", sum("answered")], ["Cancelled by the student", sum("cancelled")], ["Unavailable (provider failed)", sum("unavailable")],
    ["Limit reached", sum("limitReached")], ["Total asked", sum("asked")], ["Of answered: refused by the model", sum("refused")],
    ["Of answered: stopped mid-answer", sum("stopped")], ["Of answered: usage estimated", sum("estimated")],
  ];
  return <>
    <LineCard id="r1" wide title="Time to answer" meta="Slowest 5% and median, seconds" xHead="Day" xs={xs} fmt={(v) => `${v.toFixed(1)} s`}
      series={[{ name: "Slowest 5%", tone: "olive", values: days.map((d) => secs(d.latencyP95Ms)) }, { name: "Median", tone: "grey", values: days.map((d) => secs(d.latencyMedianMs)) }]} />
    <LineCard id="r2" title="Questions not answered" meta="Share per day; under 5 questions shows no value" xHead="Day" xs={xs} fmt={pct}
      refLine={{ y: 0.04, label: "Attention at 4%" }} yMax={Math.max(0.05, ...failed.map((v) => v ?? 0))}
      series={[{ name: "Not answered", tone: "olive", values: failed, n: days.map((d) => d.asked) }]} />
    <ChartCard id="r3" title="Outcomes" meta={`${num(sum("asked"))} questions asked; the first four rows add up to it`}>
      <DataTable cols={["Outcome", "Questions"]} rows={outcomes.map(([k, v]) => [k, num(v)])} />
    </ChartCard>
  </>;
}
