import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapDetailsCard } from "@/components/workspace/map/MapDetailsCard";
import type { MapEntity } from "@/components/workspace/map/types";

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

describe("MapDetailsCard", () => {
  it("shows capacity + status label for a warehouse entity", () => {
    render(<MapDetailsCard entity={wh} containerPoint={{ x: 100, y: 100 }} onClose={vi.fn()} />);
    expect(screen.getByTestId("map-details-capacity")).toHaveTextContent("12,000 units");
    expect(screen.getByTestId("map-details-status")).toHaveTextContent("Fixed-Open");
    expect(screen.queryByTestId("map-details-demand")).not.toBeInTheDocument();
  });

  // T4 (Bundle 2) — R3 capability gate seam: a warehouse-role entity with no
  // status (a role with hasStatus:false, e.g. a mine) shows capacity but no
  // status badge at all — never crashes on the absent `status` field.
  it("shows capacity but no status badge for a warehouse-role entity with no status (hasStatus:false role)", () => {
    const mine: MapEntity = { kind: "wh", entity: { ...wh.entity, status: undefined } };
    render(<MapDetailsCard entity={mine} containerPoint={{ x: 100, y: 100 }} onClose={vi.fn()} />);
    expect(screen.getByTestId("map-details-capacity")).toHaveTextContent("12,000 units");
    expect(screen.queryByTestId("map-details-status")).not.toBeInTheDocument();
  });

  it("shows demand for a customer entity, no capacity/status fields", () => {
    render(<MapDetailsCard entity={cs} containerPoint={{ x: 100, y: 100 }} onClose={vi.fn()} />);
    expect(screen.getByTestId("map-details-demand")).toHaveTextContent("5,000 units");
    expect(screen.queryByTestId("map-details-capacity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-details-status")).not.toBeInTheDocument();
  });

  it("shows city/state and 4-decimal lat/lng for either kind", () => {
    render(<MapDetailsCard entity={wh} containerPoint={{ x: 100, y: 100 }} onClose={vi.fn()} />);
    expect(screen.getByTestId("map-details-city")).toHaveTextContent("Dallas, TX");
    expect(screen.getByTestId("map-details-lat")).toHaveTextContent("32.7767");
    expect(screen.getByTestId("map-details-lng")).toHaveTextContent("-96.7970");
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(<MapDetailsCard entity={wh} containerPoint={{ x: 100, y: 100 }} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on an outside click (click-away)", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <MapDetailsCard entity={wh} containerPoint={{ x: 100, y: 100 }} onClose={onClose} />
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
      <MapDetailsCard entity={wh} containerPoint={{ x: 100, y: 100 }} onClose={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("flips to render left of the point when near the right container edge", () => {
    render(
      <MapDetailsCard
        entity={wh}
        containerPoint={{ x: 780, y: 100 }}
        containerSize={{ width: 800, height: 600 }}
        onClose={vi.fn()}
      />,
    );
    const card = screen.getByTestId("map-details-card");
    expect(card.getAttribute("data-flipped-x")).toBe("true");
    const left = parseFloat((card as HTMLElement).style.left);
    expect(left).toBeLessThan(780);
  });

  it("does not flip when there is room to the right", () => {
    render(
      <MapDetailsCard
        entity={wh}
        containerPoint={{ x: 100, y: 100 }}
        containerSize={{ width: 800, height: 600 }}
        onClose={vi.fn()}
      />,
    );
    const card = screen.getByTestId("map-details-card");
    expect(card.getAttribute("data-flipped-x")).toBeNull();
    const left = parseFloat((card as HTMLElement).style.left);
    expect(left).toBeGreaterThan(100);
  });
});
