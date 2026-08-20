import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarTree } from "@/components/workspace/SidebarTree";

function baseProps() {
  return {
    scenarios: [
      { id: 1, name: "Baseline" },
      { id: 2, name: "Best 3-4 DCs" },
    ],
    activeScenarioId: 1 as number | null,
    onSelectScenario: vi.fn(),
    onCreateScenario: vi.fn(),
    inputs: [
      { id: "warehouses", label: "Warehouses" },
      { id: "customers", label: "Customers" },
    ],
    outputs: [
      { id: "open-warehouses", label: "Open Warehouses" },
      { id: "flows", label: "Flows" },
    ],
    hasSolvedRun: false,
    activeEntityId: null as string | null,
    onOpenInput: vi.fn(),
    onOpenOutput: vi.fn(),
  };
}

describe("SidebarTree", () => {
  it("renders the Scenarios, Inputs, and Outputs sections", () => {
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-section-scenarios")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-outputs")).toBeInTheDocument();
  });

  it("lists every scenario and marks the active one", () => {
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-scenario-1")).toHaveTextContent("Baseline");
    expect(screen.getByTestId("sidebar-scenario-2")).toHaveTextContent("Best 3-4 DCs");
    expect(screen.getByTestId("sidebar-scenario-1")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("sidebar-scenario-2")).toHaveAttribute("aria-current", "false");
  });

  it("clicking the + button calls onCreateScenario", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-create-scenario"));
    expect(props.onCreateScenario).toHaveBeenCalled();
  });

  it("clicking a scenario calls onSelectScenario with its id", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("sidebar-scenario-2"));
    expect(props.onSelectScenario).toHaveBeenCalledWith(2);
  });

  it("lists every input entry and opens it on click", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    expect(screen.getByTestId("sidebar-input-warehouses")).toHaveTextContent("Warehouses");
    expect(screen.getByTestId("sidebar-input-customers")).toHaveTextContent("Customers");
    await userEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(props.onOpenInput).toHaveBeenCalledWith(props.inputs[0]);
  });

  it("greys out and disables outputs when there is no solved run", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} hasSolvedRun={false} />);
    const output = screen.getByTestId("sidebar-output-open-warehouses");
    expect(output).toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(output);
    expect(props.onOpenOutput).not.toHaveBeenCalled();
  });

  it("enables outputs and opens them on click once a solved run exists", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} hasSolvedRun={true} />);
    const output = screen.getByTestId("sidebar-output-flows");
    expect(output).not.toBeDisabled();
    await userEvent.click(output);
    expect(props.onOpenOutput).toHaveBeenCalledWith(props.outputs[1]);
  });

  it("shows a placeholder when there are no scenarios yet", () => {
    render(<SidebarTree {...baseProps()} scenarios={[]} activeScenarioId={null} />);
    expect(screen.getByText(/no scenarios yet/i)).toBeInTheDocument();
  });
});
