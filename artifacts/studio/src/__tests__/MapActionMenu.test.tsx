import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapActionMenu } from "@/components/workspace/map/MapActionMenu";
import type { MapEntity } from "@/components/workspace/map/types";

const baseWh: MapEntity = {
  kind: "wh",
  entity: {
    id: "W1",
    displayCode: "WH01",
    city: "Dallas",
    state: "TX",
    lat: 32.7767,
    lng: -96.797,
    capacity: 12000,
    status: "active",
    isAdded: false,
  },
};

const addedCs: MapEntity = {
  kind: "cs",
  entity: {
    id: "C1",
    displayCode: "CS01",
    city: "Austin",
    state: "TX",
    lat: 30.2672,
    lng: -97.7431,
    demand: 5000,
    excluded: false,
    isAdded: true,
  },
};

function renderMenu(entity: MapEntity, overrides: Partial<Parameters<typeof MapActionMenu>[0]> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onMove: vi.fn(),
    onCopy: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
  const utils = render(
    <MapActionMenu
      entity={entity}
      containerPoint={{ x: 100, y: 100 }}
      onEdit={handlers.onEdit}
      onMove={handlers.onMove}
      onCopy={handlers.onCopy}
      onDelete={handlers.onDelete}
      onClose={handlers.onClose}
      {...overrides}
    />,
  );
  return { ...utils, handlers };
}

describe("MapActionMenu", () => {
  it("shows only Edit + Copy for a base (non-added) entity", () => {
    renderMenu(baseWh);
    expect(screen.getByTestId("map-action-edit")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-copy")).toBeInTheDocument();
    expect(screen.queryByTestId("map-action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-action-delete")).not.toBeInTheDocument();
  });

  it("shows all four actions for an added entity", () => {
    renderMenu(addedCs);
    expect(screen.getByTestId("map-action-edit")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-move")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-copy")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-delete")).toBeInTheDocument();
  });

  it("requires two clicks to delete: first shows Confirm delete?, does not call onDelete", async () => {
    const { handlers } = renderMenu(addedCs);
    const deleteButton = screen.getByTestId("map-action-delete");
    await userEvent.click(deleteButton);
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("map-action-delete")).toHaveTextContent("Confirm delete?");
  });

  it("calls onDelete on the second click", async () => {
    const { handlers } = renderMenu(addedCs);
    const deleteButton = screen.getByTestId("map-action-delete");
    await userEvent.click(deleteButton);
    await userEvent.click(screen.getByTestId("map-action-delete"));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onEdit/onMove/onCopy when clicked", async () => {
    const { handlers } = renderMenu(addedCs);
    await userEvent.click(screen.getByTestId("map-action-edit"));
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const { handlers } = renderMenu(addedCs);
    await userEvent.keyboard("{Escape}");
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on an outside click (click-away)", async () => {
    const handlers = {
      onEdit: vi.fn(),
      onMove: vi.fn(),
      onCopy: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn(),
    };
    render(
      <div>
        <div data-testid="outside">outside</div>
        <MapActionMenu entity={addedCs} containerPoint={{ x: 100, y: 100 }} {...handlers} />
      </div>,
    );
    await userEvent.click(screen.getByTestId("outside"));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the first item on mount and moves focus with ArrowDown/ArrowUp", async () => {
    renderMenu(addedCs);
    expect(screen.getByTestId("map-action-edit")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByTestId("map-action-move")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByTestId("map-action-edit")).toHaveFocus();
  });

  it("every action item is a real focusable button", () => {
    renderMenu(addedCs);
    for (const key of ["edit", "move", "copy", "delete"]) {
      const el = screen.getByTestId(`map-action-${key}`);
      expect(el.tagName).toBe("BUTTON");
    }
  });

  it("restores focus to the caller-supplied restoreFocusTo element on unmount", () => {
    // restoreFocusTo is captured by the CALLER (InputMapTab, synchronously
    // at the click that opened the menu) and passed in as a prop — the
    // component itself no longer reads `document.activeElement` on mount,
    // since that read raced with a previous menu instance's own unmount
    // cleanup when re-opening the menu in quick succession (see
    // MapActionMenu.tsx's mount-effect comment).
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderMenu(addedCs, { restoreFocusTo: trigger });
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("does not throw on unmount when restoreFocusTo is not provided", () => {
    const { unmount } = renderMenu(addedCs);
    expect(() => unmount()).not.toThrow();
  });
});
