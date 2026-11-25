import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
// Made-up page text (never book text: this repo is public).
const PAGE = "Page intro.\n\nP-median minimizes demand-weighted distance.\n\nPage end.";
const passageState = { isError: false, isLoading: false, retry: undefined as boolean | undefined, enabled: undefined as boolean | undefined, body: PAGE };
vi.mock("@workspace/api-client-react", () => ({
  getGetWatBotPassageQueryKey: (id: number) => ["passage", id],
  useGetWatBotPassage: (id: number, o: { query: { enabled: boolean; retry: boolean } }) => ({
    data: o.query.enabled && !passageState.isError && !passageState.isLoading ? { id, label: "Ch 3 · p.38", body: passageState.body } : undefined,
    isError: o.query.enabled && passageState.isError, isLoading: o.query.enabled && passageState.isLoading,
    ...(passageState.retry = o.query.retry, passageState.enabled = o.query.enabled, {}),
  }),
  useSubmitWatBotReport: () => ({ mutateAsync, isPending: false }),
  useSubmitWatBotFeedback: () => ({ mutateAsync, isPending: false }),
}));
import { WatBotMessages } from "@/components/workspace/watbot/WatBotMessages";

const CITED = "P-median minimizes demand-weighted distance.";
const items = [
  { kind: "student" as const, blocks: [{ text: "Why?", citations: [] }] },
  { kind: "tutor" as const, id: 9, blocks: [{ text: "Demand weights distance", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: CITED }] }] },
  { kind: "notice" as const, blocks: [{ text: "Part of this answer was removed: it wasn't backed by a course source, or it gave away a result.", citations: [] }] },
];
const unsaved = (citedText: string) => [{ kind: "tutor" as const, blocks: [{ text: "See the book", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText }] }] }];
const saved = (citedText: string) => [{ ...unsaved(citedText)[0]!, id: 9 }];
const openChip = () => { fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" })); return screen.getByRole("dialog"); };

describe("WatBotMessages", () => {
  afterEach(() => { passageState.isError = false; passageState.isLoading = false; passageState.retry = undefined; passageState.enabled = undefined; passageState.body = PAGE; });
  it("renders student, tutor and notice messages distinctly", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    expect(screen.getByText("Why?").closest("[data-role]")).toHaveAttribute("data-role", "student");
    expect(screen.getByText(/Demand weights distance/).closest("[data-role]")).toHaveAttribute("data-role", "tutor");
    expect(screen.getByText(/Part of this answer was removed/).closest("[data-role]")).toHaveAttribute("data-role", "notice");
  });

  // WQF-A5: one view — the page, with the cited span highlighted inside it.
  it("a saved answer's chip opens straight to the page, with the cited text highlighted once", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent("Page intro.");
    expect([...popover.querySelectorAll("mark")].map((m) => m.textContent)).toEqual([CITED]);
    expect(popover.textContent!.split(CITED)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Open full source" })).toBeNull();
  });

  it("shows the page with no highlight when the citation is the whole page, or is not in it", () => {
    passageState.body = CITED;
    const { unmount } = render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    expect(openChip().querySelector("mark")).toBeNull();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    unmount();
    passageState.body = "Another page entirely.";
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    expect(popover.querySelector("mark")).toBeNull();
    expect(popover).toHaveTextContent("Another page entirely.");
    expect(popover.textContent).not.toContain(CITED); // never the separate quote
  });

  it("shows the cited text while the page loads, with no separate status line", () => {
    passageState.isLoading = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an unsaved answer shows the cited text and never requests the page (D23)", () => {
    render(<WatBotMessages items={unsaved(CITED)} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(passageState.enabled).toBe(false);
  });

  it("keeps the cited text and says 'Source unavailable' when the page fails to load", () => {
    passageState.isError = true;
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
    expect(screen.getByTestId("watbot-source")).toHaveTextContent(CITED);
    expect(passageState.retry).toBe(false);
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

  // WATBOT-POPOVER-KATEX + WQF-A5: formulas render as math, and a formula inside the cited span stays unmarked.
  it("renders the page's LaTeX as math and marks only the text around a formula in the cited span", async () => {
    passageState.body = "Page text $$\\sum_{i} d_i$$ continues. The cost is $$x_{ij} + y$$ here. Page end.";
    render(<WatBotMessages items={saved("The cost is $$x_{ij} + y$$ here.")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$$");
    expect([...popover.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["The cost is ", " here."]);
    expect(popover.querySelector("mark .katex")).toBeNull();
    expect(popover.textContent).toContain("continues.");
  });

  it("keeps an unclosed $$ as text and shows invalid LaTeX without throwing", async () => {
    render(<WatBotMessages items={unsaved("Bad $$\\frac{$$ then cut $$\\sum_i")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelector(".katex-error")).not.toBeNull());
    expect(popover.textContent).toContain("then cut $$\\sum_i");
  });

  // WATBOT-POPOVER-INLINE-MATH: the corpus also writes symbols as single-$ inline math.
  it("renders single-$ inline math that starts with a command, and leaves prices as text", async () => {
    render(<WatBotMessages items={unsaved("For $\\forall$ j $\\in$ J, each site costs $2 or $3 more.")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(2));
    expect(popover.textContent).not.toContain("$\\forall$");
    expect(popover.textContent).toContain("each site costs $2 or $3 more.");
  });

  it("caps the page's height so a long passage scrolls inside the popover", () => {
    render(<WatBotMessages items={items} pending={null} onStop={vi.fn()} />);
    openChip();
    expect(screen.getByTestId("watbot-source")).toHaveClass("max-h-48", "overflow-auto", "whitespace-pre-wrap");
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[var(--radix-popover-content-available-height)]", "overflow-y-auto");
  });

  it("never lets an unclosed $\\cmd run past the end of its line", async () => {
    render(<WatBotMessages items={unsaved("cut $\\forall\nnew para $$x$$ costs $5")} pending={null} onStop={vi.fn()} />);
    const popover = openChip();
    await vi.waitFor(() => expect(popover.querySelectorAll(".katex")).toHaveLength(1));
    expect(screen.getByTestId("watbot-source").textContent).toContain("cut $\\forall");
    expect(screen.getByTestId("watbot-source").textContent).toContain("costs $5");
  });
});
