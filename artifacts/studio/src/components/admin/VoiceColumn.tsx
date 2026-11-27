import { useState } from "react";
import type { AdminFlaggedAnswers, AdminSiteFeedback } from "@workspace/api-client-react";
import { dayLabel, chicagoToday, MESSAGE_TYPE_LABEL, REASON } from "@/lib/adminMetrics";

export type VoiceTab = "all" | "flagged" | "site";
const reason = (r: string | null) => (r ? REASON[r] ?? r : "no reason given");
const tag = "rounded border border-input bg-card px-1.5 text-xs";

type Flagged = AdminFlaggedAnswers["items"][number];
type Site = AdminSiteFeedback["items"][number];

function FlaggedItem({ f, modelName }: { f: Flagged; modelName: (id: string) => string }) {
  return (
    <details className="mb-2.5 rounded-lg border border-border bg-card">
      <summary className="cursor-pointer rounded-lg p-3 hover:bg-secondary">
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {f.report && <span className={`${tag} border-foreground/50 text-foreground`}>Reported · {reason(f.report.reason)}</span>}
          {f.rating && <span className={`${tag} text-primary`}>Not helped · {reason(f.rating.reason)}</span>}
          <span>{modelName(f.modelId)} · {f.messageType ? MESSAGE_TYPE_LABEL[f.messageType] ?? f.messageType : "Unrecorded"} · {dayLabel(chicagoToday(new Date(f.at)))}</span>
        </span>
        <span className="mt-1.5 block font-serif text-base">{f.question == null ? "(question not found)" : `“${f.question}”`}</span>
        <span className="mt-1.5 block truncate text-[13px] text-muted-foreground">WatBot: {f.answer.text}</span>
      </summary>
      <div className="space-y-2.5 border-t border-border p-3">
        <Turn who="WatBot answered">
          {f.answer.text}{" "}
          {f.answer.citations.map((c) => <span key={c} className="mr-1 whitespace-nowrap rounded bg-secondary px-1.5 text-xs text-primary">{c}</span>)}
        </Turn>
        {f.rating?.note && <Turn who="Student's note">“{f.rating.note}”</Turn>}
        {f.report?.note && <Turn who="Student's report">“{f.report.note}”</Turn>}
        {f.reanswer.status === "answered" && f.reanswer.text && <Turn who="Re-answer">{f.reanswer.text}</Turn>}
        {f.reanswer.status === "not_completed" && <Turn who="Re-answer">Re-answer didn't finish</Turn>}
      </div>
    </details>
  );
}
const Turn = ({ who, children }: { who: string; children: React.ReactNode }) => (
  <div><div className="mb-0.5 text-xs text-muted-foreground">{who}</div><p className="font-serif text-[15px] leading-relaxed">{children}</p></div>
);

function SiteItem({ s }: { s: Site }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2.5 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={tag}>Site feedback</span>{dayLabel(chicagoToday(new Date(s.createdAt)))} · anonymous</div>
      <p className={`mt-1.5 font-serif text-base ${s.body.length > 160 && !open ? "line-clamp-3" : ""}`}>“{s.body}”</p>
      {s.body.length > 160 && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[13px] text-primary underline underline-offset-4">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function VoiceColumn({ flagged, site, tab, onTab, modelId, modelName, scope, failed, onRetry }: {
  flagged: AdminFlaggedAnswers | undefined; site: AdminSiteFeedback | undefined; tab: VoiceTab; onTab: (t: VoiceTab) => void;
  modelId: string; modelName: (id: string) => string; scope: string; failed: boolean; onRetry: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hit = (...t: Array<string | null | undefined>) => !needle || t.some((x) => x?.toLowerCase().includes(needle));
  const fl = (flagged?.items ?? []).filter((f) => hit(f.question, f.answer.text, f.rating?.note, f.report?.note, f.reanswer.text));
  const st = (site?.items ?? []).filter((s) => hit(s.body));
  const items = [
    ...(tab !== "site" ? fl.map((f) => ({ at: f.at, node: <FlaggedItem key={`f${f.at}-${f.modelId}-${f.answer.text.slice(0, 20)}`} f={f} modelName={modelName} /> })) : []),
    ...(tab !== "flagged" ? st.map((s) => ({ at: s.createdAt, node: <SiteItem key={`s${s.id}`} s={s} /> })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const tabs: Array<[VoiceTab, string, number]> = [["all", "All", fl.length + st.length], ["flagged", "Flagged answers", fl.length], ["site", "Site feedback", st.length]];
  return (
    <aside id="voice" aria-label="What students said" tabIndex={-1} className="min-w-0 border-t border-border bg-muted/40 px-5 py-4 min-[1100px]:border-l min-[1100px]:border-t-0">
      <div className="min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:flex min-[1100px]:max-h-[calc(100vh-6rem)] min-[1100px]:flex-col">
        <h2 className="font-serif text-xl font-semibold">What students said</h2>
        <p className="mb-2.5 text-xs text-muted-foreground">{scope}</p>
        <div role="tablist" aria-label="Kinds of feedback" className="mb-2.5 flex gap-0.5 border-b border-border">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => onTab(k)}
              className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] ${tab === k ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}>
              {label} <span className="font-normal tabular-nums text-muted-foreground">{n}</span>
            </button>
          ))}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search what students wrote" placeholder="Search what students wrote"
          className="mb-2.5 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px]" />
        {modelId && tab !== "flagged" && (
          <div className="mb-2.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">Site feedback has no chapter, so it shows for every chapter.</div>
        )}
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {failed ? (
            <div className="py-6 text-center text-[13px]">Couldn't load what students said. Try again. <button type="button" onClick={onRetry} className="ml-1 underline">Retry</button></div>
          ) : items.length ? (
            <>
              {items.map((i) => i.node)}
              {(flagged?.truncated || site?.truncated) && <p className="text-xs text-muted-foreground">Showing the newest items only; narrow the date range to see older ones.</p>}
            </>
          ) : <div className="py-6 text-center text-[13px] text-muted-foreground">{needle ? "Nothing matches that search in this range." : "Nothing in this range."}</div>}
        </div>
      </div>
    </aside>
  );
}
