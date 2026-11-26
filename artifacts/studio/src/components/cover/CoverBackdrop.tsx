import type { CSSProperties } from "react";
import worldLand from "@/assets/world-land.svg";
import "./coverBackdrop.css";

// Deterministic, so the composition is stable between loads (seed shared with the sign-in page's
// original port; CoverShell's strip bubbles continue the same sequence via nextRandom()).
let seed = 7;
export const nextRandom = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const DOTS = Array.from({ length: 70 }, () => ({ cx: nextRandom() * 100, cy: nextRandom() * 100, r: 3 + nextRandom() * 16 }));
const ARCS = [[-.1, .78, .5, .35, 1.1, .62], [-.05, .3, .55, .9, 1.1, .45]].map(
  ([x0, y0, cx, cy, x1, y1]) => `M${x0 * 100},${y0 * 100} Q${cx * 100},${cy * 100} ${x1 * 100},${y1 * 100}`,
);

/** The paper's decoration. Render it as the first children of an element with class `cover-paper`. */
export function CoverBackdrop() {
  return (
    <>
      <div className="wash" aria-hidden="true" style={{ "--land-url": `url(${worldLand})` } as CSSProperties} />
      <svg className="bg" aria-hidden="true">
        {DOTS.map((d, i) => <circle key={i} className="dot" cx={`${d.cx}%`} cy={`${d.cy}%`} r={d.r} />)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
          {ARCS.map((d) => <path key={d} className="arc" d={d} pathLength={240} />)}
        </svg>
      </svg>
    </>
  );
}
