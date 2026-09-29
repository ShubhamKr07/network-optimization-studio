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
});
