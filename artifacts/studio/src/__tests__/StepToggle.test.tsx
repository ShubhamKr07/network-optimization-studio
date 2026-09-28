import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepToggle } from "@/components/workspace/StepToggle";

const unsolved = { solved: false, stale: false, jobId: null, summary: null };
const solved = { solved: true, stale: false, jobId: 1, summary: null };

describe("CH4-15 — the step toggle is always selectable", () => {
  it("renders both steps and the N of 2 counter", () => {
    render(<StepToggle selected={1} onSelect={vi.fn()} solvedCount={0} steps={{ step1: unsolved, step2: unsolved }} />);
    expect(screen.getByTestId("step-toggle-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-toggle-2")).toBeInTheDocument();
    expect(screen.getByTestId("text-steps-solved-counter")).toHaveTextContent("0 of 2 solved");
  });

  // The deck locks Step 2's SOLVE, not the act of looking at it (frame 3a).
  it("lets Step 2 be selected at 0 of 2, showing a lock rather than disabling it", () => {
    const onSelect = vi.fn();
    render(<StepToggle selected={1} onSelect={onSelect} solvedCount={0} steps={{ step1: unsolved, step2: unsolved }} />);
    const step2 = screen.getByTestId("step-toggle-2");
    expect(step2).not.toBeDisabled();
    fireEvent.click(step2);
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("step-toggle-2-lock")).toBeInTheDocument();
  });

  it("counts a solved step and drops the lock once Step 1 is solved", () => {
    render(<StepToggle selected={1} onSelect={vi.fn()} solvedCount={1} steps={{ step1: solved, step2: unsolved }} />);
    expect(screen.getByTestId("text-steps-solved-counter")).toHaveTextContent("1 of 2 solved");
    expect(screen.queryByTestId("step-toggle-2-lock")).not.toBeInTheDocument();
  });

  it("marks the selected step with aria-pressed", () => {
    render(<StepToggle selected={2} onSelect={vi.fn()} solvedCount={2} steps={{ step1: solved, step2: solved }} />);
    expect(screen.getByTestId("step-toggle-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("step-toggle-1")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a stale badge only on Step 2", () => {
    render(<StepToggle selected={2} onSelect={vi.fn()} solvedCount={2}
      steps={{ step1: solved, step2: { ...solved, stale: true } }} />);
    expect(screen.getByTestId("step-toggle-2-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("step-toggle-1-stale")).not.toBeInTheDocument();
  });
});
