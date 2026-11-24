// WATBOT-POPOVER-KATEX review fold: a MathText chunk that fails to load (a tab left open
// across a deploy) must fall back to the raw text, not reach the app-level error boundary.
import { describe, it, expect, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/components/workspace/watbot/MathText", () => { throw new Error("chunk load failed"); });
vi.mock("@workspace/api-client-react", () => ({
  getGetWatBotPassageQueryKey: (id: number) => ["passage", id],
  useGetWatBotPassage: () => ({ data: undefined, isError: false, isLoading: false }),
  useSubmitWatBotReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitWatBotFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
import { WatBotMessages } from "@/components/workspace/watbot/WatBotMessages";

// Stands in for main.tsx's app-level SentryErrorBoundary, which replaces the whole app.
class AppBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <p>Something went wrong</p> : this.props.children; }
}

describe("WatBotMessages math fallback", () => {
  it("shows the raw $$ text when the math chunk fails to load", async () => {
    const items = [{ kind: "tutor" as const, id: 9, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "The cost is $$x_{ij}$$ here." }] }] }];
    render(<AppBoundary><WatBotMessages items={items} pending={null} onStop={vi.fn()} /></AppBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    // Wait for the same import to reject, then let React process the lazy rejection.
    await act(async () => { await import("@/components/workspace/watbot/MathText").catch(() => {}); });
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent("The cost is $$x_{ij}$$ here.");
  });
});
