import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mutate, state } = vi.hoisted(() => ({ mutate: vi.fn(), state: { isError: false, error: null as unknown, isPending: false } }));
vi.mock("@workspace/api-client-react", () => ({
  useFetchScenarioRoadDistances: () => ({ mutate, reset: vi.fn(), ...state }),
  RoadDistancesErrorCode: { road_distances_unavailable: "road_distances_unavailable", road_distances_quota: "road_distances_quota",
    road_distances_failed: "road_distances_failed", road_distances_unroutable: "road_distances_unroutable", road_distances_busy: "road_distances_busy" },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
import { SuperRoadDistancesDialog, describeRoadError } from "@/components/workspace/super/SuperRoadDistancesDialog";

beforeEach(() => { mutate.mockReset(); Object.assign(state, { isError: false, error: null, isPending: false }); });
const open = (onApplied = vi.fn()) => render(<SuperRoadDistancesDialog open onOpenChange={vi.fn()} scenarioId={7} onApplied={onApplied} />);

describe("SuperRoadDistancesDialog", () => {
  it("states every time that coordinates are sent to OpenRouteService", () => {
    open();
    expect(screen.getByTestId("super-road-privacy")).toHaveTextContent("plant, warehouse and customer coordinates");
    expect(screen.getByTestId("super-road-privacy")).toHaveTextContent("OpenRouteService");
  });
  it("confirm posts once for the scenario and hands the scenario back", () => {
    const onApplied = vi.fn();
    mutate.mockImplementation((_v, o) => o.onSuccess({ scenario: { id: 7 } }));
    open(onApplied);
    fireEvent.click(screen.getByTestId("super-road-confirm"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ scenarioId: 7 });
    expect(onApplied).toHaveBeenCalledWith({ id: 7 });
  });
  it.each([
    ["road_distances_quota", 429, "OpenRouteService quota reached, try again later. The daily quota is shared by everyone using this server."],
    ["road_distances_quota", 403, "OpenRouteService quota reached, try again later. The daily quota is shared by everyone using this server."],
    ["road_distances_unroutable", 422, "No road route from P1 to W1. Add a distance override for that pair."],
    ["road_distances_unavailable", 503, "Road distances are not available: no OpenRouteService key is configured on this server."],
    ["road_distances_failed", 502, "OpenRouteService failed (HTTP 500) for warehouses → customers 71–140."],
    ["road_distances_busy", 409, "Road distances are already being fetched on this server. Try again in a minute."],
  ])("shows the server message for %s (HTTP %s)", (code, status, message) => {
    Object.assign(state, { isError: true, error: { status, data: { error: code, message } } });
    open();
    expect(screen.getByTestId("super-road-error")).toHaveTextContent(message);
  });
  it("does not show the message of a body whose error is not a road code", () => {
    Object.assign(state, { isError: true, error: { status: 500, data: { error: "other", message: "raw text" } } });
    open();
    expect(screen.getByTestId("super-road-error")).not.toHaveTextContent("raw text");
  });
  it("an unknown body falls back to the generic write-error text", () => {
    expect(describeRoadError({ status: 500, data: { error: "Internal server error" } })).toBe("Internal server error");
  });
});
