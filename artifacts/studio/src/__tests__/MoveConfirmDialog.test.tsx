import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveConfirmDialog } from "@/components/workspace/map/dialogs/MoveConfirmDialog";
import { MINE_ROLE } from "@/components/workspace/map/types";

// Real gazetteer coordinates (see CreateEntityDialog.test.tsx's note).
const DALLAS = { lat: 32.793333, lng: -96.766513 };
const OKLAHOMA_CITY = { lat: 35.467079, lng: -97.513657 };

function renderDialog(props: Partial<React.ComponentProps<typeof MoveConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <MoveConfirmDialog
      kind="wh"
      entity={{ id: "aw-1", displayCode: "WH-TX-DALLAS-01" }}
      newLat={DALLAS.lat}
      newLng={DALLAS.lng}
      existingCodes={["WH-TX-DALLAS-01"]}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
}

describe("MoveConfirmDialog", () => {
  it("a nudge that stays nearest the same city keeps its own display code (self excluded from collisions)", () => {
    renderDialog();
    expect(screen.getByTestId("move-confirm-old-code")).toHaveTextContent("WH-TX-DALLAS-01");
    expect(screen.getByTestId("move-confirm-new-code")).toHaveTextContent("WH-TX-DALLAS-01");
    expect(screen.getByTestId("move-confirm-location")).toHaveTextContent("Dallas, TX");
  });

  it("moving to a new nearest city regenerates the display code for that city", () => {
    renderDialog({ newLat: OKLAHOMA_CITY.lat, newLng: OKLAHOMA_CITY.lng });
    expect(screen.getByTestId("move-confirm-new-code")).toHaveTextContent("WH-OK-OKLAHOMACITY-01");
    expect(screen.getByTestId("move-confirm-location")).toHaveTextContent("Oklahoma City, OK");
  });

  it("confirm emits displayCode/city/state/lat/lng and no id field", () => {
    const { onConfirm } = renderDialog({ newLat: OKLAHOMA_CITY.lat, newLng: OKLAHOMA_CITY.lng });
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0];
    expect(payload).toEqual({
      displayCode: "WH-OK-OKLAHOMACITY-01",
      city: "Oklahoma City",
      state: "OK",
      lat: OKLAHOMA_CITY.lat,
      lng: OKLAHOMA_CITY.lng,
    });
    expect(payload).not.toHaveProperty("id");
  });

  it("still avoids a real collision with a DIFFERENT entity's code at the destination city", () => {
    // Own code is WH-TX-DALLAS-01 (irrelevant here — it's excluded from the
    // set regardless), but WH-OK-OKLAHOMACITY-01 belongs to some other
    // entity and must still block the first slot at the new city.
    renderDialog({
      newLat: OKLAHOMA_CITY.lat,
      newLng: OKLAHOMA_CITY.lng,
      existingCodes: ["WH-TX-DALLAS-01", "WH-OK-OKLAHOMACITY-01"],
    });
    expect(screen.getByTestId("move-confirm-new-code")).toHaveTextContent("WH-OK-OKLAHOMACITY-02");
  });

  it("Escape calls onCancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByTestId("move-confirm-dialog"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("Cancel button calls onCancel without confirming", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("move-confirm-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // T4 (Bundle 2, Step 0) — role/editor config.
  describe("role config", () => {
    it("a role's uidKind (not the rendering kind) drives the regenerated display-code prefix — a mine gets MN-, not WH-", () => {
      renderDialog({ role: MINE_ROLE, entity: { id: "am-1", displayCode: "MN-TX-DALLAS-01" }, existingCodes: ["MN-TX-DALLAS-01"] });
      expect(screen.getByTestId("move-confirm-new-code")).toHaveTextContent(/^MN-/);
    });

    it("a role's label drives the dialog title", () => {
      renderDialog({ role: MINE_ROLE });
      expect(screen.getByTestId("move-confirm-dialog")).toHaveTextContent("Move mine");
    });

    it("omitting role defaults to WAREHOUSE_ROLE by kind='wh' — today's exact behavior, unchanged", () => {
      renderDialog();
      expect(screen.getByTestId("move-confirm-dialog")).toHaveTextContent("Move warehouse");
    });

    it("omitting role defaults to CUSTOMER_ROLE by kind='cs' — today's exact behavior, unchanged", () => {
      renderDialog({ kind: "cs" });
      expect(screen.getByTestId("move-confirm-dialog")).toHaveTextContent("Move customer");
    });
  });
});
