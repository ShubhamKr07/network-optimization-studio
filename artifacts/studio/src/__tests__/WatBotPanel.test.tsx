import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const status = { data: { available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false } };
vi.mock("@workspace/api-client-react", () => ({ useGetWatBotStatus: () => status }));
import { WatBotPanel } from "@/components/workspace/watbot/WatBotPanel";

const tutor = { readingList: [{ kind: "book", chapter: 3 }], fixedQuestions: [
  { id: "q1", text: "What decision is this model making?", tab: "optimization-parameters" },
  { id: "q3", text: "How do I read this Output Map?", tab: "output-map" },
] };
const view = { id: "o", kind: "output", entity: "output-map", label: "Output Map" } as never;

function renderPanel(onAsk = vi.fn(), onClose = vi.fn()) {
  render(<WatBotPanel modelId="p-median-us" chapter="Chapter 3" tutor={tutor as never} view={view} scenario={{ name: "Baseline", inputs: { p: 4 } }} onAsk={onAsk} onClose={onClose} />);
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
    status.data = { ...status.data, available: false };
    renderPanel();
    expect(screen.getByText("WatBot is unavailable right now")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /What decision/ })).toBeDisabled();
  });

  it("shows the student limit with its reset time", () => {
    status.data = { ...status.data, studentRemaining: 0, studentResetAt: "2026-11-21T09:00:00Z" as never };
    renderPanel();
    expect(screen.getByText(/You've asked 50 questions in the last 24 hours/)).toBeInTheDocument();
  });

  it("moves focus to the question input on open", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "Ask WatBot" })).toHaveFocus();
  });

  it("focuses the panel region when the input is disabled", () => {
    status.data = { ...status.data, available: false };
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
});
