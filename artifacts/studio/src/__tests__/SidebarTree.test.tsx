import { describe, it, expect, vi, beforeEach } from "vitest";
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
    onRenameScenario: vi.fn(),
    onCloneScenario: vi.fn(),
    onDeleteScenario: vi.fn(),
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

  it("styles the active input row with the book-cover selected-surface/green-rule treatment", () => {
    render(<SidebarTree {...baseProps()} activeEntityId="customers" />);
    const active = screen.getByTestId("sidebar-input-customers");
    expect(active.className).toContain("var(--surface-selected)");
    expect(active.className).toContain("var(--text-brand)");
    expect(active.className).toContain("var(--green-500)");
    const inactive = screen.getByTestId("sidebar-input-warehouses");
    expect(inactive.className).not.toContain("var(--surface-selected)");
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

  // CH4-18 — Chapter 4's output entries stay clickable even before the
  // selected step is solved (the tab itself renders the empty state); every
  // other model (the default, `keepOutputsClickable` unset) keeps today's
  // disabled-until-solved behaviour, proven above.
  it("keeps outputs clickable (not greyed/disabled) when keepOutputsClickable is true, even with no solved run", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} hasSolvedRun={false} keepOutputsClickable={true} />);
    const output = screen.getByTestId("sidebar-output-open-warehouses");
    expect(output).not.toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(output);
    expect(props.onOpenOutput).toHaveBeenCalledWith(props.outputs[0]);
  });
});

// A4.1 — scenario row operations: rename, clone, delete.
describe("SidebarTree — scenario row operations", () => {
  it("clicking Rename turns the row into an editable input pre-filled with the current name", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    const input = screen.getByTestId("input-rename-scenario-1");
    expect(input).toHaveValue("Baseline");
  });

  it("pressing Enter in the rename input commits via onRenameScenario with the trimmed new name", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    const input = screen.getByTestId("input-rename-scenario-1");
    await userEvent.clear(input);
    await userEvent.type(input, "  Renamed Baseline  {Enter}");
    expect(props.onRenameScenario).toHaveBeenCalledWith(1, "Renamed Baseline");
    // the row exits edit mode
    expect(screen.queryByTestId("input-rename-scenario-1")).not.toBeInTheDocument();
  });

  it("pressing Escape in the rename input cancels without calling onRenameScenario", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    const input = screen.getByTestId("input-rename-scenario-1");
    await userEvent.type(input, " edit{Escape}");
    expect(props.onRenameScenario).not.toHaveBeenCalled();
    expect(screen.queryByTestId("input-rename-scenario-1")).not.toBeInTheDocument();
  });

  it("renaming to a blank name does not call onRenameScenario", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    const input = screen.getByTestId("input-rename-scenario-1");
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");
    expect(props.onRenameScenario).not.toHaveBeenCalled();
  });

  it("clicking Clone calls onCloneScenario immediately, with no confirm step", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-clone-scenario-2"));
    expect(props.onCloneScenario).toHaveBeenCalledWith(2);
  });

  it("clicking Delete requires an explicit confirm before onDeleteScenario fires", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-delete-scenario-2"));
    expect(props.onDeleteScenario).not.toHaveBeenCalled();
    expect(screen.getByTestId("button-confirm-delete-2")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-confirm-delete-2"));
    expect(props.onDeleteScenario).toHaveBeenCalledWith(2);
  });

  it("cancelling the delete confirm does not call onDeleteScenario", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} />);
    await userEvent.click(screen.getByTestId("button-delete-scenario-2"));
    await userEvent.click(screen.getByTestId("button-cancel-delete-2"));
    expect(props.onDeleteScenario).not.toHaveBeenCalled();
    expect(screen.queryByTestId("button-confirm-delete-2")).not.toBeInTheDocument();
  });
});

// SBR-2 — collapse state, persistence, rail parity.
describe("SidebarTree — collapsed rail", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders collapsed when there is no stored preference and no prop", () => {
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "false");
  });

  it("lets an explicit defaultCollapsed prop win over the stored preference", () => {
    window.localStorage.setItem("nos:sidebar-collapsed", "true");
    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });

  it("uses the stored preference when no prop is supplied", () => {
    window.localStorage.setItem("nos:sidebar-collapsed", "false");
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });

  it("toggles both ways from the hamburger and persists the choice", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const toggle = screen.getByTestId("button-toggle-sidebar");

    await userEvent.click(toggle);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("false");

    await userEvent.click(toggle);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("true");
  });

  it("exposes the identical entry testids collapsed and expanded, each exactly once", () => {
    const ids = [
      "sidebar-input-warehouses",
      "sidebar-input-customers",
      "sidebar-output-open-warehouses",
      "sidebar-output-flows",
    ];

    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    for (const id of ids) expect(collapsed.container.querySelectorAll(`[data-testid="${id}"]`)).toHaveLength(1);
    collapsed.unmount();

    const expanded = render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    for (const id of ids) expect(expanded.container.querySelectorAll(`[data-testid="${id}"]`)).toHaveLength(1);
  });

  it("keeps all three section wrappers in the collapsed rail", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-section-scenarios")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-outputs")).toBeInTheDocument();
  });

  it("keeps each entry label in the DOM inside its own button while collapsed", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    // toHaveTextContent reads the button's OWN subtree — this is what the four
    // pre-existing assertions in this file and Workspace.test.tsx depend on.
    expect(screen.getByTestId("sidebar-input-warehouses")).toHaveTextContent("Warehouses");
    expect(screen.getByTestId("sidebar-output-flows")).toHaveTextContent("Flows");
  });

  it("renders an icon in every entry row in both states", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-input-warehouses").querySelector("svg")).not.toBeNull();
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-input-warehouses").querySelector("svg")).not.toBeNull();
  });

  it("still disables unsolved outputs in the collapsed rail", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} hasSolvedRun={false} />);
    const output = screen.getByTestId("sidebar-output-flows");
    expect(output).toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "true");
  });

  it("never applies truncate to a collapsed entry button (it would clip the label pill)", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-input-warehouses").className).not.toContain("truncate");
  });

  it("stacks the nav above the map, which carries an explicit z-index", () => {
    // .leaflet-container has z-index:0 (index.css:16-18) and the nav precedes the
    // content column in DOM order, so without this the pills paint under the map.
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const nav = screen.getByTestId("sidebar-tree");
    expect(nav.className).toContain("relative");
    expect(nav.className).toContain("z-50");
  });

  it("hides the collapsed label pill with opacity, never with visibility", () => {
    // Playwright's visibility check ignores opacity, and
    // e2e/empty-first-run-workspace.spec.ts:53 calls .toBeVisible() on sidebar
    // content; `invisible`/`hidden` would break it. pointer-events-none is what
    // actually stops a click landing on a non-hovered pill.
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const pill = screen.getByTestId("sidebar-input-warehouses").querySelector("span");
    expect(pill?.className).toContain("opacity-0");
    expect(pill?.className).toContain("pointer-events-none");
    expect(pill?.className).not.toContain("invisible");
  });

  it("drops the scroll container when collapsed and restores it when expanded", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    // An overflow-y-auto ancestor also clips horizontally, which would eat the
    // left-full label pill — see the spec's §4.5 constraint 3.
    expect(screen.getByTestId("sidebar-tree").className).not.toContain("overflow-y-auto");
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-tree").className).toContain("overflow-y-auto");
  });
});

// SBR-4 — the Scenarios rail icon, its flyout, and the rename/confirm latch.
describe("SidebarTree — collapsed Scenarios flyout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders a Scenarios rail trigger when collapsed and none when expanded", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("button-open-scenarios-flyout")).toBeInTheDocument();
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.queryByTestId("button-open-scenarios-flyout")).not.toBeInTheDocument();
  });

  it("expands the whole sidebar when the Scenarios rail icon is activated (D7)", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-open-scenarios-flyout"));
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("false");
  });

  it("mounts every scenario row exactly once while collapsed", () => {
    const { container } = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    for (const id of ["sidebar-scenario-1", "sidebar-scenario-2", "button-delete-scenario-1"]) {
      expect(container.querySelectorAll(`[data-testid="${id}"]`), id).toHaveLength(1);
    }
  });

  it("keeps the create button and the empty row inside the scenarios section while collapsed", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} scenarios={[]} activeScenarioId={null} />);
    const section = screen.getByTestId("sidebar-section-scenarios");
    expect(section).toContainElement(screen.getByTestId("button-create-scenario"));
    // e2e/empty-first-run-workspace.spec.ts:53,95 scope this string to the
    // section, because the first-run CTA duplicates it.
    expect(section).toContainElement(screen.getByText(/no scenarios yet/i));
  });

  it("scenario rows are still interactive inside the collapsed flyout", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-clone-scenario-2"));
    expect(props.onCloneScenario).toHaveBeenCalledWith(2);
  });

  it("latches the flyout open while a row is renaming, and releases it on commit (D6)", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} defaultCollapsed={true} />);
    const flyout = screen.getByTestId("sidebar-scenarios-flyout");

    expect(flyout).toHaveAttribute("data-pinned", "false");
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    expect(flyout).toHaveAttribute("data-pinned", "true");

    await userEvent.type(screen.getByTestId("input-rename-scenario-1"), "{Enter}");
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
  });

  it("latches the flyout open while a delete is awaiting confirmation, and releases it on cancel (D6)", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-delete-scenario-2"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    await userEvent.click(screen.getByTestId("button-cancel-delete-2"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
  });

  it("releases the latch when a row unmounts mid-rename (a list refetch dropping it)", async () => {
    const props = baseProps();
    const view = render(<SidebarTree {...props} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    // Scenario 1 disappears from the list while its rename is open.
    view.rerender(<SidebarTree {...props} defaultCollapsed={true} scenarios={[{ id: 2, name: "Best 3-4 DCs" }]} />);
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
  });

  it("releases an abandoned delete-confirm when the pointer leaves the flyout (review finding 1)", async () => {
    // Without this, the flyout stays pinned forever with pointer-events ENABLED
    // (the pinned branch deliberately drops pointer-events-none), leaving a
    // 224px interactive panel over the content column swallowing clicks on the
    // map and grids beneath it. A rename self-heals via the input's onBlur; a
    // started-then-abandoned delete has no equivalent release.
    const props = baseProps();
    render(<SidebarTree {...props} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-delete-scenario-2"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    await userEvent.unhover(screen.getByTestId("sidebar-section-scenarios"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
    expect(screen.queryByTestId("button-confirm-delete-2")).not.toBeInTheDocument();
    expect(props.onDeleteScenario).not.toHaveBeenCalled();
  });

  it("leaving the flyout does NOT cancel an in-progress rename", async () => {
    // Renames are deliberately exempt: blur already commits them, and clearing
    // one on mouse-leave could discard what the user typed.
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    await userEvent.unhover(screen.getByTestId("sidebar-section-scenarios"));
    expect(screen.getByTestId("input-rename-scenario-1")).toBeInTheDocument();
  });

  it("gives the flyout its own scroll box so a long list cannot clip", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const scroller = screen.getByTestId("sidebar-scenarios-flyout-scroll");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("max-h-");
  });
});
