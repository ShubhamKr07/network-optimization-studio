import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 300));
    expect(result.current).toBe("initial");
  });

  it("does not update value before delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: "initial" } }
    );

    rerender({ value: "updated" });
    act(() => vi.advanceTimersByTime(100));

    expect(result.current).toBe("initial");
  });

  it("updates value after delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: "initial" } }
    );

    rerender({ value: "updated" });
    act(() => vi.advanceTimersByTime(300));

    expect(result.current).toBe("updated");
  });

  it("resets the timer on rapid successive updates", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "b" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "c" });
    act(() => vi.advanceTimersByTime(200)); // 200ms since last change — not yet
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(100)); // now 300ms since last change
    expect(result.current).toBe("c");
  });

  it("works with numeric values", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: 1 } }
    );

    rerender({ value: 42 });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(42);
  });

  it("works with object values", () => {
    const obj1 = { p: 3 };
    const obj2 = { p: 5 };
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: obj1 } }
    );

    rerender({ value: obj2 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(obj2);
  });
});
