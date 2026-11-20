import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@workspace/api-client-react", () => ({
  useListWatBotConversations: () => ({ isLoading: false, data: [{ id: 7, modelId: "p-median-us", title: "Why open Dallas?", updatedAt: "2026-11-20T10:00:00Z" }] }),
}));
import { WatBotHistory } from "@/components/workspace/watbot/WatBotHistory";

describe("WatBotHistory", () => {
  it("picks a past conversation and starts a new one", () => {
    const onPick = vi.fn(); const onNew = vi.fn();
    render(<WatBotHistory modelId="p-median-us" onPick={onPick} onNew={onNew} />);
    fireEvent.click(screen.getByRole("button", { name: /Why open Dallas/ }));
    expect(onPick).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(onNew).toHaveBeenCalled();
  });
});
