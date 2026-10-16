import type { ResultNarrative } from "@/lib/resultNarrative";

// SCU-1.9 (spec B1.1) — plain-language reading of the displayed result,
// rendered below the Output Map. Presentational only: the text comes from
// buildResultNarrative (lib/resultNarrative.ts).
export function OutputMapNarrative({ narrative }: { narrative: ResultNarrative }) {
  return (
    <section
      data-testid="output-map-narrative"
      aria-label="About this result"
      className="flex-shrink-0 max-h-40 overflow-y-auto rounded-md border bg-card px-3 py-2 text-xs leading-relaxed space-y-1.5"
    >
      <p data-testid="output-map-narrative-summary">{narrative.summary.join(" ")}</p>
      <p data-testid="output-map-narrative-how-to-read" className="text-muted-foreground">
        <span className="font-medium text-foreground">How to read this map: </span>
        {narrative.howToRead}
      </p>
    </section>
  );
}
