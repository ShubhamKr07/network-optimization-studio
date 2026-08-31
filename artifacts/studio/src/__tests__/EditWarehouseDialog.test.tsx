import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditWarehouseDialog } from "@/components/workspace/map/dialogs/EditWarehouseDialog";
import type { MapWarehouse } from "@/components/workspace/map/types";

const warehouse: MapWarehouse = {
  id: "wh-1",
  displayCode: "CHI",
  city: "Chicago",
  state: "IL",
  lat: 41.8781,
  lng: -87.6298,
  capacity: 5000,
  status: "active",
  isAdded: false,
};

function renderDialog(props: Partial<React.ComponentProps<typeof EditWarehouseDialog>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <EditWarehouseDialog
      entity={warehouse}
      capacityMode="per_wh"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onSubmit, onCancel };
}

describe("EditWarehouseDialog", () => {
  it("shows the capacity input when capacityMode is per_wh", () => {
    renderDialog({ capacityMode: "per_wh" });
    expect(screen.getByTestId("edit-warehouse-capacity")).toBeInTheDocument();
  });

  it("omits the capacity input when capacityMode is not per_wh", () => {
    renderDialog({ capacityMode: "uniform" });
    expect(screen.queryByTestId("edit-warehouse-capacity")).not.toBeInTheDocument();
    renderDialog({ capacityMode: "none" });
    expect(screen.queryAllByTestId("edit-warehouse-capacity")).toHaveLength(0);
  });

  it("selecting a different status and saving calls onSubmit with that enum value", () => {
    const { onSubmit } = renderDialog();
    fireEvent.click(screen.getByTestId("edit-warehouse-status-forced_open"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));
    expect(onSubmit).toHaveBeenCalledWith({ status: "forced_open", capacity: 5000 });
  });

  it("Escape calls onCancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByTestId("edit-warehouse-dialog"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows read-only entity fields", () => {
    renderDialog();
    expect(screen.getByTestId("edit-warehouse-display-code")).toHaveTextContent("CHI");
    expect(screen.getByTestId("edit-warehouse-location")).toHaveTextContent("Chicago, IL");
    expect(screen.getByTestId("edit-warehouse-lat")).toHaveTextContent("41.8781");
    expect(screen.getByTestId("edit-warehouse-lng")).toHaveTextContent("-87.6298");
  });
});
