import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityIdCell } from "@/components/tables/EntityIdCell";

describe("EntityIdCell", () => {
  it("renders a stacked City, State primary line with a mono displayId sub-label when location is known", () => {
    render(<EntityIdCell entityId="wh-1" displayId="WH-01" location={{ city: "Dallas", state: "TX" }} />);
    expect(screen.getByText("Dallas, TX")).toBeInTheDocument();
    const sub = screen.getByText("WH-01");
    expect(sub).toHaveClass("font-mono");
    expect(sub).toHaveClass("text-muted-foreground");
  });

  it("falls back to bare displayId when location is missing", () => {
    render(<EntityIdCell entityId="wh-2" displayId="WH-02" />);
    expect(screen.getByText("WH-02")).toBeInTheDocument();
    // No stacked City, State line should be present.
    expect(screen.queryByText(",")).not.toBeInTheDocument();
  });

  it("renders a scenario-added row's display code (not its canonical id) as displayId", () => {
    render(<EntityIdCell entityId="aw-abc123" displayId="WH-27" location={{ city: "Reno", state: "NV" }} />);
    expect(screen.getByText("Reno, NV")).toBeInTheDocument();
    expect(screen.getByText("WH-27")).toBeInTheDocument();
    expect(screen.queryByText("aw-abc123")).not.toBeInTheDocument();
  });

  it("renders the canonical id as displayId when no display code exists (legacy added row)", () => {
    render(<EntityIdCell entityId="aw-legacy1" displayId="aw-legacy1" location={{ city: "Reno", state: "NV" }} />);
    expect(screen.getByText("Reno, NV")).toBeInTheDocument();
    expect(screen.getByText("aw-legacy1")).toBeInTheDocument();
  });
});
