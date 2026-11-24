import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
const passageState = { isError: false, isLoading: false, retry: undefined as boolean | undefined, body: "Full page text." };
vi.mock("@workspace/api-client-react", () => ({
  getGetWatBotPassageQueryKey: (id: number) => ["passage", id],
  useGetWatBotPassage: (id: number, o: { query: { enabled: boolean; retry: boolean } }) => ({
    data: o.query.enabled && !passageState.isError && !passageState.isLoading ? { id, label: "Ch 3 · p.38", body: passageState.body } : undefined,
    isError: o.query.enabled && passageState.isError, isLoading: o.query.enabled && passageState.isLoading,
    ...(passageState.retry = o.query.retry, {}),
  }),
  useSubmitWatBotReport: () => ({ mutateAsync, isPending: false }),
  useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }),
}));
import { WatBotMessages } from "@/components/workspace/watbot/WatBotMessages";

const items = [
  { kind: "student" as const, blocks: [{ text: "Why?", citations: [] }] },
  { kind: "tutor" as const, id: 9, blocks: [{ text: "Demand weights distance", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "P-median minimizes demand-weighted distance." }] }] },
  { kind: "notice" as const, blocks: [{ text: "One claim was removed — I couldn't support it with a course source.", citations: [] }] },
];

describe("WatBotMessages", () => {
  afterEach(() => { passageState.isError = false; passageState.isLoading = false; passageState.retry = undefined; passageState.body = "Full page text."; });
  it("renders student, tutor and notice messages distinctly", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    expect(screen.getByText("Why?").closest("[data-role]")).toHaveAttribute("data-role", "student");
    expect(screen.getByText(/Demand weights distance/).closest("[data-role]")).toHaveAttribute("data-role", "tutor");
    expect(screen.getByText(/One claim was removed/).closest("[data-role]")).toHaveAttribute("data-role", "notice");
  });

  it("citation chip opens a popover with the cited passage and the full source", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    expect(screen.getByText("P-median minimizes demand-weighted distance.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open full source" }));
    expect(screen.getByText("Full page text.")).toBeInTheDocument();
  });

  it("reports a cited answer with a reason and note", async () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Report this answer" }));
    fireEvent.click(screen.getByRole("radio", { name: "The citation doesn't support the answer" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Anything else/ }), { target: { value: "wrong page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(mutateAsync).toHaveBeenCalledWith({ data: { messageId: 9, reason: "citation_unsupported", note: "wrong page" } });
    expect(await screen.findByText("Thanks — reported. Your conversation continues.")).toBeInTheDocument();
  });

  it("shows checking source and a Stop control while a block is pending", () => {
    const onStop = vi.fn();
    render(<WatBotMessages items={[]} pending={{ searching: "Chapter 6" }} onStop={onStop} />);
    expect(screen.getByText(/Searching Chapter 6/)).toBeInTheDocument();
    expect(screen.getByText("checking source…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows queue position as text", () => {
    render(<WatBotMessages items={[]} pending={{ searching: null, queued: 2 }} onStop={vi.fn()} />);
    expect(screen.getByText(/number 2 in line/)).toBeInTheDocument();
  });

  it("shows 'Source unavailable' when the passage fails to load", () => {
    passageState.isError = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full source" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
    expect(passageState.retry).toBe(false);
  });

  it("shows 'Loading…' while the passage loads", () => {
    passageState.isLoading = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full source" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("hides 'Open full source' until the message has a server id (D23)", () => {
    const unsaved = [{ ...items[1]!, id: undefined }];
    render(<WatBotMessages items={unsaved} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    expect(screen.queryByRole("button", { name: "Open full source" })).toBeNull();
  });

  it("shows the rating line once, under the latest saved tutor answer, and only when idle", () => {
    const two = [...items, { kind: "student" as const, blocks: [{ text: "And now?", citations: [] }] },
      { kind: "tutor" as const, id: 12, blocks: [{ text: "Look at the zones.", citations: [] }] }];
    const fb = { conversationId: 5, onRepair: vi.fn() };
    const { rerender } = render(<WatBotMessages items={two} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.getAllByTestId("watbot-feedback")).toHaveLength(1);
    rerender(<WatBotMessages items={two} pending={{ searching: null }} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
    rerender(<WatBotMessages items={[...two.slice(0, 4), { kind: "tutor" as const, id: 13, blocks: [] }]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull(); // the latest answer was stopped/failed with no blocks
    rerender(<WatBotMessages items={two} pending={null} onStop={vi.fn()} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull(); // no conversation yet
  });

  it("never falls back to an earlier answer: a trailing student or notice hides the rating line", () => {
    const fb = { conversationId: 5, onRepair: vi.fn() };
    const student = { kind: "student" as const, blocks: [{ text: "And now?", citations: [] }] };
    render(<WatBotMessages items={[items[0]!, items[1]!, student]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
    render(<WatBotMessages items={[items[0]!, items[1]!, student, items[2]!]} pending={null} onStop={vi.fn()} feedback={fb} />);
    expect(screen.queryByTestId("watbot-feedback")).toBeNull();
  });

  // WATBOT-POPOVER-KATEX: the corpus stores formulas as $$…$$ LaTeX; the popover renders them.
  it("renders $$ LaTeX in the cited passage and the full source as math", async () => {
    passageState.body = "Page text $$\\sum_{i} d_i$$ continues.";
    const math = [{ kind: "tutor" as const, id: 9, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "The cost is $$x_{ij} + y$$ here." }] }] }];
    render(<WatBotMessages items={math} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full source" }));
    const popover = screen.getByRole("dialog");
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$$");
    expect(popover.textContent).toContain("The cost is");
    expect(popover.textContent).toContain("continues.");
  });

  it("keeps an unclosed $$ as text and shows invalid LaTeX without throwing", async () => {
    const math = [{ kind: "tutor" as const, id: 9, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "Bad $$\\frac{$$ then cut $$\\sum_i" }] }] }];
    render(<WatBotMessages items={math} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    const popover = screen.getByRole("dialog");
    await vi.waitFor(() => expect(popover.querySelector(".katex-error")).not.toBeNull());
    expect(popover.textContent).toContain("then cut $$\\sum_i");
  });

  // WATBOT-POPOVER-INLINE-MATH: the corpus also writes symbols as single-$ inline math.
  it("renders single-$ inline math that starts with a command, and leaves prices as text", async () => {
    const math = [{ kind: "tutor" as const, id: 9, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "For $\\forall$ j $\\in$ J, each site costs $2 or $3 more." }] }] }];
    render(<WatBotMessages items={math} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    const popover = screen.getByRole("dialog");
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$\\forall$");
    expect(popover.textContent).toContain("each site costs $2 or $3 more.");
  });

  it("caps the cited quote's height so a whole-page citation scrolls instead of running off screen", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    expect(screen.getByText("P-median minimizes demand-weighted distance.").closest("mark")).toHaveClass("max-h-48", "overflow-auto");
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[var(--radix-popover-content-available-height)]", "overflow-y-auto");
  });
});

