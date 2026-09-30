// CH4UX-5 — the running overlay's rotating flavour text. A frozen, ordered
// array cycled by index (never randomised) so a test with fake timers can
// assert an exact sequence. Text-only by design: no new dependency, no SVG
// animation, and with timers frozen the overlay simply shows SOLVE_QUIPS[0].
export const SOLVE_QUIPS = [
  "Branching and bounding…",
  "Relaxing the integers…",
  "Tightening the gap…",
  "Arguing with CBC…",
  "Pricing out a few columns…",
  "Checking every warehouse twice…",
  "Nudging the simplex…",
  "Rounding, then regretting it…",
] as const;

/** How long each quip stays on screen. */
export const QUIP_INTERVAL_MS = 2500;
