import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";

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
  global.ResizeObserver = realResizeObserver;
});

describe("InvalidateOnResize", () => {
  it("observes the map's own container element", () => {
    render(<InvalidateOnResize />);
    expect(observed).toEqual([container]);
  });

  it("calls map.invalidateSize() when the container resizes", () => {
    render(<InvalidateOnResize />);
    expect(invalidateSize).not.toHaveBeenCalled();
    fire!();
    expect(invalidateSize).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer on unmount", () => {
    const view = render(<InvalidateOnResize />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
