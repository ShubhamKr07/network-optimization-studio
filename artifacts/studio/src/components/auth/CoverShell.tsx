import type { CSSProperties, ReactNode } from "react";
import worldLand from "@/assets/world-land.svg";
import "./cover.css";

// The strip's picture lives in the asset's own 360x180 degree space (x = lon + 180,
// y = 90 - lat), so routes are placed here without d3. Ported from the prototype v8.
const at = ([lon, lat]: [number, number]) => [lon + 180, 90 - lat] as const;
const PLACES: [number, number][] = [[-74, 40.7], [-0.1, 51.5], [121.5, 31.2], [-46.6, -23.5], [28, -26.2], [139.7, 35.7], [-118.2, 34], [72.9, 19.1]];
const PAIRS: [number, number][] = [[0, 1], [1, 2], [6, 5], [0, 3], [1, 4], [2, 7], [3, 4]];

// Deterministic, so the composition is stable between loads.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const DOTS = Array.from({ length: 70 }, () => ({ cx: rnd() * 100, cy: rnd() * 100, r: 3 + rnd() * 16 }));
const ARCS = [[-.1, .78, .5, .35, 1.1, .62], [-.05, .3, .55, .9, 1.1, .45]].map(
  ([x0, y0, cx, cy, x1, y1]) => `M${x0 * 100},${y0 * 100} Q${cx * 100},${cy * 100} ${x1 * 100},${y1 * 100}`,
);
const BUBBLES = Array.from({ length: 40 }, () => ({ cx: 12 + rnd() * 348, cy: 12 + 134 * (.45 + rnd() * .55), r: 1.5 + rnd() * 5.5 }));
const ROUTES = PAIRS.map(([a, b]) => {
  const [x0, y0] = at(PLACES[a]);
  const [x1, y1] = at(PLACES[b]);
  const mx = (x0 + x1) / 2;
  const my = Math.min(y0, y1) - Math.abs(x1 - x0) * .18;
  const pt = (t: number) => ({
    x: (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1,
    y: (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1,
  });
  let len = 0;
  for (let i = 1, prev = pt(0); i <= 24; i++) {
    const cur = pt(i / 24);
    len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    prev = cur;
  }
  const beads: { x: number; y: number }[] = [];
  for (let t = .12; t < 1; t += .19) beads.push(pt(t));
  return { d: `M${x0},${y0} Q${mx},${my} ${x1},${y1}`, len: Math.ceil(len), beads };
});

/** The "opens in a new tab" mark: arrow for sighted users, text for screen readers (L8). */
export function NewTabMark({ size = 11 }: { size?: number }) {
  return (
    <>
      <svg className="ext-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7" /><path d="M8 7h9v9" />
      </svg>
      <span className="sr">{" (opens in a new tab)"}</span>
    </>
  );
}

export function CoverShell({ children }: { children: ReactNode }) {
  return (
    <div className="cover" data-testid="cover-shell">
      <div className="band" aria-hidden="true" />
      <div className="paper">
        <div className="wash" aria-hidden="true" style={{ "--land-url": `url(${worldLand})` } as CSSProperties} />
        <svg className="bg" aria-hidden="true">
          {DOTS.map((d, i) => <circle key={i} className="dot" cx={`${d.cx}%`} cy={`${d.cy}%`} r={d.r} />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
            {ARCS.map((d) => <path key={d} className="arc" d={d} />)}
          </svg>
        </svg>
        <main className="inner">
          <header>
            <h1>Network Design Labs</h1>
            <p className="lede">
              Hands-on labs for{" "}
              <a href="https://www.amazon.com/dp/B078PNRZJB" target="_blank" rel="noopener noreferrer" data-testid="link-book">
                Supply Chain Network Design<NewTabMark size={12} />
              </a>
              .<br />
              <span className="one-line">Pick a model from the book, change it on the map, solve it with a real optimizer, and compare what moved.</span>
            </p>
          </header>

          <section className="strip" aria-label="Sign in or create an account" data-testid="cover-strip">
            <div className="world" aria-hidden="true">
              <svg viewBox="12 12 348 134" preserveAspectRatio="xMidYMid meet">
                {BUBBLES.map((b, i) => <circle key={i} className="bubble" cx={b.cx} cy={b.cy} r={b.r} />)}
                {/* white land: the asset is black, so invert it (cover.css) rather than ship a second copy */}
                <image className="land" href={worldLand} width="360" height="180" />
                {ROUTES.map((r) => (
                  <g key={r.d}>
                    <path className="route" d={r.d} style={{ "--len": r.len } as CSSProperties} />
                    {r.beads.map((p, i) => <circle key={i} className="bead" cx={p.x} cy={p.y} r="1.5" />)}
                  </g>
                ))}
              </svg>
            </div>
            <div className="access">{children}</div>
          </section>

          <div className="offered" data-testid="cover-offered-by">
            <p className="by">Offered by</p>
            <p className="authors">Michael Watson</p>
            <p className="links">
              <a href="https://www.linkedin.com/in/michael-watson-07600a1/" target="_blank" rel="noopener noreferrer" aria-label="Michael Watson on LinkedIn (opens in a new tab)" title="LinkedIn, opens in a new tab" data-testid="link-linkedin">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
              </a>
              <a href="mailto:michael.watson@northwestern.edu" aria-label="Email Michael Watson" title="Email" data-testid="link-watson-email">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
              </a>
            </p>
          </div>
        </main>
      </div>

      <footer className="band bottom" data-testid="cover-help">
        <p className="help">Trouble signing in? <a href="mailto:shubham.shubham4995@gmail.com">Contact the developer</a></p>
      </footer>
    </div>
  );
}
