import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaleOutputBanner } from "@/components/workspace/StaleOutputBanner";

// A3.2 — reusable banner blanking output-kind tab content when the active
// scenario's outputs aren't trustworthy (unsolved or stale). Wireframe screen
// 1a·5. Kept as its own component (not inlined into Workspace.tsx) because
// Phase C's Reports & Compare tab is meant to reuse it verbatim once it
// exists (task brief item 3).
describe("StaleOutputBanner", () => {
  it("shows the 'inputs changed since last solve' message", () => {
    render(<StaleOutputBanner onRunOptimizer={vi.fn()} />);
    expect(screen.getByTestId("stale-output-banner")).toBeInTheDocument();
    expect(screen.getByText(/inputs changed since last solve/i)).toBeInTheDocument();
  });

  it("clicking the Run Optimizer CTA calls onRunOptimizer", async () => {
    const onRunOptimizer = vi.fn();
    render(<StaleOutputBanner onRunOptimizer={onRunOptimizer} />);
    await userEvent.click(screen.getByTestId("button-stale-banner-run-optimizer"));
    expect(onRunOptimizer).toHaveBeenCalledTimes(1);
  });

  it("renders its message text on book-cover text tokens, not raw shadcn foreground/muted", () => {
    render(<StaleOutputBanner onRunOptimizer={vi.fn()} />);
    expect(screen.getByText(/inputs changed since last solve/i).className).toContain("var(--text-body)");
    expect(screen.getByText(/re-run the optimizer/i).className).toContain("var(--text-muted)");
  });
});
