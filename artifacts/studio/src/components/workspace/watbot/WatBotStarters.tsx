import type { ModelTutor } from "@workspace/api-client-react";

export function WatBotStarters({ chapter, tutor, activeTab, disabled, onPick }: {
  chapter: string; tutor: ModelTutor; activeTab: string | null; disabled: boolean; onPick: (text: string) => void;
}) {
  if (!tutor.fixedQuestions.length) return null;
  return (
    <section aria-label={`${chapter} questions from your instructor`} className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground">{chapter.toUpperCase()} · QUESTIONS FROM YOUR INSTRUCTOR</h3>
      {tutor.fixedQuestions.map((q, i) => (
        <button key={q.id} type="button" disabled={disabled} onClick={() => onPick(q.text)}
          className="flex min-h-11 items-start gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60">
          <span className="font-mono text-[11px] text-muted-foreground">Q{i + 1}</span>
          <span className="flex-1">{q.text}</span>
          {q.tab && q.tab === activeTab && <span className="rounded-full border px-2 font-mono text-[11px]">For this tab</span>}
        </button>
      ))}
    </section>
  );
}
