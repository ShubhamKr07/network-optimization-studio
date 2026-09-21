import type { DisplayUnitPref } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";

// Compact auto/km/mi segmented control. Styling mirrors the existing
// segmented-control pattern already used for Chen's objective-mode toggle
// (OptimizationParametersTab.tsx) rather than inventing a new one.
const OPTIONS: ReadonlyArray<{ value: DisplayUnitPref; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "km", label: "km" },
  { value: "mi", label: "mi" },
];

export function UnitToggle() {
  const { pref, setPref } = useDisplayUnit();

  return (
    <div
      className="inline-flex rounded border border-border overflow-hidden"
      role="group"
      aria-label="Distance unit"
      data-testid="unit-toggle"
    >
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`unit-toggle-${value}`}
          aria-pressed={pref === value}
          onClick={() => setPref(value)}
          className={`text-xs px-2 py-1 transition-colors ${
            pref === value ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
