import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({ useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }) }));
import { WatBotFeedback } from "@/components/workspace/watbot/WatBotFeedback";

describe("WatBotFeedback", () => {
  // Braces matter: a beforeEach that returns the mock makes vitest call it as a teardown hook.
  beforeEach(() => { mutateAsync.mockReset(); });

  it("✓ stores helped and thanks the student", async () => {
    mutateAsync.mockResolvedValue({ id: 1, repairLabel: null });
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={vi.fn()} />);
    expect(screen.getByText("Did this help you understand the topic?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, this helped" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thanks for the feedback."));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: true } });
  });

  it("✗ with reason 1 hands the re-answer label to onRepair", async () => {
    mutateAsync.mockResolvedValue({ id: 7, repairLabel: "↻ Explain with fewer questions" });
    const onRepair = vi.fn();
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole("button", { name: "No, this didn't help" }));
    fireEvent.click(screen.getByLabelText("It kept asking me questions instead of explaining"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onRepair).toHaveBeenCalledWith(7, "↻ Explain with fewer questions"));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: false, reason: "too_many_questions" } });
  });

  it("Other opens the note box; the note is sent and the rephrase notice shows, with no re-answer", async () => {
    mutateAsync.mockResolvedValue({ id: 8, repairLabel: null });
    const onRepair = vi.fn();
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole("button", { name: "No, this didn't help" }));
    expect(screen.queryByLabelText("What's still unclear? (optional)")).toBeNull();
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("What's still unclear? (optional)"), { target: { value: " the zones " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Try asking again in your own words, and say which step you're stuck on."));
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: 5, data: { messageId: 9, helped: false, reason: "other", note: "the zones" } });
    expect(onRepair).not.toHaveBeenCalled();
  });

  it("shows an error and stays usable when the request fails", async () => {
    mutateAsync.mockRejectedValue(new Error("x"));
    render(<WatBotFeedback conversationId={5} messageId={9} onRepair={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, this helped" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send your feedback. Try again."));
    expect(screen.getByRole("button", { name: "Yes, this helped" })).toBeEnabled();
  });
});
