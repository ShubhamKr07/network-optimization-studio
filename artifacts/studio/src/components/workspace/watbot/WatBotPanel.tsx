import { useState, type ReactNode } from "react";
import { History, X } from "lucide-react";
import { useGetWatBotStatus, type ModelTutor } from "@workspace/api-client-react";
import type { WorkspaceView } from "@/lib/workspaceView";
import { buildContextChip } from "./contextChip";
import { WatBotStarters } from "./WatBotStarters";

export type AskOptions = { tab: string | null; includeContext: boolean };
const MAX_QUESTION_CHARS = 2000;

export function WatBotPanel(props: {
  modelId: string; chapter: string; tutor: ModelTutor | undefined; view: WorkspaceView | null;
  scenario: { name: string; inputs?: unknown } | null; busy?: boolean; hasMessages?: boolean;
  onAsk: (question: string, opts: AskOptions) => void; onClose: () => void; onOpenHistory?: () => void;
  children?: ReactNode;
}) {
  const { data: status } = useGetWatBotStatus({ query: { refetchInterval: 60_000 } } as never);
  const [contextOn, setContextOn] = useState(true);
  const [draft, setDraft] = useState("");
  const chip = buildContextChip(props.view, props.scenario);
  const unavailable = status ? !status.available : false;
  const studentLimited = status ? status.studentRemaining === 0 : false;
  const projectLimited = status?.projectCapReached ?? false;
  const blocked = unavailable || studentLimited || projectLimited;
  const inputDisabled = blocked || !!props.busy;
  const ask = (q: string) => { if (q.trim()) props.onAsk(q.trim(), { tab: chip?.tab ?? null, includeContext: contextOn && !!chip }); };

  return (
    <aside aria-label="WatBot" className="flex w-[400px] flex-shrink-0 flex-col border-l bg-background" data-testid="watbot-panel">
      <header className="flex h-11 items-center gap-2 border-b pl-3.5 pr-2">
        <span aria-hidden="true" className="size-3.5 rounded-sm bg-primary" />
        <b className="font-serif text-sm">WatBot</b>
        {unavailable && <span className="rounded border border-warning-border bg-warning-bg px-2 text-[11px] font-semibold text-warning">Unavailable</span>}
        {(studentLimited || projectLimited) && <span className="rounded border border-warning-border bg-warning-bg px-2 text-[11px] font-semibold text-warning">Limit reached</span>}
        <span className="flex-1" />
        <button type="button" aria-label="Conversation history" onClick={props.onOpenHistory} className="grid size-8 place-items-center rounded hover:bg-muted"><History className="size-4" aria-hidden="true" /></button>
        <button type="button" aria-label="Close WatBot panel" onClick={props.onClose} className="grid size-8 place-items-center rounded hover:bg-muted"><X className="size-4" aria-hidden="true" /></button>
      </header>
      {chip && contextOn && (
        <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3.5 py-2">
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground">LOOKING AT</span>
          <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 font-mono text-[11px]">
            {chip.label}
            <button type="button" aria-label="Remove context" onClick={() => setContextOn(false)} className="ml-1"><X className="size-3" aria-hidden="true" /></button>
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {unavailable && <Notice title="WatBot is unavailable right now" body="Your conversation is saved and resumes when it is back." />}
        {studentLimited && <Notice title="You've asked 50 questions in the last 24 hours"
          body={`You can ask again ${status?.studentResetAt ? `after ${new Date(status.studentResetAt).toLocaleString()}` : "soon"}. Your conversation is saved.`} />}
        {projectLimited && !studentLimited && <Notice title="WatBot has reached its monthly limit" body="It will be back next month. Your conversation is saved." />}
        {!props.hasMessages && props.tutor && (
          <WatBotStarters chapter={props.chapter} tutor={props.tutor} activeTab={chip?.tab ?? null} disabled={blocked || !!props.busy} onPick={ask} />
        )}
        {props.children}
      </div>
      <form className="border-t px-3.5 py-2.5" onSubmit={(e) => { e.preventDefault(); ask(draft); setDraft(""); }}>
        <div className="flex gap-2">
          <input type="text" aria-label="Ask WatBot" maxLength={MAX_QUESTION_CHARS} disabled={inputDisabled}
            placeholder={unavailable ? "WatBot is unavailable" : blocked ? "Question limit reached" : props.busy ? "WatBot is answering…" : "Ask a follow-up…"}
            value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border px-3 text-sm disabled:bg-muted" />
          <button type="submit" aria-label="Send question" disabled={inputDisabled} className="size-9 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">↵</button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Answers come from the course materials and cite them.</p>
      </form>
    </aside>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="rounded-md border border-warning-border bg-warning-bg px-3.5 py-2.5 text-sm text-warning">
      <b className="font-semibold">{title}</b><br />{body}
    </div>
  );
}
