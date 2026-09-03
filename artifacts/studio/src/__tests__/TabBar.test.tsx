import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "@/components/workspace/TabBar";
import type { WorkspaceTab } from "@/lib/workspaceTabs";

function makeTabs(): WorkspaceTab[] {
  return [
    { id: "input:warehouses", kind: "input", entity: "warehouses", label: "Warehouses" },
    { id: "input:customers", kind: "input", entity: "customers", label: "Customers" },
    { id: "output:flows", kind: "output", entity: "flows", label: "Flows" },
  ];
}

function baseProps() {
  return {
    tabs: makeTabs(),
    activeTabId: "input:customers" as string | null,
    onActivate: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TabBar", () => {
  it("shows an empty state and no tab buttons when no tabs are open", () => {
    render(<TabBar tabs={[]} activeTabId={null} onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("tab-bar-empty")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("renders one tab per open tab, in order, with its label", () => {
    render(<TabBar {...baseProps()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("Warehouses");
    expect(tabs[1]).toHaveTextContent("Customers");
    expect(tabs[2]).toHaveTextContent("Flows");
  });

  it("marks the active tab via aria-selected", () => {
    render(<TabBar {...baseProps()} />);
    expect(screen.getByTestId("tab-input:customers")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tab-input:warehouses")).toHaveAttribute("aria-selected", "false");
  });

  it("gives the active tab a top green rule via inset box-shadow, not a bottom border", () => {
    render(<TabBar {...baseProps()} />);
    expect(screen.getByTestId("tab-input:customers")).toHaveStyle({ boxShadow: "inset 0 2px 0 var(--green-500)" });
    expect(screen.getByTestId("tab-input:warehouses")).toHaveStyle({ boxShadow: "none" });
  });

  it("clicking a tab calls onActivate with its id", async () => {
    const props = baseProps();
    render(<TabBar {...props} />);
    await userEvent.click(screen.getByTestId("tab-input:warehouses"));
    expect(props.onActivate).toHaveBeenCalledWith("input:warehouses");
  });

  it("clicking a tab's close button calls onClose with its id, not onActivate", async () => {
    const props = baseProps();
    render(<TabBar {...props} />);
    await userEvent.click(screen.getByTestId("tab-close-output:flows"));
    expect(props.onClose).toHaveBeenCalledWith("output:flows");
    expect(props.onActivate).not.toHaveBeenCalled();
  });
});
