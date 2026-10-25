import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UNVERIFIED_TOOLTIP } from "@/lib/resultOutcome";

/** Tap/keyboard-reachable replacement for the native `title` "Unverified" tooltip. */
export function UnverifiedInfo() {
  // The span stops an enclosing <a> (Landing history rows) from navigating on a click here;
  // React events bubble through the portal too, so the popover content is covered.
  return (
    <span onClick={(e) => e.preventDefault()} className="inline-flex">
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Why unverified?"
          data-testid="button-unverified-info"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          ⓘ
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid="popover-unverified" className="w-64 text-xs">
        {UNVERIFIED_TOOLTIP}
      </PopoverContent>
    </Popover>
    </span>
  );
}
