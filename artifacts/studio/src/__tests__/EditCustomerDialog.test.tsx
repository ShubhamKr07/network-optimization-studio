import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditCustomerDialog } from "@/components/workspace/map/dialogs/EditCustomerDialog";
import { STATION_ROLE, type MapCustomer } from "@/components/workspace/map/types";

const customer: MapCustomer = {
  id: "cs-1",
  displayCode: "SPR",
  city: "Springfield",
  state: "IL",
  lat: 39.7817,
  lng: -89.6501,
  demand: 1000,
  excluded: false,
  isAdded: false,
};

function renderDialog(props: Partial<React.ComponentProps<typeof EditCustomerDialog>> = {}) {
  const onSubmit = vi.fn();
  const onLivePreview = vi.fn();
  const onCancel = vi.fn();
  render(
    <EditCustomerDialog
      entity={customer}
      onSubmit={onSubmit}
      onLivePreview={onLivePreview}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onSubmit, onLivePreview, onCancel };
}

describe("EditCustomerDialog", () => {
  it("defaults the demand input to the entity's current demand", () => {
    renderDialog();
    expect(screen.getByTestId("edit-customer-demand-input")).toHaveValue(1000);
  });

  it("moving the slider fires onLivePreview with the new number", () => {
    const { onLivePreview } = renderDialog();
    const thumb = screen.getByTestId("edit-customer-demand-slider").querySelector('[role="slider"]');
    expect(thumb).not.toBeNull();
    fireEvent.keyDown(thumb as HTMLElement, { key: "ArrowRight" });
    expect(onLivePreview).toHaveBeenCalled();
    expect(onLivePreview.mock.calls[0][0]).toBeGreaterThan(1000);
  });

  it("editing the number input fires onLivePreview and keeps the slider in sync", () => {
    const { onLivePreview } = renderDialog();
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "2500" } });
    expect(onLivePreview).toHaveBeenCalledWith(2500);
    const thumb = screen.getByTestId("edit-customer-demand-slider").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuenow", "2500");
  });

  it("Save calls onSubmit with the current demand value", () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "3000" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));
    expect(onSubmit).toHaveBeenCalledWith({ demand: 3000 });
  });

  it("Escape calls onCancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByTestId("edit-customer-dialog"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  // T4 (Bundle 2, Step 0) — role/editor config: STATION_ROLE only changes
  // the title, every field/testid here already applies unchanged.
  it("a role's label drives the dialog title (e.g. STATION_ROLE -> 'Edit station')", () => {
    renderDialog({ role: STATION_ROLE });
    expect(screen.getByTestId("edit-customer-dialog")).toHaveTextContent("Edit station");
  });

  it("omitting role defaults to CUSTOMER_ROLE — today's exact title, unchanged", () => {
    renderDialog();
    expect(screen.getByTestId("edit-customer-dialog")).toHaveTextContent("Edit customer");
  });
});
