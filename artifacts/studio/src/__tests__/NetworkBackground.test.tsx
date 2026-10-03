import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkBackground } from "@/components/NetworkBackground";

let observed: Array<() => void> = [];
const disconnect = vi.fn();

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

const ctx = {
  clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  lineWidth: 0, strokeStyle: "", fillStyle: "",
};

beforeEach(() => {
  observed = [];
  disconnect.mockReset();
  // MUST clear every ctx mock: `ctx` is module-level and vitest.config.ts
  // does not enable clearMocks, so without this the reduced-motion case's
  // `expect(ctx.fill).toHaveBeenCalled()` is satisfied by the PREVIOUS
  // test's frame and stays green even if this render draws nothing at all.
  for (const fn of Object.values(ctx)) {
    if (typeof fn === "function" && "mockClear" in fn) (fn as ReturnType<typeof vi.fn>).mockClear();
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: () => void) { observed.push(cb); }
    observe() {} unobserve() {} disconnect = disconnect;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("NetworkBackground", () => {
  it("renders a non-interactive, hidden canvas", () => {
    mockMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    const el = screen.getByTestId("network-background");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toMatch(/pointer-events-none/);
  });

  it("never starts the animation loop under prefers-reduced-motion", () => {
    mockMatchMedia(true);
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    expect(raf).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled(); // one static frame was drawn
  });

  it("redraws after a resize under reduced motion, so the canvas is not left blank", () => {
    mockMatchMedia(true);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    ctx.fill.mockClear();
    observed.forEach(cb => cb());
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("starts the loop when motion is allowed", () => {
    mockMatchMedia(false);
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<NetworkBackground />);
    expect(raf).toHaveBeenCalled();
  });

  it("cancels the frame and disconnects the observer on unmount", () => {
    mockMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<NetworkBackground />);
    unmount();
    expect(cancel).toHaveBeenCalledWith(42);
    expect(disconnect).toHaveBeenCalled();
  });
});
