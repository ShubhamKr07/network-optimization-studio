import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useElapsed, type ElapsedJobStatus } from "@/lib/useElapsed";
import { SOLVE_QUIPS, QUIP_INTERVAL_MS } from "@/lib/solveQuips";

/**
 * CH4UX-5 — the whole solve lifecycle, owned by Workspace.tsx.
 *
 * `"idle"` — nothing running; this overlay is unmounted.
 * `"saving"` — a dirty localInputs draft is being persisted before solve.
 * `"solving"` — the job has been enqueued and/or is being polled.
 * `"failed"` — the save, the enqueue, or the job itself ended in an error.
 *
 * CH4UX-6 made this true: moved out of SolveDialog, whose own phase type is
 * now deleted. That dialog no longer has a progress concept at all, and this
 * type has exactly two consumers — this component and `Workspace.tsx`'s
 * `solvePhase` state.
 */
export type SolvePhase = "idle" | "saving" | "solving" | "failed";

export interface SolveProgressOverlayProps {
  /** The ONLY mount control. `open` is derived internally as
   * `phase !== "idle"`, deliberately: a separate `open` prop would let a
   * caller pass a contradictory pair that TypeScript cannot rule out. */
  phase: SolvePhase;
  queuedAt?: Date | string | number | null;
  startedAt?: Date | string | number | null;
  finishedAt?: Date | string | number | null;
  jobStatus?: ElapsedJobStatus;
  /** The server's safe public message. Never a raw diagnostic. */
  errorMessage?: string | null;
  /** Close the overlay and reopen the Solve dialog so the student can change
   * something before rerunning. The only retry path — a solve that just
   * failed is unlikely to succeed unchanged, so there is no blind retry. */
  onAdjust: () => void;
  /** Dismiss and stay put. */
  onClose: () => void;
}

// CH4UX-5 — a Radix AlertDialog, NOT a bare `fixed inset-0` div and NOT
// `Dialog`. A plain div blocks pointer events at best: it does not make the
// background inert to keyboard or assistive technology, does not trap or
// restore focus, exposes no `aria-modal`, and cannot stop a Leaflet/portal
// layer painting above it. `Dialog`'s `DialogContent` hardcodes an X close
// control with no opt-out seam, which disqualifies it for a surface that is
// deliberately inescapable while running. AlertDialog already suppresses
// outside-click dismissal, so only Escape needs explicit prevention.
//
// There is nothing to cancel: the API has no cancel endpoint
// (`/scenarios/{id}/solve-jobs/{jobId}` is GET-only), so offering a cancel
// affordance would be a lie.
export function SolveProgressOverlay({
  phase,
  queuedAt,
  startedAt,
  finishedAt,
  jobStatus,
  errorMessage,
  onAdjust,
  onClose,
}: SolveProgressOverlayProps) {
  const open = phase !== "idle";
  const running = phase === "saving" || phase === "solving";

  const elapsed = useElapsed({ queuedAt, startedAt, finishedAt, status: jobStatus });

  // CH4UX-6 review (Finding 3) — claim focus explicitly when the overlay
  // opens. MEASURED in jsdom, not assumed: without this, pressing Solve
  // leaves `document.activeElement === document.body`, and it STAYS there
  // across a macrotask and an animation frame.
  //
  // The mechanism is specific to the handoff CH4UX-6 introduced. SolveDialog
  // closes in the SAME commit this overlay opens, and Radix's Dialog restores
  // focus to its trigger on close — that trigger is `button-run-optimizer`,
  // which `solvePhase !== "idle"` has just DISABLED, so `.focus()` on it is a
  // no-op and focus falls to <body>. The running branch below deliberately
  // has no focusable child (there is nothing to cancel — the API has no
  // cancel endpoint), so nothing pulls focus back in.
  //
  // Net effect without the `onOpenAutoFocus` handler below: a keyboard user
  // sits on <body>, OUTSIDE a modal that has set `body { pointer-events:
  // none }`, with Escape prevented while running — no tab stop, no way back.
  //
  // Done via `onOpenAutoFocus` rather than a `useEffect` keyed on `open`: a
  // userland effect would race Radix's own `FocusScope` mount-time auto-focus,
  // whereas `onOpenAutoFocus` is the documented hook Radix fires exactly once,
  // after the content and its FocusScope already exist, precisely so a caller
  // can redirect that focus. (Measured in jsdom: on the commit where `open`
  // flips true, `contentRef.current` is still null inside a parent effect —
  // Radix mounts this content through `Presence` — so a `useEffect`-based
  // version would be a silent no-op there regardless of the race.)
  const contentRef = useRef<HTMLDivElement>(null);
  const [quipIndex, setQuipIndex] = useState(0);
  useEffect(() => {
    if (!running) {
      setQuipIndex(0);
      return;
    }
    const id = setInterval(() => {
      setQuipIndex(i => (i + 1) % SOLVE_QUIPS.length);
    }, QUIP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        ref={contentRef}
        data-testid="solve-progress-overlay"
        className="max-w-sm"
        // See the focus note above. Radix's default hunts for the first
        // focusable child; the running branch has none, and the fallback
        // lands on <body> — outside the modal. Point it at the container,
        // which carries Radix's own `tabIndex={-1}`.
        //
        // Gated on `running`, matching this handler's actual job: the
        // redirect below exists ONLY because the running branch has no
        // focusable child for Radix's own default to land on (see the note
        // above). The failed branch has two — Close and an `autoFocus`
        // Adjust — so Radix's default already does the right thing there and
        // this handler has nothing to add. CH4UX-6 follow-up review raised
        // the concern that an unconditional version of this handler could
        // race a cold mount straight into "failed" (a synchronous
        // save/enqueue rejection collapsing "saving"/"solving" and "failed"
        // into one batch) and steal focus from Adjust's `autoFocus`.
        // MEASURED, not assumed, that this is narrower than it sounds:
        // traced against @radix-ui/react-focus-scope's actual source and
        // confirmed with a throwaway probe, React commits a host element's
        // `autoFocus` during the mutation phase, strictly before any passive
        // effect — including the one that would dispatch the
        // `onMountAutoFocus` event this handler is wired to. That effect's
        // own `hasFocusedCandidate` check is therefore already true by the
        // time it runs whenever a focusable `autoFocus` child exists, so it
        // never dispatches at all; this handler is provably unreachable on
        // that exact path regardless of the guard. The guard is kept anyway
        // because it makes the handler's actual scope match its stated
        // intent (only the no-focusable-child branch needs a redirect), and
        // it costs nothing — but do not cite "prevented a live focus theft
        // on cold-mount-into-failed" as its justification; that path was
        // never reachable to begin with. See
        // `SolveProgressOverlay.test.tsx`'s "leaves focus on Adjust..." test
        // for the full measurement.
        onOpenAutoFocus={e => {
          if (!running) return;
          e.preventDefault();
          contentRef.current?.focus();
        }}
        // Radix fires this before any close attempt. Prevented while running
        // so Escape cannot dismiss a surface with no cancel behind it.
        onEscapeKeyDown={e => {
          if (running) e.preventDefault();
        }}
      >
        {running ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 font-heading">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Running the optimizer
              </AlertDialogTitle>
              {/* The ONLY live region. The clock below must not be one, or a
                  screen reader announces it once per second. */}
              <AlertDialogDescription aria-live="polite" data-testid="solve-progress-phase">
                {phase === "saving" ? "Saving changes…" : "Solving…"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <p
              className="text-sm text-muted-foreground"
              aria-hidden="true"
              data-testid="solve-progress-quip"
            >
              {SOLVE_QUIPS[quipIndex]}
            </p>

            {elapsed.label && (
              <p className="text-xs font-mono text-muted-foreground" data-testid="solve-progress-elapsed">
                {elapsed.label}
              </p>
            )}
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-heading">The solve didn&apos;t finish</AlertDialogTitle>
              <AlertDialogDescription role="alert" data-testid="solve-progress-error">
                {errorMessage ?? "The solver did not complete. Try again."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {elapsed.label && (
              <p className="text-xs font-mono text-muted-foreground" data-testid="solve-progress-elapsed">
                {elapsed.label}
              </p>
            )}

            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={onClose} data-testid="solve-progress-close">
                Close
              </Button>
              <Button type="button" autoFocus onClick={onAdjust} data-testid="solve-progress-adjust">
                Adjust &amp; re-solve
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
