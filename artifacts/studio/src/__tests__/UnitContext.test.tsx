import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { KM_PER_MI } from "@workspace/units";

const STORAGE_KEY = "nos:display-unit-pref";

function wrapper({ children }: { children: React.ReactNode }) {
  return <UnitProvider>{children}</UnitProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("useDisplayUnit", () => {
  it("throws when used without a UnitProvider ancestor", () => {
    // Suppress React's expected console.error for the thrown-render case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useDisplayUnit())).toThrow(/UnitProvider/);
    spy.mockRestore();
  });

  it("defaults pref to 'auto'", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    expect(result.current.pref).toBe("auto");
  });

  it("'auto' is a no-op: effectiveUnit/toDisplay/fromDisplay pass the canonical value through unchanged", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    expect(result.current.effectiveUnit("km")).toBe("km");
    expect(result.current.effectiveUnit("mi")).toBe("mi");
    expect(result.current.toDisplay(500, "km")).toBe(500);
    expect(result.current.toDisplay(500, "mi")).toBe(500);
    expect(result.current.fromDisplay(500, "km")).toBe(500);
    expect(result.current.fromDisplay(500, "mi")).toBe(500);
  });

  it("'km'/'mi' convert at the exact KM_PER_MI factor, regardless of canonical", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    act(() => result.current.setPref("mi"));
    // canonical km -> display mi
    expect(result.current.toDisplay(KM_PER_MI, "km")).toBeCloseTo(1, 12);
    act(() => result.current.setPref("km"));
    // canonical mi -> display km
    expect(result.current.toDisplay(1, "mi")).toBeCloseTo(KM_PER_MI, 12);
  });

  it("effectiveUnit always resolves to the forced pref when pref is km/mi, no matter the canonical", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    act(() => result.current.setPref("mi"));
    expect(result.current.effectiveUnit("km")).toBe("mi");
    expect(result.current.effectiveUnit("mi")).toBe("mi");
  });

  it("toDisplay ∘ fromDisplay round-trips for every pref", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    for (const pref of ["auto", "km", "mi"] as const) {
      act(() => result.current.setPref(pref));
      for (const canonical of ["km", "mi"] as const) {
        const original = 804.672;
        const displayed = result.current.toDisplay(original, canonical);
        const roundTripped = result.current.fromDisplay(displayed, canonical);
        expect(roundTripped).toBeCloseTo(original, 9);
      }
    }
  });

  it("setPref writes through to localStorage", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    act(() => result.current.setPref("mi"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("mi");
  });

  it("the pref persists across a remount (a fresh provider reads the stored value)", () => {
    const first = renderHook(() => useDisplayUnit(), { wrapper });
    act(() => first.result.current.setPref("km"));
    first.unmount();

    const second = renderHook(() => useDisplayUnit(), { wrapper });
    expect(second.result.current.pref).toBe("km");
  });

  it("an invalid stored pref falls back to 'auto' rather than crashing or propagating garbage", () => {
    window.localStorage.setItem(STORAGE_KEY, "parsecs");
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    expect(result.current.pref).toBe("auto");
  });

  it("format() renders the value in the effective unit with a trailing unit label", () => {
    const { result } = renderHook(() => useDisplayUnit(), { wrapper });
    act(() => result.current.setPref("mi"));
    expect(result.current.format(KM_PER_MI, "km")).toBe("1 mi");
  });
});
