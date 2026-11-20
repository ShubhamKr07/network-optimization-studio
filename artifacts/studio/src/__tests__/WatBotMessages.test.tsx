import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@workspace/api-client-react", () => ({
  useGetWatBotPassage: (id: number) => ({ data: id ? { id, label: "Ch 3 · p.38", body: "Full page text." } : undefined }),
  useSubmitWatBotReport: () => ({ mutateAsync, isPending: false }),
}));
import { WatBotMessages } from "@/components/workspace/watbot/WatBotMessages";

const items = [
  { kind: "student" as const, blocks: [{ text: "Why?", citations: [] }] },
  { kind: "tutor" as const, id: 9, blocks: [{ text: "Demand weights distance", citations: [{ passageId: 11, label: "Ch 3 · p.38", citedText: "P-median minimizes demand-weighted distance." }] }] },
  { kind: "notice" as const, blocks: [{ text: "One claim was removed — I couldn't support it with a course source.", citations: [] }] },
];

describe("WatBotMessages", () => {
  it("renders student, tutor and notice messages distinctly", () => {
    render(<WatBotMessages items={items} pending={null} />);
    expect(screen.getByText("Why?").closest("[data-role]")).toHaveAttribute("data-role", "student");
    expect(screen.getByText(/Demand weights distance/).closest("[data-role]")).toHaveAttribute("data-role", "tutor");
    expect(screen.getByText(/One claim was removed/).closest("[data-role]")).toHaveAttribute("data-role", "notice");
  });

  it("citation chip opens a popover with the cited passage and the full source", () => {
    render(<WatBotMessages items={items} pending={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Source: Ch 3 · p.38" }));
    expect(screen.getByText("P-median minimizes demand-weighted distance.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open full source" }));
    expect(screen.getByText("Full page text.")).toBeInTheDocument();
  });

  it("reports a cited answer with a reason and note", async () => {
    render(<WatBotMessages items={items} pending={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Report this answer" }));
    fireEvent.click(screen.getByRole("radio", { name: "The citation doesn't support the answer" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Anything else/ }), { target: { value: "wrong page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(mutateAsync).toHaveBeenCalledWith({ data: { messageId: 9, reason: "citation_unsupported", note: "wrong page" } });
    expect(await screen.findByText("Thanks — reported. Your conversation continues.")).toBeInTheDocument();
  });

  it("shows checking source and a Stop control while a block is pending", () => {
    const onStop = vi.fn();
    render(<WatBotMessages items={[]} pending={{ searching: "Chapter 6", streaming: true }} onStop={onStop} />);
    expect(screen.getByText(/Searching Chapter 6/)).toBeInTheDocument();
    expect(screen.getByText("checking source…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows queue position as text", () => {
    render(<WatBotMessages items={[]} pending={{ searching: null, queued: 2, streaming: true }} />);
    expect(screen.getByText(/number 2 in line/)).toBeInTheDocument();
  });
});
