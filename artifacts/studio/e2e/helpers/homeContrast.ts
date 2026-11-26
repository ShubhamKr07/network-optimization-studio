import type { Page } from "@playwright/test";

/**
 * Contrast measurement for the signed-in home page (`.home`, HCV).
 *
 * `coverContrast.ts` cannot be reused: it throws without `[data-testid="cover-shell"]`
 * and reads the sign-in strip's variables. design-upgrade-p5's `legibilityScan` skips
 * every text node over the gradient paper (vacuous for the heading and stats line).
 *
 * Every visible text node under `.home` is measured against its nearest opaque
 * ancestor background. Translucent layers (chip tints in dark) are composited over
 * what is beneath them. If no opaque ancestor exists before `.cover-paper`, the text
 * is measured against FOUR grounds and the lowest ratio wins: `--paper`, `--paper-2`,
 * and each of those with the world wash (`.cover-paper > .wash`: `--land` at the
 * wash's computed opacity, assumed to cover the text fully since the mask is partial)
 * composited on top. The wash is darker than the paper in light and lighter in dark,
 * so a paper-only bound is optimistic exactly under the heading row and stats line.
 *
 * Opacity: the text colour's alpha is multiplied by the product of the opacities of
 * the element and every ancestor up to `.home`, so a dimmed (e.g. locked, .6) card is
 * measured as rendered. Limitation: the card's own background is not dimmed in the
 * model, which is the conservative direction for light text on a dark surface only
 * when the dimmed ground is lighter; revisit if a locked card ever ships.
 */
export interface HomeContrastResult {
  checked: number;
  findings: Array<{ text: string; ratio: number; fg: string; bg: string }>;
}

export async function measureHomeContrast(page: Page, min = 4.5): Promise<HomeContrastResult> {
  return page.evaluate((minRatio) => {
    const root = document.querySelector<HTMLElement>(".home");
    if (!root) throw new Error(".home not rendered");
    const paper = root.querySelector<HTMLElement>(".cover-paper");
    if (!paper) throw new Error(".cover-paper not rendered");
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgba = (c: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v));
    };
    const over = (top: number[], under: number[]) =>
      top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const pcs = getComputedStyle(paper);
    const paperStops = [rgba(pcs.getPropertyValue("--paper").trim()), rgba(pcs.getPropertyValue("--paper-2").trim())];
    const wash = paper.querySelector<HTMLElement>(":scope > .wash");
    if (!wash) throw new Error(".cover-paper > .wash not rendered");
    const wcs = getComputedStyle(wash);
    const land = rgba(wcs.backgroundColor);
    land[3] *= parseFloat(wcs.opacity);
    const grounds4 = [...paperStops, ...paperStops.map((p) => over(land, p))];
    const groundsFor = (el: Element): number[][] => {
      const layers: number[][] = [];
      for (let n: Element | null = el; n && n !== paper; n = n.parentElement) {
        const bg = rgba(getComputedStyle(n).backgroundColor);
        if (bg[3] === 0) continue;
        layers.push(bg);
        if (bg[3] === 1) return [layers.reduceRight((acc, l) => over(l, acc))];
      }
      return grounds4.map((p) => layers.reduceRight((acc, l) => over(l, acc), p));
    };
    const findings: HomeContrastResult["findings"] = [];
    let checked = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement!;
      const text = (t.textContent ?? "").trim();
      if (!text || el.closest(".sr, [aria-hidden='true']")) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0) continue;
      const fg = rgba(cs.color);
      for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) fg[3] *= parseFloat(getComputedStyle(n).opacity);
      const grounds = groundsFor(el);
      const worst = Math.min(...grounds.map((g) => ratio(over(fg, g), g)));
      checked++;
      if (worst < minRatio) findings.push({ text: text.slice(0, 40), ratio: +worst.toFixed(2), fg: cs.color, bg: grounds.map((g) => g.slice(0, 3).join(",")).join(" | ") });
    }
    return { checked, findings };
  }, min);
}
