import { bandRangeLabel, OVERFLOW_BAND, type CanonicalUnit } from "@workspace/units";
import { getBandColor, getBandDash } from "@/lib/bandPalette";

/** DU-2.2 — band text + colour + pattern swatch. `bands` in the display unit. */
export function BandLabel({ index, bands, unit }: { index: number; bands: number[]; unit: CanonicalUnit }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span data-band-swatch className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getBandColor(index) }} aria-hidden="true" />
      <svg width="14" height="6" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="3" x2="14" y2="3" stroke={getBandColor(index)} strokeWidth="2.5" strokeDasharray={index === OVERFLOW_BAND ? undefined : getBandDash(index)} />
      </svg>
      <span>{bandRangeLabel(index, bands, unit)}</span>
    </span>
  );
}
