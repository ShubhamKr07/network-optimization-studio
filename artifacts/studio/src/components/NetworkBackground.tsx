import { useEffect, useRef } from "react";

// COSM-5 — React port of docs/superpowers/specs/assets/2026-10-03-network-bg.html
// (SHA df9efa66c1f18207cbc058b17c714aa8465b8b1c1ee14488214c4f6e3d034e44).
// Constants below are that file's, unchanged.
const NODE_COUNT = 26;
const HUB_COUNT = 5;
const EDGE_RANGE_PX = 340;
const FALLBACK_RGB = "128,132,122";

function readInkRgb(el: HTMLElement): string {
  // --ink-400 (#83887A) is the token this animation was authored against.
  // Read ONCE at mount: the app has no runtime theme switcher (index.css
  // defines .dark but nothing in src/ ever applies it), so there is nothing
  // to react to. If a toggle is ever added, this is the one place to change.
  const hex = getComputedStyle(el).getPropertyValue("--ink-400").trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return FALLBACK_RGB;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

export function NetworkBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgb = readInkRgb(wrap);
    const reduced = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, raf: number | null = null;

    const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00022,
      vy: (Math.random() - 0.5) * 0.00022,
      hub: i < HUB_COUNT,
      r: i < HUB_COUNT ? 7 : 4,
    }));

    function resize() {
      w = canvas!.width = canvas!.offsetWidth;
      h = canvas!.height = canvas!.offsetHeight;
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineWidth = 1.6;
      for (let a = 0; a < NODE_COUNT; a++) {
        for (let b = a + 1; b < NODE_COUNT; b++) {
          if (!nodes[a].hub && !nodes[b].hub) continue;
          const dx = (nodes[a].x - nodes[b].x) * w;
          const dy = (nodes[a].y - nodes[b].y) * h;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= EDGE_RANGE_PX) continue;
          ctx!.strokeStyle = `rgba(${rgb},${(0.16 * (1 - d / EDGE_RANGE_PX)).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.moveTo(nodes[a].x * w, nodes[a].y * h);
          ctx!.lineTo(nodes[b].x * w, nodes[b].y * h);
          ctx!.stroke();
        }
      }
      for (const m of nodes) {
        ctx!.fillStyle = `rgba(${rgb},${m.hub ? 0.28 : 0.2})`;
        if (m.hub) {
          ctx!.fillRect(m.x * w - m.r, m.y * h - m.r, m.r * 2, m.r * 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(m.x * w, m.y * h, m.r, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    function step() {
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    resize();
    draw();
    if (!reduced) raf = requestAnimationFrame(step);

    // ResizeObserver, not window.resize: Landing's Recent Solves section
    // arrives asynchronously and changes this container's height, which a
    // window listener never observes. Resizing resets canvas.width, which
    // CLEARS the bitmap — so a reduced-motion canvas must redraw here or it
    // goes permanently blank after the first resize.
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(wrap);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      data-testid="network-background"
      className="absolute inset-0 z-0 pointer-events-none"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
