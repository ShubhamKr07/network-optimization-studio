import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DirtyNavPrompt } from "@/components/workspace/DirtyNavPrompt";

// chen-bands-units, Part A (decision 1i), Task 14 Step 1/5 — component-level
// coverage for the dirty-nav prompt. Workspace.test.tsx covers the
// integration (stepResultBack/Forward actually intercepted, the index/draft
// staying untouched on a rejected save); this file proves the component's
// own three-choice contract and inline-error behavior in isolation.
describe("DirtyNavPrompt", () => {
  it("renders nothing observable when closed", () => {
    render(<DirtyNavPrompt open={false} onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId("dirty-nav-prompt")).not.toBeInTheDocument();
  });

  it("renders the three choices when open", () => {
    render(<DirtyNavPrompt open={true} onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("dirty-nav-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("dirty-nav-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("dirty-nav-discard")).toBeInTheDocument();
    expect(screen.getByTestId("dirty-nav-save")).toBeInTheDocument();
  });

  it("Cancel calls onCancel and never onSave/onDiscard", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DirtyNavPrompt open={true} onSave={onSave} onDiscard={onDiscard} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("dirty-nav-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("Discard calls onDiscard and never onSave/onCancel", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DirtyNavPrompt open={true} onSave={onSave} onDiscard={onDiscard} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("dirty-nav-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Save calls onSave, shows a Saving… state, and shows no error on success", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<DirtyNavPrompt open={true} onSave={onSave} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("dirty-nav-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("dirty-nav-save")).not.toBeDisabled());
    expect(screen.queryByTestId("save-error")).not.toBeInTheDocument();
  });

  // The literal DoD test (plan-review-2 #4/#6): a REJECTED Save surfaces
  // the inline error and leaves the dialog open — it does NOT call
  // onDiscard/onCancel, so the caller (Workspace.tsx) never proceeds with
  // navigation on a rejection.
  it("a REJECTED Save shows the inline error, stays open, and never calls onDiscard/onCancel", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("HTTP 422: invalid input")));
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DirtyNavPrompt open={true} onSave={onSave} onDiscard={onDiscard} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("dirty-nav-save"));

    await waitFor(() => expect(screen.getByTestId("save-error")).toBeInTheDocument());
    expect(screen.getByTestId("save-error")).toHaveTextContent("HTTP 422: invalid input");
    expect(screen.getByTestId("dirty-nav-prompt")).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
