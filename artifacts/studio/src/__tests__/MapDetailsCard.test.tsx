import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapDetailsCard } from "@/components/workspace/map/MapDetailsCard";
import { entityActionsFor, actionsInContext } from "@/components/workspace/map/MapActionMenu";
import type { MapEntity } from "@/components/workspace/map/types";
import { placeCard } from "@/components/workspace/map/placeCard";

const A = { x: 100, y: 100 };
const C = { width: 800, height: 600 };

const wh: MapEntity = {
  kind: "wh",
  entity: {
    id: "W1",
    displayCode: "WH01",
    city: "Dallas",
    state: "TX",
    lat: 32.7767,
    lng: -96.797,
    capacity: 12000,
    status: "forced_open",
    isAdded: false,
  },
};

const cs: MapEntity = {
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

// jade-T12 (Chapter 9 JADE) — the third map-entity kind: no capacity, no
// demand, no status.
const pl: MapEntity = {
  kind: "pl",
  entity: {
    id: "P1",
    displayCode: "PL01",
    city: "Ashland",
    state: "KY",
    lat: 38.4483,
    lng: -82.6662,
    isAdded: false,
  },
};

describe("MapDetailsCard", () => {
  it("shows neither capacity nor demand nor status for a plant entity (jade-T12)", () => {
    render(<MapDetailsCard entity={pl} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.queryByTestId("map-details-capacity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-demand")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-status")).not.toBeInTheDocument();
    // DU-2.7 — header is name + mono ID; map-details-code holds exactly the ID.
    expect(screen.getByTestId("map-details-name")).toHaveTextContent("Ashland, KY · PL01");
    expect(screen.getByTestId("map-details-code")).toHaveTextContent(/^PL01$/);
    expect(screen.getByTestId("map-details-code")).toHaveClass("font-mono");
    expect(screen.getByRole("dialog", { name: "Ashland, KY (PL01) details" })).toBeInTheDocument();
  });

  it("shows capacity + status label for a warehouse entity", () => {
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-capacity")).toHaveTextContent("12,000 units");
    expect(screen.getByTestId("map-details-status")).toHaveTextContent("Fixed-Open");
    expect(screen.queryByTestId("map-details-demand")).not.toBeInTheDocument();
  });

  // T4 (Bundle 2) — R3 capability gate seam: a warehouse-role entity with no
  // status (a role with hasStatus:false, e.g. a mine) shows capacity but no
  // status badge at all — never crashes on the absent `status` field.
  it("shows capacity but no status badge for a warehouse-role entity with no status (hasStatus:false role)", () => {
    const mine: MapEntity = { kind: "wh", entity: { ...wh.entity, status: undefined } };
    render(<MapDetailsCard entity={mine} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-capacity")).toHaveTextContent("12,000 units");
    expect(screen.queryByTestId("map-details-status")).not.toBeInTheDocument();
  });

  it("shows demand for a customer entity, no capacity/status fields", () => {
    render(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-demand")).toHaveTextContent("5,000 units");
    expect(screen.queryByTestId("map-details-capacity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-status")).not.toBeInTheDocument();
  });

  it("shows the name once (header only) and 4-decimal lat/lng for either kind", () => {
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-name")).toHaveTextContent("Dallas, TX");
    expect(screen.queryByTestId("map-details-city")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Dallas, TX/)).toHaveLength(1);
    expect(screen.getByTestId("map-details-lat")).toHaveTextContent("32.7767");
    expect(screen.getByTestId("map-details-lng")).toHaveTextContent("-96.7970");
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={onClose} actions={[]} onAction={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on an outside click (click-away)", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={onClose} actions={[]} onAction={vi.fn()} />
      </div>,
    );
    await userEvent.click(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("flips left of the marker when near the right container edge", () => {
    render(
      <MapDetailsCard entity={wh} anchor={{ x: 780, y: 100 }} markerSize={32} containerSize={C}
        onClose={vi.fn()} actions={[]} onAction={vi.fn()} />,
    );
    const card = screen.getByTestId("map-details-card");
    expect(card.getAttribute("data-flipped-x")).toBe("true");
    expect(parseFloat(card.style.left) + 224).toBeLessThanOrEqual(780 - 16 - 24);
  });

  it("flips above the marker when near the bottom container edge", () => {
    render(
      <MapDetailsCard entity={wh} anchor={{ x: 100, y: 580 }} markerSize={32} containerSize={C}
        onClose={vi.fn()} actions={[]} onAction={vi.fn()} />,
    );
    const card = screen.getByTestId("map-details-card");
    expect(card.getAttribute("data-flipped-y")).toBe("true");
    expect(parseFloat(card.style.top) + 230).toBeLessThanOrEqual(580 - 16 - 24);
  });

  it("is positioned by placeCard from the anchor (the marker), not a click point", () => {
    const anchor = { x: 300, y: 250 };
    render(<MapDetailsCard entity={wh} anchor={anchor} markerSize={44} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    const card = screen.getByTestId("map-details-card");
    const want = placeCard(anchor, { width: 224, height: 230 }, C, 44);
    expect(card.style.left).toBe(`${want.left}px`);
    expect(card.style.top).toBe(`${want.top}px`);
  });

  it("has a Close button (min-h-6 min-w-6) that calls onClose", async () => {
    const onClose = vi.fn();
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={onClose} actions={[]} onAction={vi.fn()} />);
    const close = screen.getByTestId("map-details-close");
    expect(close).toHaveAttribute("aria-label", "Close");
    expect(close).toHaveClass("min-h-6", "min-w-6");
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // DU-3.1 — the footer hint and the button row derive from `actions` (the one
  // list, actionsInContext), never from a per-view prop.
  it("derives the footer hint from the actions (base: Edit · Copy; added: all four)", () => {
    const { rerender } = render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(wh)} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-footer")).toHaveTextContent("Right-click for Edit · Copy");
    rerender(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(cs)} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-footer")).toHaveTextContent("Right-click for Edit · Move · Copy · Delete");
  });

  it("fixed geography: Edit-only hint and a single Edit button", () => {
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={actionsInContext(wh, { fixedGeography: true })} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-footer")).toHaveTextContent("Right-click for Edit");
    expect(screen.getByTestId("map-details-footer")).not.toHaveTextContent("Copy");
    expect(screen.getByTestId("map-details-action-edit")).toBeInTheDocument();
    expect(screen.queryByTestId("map-details-action-copy")).not.toBeInTheDocument();
  });

  it("renders min-h-6 buttons for base (edit, copy) and no move/delete", () => {
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(wh)} onAction={vi.fn()} />);
    for (const k of ["edit", "copy"]) expect(screen.getByTestId(`map-details-action-${k}`)).toHaveClass("min-h-6");
    expect(screen.queryByTestId("map-details-action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-action-delete")).not.toBeInTheDocument();
  });

  it("clicking a button calls onAction with its key", async () => {
    const onAction = vi.fn();
    render(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(cs)} onAction={onAction} />);
    await userEvent.click(screen.getByTestId("map-details-action-move"));
    expect(onAction).toHaveBeenCalledWith("move");
  });

  it("delete is two-step by default and one-step with confirmDelete={false}", async () => {
    const onAction = vi.fn();
    const { rerender } = render(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(cs)} onAction={onAction} />);
    await userEvent.click(screen.getByTestId("map-details-action-delete"));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("map-details-action-delete")).toHaveTextContent("Confirm delete?");
    await userEvent.click(screen.getByTestId("map-details-action-delete"));
    expect(onAction).toHaveBeenCalledWith("delete");
    onAction.mockClear();
    rerender(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={entityActionsFor(cs)} onAction={onAction} confirmDelete={false} />);
    await userEvent.click(screen.getByTestId("map-details-action-delete"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("re-selecting a different entity disarms an armed Delete", async () => {
    const other: MapEntity = { kind: "cs", entity: { ...(cs.entity as object), id: "C2", displayCode: "CS02" } as never };
    const props = { anchor: A, markerSize: 32, containerSize: C, onClose: vi.fn(), onAction: vi.fn() };
    const { rerender } = render(<MapDetailsCard entity={cs} actions={entityActionsFor(cs)} {...props} />);
    await userEvent.click(screen.getByTestId("map-details-action-delete"));
    expect(screen.getByTestId("map-details-action-delete")).toHaveTextContent("Confirm delete?");
    rerender(<MapDetailsCard entity={other} actions={entityActionsFor(other)} {...props} />);
    expect(screen.getByTestId("map-details-action-delete")).not.toHaveTextContent("Confirm delete?");
  });

  it("actions=[] renders neither the footer nor the button row", () => {
    render(<MapDetailsCard entity={cs} anchor={A} markerSize={32} containerSize={C} onClose={vi.fn()} actions={[]} onAction={vi.fn()} />);
    expect(screen.queryByTestId("map-details-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-actions")).not.toBeInTheDocument();
  });

  it("Tab from the card root reaches the first action button; Escape still closes", async () => {
    const onClose = vi.fn();
    render(<MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={onClose} actions={entityActionsFor(wh)} onAction={vi.fn()} />);
    expect(screen.getByTestId("map-details-card")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId("map-details-close")).toHaveFocus(); // DU-3.2: Close is first in tab order
    await userEvent.tab();
    expect(screen.getByTestId("map-details-action-edit")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not flip when there is room to the right", () => {
    render(
      <MapDetailsCard
        entity={wh}
        anchor={A} markerSize={32} containerSize={C}
        onClose={vi.fn()} actions={[]} onAction={vi.fn()}
      />,
    );
    const card = screen.getByTestId("map-details-card");
    expect(card.getAttribute("data-flipped-x")).toBeNull();
    const left = parseFloat((card as HTMLElement).style.left);
    expect(left).toBeGreaterThan(100);
  });
});

describe("MapDetailsCard — drag vs click outside (DU-3.F1)", () => {
  const mount = (onClose: () => void) =>
    render(
      <div>
        <div data-testid="outside">outside</div>
        <MapDetailsCard entity={wh} anchor={A} markerSize={32} containerSize={C} onClose={onClose} actions={[]} onAction={vi.fn()} />
      </div>,
    );

  it("a drag that starts outside the card (a pan) keeps it open", () => {
    const onClose = vi.fn();
    mount(onClose);
    const o = screen.getByTestId("outside");
    fireEvent.mouseDown(o, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(o, { clientX: 80, clientY: 60 });
    fireEvent.mouseUp(o, { clientX: 80, clientY: 60 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a press that starts inside the card and releases outside keeps it open", () => {
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.mouseDown(screen.getByTestId("map-details-card"), { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(screen.getByTestId("outside"), { clientX: 10, clientY: 10 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
