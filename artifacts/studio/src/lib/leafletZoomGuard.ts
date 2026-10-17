import L from "leaflet";

// SCND_STUDIO-3: Leaflet 1.9.4's _animateZoom schedules
// setTimeout(_onZoomTransitionEnd, 250), and map.remove() deletes _mapPane
// without cancelling it. A map unmounted mid-zoom (a react-leaflet remount, a
// tab or route change) then crashes in _getMapPanePos ("reading
// '_leaflet_pos'"). A removed map has nothing left to finish, so skip it.
// One prototype patch covers every map in the app, present and future.
// ponytail: patches a private Leaflet 1.x method; delete on upgrading to Leaflet 2.
type ZoomEnd = { _mapPane?: HTMLElement; _onZoomTransitionEnd(this: ZoomEnd): void };
const proto = L.Map.prototype as unknown as ZoomEnd;
const finishZoom = proto._onZoomTransitionEnd;
proto._onZoomTransitionEnd = function () {
  if (this._mapPane) finishZoom.call(this);
};
