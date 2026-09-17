import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsed } from "@/lib/useElapsed";

// jade B9 — spec §9 running solve clock. Fake timers so `Date.now()` and the
// hook's own 1s tick interval are both under test control.
describe("useElapsed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns a null label when queuedAt is not supplied (no timing props)", () => {
    const { result } = renderHook(() => useElapsed({}));
    expect(result.current.label).toBeNull();
    expect(result.current.queuedSec).toBeNull();
    expect(result.current.activeSec).toBeNull();
  });

  it("queued-only shows 'Queued Xs', ticking, before startedAt is known", () => {
    const t0 = Date.now();
    const { result } = renderHook(() => useElapsed({ queuedAt: t0, status: "queued" }));
    expect(result.current.label).toBe("Queued 0s");

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.label).toBe("Queued 5s");
    expect(result.current.queuedSec).toBe(5);
    expect(result.current.activeSec).toBeNull();
  });

  it("splits into 'Queued Xs · Solving Ys' once startedAt is present", () => {
    const t0 = Date.now();
    const startedAt = t0 + 3000; // queued for 3s before the solver started
    const { result, rerender } = renderHook(
      ({ status }) => useElapsed({ queuedAt: t0, startedAt, status }),
      { initialProps: { status: "queued" as const } },
    );

    // Advance real (fake) time to startedAt, then flip status to running —
    // mirrors the real poll sequence (a later GET solve-job response reports
    // startedAt once the worker picks the job up).
    act(() => vi.advanceTimersByTime(3000));
    rerender({ status: "running" });
    expect(result.current.label).toBe("Queued 3s · Solving 0s");

    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.label).toBe("Queued 3s · Solving 4s");
    expect(result.current.queuedSec).toBe(3);
    expect(result.current.activeSec).toBe(4);
  });

  it("freezes on a terminal status (succeeded) — further real time does not change the label", () => {
    const t0 = Date.now();
    const startedAt = t0 + 2000;
    const { result, rerender } = renderHook(
      ({ status, finishedAt }: { status: "queued" | "running" | "succeeded"; finishedAt?: number }) =>
        useElapsed({ queuedAt: t0, startedAt, finishedAt, status }),
      { initialProps: { status: "running" as const, finishedAt: undefined } },
    );

    act(() => vi.advanceTimersByTime(6000)); // startedAt + 4000ms of solving
    const finishedAt = Date.now();
    rerender({ status: "succeeded", finishedAt });
    expect(result.current.label).toBe("Queued 2s · Solving 4s");
    expect(result.current.frozen).toBe(true);

    // Advancing further must NOT change the frozen total — the tick interval
    // stops once terminal, and endMs is pinned to finishedAt.
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.label).toBe("Queued 2s · Solving 4s");
  });

  it("failed shows the frozen total (same freeze semantics as succeeded)", () => {
    const t0 = Date.now();
    const startedAt = t0 + 1000;
    const { result, rerender } = renderHook(
      ({ status, finishedAt }: { status: "queued" | "running" | "failed"; finishedAt?: number }) =>
        useElapsed({ queuedAt: t0, startedAt, finishedAt, status }),
      { initialProps: { status: "running" as const, finishedAt: undefined } },
    );

    act(() => vi.advanceTimersByTime(3500)); // startedAt + 2500ms
    const finishedAt = Date.now();
    rerender({ status: "failed", finishedAt });
    expect(result.current.label).toBe("Queued 1s · Solving 3s");
    expect(result.current.frozen).toBe(true);

    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.label).toBe("Queued 1s · Solving 3s");
  });

  it("a job that fails while still queued (never started) freezes at 'Queued Xs' using finishedAt", () => {
    const t0 = Date.now();
    const { result, rerender } = renderHook(
      ({ status, finishedAt }: { status: "queued" | "failed"; finishedAt?: number }) =>
        useElapsed({ queuedAt: t0, status, finishedAt }),
      { initialProps: { status: "queued" as const, finishedAt: undefined } },
    );

    act(() => vi.advanceTimersByTime(1200));
    const finishedAt = Date.now();
    rerender({ status: "failed", finishedAt });
    expect(result.current.label).toBe("Queued 1s");

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.label).toBe("Queued 1s");
  });
});
