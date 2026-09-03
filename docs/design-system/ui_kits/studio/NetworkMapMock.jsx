import React from "react";
import { MapLegend } from "../../components/studio/MapLegend.jsx";
import { WAREHOUSES, CUSTOMERS, SOLUTION } from "./data.js";

function demandR(d) { return 3 + Math.sqrt(d) / 22; }

// Abstract network field (not real geography): grid paper + entity markers.
// Real product uses Leaflet tiles; this mock stands in for layout/visuals only.
export function NetworkMapMock({ mode = "input" }) {
  var open = SOLUTION.open;
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, background: "var(--map-water)", overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        {[10,20,30,40,50,60,70,80,90].map(function (t) {
          return <g key={t}><line x1={t} y1="0" x2={t} y2="100" stroke="#E0E5DE" strokeWidth="0.15" /><line x1="0" y1={t} x2="100" y2={t} stroke="#E0E5DE" strokeWidth="0.15" /></g>;
        })}
        {mode === "output" ? Object.entries(SOLUTION.assign).map(function (pair) {
          var c = CUSTOMERS.find(function (x) { return x.id === pair[0]; });
          var w = WAREHOUSES.find(function (x) { return x.id === pair[1]; });
          return <line key={pair[0]} x1={c.x} y1={c.y} x2={w.x} y2={w.y} stroke="var(--map-flow)" strokeWidth="0.35" opacity="0.8" />;
        }) : null}
        {CUSTOMERS.map(function (c) {
          return <circle key={c.id} cx={c.x} cy={c.y} r={demandR(c.demand) / 2.4} fill="var(--map-customer)" fillOpacity="0.55" stroke="var(--map-customer-stroke)" strokeWidth="0.3" />;
        })}
        {WAREHOUSES.map(function (w) {
          var s = 2.4;
          var pts = w.x + "," + (w.y - s) + " " + (w.x + s) + "," + (w.y + s) + " " + (w.x - s) + "," + (w.y + s);
          var isOpen = open.indexOf(w.id) !== -1;
          if (mode === "output") {
            return <polygon key={w.id} points={pts} fill={isOpen ? "var(--map-warehouse-open)" : "none"} stroke={isOpen ? "var(--green-700)" : "var(--map-inactive)"} strokeWidth="0.4" strokeDasharray={isOpen ? "none" : "1 0.7"} />;
          }
          return <polygon key={w.id} points={pts}
            fill={w.status === "forced_open" ? "var(--map-warehouse-open)" : "none"}
            stroke={w.status === "inactive" ? "var(--map-inactive)" : w.status === "forced_open" ? "var(--green-700)" : "var(--map-warehouse)"}
            strokeWidth="0.4" strokeDasharray={w.status === "inactive" ? "1 0.7" : "none"} />;
        })}
      </svg>
      <div style={{ position: "absolute", top: 10, right: 10, fontFamily: "var(--font-mono)", fontSize: "9.5px", color: "var(--text-faint)", background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", padding: "3px 7px" }}>
        abstract network view — real app renders Leaflet tiles
      </div>
      <MapLegend style={{ position: "absolute", bottom: 12, left: 12 }} />
    </div>
  );
}
