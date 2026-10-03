import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { InvalidateOnResize, INVALIDATE_DEBOUNCE_MS } from "@/components/workspace/map/InvalidateOnResize";

const invalidateSize = vi.fn();
const container = document.createElement("div");

// Spread importActual rather than replacing the module wholesale — the pattern
// every other react-leaflet mock in this repo uses. InvalidateOnResize itself
// only imports useMap, but the spread keeps this honest if that changes.
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    useMap: () => ({ invalidateSize, getContainer: () => container }),
  };
});

let observed: Element[] = [];
let fire: (() => void) | null = null;
const disconnect = vi.fn();
const realResizeObserver = global.ResizeObserver;

beforeEach(() => {
  vi.useFakeTimers();
  invalidateSize.mockClear();
  disconnect.mockClear();
  observed = [];
  fire = null;
  // src/__tests__/setup.ts installs a deliberately no-op ResizeObserver (Radix
  // needs one to exist). This test needs to drive the callback, so it installs
  // its own capturing stub for its own duration.
  global.ResizeObserver = class {
    disconnect = disconnect;
    constructor(callback: () => void) {
      fire = callback;
    }
    observe(element: Element) {
      observed.push(element);
    }
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
  global.ResizeObserver = realResizeObserver;
});

describe("InvalidateOnResize", () => {
  it("observes the map's own container element", () => {
    render(<InvalidateOnResize />);
    expect(observed).toEqual([container]);
  });

  it("calls map.invalidateSize() once the resize has settled", () => {
    render(<InvalidateOnResize />);
    fire!();
    expect(invalidateSize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(INVALIDATE_DEBOUNCE_MS);
    expect(invalidateSize).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of resizes into ONE call — the rail's width animation fires one per frame", () => {
    // Regression guard: the nav's width is animated, so one toggle delivers a
    // resize callback per frame. Undebounced that is ~60 full Leaflet size
    // recomputations for a single click.
    //
    // Review finding 5 — this comment used to add "...and left the sidebar stuck
    // at the collapsed width". That symptom was retracted in the same commit
    // range (see InvalidateOnResize.tsx): it was an artifact of a BACKGROUND tab
    // freezing CSS transitions, not of this code. Stating it here would re-seed
    // the wrong diagnosis the module explicitly corrects.
    render(<InvalidateOnResize />);
    for (let frame = 0; frame < 60; frame++) {
      fire!();
      vi.advanceTimersByTime(16); // ~60fps, each tick well inside the debounce
    }
    expect(invalidateSize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INVALIDATE_DEBOUNCE_MS);
    expect(invalidateSize).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer and drops a pending call on unmount", () => {
    const view = render(<InvalidateOnResize />);
    fire!();
    view.unmount();
    vi.advanceTimersByTime(INVALIDATE_DEBOUNCE_MS * 4);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(invalidateSize).not.toHaveBeenCalled();
  });
});
