/**
 * CSI-2 — text contrast on the cover sign-in page, measured in a real browser.
 *
 * Why this exists instead of design-upgrade-p5's `legibilityScan`: that scan skips any
 * element with a gradient/image anywhere up its ancestor chain (it cannot composite one), and the
 * cover is built from gradients (graph-paper `.paper`, the green `.strip`), so on the cover the
 * scan measures almost nothing and "finds nothing" is vacuous. Here every visible text node is
 * measured against the WORST (closest-to-the-text-colour) stop of the surface it sits on:
 *   - inside `.go`    -> the submit button's own light ground;
 *   - inside `.band`  -> the band green;
 *   - inside `.strip` -> the lightest of the strip's three gradient stops (the 22px dark grid
 *     overlay only darkens it, so the lightest stop is the pessimistic bound for light text);
 *   - otherwise       -> the darker of the two paper tones.
 * Text and the surface variables are read from the live computed style, so a regression in either
 * (a theme token leaking in, a variable changed) moves the measurement.
 */
import type { Page } from "@playwright/test";

export interface CoverContrastResult {
  checked: number;
  /** Text nodes under `min` (default 4.5:1), with where they sit. */
  findings: Array<{ text: string; ratio: number; surface: string; fg: string; bg: string }>;
  /** Text nodes under 11px. */
  smallText: Array<{ text: string; px: number }>;
}

export async function measureCoverContrast(page: Page, min = 4.5): Promise<CoverContrastResult> {
  return page.evaluate((minRatio) => {
    const root = document.querySelector<HTMLElement>('[data-testid="cover-shell"]');
    if (!root) throw new Error("cover-shell not rendered");
    const toRgb = (s: string): [number, number, number] => {
      const m = s.match(/[\d.]+/g);
      if (!m || m.length < 3) throw new Error(`not a colour: "${s}"`);
      return [+m[0], +m[1], +m[2]];
    };
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const cs = getComputedStyle(root);
    const v = (name: string) => toRgb(cs.getPropertyValue(name).trim().startsWith("#") ? hexToRgb(cs.getPropertyValue(name).trim()) : cs.getPropertyValue(name).trim());
    function hexToRgb(h: string): string {
      const n = parseInt(h.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    }
    const surfaces = {
      band: [v("--band")],
      button: [v("--strip-ink")], // the light submit button (.go) paints its own ground inside the strip
      strip: [v("--strip-top"), v("--strip-mid"), v("--strip-bot")],
      paper: [v("--paper"), v("--paper-2")],
    };
    const findings: CoverContrastResult["findings"] = [];
    const smallText: CoverContrastResult["smallText"] = [];
    let checked = 0;
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? "").trim();
      if (!el || !text || seen.has(el)) continue;
      seen.add(el);
      if (el.closest("svg,script,style")) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || s.visibility === "hidden" || s.display === "none") continue; // the .sr text is 1px: skipped here on purpose
      let op = 1;
      for (let e: Element | null = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      if (op < 0.99 && el.closest(".go")?.matches(":disabled")) continue; // only the disabled submit is dimmed on purpose; any other dimmed text is measured
      const px = parseFloat(s.fontSize);
      if (px < 11) smallText.push({ text: text.slice(0, 40), px });
      const surface = el.closest(".go") ? "button" : el.closest(".band") ? "band" : el.closest(".strip") ? "strip" : "paper";
      const fg = toRgb(s.color);
      // Worst case over the surface's stops.
      // Dimmed text is composited onto the ground first, so a faded label is measured as it renders.
      const composite = (g: number[]) => fg.map((c, i) => c * op + g[i] * (1 - op));
      const worst = surfaces[surface as keyof typeof surfaces].reduce((a, b) => (ratio(composite(a), a) <= ratio(composite(b), b) ? a : b));
      checked++;
      const rr = ratio(composite(worst), worst);
      if (rr < minRatio) findings.push({ text: text.slice(0, 40), ratio: Math.round(rr * 100) / 100, surface, fg: s.color, bg: `rgb(${worst.join(",")})` });
    }
    return { checked, findings, smallText };
  }, min);
}
