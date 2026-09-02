import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { MINE_ROLE, REFINERY_ROLE, STATION_ROLE } from "@/components/workspace/map/types";

// Reno, NV per the real gazetteer entry (lat 39.549097, lng -119.849907) —
// (39.53, -119.81) is nearest to it, not any other gazetteer city.
const RENO_LAT = 39.53;
const RENO_LNG = -119.81;

function renderDialog(props: Partial<React.ComponentProps<typeof CreateEntityDialog>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <CreateEntityDialog
      kind="wh"
      lat={RENO_LAT}
      lng={RENO_LNG}
      existingCodes={[]}
      medianDemand={5000}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onSubmit, onCancel };
}

describe("CreateEntityDialog", () => {
  it("reverse-geocodes on open and prefills city/state/display code", () => {
    renderDialog();
    expect(screen.getByTestId("create-entity-city")).toHaveValue("Reno");
    expect(screen.getByTestId("create-entity-state")).toHaveValue("NV");
    expect(screen.getByTestId("create-entity-display-code")).toHaveTextContent("WH-NV-RENO-01");
  });

  it("editing the city regenerates the display code deterministically", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Sparks" } });
    expect(screen.getByTestId("create-entity-display-code")).toHaveTextContent("WH-NV-SPARKS-01");
  });

  it("submit returns a fully-assembled AddedWarehouseInput with an aw- id", () => {
    const { onSubmit } = renderDialog();
    fireEvent.click(screen.getByTestId("create-entity-status-forced_open"));
    fireEvent.change(screen.getByTestId("create-entity-capacity"), { target: { value: "1200" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0][0];
    expect(input.id).toMatch(/^aw-/);
    expect(input).toMatchObject({
      displayCode: "WH-NV-RENO-01",
      city: "Reno",
      state: "NV",
      lat: RENO_LAT,
      lng: RENO_LNG,
      capacity: 1200,
      status: "forced_open",
    });
  });

  it("submit for a customer returns an ac- id and the demand field, no status/capacity", () => {
    const { onSubmit } = renderDialog({ kind: "cs" });
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const input = onSubmit.mock.calls[0][0];
    expect(input.id).toMatch(/^ac-/);
    expect(input).toMatchObject({
      displayCode: "CS-NV-RENO-01",
      demand: 300,
    });
    expect(input.status).toBeUndefined();
    expect(input.capacity).toBeUndefined();
  });

  it("defaults customer demand to medianDemand when there is no copyFrom", () => {
    renderDialog({ kind: "cs", medianDemand: 4242 });
    expect(screen.getByTestId("create-entity-demand")).toHaveValue(4242);
  });

  it("copy variant prefills capacity/demand from copyFrom and shows the (copy) title", () => {
    renderDialog({ copyFrom: { capacity: 777 } });
    expect(screen.getByTestId("create-entity-capacity")).toHaveValue(777);
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("(copy)");

    renderDialog({ kind: "cs", copyFrom: { demand: 555 } });
    expect(screen.getByTestId("create-entity-demand")).toHaveValue(555);
  });

  it("Escape calls onCancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByTestId("create-entity-dialog"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("Cancel button calls onCancel without submitting", () => {
    const { onCancel, onSubmit } = renderDialog();
    fireEvent.click(screen.getByTestId("create-entity-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // T4 (Bundle 2, Step 0) — role/editor config.
  describe("role config", () => {
    it("a role with hasStatus:false (e.g. MINE_ROLE) renders no status control and persists no status field at all", () => {
      const { onSubmit } = renderDialog({ role: MINE_ROLE });
      expect(screen.queryByTestId("create-entity-status")).not.toBeInTheDocument();
      // Capacity is still a real field for a mine (MINE_ROLE has a valueField).
      expect(screen.getByTestId("create-entity-capacity")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input).not.toHaveProperty("status");
    });

    it("a role's uidKind (not the rendering kind) drives the minted id/display-code prefix — a mine gets am-/MN-, not aw-/WH-", () => {
      const { onSubmit } = renderDialog({ role: MINE_ROLE });
      expect(screen.getByTestId("create-entity-display-code")).toHaveTextContent(/^MN-/);
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input.id).toMatch(/^am-/);
      expect(input.displayCode).toMatch(/^MN-/);
    });

    it("a role's label drives the dialog title", () => {
      renderDialog({ role: MINE_ROLE });
      expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New mine");
    });

    it("REFINERY_ROLE keeps status AND the aw-/WH- uid prefix (DD-7: refineries reuse wh, no ar- prefix)", () => {
      const { onSubmit } = renderDialog({ role: REFINERY_ROLE });
      expect(screen.getByTestId("create-entity-status")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input.id).toMatch(/^aw-/);
      expect(input.status).toBe("active");
    });

    it("omitting role defaults to WAREHOUSE_ROLE/CUSTOMER_ROLE — today's exact p-median-us behavior, unchanged", () => {
      renderDialog();
      expect(screen.getByTestId("create-entity-status")).toBeInTheDocument();
      expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New warehouse");
    });
  });

  // Cleanup pass — CreateEntityDialog's Capacity field now mirrors
  // EditWarehouseDialog's own capacityMode gate (a refinery has no capacity
  // concept at all; a per-warehouse capacity mode still needs it).
  describe("capacityMode gate", () => {
    it("REFINERY_ROLE with capacityMode='none' renders no Capacity field and submits no capacity key", () => {
      const { onSubmit } = renderDialog({ role: REFINERY_ROLE, capacityMode: "none" });
      expect(screen.queryByTestId("create-entity-capacity")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input).not.toHaveProperty("capacity");
    });

    it("a per_wh warehouse (default WAREHOUSE_ROLE) still shows and submits Capacity", () => {
      const { onSubmit } = renderDialog({ capacityMode: "per_wh" });
      expect(screen.getByTestId("create-entity-capacity")).toBeInTheDocument();
      fireEvent.change(screen.getByTestId("create-entity-capacity"), { target: { value: "900" } });
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input.capacity).toBe(900);
    });

    it("a warehouse with capacityMode='none'/'uniform' hides Capacity too — mirrors EditWarehouseDialog's showValueField exactly", () => {
      renderDialog({ capacityMode: "none" });
      expect(screen.queryByTestId("create-entity-capacity")).not.toBeInTheDocument();
    });

    it("MINE_ROLE with no capacityMode prop (undefined — mines have no capacityMode concept) still shows Capacity", () => {
      renderDialog({ role: MINE_ROLE });
      expect(screen.getByTestId("create-entity-capacity")).toBeInTheDocument();
    });
  });

  // T8 (Bundle 2.2, A3) — a newly-created customer is always "added", so the
  // gate here is simpler than EditCustomerDialog's (no base-vs-added
  // branch): role.supportsExclusion (CUSTOMER_ROLE only) AND the model
  // capability `supportsAddedCustomerExclusion`.
  describe("Active/Excluded status control (T8, Bundle 2.2, A3)", () => {
    it("kind='cs' (customer branch) with supportsAddedCustomerExclusion=true shows the control and submits the selected status", () => {
      const { onSubmit } = renderDialog({ kind: "cs", supportsAddedCustomerExclusion: true });
      expect(screen.getByTestId("create-entity-cs-status")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("create-entity-cs-status-excluded"));
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input.status).toBe("excluded");
    });

    it("kind='cs' with supportsAddedCustomerExclusion=true defaults the radio to Active and submits status:'active'", () => {
      const { onSubmit } = renderDialog({ kind: "cs", supportsAddedCustomerExclusion: true });
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input.status).toBe("active");
    });

    it("kind='cs' with supportsAddedCustomerExclusion omitted (default false) hides the control and submits no status key — matches the existing 'no status/capacity' coverage above", () => {
      renderDialog({ kind: "cs" });
      expect(screen.queryByTestId("create-entity-cs-status")).not.toBeInTheDocument();
    });

    it("STATION_ROLE (kind='cs') NEVER shows the control, even with supportsAddedCustomerExclusion=true (negative — role gate wins)", () => {
      const { onSubmit } = renderDialog({ kind: "cs", role: STATION_ROLE, supportsAddedCustomerExclusion: true });
      expect(screen.queryByTestId("create-entity-cs-status")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("create-entity-submit"));
      const input = onSubmit.mock.calls[0][0];
      expect(input).not.toHaveProperty("status");
    });

    it("kind='wh' never renders the customer status control regardless of the capability prop", () => {
      renderDialog({ kind: "wh", supportsAddedCustomerExclusion: true });
      expect(screen.queryByTestId("create-entity-cs-status")).not.toBeInTheDocument();
    });
  });
});
