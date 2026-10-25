import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import type L from "leaflet";
import { MapAnchorBridge } from "@/components/workspace/map/MapAnchorBridge";

function Grab({ into }: { into: { map?: L.Map } }) {
  into.map = useMap();
  return null;
}

describe("MapAnchorBridge", () => {
  it("reports the marker's container point, re-reports on pan and zoom, and null with no selection", () => {
    const into: { map?: L.Map } = {};
    const onAnchor = vi.fn();
    const ui = (latLng: [number, number] | null) => (
      <MapContainer center={[10, 10]} zoom={5}>
        <Grab into={into} />
        <MapAnchorBridge latLng={latLng} onAnchor={onAnchor} />
      </MapContainer>
    );
    const { rerender } = render(ui([12, 12]));
    const map = into.map!;
    const first = onAnchor.mock.calls.at(-1)![0];
    expect(first).toEqual(map.latLngToContainerPoint([12, 12]));

    onAnchor.mockClear();
    act(() => { map.panBy([40, 25], { animate: false }); });
    const panned = onAnchor.mock.calls.at(-1)![0];
    expect(panned).toEqual(map.latLngToContainerPoint([12, 12]));
    expect(panned).not.toEqual(first);

    onAnchor.mockClear();
    act(() => { map.setZoom(6, { animate: false }); });
    expect(onAnchor).toHaveBeenCalled();
    expect(onAnchor.mock.calls.at(-1)![0]).toEqual(map.latLngToContainerPoint([12, 12]));

    onAnchor.mockClear();
    rerender(ui(null));
    expect(onAnchor).toHaveBeenLastCalledWith(null);
    onAnchor.mockClear();
    act(() => { map.panBy([10, 10], { animate: false }); });
    expect(onAnchor.mock.calls.every(([p]) => p === null)).toBe(true);
  });
});
