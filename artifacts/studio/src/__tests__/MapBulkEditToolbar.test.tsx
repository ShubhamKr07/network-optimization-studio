import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapBulkEditToolbar } from "@/components/MapBulkEditToolbar";

describe("MapBulkEditToolbar", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = render(
      <MapBulkEditToolbar
        selectedWarehouseIds={[]}
        selectedCustomerIds={[]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a mixed-selection warning and disables all actions when both warehouses and customers are selected", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1"]}
        selectedCustomerIds={["C1"]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByText(/select only one entity type/i)).toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-set-capacity")).not.toBeInTheDocument();
  });

  it("applies a bulk capacity set to all selected warehouses", async () => {
    const onSetWarehouseCapacity = vi.fn();
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1", "W2"]}
        selectedCustomerIds={[]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={onSetWarehouseCapacity}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByTestId("input-bulk-capacity"), "50000");
    await userEvent.click(screen.getByTestId("button-bulk-set-capacity"));
    expect(onSetWarehouseCapacity).toHaveBeenCalledWith(["W1", "W2"], 50000);
  });

  it("applies a bulk exclude to all selected customers", async () => {
    const onSetCustomerStatus = vi.fn();
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={[]}
        selectedCustomerIds={["C1", "C2"]}
        capacityMode="none"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={onSetCustomerStatus}
        onClearSelection={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-bulk-exclude"));
    expect(onSetCustomerStatus).toHaveBeenCalledWith(["C1", "C2"], "excluded");
  });

  it("hides the capacity input when capacityMode is not per_wh", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1"]}
        selectedCustomerIds={[]}
        capacityMode="uniform"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("input-bulk-capacity")).not.toBeInTheDocument();
  });

  it("hides status buttons entirely for transport-coal (mines have no status concept)", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["KY"]}
        selectedCustomerIds={[]}
        capacityMode="per_wh"
        entityKind="mine-station"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-bulk-set-capacity")).toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-force-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-clear-status")).not.toBeInTheDocument();
  });

  it("hides the exclude button for transport-coal stations", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={[]}
        selectedCustomerIds={["CHI"]}
        capacityMode="none"
        entityKind="mine-station"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-bulk-set-demand")).toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-exclude")).not.toBeInTheDocument();
  });

  it('labels the clear-selection button "Deselect all"', () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1"]}
        selectedCustomerIds={[]}
        capacityMode="none"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-bulk-cancel")).toHaveTextContent("Deselect all");
  });

  describe("restrict solver to selection", () => {
    it("calls onMakeWarehousesExclusive with the selected warehouse ids when clicked", async () => {
      const onMakeWarehousesExclusive = vi.fn();
      render(
        <MapBulkEditToolbar
          selectedWarehouseIds={["W1", "W2"]}
          selectedCustomerIds={[]}
          capacityMode="none"
          onSetWarehouseCapacity={vi.fn()}
          onSetWarehouseStatus={vi.fn()}
          onSetCustomerDemand={vi.fn()}
          onSetCustomerStatus={vi.fn()}
          onMakeWarehousesExclusive={onMakeWarehousesExclusive}
          onClearSelection={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByTestId("button-bulk-make-exclusive"));
      expect(onMakeWarehousesExclusive).toHaveBeenCalledWith(["W1", "W2"]);
    });

    it("calls onMakeCustomersExclusive with the selected customer ids when clicked", async () => {
      const onMakeCustomersExclusive = vi.fn();
      render(
        <MapBulkEditToolbar
          selectedWarehouseIds={[]}
          selectedCustomerIds={["C1", "C2"]}
          capacityMode="none"
          onSetWarehouseCapacity={vi.fn()}
          onSetWarehouseStatus={vi.fn()}
          onSetCustomerDemand={vi.fn()}
          onSetCustomerStatus={vi.fn()}
          onMakeCustomersExclusive={onMakeCustomersExclusive}
          onClearSelection={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByTestId("button-bulk-make-exclusive"));
      expect(onMakeCustomersExclusive).toHaveBeenCalledWith(["C1", "C2"]);
    });

    it("does not render when the corresponding onMake*Exclusive prop is omitted (back-compat)", () => {
      render(
        <MapBulkEditToolbar
          selectedWarehouseIds={["W1"]}
          selectedCustomerIds={[]}
          capacityMode="none"
          onSetWarehouseCapacity={vi.fn()}
          onSetWarehouseStatus={vi.fn()}
          onSetCustomerDemand={vi.fn()}
          onSetCustomerStatus={vi.fn()}
          onClearSelection={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("button-bulk-make-exclusive")).not.toBeInTheDocument();
    });

    it("does not render for transport-coal (mine-station has no status concept)", () => {
      render(
        <MapBulkEditToolbar
          selectedWarehouseIds={["KY"]}
          selectedCustomerIds={[]}
          capacityMode="per_wh"
          entityKind="mine-station"
          onSetWarehouseCapacity={vi.fn()}
          onSetWarehouseStatus={vi.fn()}
          onSetCustomerDemand={vi.fn()}
          onSetCustomerStatus={vi.fn()}
          onMakeWarehousesExclusive={vi.fn()}
          onClearSelection={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("button-bulk-make-exclusive")).not.toBeInTheDocument();
    });
  });
});
