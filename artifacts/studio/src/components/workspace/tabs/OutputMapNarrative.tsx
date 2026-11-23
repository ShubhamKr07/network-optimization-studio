import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ResultNarrative } from "@/lib/resultNarrative";

export const ICON_BUTTON =
  "grid size-8 place-items-center rounded border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// NAR-1 — plain-language reading of the displayed result, behind an info
// popover (OMQ-3). Presentational only: the text comes from buildResultNarrative.
export function OutputMapNarrative({ narrative }: { narrative: ResultNarrative }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="button-output-map-info" aria-label="About this result" title="About this result" className={ICON_BUTTON}>
          <Info className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="output-map-narrative" aria-label="About this result" className="w-96 max-h-80 overflow-y-auto text-xs leading-relaxed">
        <p data-testid="output-map-narrative-summary">{narrative.text}</p>
      </PopoverContent>
    </Popover>
  );
}
