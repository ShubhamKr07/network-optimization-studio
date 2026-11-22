import { useState } from "react";
import { Check, X } from "lucide-react";
import { useSubmitWatBotFeedback } from "@workspace/api-client-react";

// WATBOT-FB §2 — keys match WATBOT_FEEDBACK_REASONS (lib/db) and the OpenAPI enum.
const REASONS = [
  ["too_many_questions", "It kept asking me questions instead of explaining"],
  ["hard_to_follow", "The explanation was hard to follow"],
  ["not_what_i_asked", "It didn't answer what I asked"],
  ["still_stuck", "I still don't know how to do the exercise"],
  ["other", "Other"],
] as const;
type Reason = (typeof REASONS)[number][0];

export function WatBotFeedback({ conversationId, messageId, onRepair }: {
  conversationId: number; messageId: number; onRepair: (feedbackId: number, label: string) => void;
}) {
  const submit = useSubmitWatBotFeedback();
  const [stage, setStage] = useState<"ask" | "reasons" | "thanks" | "rephrase">("ask");
  const [reason, setReason] = useState<Reason>("too_many_questions");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async (helped: boolean) => {
    setError(null);
    const data = helped ? { messageId, helped } : { messageId, helped, reason, ...(reason === "other" && note.trim() ? { note: note.trim() } : {}) };
    try {
      const r = await submit.mutateAsync({ conversationId, data });
      if (r.repairLabel) onRepair(r.id, r.repairLabel);
      else setStage(helped ? "thanks" : "rephrase");
    } catch { setError("Could not send your feedback. Try again."); }
  };
  if (stage === "thanks") return <p role="status" className="text-[11px] text-muted-foreground">Thanks for the feedback.</p>;
  if (stage === "rephrase") return <p role="status" className="text-[11px] text-muted-foreground">Try asking again in your own words, and say which step you're stuck on.</p>;
  return (
    <div data-testid="watbot-feedback" className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span>Did this help you understand the topic?</span>
        <button type="button" aria-label="Yes, this helped" disabled={submit.isPending} onClick={() => void send(true)} className="grid size-8 place-items-center rounded border"><Check className="size-3.5" aria-hidden="true" /></button>
        <button type="button" aria-label="No, this didn't help" aria-expanded={stage === "reasons"} disabled={submit.isPending} onClick={() => setStage("reasons")} className="grid size-8 place-items-center rounded border"><X className="size-3.5" aria-hidden="true" /></button>
      </div>
      {stage === "reasons" && (
        <form className="flex flex-col gap-2 rounded-md border bg-background p-3" onSubmit={(e) => { e.preventDefault(); void send(false); }}>
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1.5 font-mono text-[11px] tracking-widest text-muted-foreground">WHAT WENT WRONG?</legend>
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex min-h-7 items-center gap-2 text-sm">
                <input type="radio" name={`feedback-${messageId}`} checked={reason === value} onChange={() => setReason(value)} />{label}
              </label>
            ))}
          </fieldset>
          {reason === "other" && (
            <label className="text-xs font-medium">What's still unclear? (optional)
              <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 block w-full rounded-md border px-3 py-2 text-sm" />
            </label>
          )}
          <button type="submit" disabled={submit.isPending} className="h-8 self-start rounded bg-primary px-3.5 text-xs font-semibold text-primary-foreground">Send</button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
