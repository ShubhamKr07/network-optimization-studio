import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapActionMenu } from "@/components/workspace/map/MapActionMenu";
import { MoveConfirmDialog } from "@/components/workspace/map/dialogs/MoveConfirmDialog";

const entity = { kind: "wh" as const, entity: { id: "aw-1", displayCode: "WH-CA-FRESNO-01", city: "Fresno", state: "CA", lat: 36.7, lng: -119.8, isAdded: true } };

describe("shared map dialogs keep their defaults", () => {
  it("MapActionMenu still asks 'Confirm delete?' by default; confirmDelete={false} deletes on the first click", () => {
    const onDelete = vi.fn();
    const props = { entity, containerPoint: { x: 0, y: 0 }, onEdit: vi.fn(), onMove: vi.fn(), onCopy: vi.fn(), onDelete, onClose: vi.fn() };
    const { unmount } = render(<MapActionMenu {...props} />);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("map-action-delete")).toHaveTextContent("Confirm delete?");
    unmount();
    render(<MapActionMenu {...props} confirmDelete={false} />);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
  it("MoveConfirmDialog shows the regenerated code by default and hides it with preserveIdentity", () => {
    const props = { kind: "wh" as const, entity: { id: "aw-1", displayCode: "WH-CA-FRESNO-01" }, newLat: 34.05, newLng: -118.24, existingCodes: [], onConfirm: vi.fn(), onCancel: vi.fn() };
    const { unmount } = render(<MoveConfirmDialog {...props} />);
    expect(screen.getByTestId("move-confirm-new-code")).toBeInTheDocument();
    unmount();
    render(<MoveConfirmDialog {...props} preserveIdentity />);
    expect(screen.queryByTestId("move-confirm-new-code")).not.toBeInTheDocument();
    expect(screen.getByTestId("move-confirm-identity-note")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ lat: 34.05, lng: -118.24 }));
  });
});
