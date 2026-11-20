import { useState } from "react";
import { useSubmitWatBotReport } from "@workspace/api-client-react";

const REASONS = [
  ["wrong_or_misleading", "The answer is wrong or misleading"],
  ["citation_unsupported", "The citation doesn't support the answer"],
  ["not_what_i_asked", "It's not what I asked"],
  ["other", "Something else"],
] as const;

export function WatBotReportForm({ messageId, onDone, onCancel }: { messageId: number; onDone: () => void; onCancel: () => void }) {
  const submit = useSubmitWatBotReport();
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("wrong_or_misleading");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-2 flex flex-col gap-2.5 rounded-md border bg-background p-3.5 shadow-lg" data-testid="watbot-report-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try { await submit.mutateAsync({ data: { messageId, reason, ...(note.trim() ? { note: note.trim() } : {}) } }); onDone(); }
        catch { setError("Could not send the report. Try again."); }
      }}>
      <div className="font-serif text-base font-semibold">Report this answer</div>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="mb-1.5 font-mono text-[11px] tracking-widest text-muted-foreground">WHAT'S WRONG?</legend>
        {REASONS.map(([value, label]) => (
          <label key={value} className="flex min-h-7 items-center gap-2 text-sm">
            <input type="radio" name={`reason-${messageId}`} checked={reason === value} onChange={() => setReason(value)} />{label}
          </label>
        ))}
      </fieldset>
      <label className="text-xs font-medium">Anything else the teaching team should know? (optional)
        <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 block w-full rounded-md border px-3 py-2 text-sm" />
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={submit.isPending} className="h-8 rounded bg-primary px-3.5 text-xs font-semibold text-primary-foreground">Send report</button>
        <button type="button" onClick={onCancel} className="h-8 rounded border px-3.5 text-xs">Cancel</button>
      </div>
      <p className="text-[11px] text-muted-foreground">Sent with this conversation, the model tab you were on and the sources used.</p>
    </form>
  );
}
