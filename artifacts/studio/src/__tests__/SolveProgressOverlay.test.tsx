import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SolveProgressOverlay } from "@/components/workspace/SolveProgressOverlay";
import { SOLVE_QUIPS, QUIP_INTERVAL_MS } from "@/lib/solveQuips";

function renderOverlay(over: Partial<Parameters<typeof SolveProgressOverlay>[0]> = {}) {
  const onAdjust = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <SolveProgressOverlay phase="solving" onAdjust={onAdjust} onClose={onClose} {...over} />,
  );
  return { ...view, onAdjust, onClose };
}

describe("SolveProgressOverlay — mount gating", () => {
  it("renders nothing at phase idle", () => {
    renderOverlay({ phase: "idle" });
    expect(screen.queryByTestId("solve-progress-overlay")).toBeNull();
  });

  it("renders while saving and while solving", () => {
    const { unmount } = renderOverlay({ phase: "saving" });
    expect(screen.getByTestId("solve-progress-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("solve-progress-phase")).toHaveTextContent("Saving changes…");
    unmount();
    renderOverlay({ phase: "solving" });
    expect(screen.getByTestId("solve-progress-phase")).toHaveTextContent("Solving…");
  });
});

describe("SolveProgressOverlay — no escape while running", () => {
  it("renders no close or adjust action while solving", () => {
    renderOverlay({ phase: "solving" });
    expect(screen.queryByTestId("solve-progress-close")).toBeNull();
    expect(screen.queryByTestId("solve-progress-adjust")).toBeNull();
  });

  it("stays mounted after an Escape keydown while solving", () => {
    const { onClose } = renderOverlay({ phase: "solving" });
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(screen.getByTestId("solve-progress-overlay")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SolveProgressOverlay — reduced motion", () => {
  it("marks the spinner motion-reduce:animate-none", () => {
    renderOverlay({ phase: "solving" });
    // Radix's AlertDialogContent renders through a Portal onto
    // `document.body`, not into RTL's own `container` — query from
    // `document` instead. SVG `className` is also an `SVGAnimatedString`
    // in the DOM, not a plain string — read the attribute directly rather
    // than the JS property.
    expect(document.querySelector("svg")?.getAttribute("class")).toMatch(/motion-reduce:animate-none/);
  });
});

describe("SolveProgressOverlay — quips", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts on the first quip and advances on the interval", () => {
    renderOverlay({ phase: "solving" });
    expect(screen.getByTestId("solve-progress-quip")).toHaveTextContent(SOLVE_QUIPS[0]);
    act(() => { vi.advanceTimersByTime(QUIP_INTERVAL_MS); });
    expect(screen.getByTestId("solve-progress-quip")).toHaveTextContent(SOLVE_QUIPS[1]);
    act(() => { vi.advanceTimersByTime(QUIP_INTERVAL_MS); });
    expect(screen.getByTestId("solve-progress-quip")).toHaveTextContent(SOLVE_QUIPS[2]);
  });

  it("wraps at the end of the list", () => {
    renderOverlay({ phase: "solving" });
    act(() => { vi.advanceTimersByTime(QUIP_INTERVAL_MS * SOLVE_QUIPS.length); });
    expect(screen.getByTestId("solve-progress-quip")).toHaveTextContent(SOLVE_QUIPS[0]);
  });

  it("is aria-hidden so it is not announced every 2.5s", () => {
    renderOverlay({ phase: "solving" });
    expect(screen.getByTestId("solve-progress-quip")).toHaveAttribute("aria-hidden", "true");
  });

  it("resets to the first quip for a new run", () => {
    const { rerender } = renderOverlay({ phase: "solving" });
    act(() => { vi.advanceTimersByTime(QUIP_INTERVAL_MS * 3); });
    rerender(<SolveProgressOverlay phase="idle" onAdjust={vi.fn()} onClose={vi.fn()} />);
    rerender(<SolveProgressOverlay phase="solving" onAdjust={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("solve-progress-quip")).toHaveTextContent(SOLVE_QUIPS[0]);
  });

  it("clears its interval on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderOverlay({ phase: "solving" });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("SolveProgressOverlay — live-region discipline", () => {
  it("makes only the phase line a polite live region", () => {
    renderOverlay({ phase: "solving", queuedAt: Date.now() - 3000, jobStatus: "running" });
    expect(screen.getByTestId("solve-progress-phase")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("solve-progress-elapsed")).not.toHaveAttribute("aria-live");
  });

  it("renders no clock before a job exists (saving phase, no queuedAt)", () => {
    renderOverlay({ phase: "saving" });
    expect(screen.queryByTestId("solve-progress-elapsed")).toBeNull();
  });
});

describe("SolveProgressOverlay — error state", () => {
  const failed = {
    phase: "failed" as const,
    errorMessage: "The solver did not complete. Try again.",
    queuedAt: 1_000_000,
    startedAt: 1_000_500,
    finishedAt: 1_004_000,
    jobStatus: "failed" as const,
  };

  it("shows the server's message with role=alert", () => {
    renderOverlay(failed);
    const err = screen.getByTestId("solve-progress-error");
    expect(err).toHaveTextContent("The solver did not complete. Try again.");
    expect(err).toHaveAttribute("role", "alert");
  });

  it("stops the quip and shows both actions", () => {
    renderOverlay(failed);
    expect(screen.queryByTestId("solve-progress-quip")).toBeNull();
    expect(screen.getByTestId("solve-progress-adjust")).toBeInTheDocument();
    expect(screen.getByTestId("solve-progress-close")).toBeInTheDocument();
  });

  it("keeps the failed job's frozen elapsed total visible", () => {
    renderOverlay(failed);
    expect(screen.getByTestId("solve-progress-elapsed")).toBeInTheDocument();
  });

  it("fires onAdjust and onClose from their buttons", () => {
    const { onAdjust, onClose } = renderOverlay(failed);
    fireEvent.click(screen.getByTestId("solve-progress-adjust"));
    expect(onAdjust).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("solve-progress-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message when none is supplied", () => {
    renderOverlay({ ...failed, errorMessage: null });
    expect(screen.getByTestId("solve-progress-error")).toHaveTextContent("The solver did not complete.");
  });

  // CH4UX-6 follow-up — a synchronous save/enqueue rejection can set
  // "saving"/"solving" and then "failed" in the same batch, so the overlay's
  // very FIRST mount is already the error card (not a transition from
  // "solving"). Rendered fresh at "failed" (never transitioning through
  // "solving") to cover exactly that path: Adjust's own `autoFocus` must win,
  // matching Task 5's deliberate intent.
  //
  // IMPORTANT, measured (not assumed): this assertion does NOT discriminate
  // the `if (!running) return;` guard added alongside it in
  // `onOpenAutoFocus`. Traced against @radix-ui/react-focus-scope@1.1.7's
  // actual source and confirmed with a throwaway probe: React applies a
  // host element's `autoFocus` during the mutation phase, which runs before
  // any passive effect — including FocusScope's own mount effect, which is
  // what would dispatch the `onMountAutoFocus` custom event our
  // `onOpenAutoFocus` prop is wired to. That effect's own
  // `hasFocusedCandidate` check (`container.contains(document.activeElement)`)
  // is therefore ALREADY true by the time it runs whenever a focusable
  // `autoFocus` child exists, so it never even attaches the listener, let
  // alone dispatches — our handler is unreachable on this exact path
  // regardless of the `running` guard. Confirmed by reverting the guard:
  // this test stays green. What DOES turn it red is removing `autoFocus`
  // from the Adjust button below — Radix's own fallback then focuses Close
  // (the first tabbable candidate) instead, exercising exactly the "no
  // focusable candidate" branch Radix's own default handles. This test is
  // real regression coverage for the `autoFocus` prop and button order, not
  // for the `running` guard. The `running` guard remains correct — and is
  // exercised by the pre-existing "moves focus into the overlay when Solve
  // is pressed" test in Workspace.test.tsx, where the overlay's first-ever
  // mount genuinely has no focusable child (the running branch) — it is
  // simply not exercised by a cold mount directly into "failed".
  it("leaves focus on Adjust when the overlay opens directly into the failed card", () => {
    renderOverlay(failed);
    expect(screen.getByTestId("solve-progress-adjust")).toHaveFocus();
  });
});
