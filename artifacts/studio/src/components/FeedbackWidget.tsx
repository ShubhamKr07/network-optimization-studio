import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubmitFeedback } from "@workspace/api-client-react";

const AUTO_CLOSE_MS = 2000;
const MAX_BODY_CHARS = 4000;

// COSM-4 — positioned absolutely inside AppShell's content wrapper (NOT
// viewport-fixed), so it cannot overlap the always-visible homepage credit
// footer, which lives outside that wrapper.
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = useSubmitFeedback();

  function clearTimer() {
    if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null; }
  }
  useEffect(() => clearTimer, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function close() {
    clearTimer();
    setOpen(false);
    setBody("");
    setStatus("idle");
    setErrorText("");
    launcherRef.current?.focus();
  }

  async function handleSend() {
    if (body.trim().length === 0 || status === "sending") return;
    setStatus("sending");
    setErrorText("");
    try {
      await submit.mutateAsync({ data: { body: body.trim() } });
      setStatus("sent");
      clearTimer();
      timerRef.current = setTimeout(close, AUTO_CLOSE_MS);
    } catch (err) {
      setStatus("error");
      const status429 = (err as { status?: number } | null)?.status === 429;
      setErrorText(status429 ? "Too many submissions — try again in a minute." : "Couldn't send that. Try again.");
    }
  }

  return (
    <div className="absolute bottom-4 right-4 z-20" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {open && (
        <div
          id="feedback-panel"
          role="group"
          aria-label="Send feedback"
          className="mb-2 w-[min(20rem,calc(100vw-2rem))] rounded border bg-background p-3 shadow-lg"
          onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
        >
          {status === "sent" ? (
            <p className="text-sm" data-testid="feedback-thanks">Thanks — got it.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <label htmlFor="feedback-body" className="text-sm font-medium">Send feedback</label>
                <button type="button" aria-label="Close feedback" onClick={close} className="opacity-60 hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" data-testid="feedback-anonymity-hint">
                Stored without your account ID — we don't save who sent this. Please avoid personal details.
              </p>
              <textarea
                id="feedback-body"
                ref={inputRef}
                data-testid="feedback-input"
                value={body}
                maxLength={MAX_BODY_CHARS}
                onChange={e => setBody(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded border p-2 text-sm"
                placeholder="What's on your mind?"
              />
              {status === "error" && (
                <p className="mt-1 text-xs text-destructive" data-testid="feedback-error">{errorText}</p>
              )}
              <div className="mt-2 flex justify-end">
                <Button size="sm" data-testid="feedback-send" onClick={handleSend}
                  disabled={body.trim().length === 0 || status === "sending"}>
                  {status === "sending" ? "Sending…" : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <Button
        ref={launcherRef}
        size="sm"
        variant="outline"
        data-testid="feedback-button"
        aria-expanded={open}
        aria-controls="feedback-panel"
        aria-label="Send feedback"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded-full shadow"
      >
        <MessageSquare className="w-4 h-4" />
      </Button>
    </div>
  );
}
