import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const status: { data: import("@workspace/api-client-react").WatBotStatus } = { data: { available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false } as never };
import { WatBotPanel } from "@/components/workspace/watbot/WatBotPanel";

const tutor = { readingList: [{ kind: "book", chapter: 3 }], fixedQuestions: [
  { id: "q1", text: "What decision is this model making?", tab: "optimization-parameters" },
  { id: "q3", text: "How do I read this Output Map?", tab: "output-map" },
] };
const view = { id: "o", kind: "output", entity: "output-map", label: "Output Map" } as never;

function panel(onAsk = vi.fn(), onClose = vi.fn(), extra: { busy?: boolean; view?: never; name?: string } = {}) {
  return <WatBotPanel status={status.data} busy={extra.busy} onOpenHistory={vi.fn()} modelId="p-median-us" chapter="Chapter 3" tutor={tutor as never} view={extra.view ?? view} scenario={{ name: extra.name ?? "Baseline", inputs: { p: 4 } }} onAsk={onAsk} onClose={onClose} />;
}
function renderPanel(onAsk = vi.fn(), onClose = vi.fn()) {
  render(panel(onAsk, onClose));
  return { onAsk, onClose };
}

describe("WatBotPanel", () => {
  beforeEach(() => { status.data = { available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false }; });

  it("labels itself as a WatBot region and shows what it is looking at", () => {
    renderPanel();
    expect(screen.getByRole("complementary", { name: "WatBot" })).toBeInTheDocument();
    expect(screen.getByText("Output Map · Baseline · p = 4")).toBeInTheDocument();
  });

  it("marks the fixed question for the active tab and sends it with context", () => {
    const { onAsk } = renderPanel();
    expect(screen.getByText("For this tab").closest("button")).toHaveTextContent("How do I read this Output Map?");
    fireEvent.click(screen.getByRole("button", { name: /What decision is this model making/ }));
    expect(onAsk).toHaveBeenCalledWith("What decision is this model making?", { tab: "output-map", includeContext: true });
  });

  it("removing the context chip sends questions without context", () => {
    const { onAsk } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove context" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask WatBot" }), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(onAsk).toHaveBeenCalledWith("Why?", { tab: "output-map", includeContext: false });
  });

  it("disables input and fixed questions when unavailable", () => {
    status.data = { ...status.data, available: false } as never;
    renderPanel();
    expect(screen.getByText("WatBot is unavailable right now")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /What decision/ })).toBeDisabled();
  });

  it("shows the student limit with its reset time", () => {
    status.data = { ...status.data, studentRemaining: 0, studentResetAt: "2026-11-21T09:00:00Z" } as never;
    renderPanel();
    expect(screen.getByText(/You've asked 50 questions in the last 24 hours/)).toBeInTheDocument();
  });

  it("moves focus to the question input on open", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toHaveFocus();
  });

  it("focuses the panel region when the input is disabled", () => {
    status.data = { ...status.data, available: false } as never;
    renderPanel();
    expect(screen.getByRole("complementary", { name: "WatBot" })).toHaveFocus();
  });

  it("enforces the 2,000-character cap in the input", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toHaveAttribute("maxLength", "2000");
  });

  it("closes from the header", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close WatBot panel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("brings a removed context chip back when the scenario (chip label) changes", () => {
    const { rerender } = render(panel());
    fireEvent.click(screen.getByRole("button", { name: "Remove context" }));
    expect(screen.queryByText("Output Map · Baseline · p = 4")).toBeNull();
    rerender(panel(vi.fn(), vi.fn(), { name: "Other" }));
    expect(screen.getByText("Output Map · Other · p = 4")).toBeInTheDocument();
  });

  it("refocuses the question input when the answer finishes", () => {
    const { rerender } = render(panel(vi.fn(), vi.fn(), { busy: true }));
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toBeDisabled();
    (document.activeElement as HTMLElement).blur(); // a browser drops focus to body when the focused input disables
    rerender(panel(vi.fn(), vi.fn(), { busy: false }));
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toHaveFocus();
  });

  it("does not steal focus from another control when the answer finishes", () => {
    const other = document.createElement("button"); document.body.appendChild(other);
    const { rerender } = render(panel(vi.fn(), vi.fn(), { busy: true }));
    other.focus();
    rerender(panel(vi.fn(), vi.fn(), { busy: false }));
    expect(other).toHaveFocus();
    other.remove();
  });

  it("disables the history button while an answer streams", () => {
    render(panel(vi.fn(), vi.fn(), { busy: true }));
    expect(screen.getByRole("button", { name: "Conversation history" })).toBeDisabled();
  });
});
