import { useRef, useState, type KeyboardEvent } from "react";
import { READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SuperTableTab } from "./SuperTableTab";
import type { Row } from "./superTables";
import type { SuperInputsLike } from "@/lib/superNetwork";

export interface SuperDistancesTabProps {
  distanceMethod: "haversine" | "circuity" | "road";
  onFetchRoad(): void;
  /** Non-null disables the fetch button and is its title. */
  fetchDisabledReason: string | null;
  circuityFactor: number;
  overrides: Row[];
  /** A partial patch of `distanceMethod` / `circuityFactor` / `distanceOverrides`. */
  onChange(patch: Record<string, unknown>): void;
  readOnly: boolean;
  plantIds: string[]; warehouseIds: string[]; customerIds: string[];
  /** QFX-6 — the whole draft, forwarded to SuperTableTab for its Add form. Keep it. */
  network: SuperInputsLike;
}

type DistanceMethod = SuperDistancesTabProps["distanceMethod"];

const METHODS: { value: DistanceMethod; label: string }[] = [
  { value: "haversine", label: "Haversine" },
  { value: "circuity", label: "Circuity" },
  { value: "road", label: "Road" },
];

// QFX-9 — radiogroup with roving tabindex: only the checked segment is
// tabbable; arrows move AND select (wrapping), Home/End jump to the ends.
// Space/Enter on the focused segment are the native <button> click.
function MethodSegments({ value, disabled, onSelect }: {
  value: DistanceMethod;
  disabled: boolean;
  onSelect(method: DistanceMethod): void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: KeyboardEvent, i: number) {
    const last = METHODS.length - 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
        : e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
          : e.key === "Home" ? 0
            : e.key === "End" ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(METHODS[next].value);
  }
  return (
    <div role="radiogroup" aria-label="Distance method" data-testid="super-distance-method" className="inline-flex rounded-md border p-0.5">
      {METHODS.map((m, i) => {
        const checked = m.value === value;
        return (
          <button
            key={m.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={disabled ? READ_ONLY_TITLE : undefined}
            data-testid={`super-distance-method-${m.value}`}
            onClick={() => onSelect(m.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              "h-7 rounded px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// QFX-9 — 1 ≤ value ≤ 3 with at most 3 decimals. Intentionally stricter than
// the server (superInputs.ts:44-46, any finite 1–3); over-precise input is
// invalid, never rounded.
function parseCircuityFactor(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 3 ? n : null;
}

// QFX-9 — typing edits local text only; the draft changes on Apply (button or
// Enter), never per keystroke and never on blur. A change to the stored value
// from elsewhere (import, history restore, Discard, or Apply itself) re-syncs
// the text.
function CircuityFactorField({ value, disabled, onApply }: {
  value: number;
  disabled: boolean;
  onApply(n: number): void;
}) {
  const [raw, setRaw] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setRaw(String(value));
  }
  const parsed = parseCircuityFactor(raw);
  // The stored value is the server's (any finite 1–3): untouched text is never an error.
  const invalid = parsed === null && raw !== String(value);
  const canApply = !disabled && parsed !== null && parsed !== value;
  const apply = () => { if (canApply && parsed !== null) onApply(parsed); };
  return (
    <div className="flex items-start gap-2">
      <div>
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Circuity factor"
          aria-invalid={invalid}
          aria-describedby={invalid ? "super-circuity-error" : undefined}
          data-testid="super-circuity-factor"
          className="h-8 w-[7ch] px-1.5 text-xs md:text-xs"
          value={raw}
          disabled={disabled}
          title={disabled ? READ_ONLY_TITLE : undefined}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
        />
        {invalid && (
          <p id="super-circuity-error" data-testid="super-circuity-error" className="mt-1 text-xs text-destructive">
            Use a number from 1 to 3 with up to 3 decimals.
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" data-testid="super-circuity-apply" disabled={!canApply} onClick={apply}>
        Apply
      </Button>
    </div>
  );
}

export function SuperDistancesTab(p: SuperDistancesTabProps) {
  return (
    <div className="space-y-4" data-testid="super-distances-tab">
      <div className="space-y-2 text-sm">
        <MethodSegments value={p.distanceMethod} disabled={p.readOnly}
          onSelect={m => { if (m !== p.distanceMethod) p.onChange({ distanceMethod: m }); }} />
        {p.distanceMethod === "circuity" && (
          <CircuityFactorField value={p.circuityFactor} disabled={p.readOnly}
            onApply={n => p.onChange({ circuityFactor: n })} />
        )}
        {p.distanceMethod === "road" && (
          <Button size="sm" variant="outline" data-testid="super-road-fetch" onClick={p.onFetchRoad}
            disabled={p.readOnly || p.fetchDisabledReason !== null} title={p.fetchDisabledReason ?? undefined}>
            Fetch road distances
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Pairs without an override use the method above. Overrides always win. Road pairs are checked by the readiness panel.</p>
      <SuperTableTab table="distanceOverrides" rows={p.overrides} readOnly={p.readOnly} network={p.network}
        onChange={rows => p.onChange({ distanceOverrides: rows })}
        options={{ fromIds: [...p.plantIds, ...p.warehouseIds], toIds: [...p.warehouseIds, ...p.customerIds] }} />
    </div>
  );
}
