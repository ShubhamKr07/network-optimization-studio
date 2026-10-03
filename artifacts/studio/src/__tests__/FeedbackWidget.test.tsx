import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackWidget } from "@/components/FeedbackWidget";

const mutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useSubmitFeedback: () => ({ mutateAsync, isPending: false }),
}));

describe("FeedbackWidget", () => {
  beforeEach(() => { mutateAsync.mockReset().mockResolvedValue(undefined); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("opens, submits, and thanks the user", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "the map is great");
    await user.click(screen.getByTestId("feedback-send"));
    expect(mutateAsync).toHaveBeenCalledWith({ data: { body: "the map is great" } });
    expect(await screen.findByTestId("feedback-thanks")).toBeInTheDocument();
  });

  it("disables Send for whitespace-only input", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
    await user.type(screen.getByTestId("feedback-input"), "   ");
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
  });

  it("marks the launcher expanded and moves focus to the textarea", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    const launcher = screen.getByTestId("feedback-button");
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    await user.click(launcher);
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(screen.getByTestId("feedback-input")).toHaveFocus());
  });

  it("closes on Escape and returns focus to the launcher", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("feedback-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("feedback-button")).toHaveFocus();
  });

  it("keeps the typed text when the request fails", async () => {
    mutateAsync.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "keep me");
    await user.click(screen.getByTestId("feedback-send"));
    expect(await screen.findByTestId("feedback-error")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-input")).toHaveValue("keep me");
  });

  it("shows a distinct message for a 429", async () => {
    mutateAsync.mockRejectedValue({ status: 429 });
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "again");
    await user.click(screen.getByTestId("feedback-send"));
    expect(await screen.findByTestId("feedback-error")).toHaveTextContent(/too many/i);
  });

  it("resets to a fresh form after the success auto-close", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "first");
    await user.click(screen.getByTestId("feedback-send"));
    await screen.findByTestId("feedback-thanks");
    vi.advanceTimersByTime(2500);
    await waitFor(() => expect(screen.queryByTestId("feedback-thanks")).not.toBeInTheDocument());
    await user.click(screen.getByTestId("feedback-button"));
    expect(screen.getByTestId("feedback-input")).toHaveValue("");
  });

  it("cannot be submitted twice while a request is in flight", async () => {
    let resolveIt: () => void = () => {};
    mutateAsync.mockImplementation(() => new Promise<void>(r => { resolveIt = r; }));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "once only");
    await user.click(screen.getByTestId("feedback-send"));
    // Still pending — the button must be disabled, and a second click a no-op.
    expect(screen.getByTestId("feedback-send")).toBeDisabled();
    await user.click(screen.getByTestId("feedback-send"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    resolveIt();
  });

  it("clears the auto-close timer on unmount", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const user = userEvent.setup();
    const { unmount } = render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    await user.type(screen.getByTestId("feedback-input"), "pending timer");
    await user.click(screen.getByTestId("feedback-send"));
    await screen.findByTestId("feedback-thanks");
    // Measure the DELTA across unmount. A bare toHaveBeenCalled() is already
    // satisfied before unmount(): findBy* goes through @testing-library/dom's
    // waitFor, which unconditionally clearTimeout()s its own overall-timeout
    // timer — so that assertion passes even with the cleanup effect deleted.
    const before = clearSpy.mock.calls.length;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
    // And the pending auto-close must not fire into an unmounted tree.
    vi.advanceTimersByTime(5000);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("states the anonymity guarantee without overclaiming", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByTestId("feedback-button"));
    const hint = screen.getByTestId("feedback-anonymity-hint");
    const text = hint.textContent ?? "";

    // QF-3 copy. The claim is scoped to what is actually controlled — what
    // gets STORED — because the request itself is authenticated.
    expect(hint).toHaveTextContent(/no account details saved/i);
    expect(hint).toHaveTextContent(/stored anonymously/i);
    // The guard against typing identifying text into the body survives the
    // rewording; QF-3 as originally specified dropped it.
    expect(hint).toHaveTextContent(/avoid personal details/i);

    // Unsupportable claims, guarded explicitly because this copy has already
    // been rewritten once and the tempting shorter sentences are the false
    // ones. `custom-fetch` sends credentials and the route is auth-gated, so
    // the server transiently knows the caller; only the stored row is
    // identity-free, and infra logs are outside this system's control.
    expect(text).not.toMatch(/won't know who you are/i);
    expect(text).not.toMatch(/we don't know who/i);
    // Bare "your feedback is anonymous" asserts more than "stored
    // anonymously" — it covers the request, not just the row.
    expect(text).not.toMatch(/feedback is anonymous/i);
  });
});
