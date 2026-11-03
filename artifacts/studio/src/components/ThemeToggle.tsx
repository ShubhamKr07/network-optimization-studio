import { useState } from "react";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";

const OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  return (
    <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="Theme" data-testid="theme-toggle">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`theme-toggle-${value}`}
          aria-pressed={pref === value}
          onClick={() => { setThemePref(value); setPref(value); }}
          className={`text-xs px-2 min-h-6 transition-colors ${
            pref === value ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
