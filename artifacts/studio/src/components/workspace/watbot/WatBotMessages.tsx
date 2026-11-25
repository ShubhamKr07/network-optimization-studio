import { Fragment, lazy, Suspense, useState } from "react";
import { BookOpen, Flag } from "lucide-react";
import { useGetWatBotPassage, getGetWatBotPassageQueryKey, type WatBotCitation } from "@workspace/api-client-react";
import type { ChatItem, Pending } from "./useWatBotConversation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WatBotReportForm } from "./WatBotReportForm";
import { WatBotFeedback } from "./WatBotFeedback";
import { citationSegments } from "./citationHighlight";
import { SentryErrorBoundary } from "@/lib/errorTracking";

const MathText = lazy(() => import("./MathText"));
// A failed chunk load (a tab open across a deploy) or a KaTeX throw is reported and shows the raw
// text here, instead of reaching main.tsx's app-level boundary, which replaces the whole app.
// Same test as MathText: $$, or a $ followed by a \command (kept here so KaTeX stays lazy).
const withMath = (text: string) => /\$\$|\$\\[a-zA-Z]/.test(text)
  ? <SentryErrorBoundary fallback={<>{text}</>}><Suspense fallback={text}><MathText text={text} /></Suspense></SentryErrorBoundary>
  : text;

export function WatBotMessages({ items, pending, onStop, feedback }: {
  items: ChatItem[]; pending: Pending | null; onStop: () => void;
  feedback?: { conversationId: number; onRepair: (feedbackId: number, label: string) => void };
}) {
  // The line belongs to the latest answer only: an answer with no blocks leaves no tutor item, so never fall back to an earlier one.
  const last = [...items].reverse().find((x) => x.kind !== "notice");
  const latestTutor = last?.kind === "tutor" ? last : undefined;
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite" data-testid="watbot-messages">
      {items.map((item, i) => <Message key={item.id ?? item.key ?? `i${i}`} item={item} />)}
      {feedback && !pending && latestTutor?.id && latestTutor.blocks.length > 0 && (
        <WatBotFeedback key={latestTutor.id} conversationId={feedback.conversationId} messageId={latestTutor.id} onRepair={feedback.onRepair} />
      )}
      {pending?.queued && <Pill>WatBot is busy — you're number {pending.queued} in line</Pill>}
      {pending?.searching && <Pill>Searching {pending.searching}…</Pill>}
      {pending && (
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex h-6 items-center rounded-full border border-dashed px-2.5 font-mono">checking source…</span>
          <button type="button" aria-label="Stop generating" data-testid="watbot-stop" onClick={onStop} className="h-8 rounded border px-3 text-xs">Stop</button>
        </div>
      )}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <div role="status" className="self-start rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{children}</div>;
}

function Message({ item }: { item: ChatItem }) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  if (item.kind === "student") {
    return <div data-role="student" className="max-w-[300px] self-end rounded-md bg-muted px-3 py-2 text-sm">{item.blocks[0]?.text}</div>;
  }
  if (item.kind === "notice") {
    return <div data-role="notice" className="self-start rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">{item.blocks[0]?.text}</div>;
  }
  // A tutor row with no forwarded blocks (stopped early, failed, refused) exists only to carry
  // usage (D22); its notice row says what happened, so it renders nothing itself.
  if (!item.blocks.length) return null;
  const cited = item.blocks.some((b) => b.citations.length > 0);
  return (
    <div data-role="tutor" className="rounded-md border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm leading-relaxed">
      <div className="mb-1 font-mono text-[11px] font-semibold tracking-widest text-foreground">WATBOT</div>
      {item.blocks.map((b, i) => (
        <p key={i} className="mb-1 last:mb-0">{b.text}{" "}{b.citations.map((c, j) => <CitationChip key={j} c={c} saved={!!item.id} />)}</p>
      ))}
      {cited && item.id && !reported && (
        <div className="mt-1.5 flex justify-end">
          <button type="button" aria-expanded={reporting} onClick={() => setReporting((r) => !r)} className="inline-flex h-8 items-center gap-1 text-[11px] font-semibold underline">
            <Flag className="size-3" aria-hidden="true" />Report this answer
          </button>
        </div>
      )}
      {reporting && item.id && <WatBotReportForm messageId={item.id} onDone={() => { setReporting(false); setReported(true); }} onCancel={() => setReporting(false)} />}
      {reported && <p role="status" className="mt-1.5 text-[11px]">Thanks — reported. Your conversation continues.</p>}
    </div>
  );
}

function CitationChip({ c, saved }: { c: WatBotCitation; saved: boolean }) {
  const [open, setOpen] = useState(false);
  // WQF-A5: a saved answer opens straight to its page. retry:false — passages 404 until the
  // answer is saved (D23), so an unsaved one never asks and shows the cited text alone.
  const { data: passage, isError } = useGetWatBotPassage(c.passageId, { query: { queryKey: getGetWatBotPassageQueryKey(c.passageId), enabled: open && saved, retry: false } });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Source: ${c.label}`} data-testid="watbot-citation-chip"
          className="inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 align-middle font-mono text-[11px]">
          <BookOpen className="size-2.5" aria-hidden="true" />{c.label}
        </button>
      </PopoverTrigger>
      {/* Portaled + collision-aware (Radix), so the panel's overflow-y-auto can't clip it. */}
      <PopoverContent aria-label={`Source ${c.label}`} collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-16px)] overflow-y-auto p-3 text-xs">
        {/* One view: the page with the cited span marked (formulas never marked); the cited text alone until it loads. */}
        <span tabIndex={0} data-testid="watbot-source" className="block max-h-48 overflow-auto whitespace-pre-wrap">
          {passage
            ? citationSegments(passage.body, c.citedText).map((s, i) => (
              <Fragment key={i}>{s.math ? withMath(s.text) : s.mark ? <mark className="bg-warning-bg">{s.text}</mark> : s.text}</Fragment>
            ))
            : withMath(c.citedText)}
        </span>
        {isError && <p role="alert" className="mt-2 text-danger">Source unavailable</p>}
      </PopoverContent>
    </Popover>
  );
}
