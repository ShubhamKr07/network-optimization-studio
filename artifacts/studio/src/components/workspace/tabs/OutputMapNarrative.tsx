import type { ResultNarrative } from "@/lib/resultNarrative";

// NAR-1 — plain-language reading of the displayed result, rendered below the
// Output Map. Presentational only: the text comes from buildResultNarrative.
export function OutputMapNarrative({ narrative }: { narrative: ResultNarrative }) {
  return (
    <section
      data-testid="output-map-narrative"
      aria-label="About this result"
      className="flex-shrink-0 max-h-40 overflow-y-auto rounded-md border bg-card px-3 py-2 text-xs leading-relaxed"
    >
      <p data-testid="output-map-narrative-summary">{narrative.text}</p>
    </section>
  );
}
