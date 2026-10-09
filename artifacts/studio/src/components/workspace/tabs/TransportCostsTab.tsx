import { useEffect, useState } from "react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft, type DraftConversion } from "@/hooks/useDistanceDraft";
import { stripGrouping } from "@/lib/formatDistanceDisplay";
import {
  IDENTITY_CONVERSION,
  UI_MIN_CHARGE_MAX,
  UI_RATE_MAX,
  rateConversion,
  rateUnitLabel,
  type TransportCosts,
} from "@/lib/transportCosts";

// ch9-tc — Chapter 9's four transportation cost parameters (spec §5.1).
// Four global scalars, not a lane grid: the per-lane $/ton is always
// DERIVED (JadeDistancesTab's two columns), never stored.
//
// Canonical storage is always $/ton-mile. The display toggle converts a
// RATE reciprocally (see lib/transportCosts.ts) and leaves a $/ton minimum
// charge alone — which is why the two field kinds pass different
// `convert` pairs into the one shared draft hook rather than this file
// re-implementing the draft state machine.

interface TransportCostsTabProps {
  canonicalUnit: CanonicalUnit | null;
  /** Effective values — the scenario's own, or the textbook defaults. */
  transportCosts: TransportCosts;
  /** True when the scenario actually carries rates (enables Reset). */
  isCustom: boolean;
  /** Always called with ALL FOUR fields (the schema is all-or-nothing). */
  onChange(next: TransportCosts): void;
  /** Clears the key entirely — never writes the textbook literals, so a
   *  reset scenario is indistinguishable from one never edited. */
  onReset(): void;
  /** True while the result-history stepper is parked on a non-latest entry.
   *  Workspace's `updateInputsField` guard is the real write barrier; this
   *  is the visible half of the same rule. */
  disabled?: boolean;
  scenarioId?: number;
}

function TransportCostField({
  canonicalUnit,
  value,
  max,
  convert,
  disabled,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  label,
}: {
  canonicalUnit: CanonicalUnit | null;
  value: number;
  max: number;
  convert: DraftConversion;
  disabled: boolean;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  label: string;
}) {
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => setRejected(null), [resetKey, value]);
  const draft = useDistanceDraft({
    canonicalUnit,
    value,
    convert,
    resetKey,
    onCommit: v => {
      // Domain validation lives HERE, not in the hook: the hook commits any
      // grammar-complete draft, and ten existing call sites share it.
      if (!Number.isFinite(v) || v < 0) {
        setRejected("Must be a number of 0 or more.");
        return;
      }
      // The committed value is canonical, so this is the authoritative
      // server-equivalent bound check even when the field displays km.
      if (v > max) {
        setRejected(`Must be ${max.toLocaleString()} or less.`);
        return;
      }
      setRejected(null);
      onCommitValid(v);
    },
  });

  // Live, as-you-type validation, independent of the commit grammar (same
  // pattern as JadeDistancesTab's own override cell).
  const trimmed = stripGrouping(draft.text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const displayMax = canonicalUnit == null
    ? null
    : roundForFile(convert.toDisplay(max, canonicalUnit));
  const liveError =
    trimmed === "" || numeric === null || Number.isNaN(numeric)
      ? trimmed === "" ? null : "Must be a number."
      : numeric < 0
        ? "Must be 0 or more."
        : displayMax != null && numeric > displayMax
          // `displayMax` is already rounded to the field's 4 dp via
          // `roundForFile`; `toLocaleString()` would re-round it to its
          // default 3 fraction digits (6.2137 -> "6.214"), silently
          // misstating the actual live-validation boundary.
          ? `Must be ${displayMax} or less.`
          : null;
  const error = liveError ?? rejected;

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft.text}
        disabled={disabled || draft.disabled}
        onChange={e => {
          setRejected(null);
          draft.onChange(e.target.value);
        }}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        className="h-8 w-28 text-sm font-mono"
        data-testid={inputTestId}
      />
      {error && (
        <span className="text-[10px] text-destructive" data-testid={errorTestId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TransportCostsTab({
  canonicalUnit,
  transportCosts,
  isCustom,
  onChange,
  onReset,
  disabled = false,
  scenarioId,
}: TransportCostsTabProps) {
  const unit = useDisplayUnit();
  const rateConvert = rateConversion(unit);
  const rateLabel = rateUnitLabel(canonicalUnit, unit);

  /**
   * The semantic no-op guard (spec §2.4), in DISPLAY space at the same 4 dp
   * the field renders. A same-unit equivalent spelling ("0.0700") is already
   * bit-identical through `fromDisplay`, but a cross-unit round trip lands on
   * 0.069999…/0.070006…, and only the display-space comparison sees that as
   * unchanged. Raw string comparison is forbidden — "0.0700" and "0.07" are
   * the same value and must not stale the scenario.
   *
   * WF-6 correction: this comment used to say the guard lives here "not in
   * the hook", because moving it inside would change behaviour for every
   * caller. WF-6 did exactly that — `useDistanceDraft.commit()` now carries
   * its own no-op guard, so all 15 call sites inherit one. This guard is
   * therefore reached only after the hook's has already passed, and the two
   * stack as an AND of two independent no-op detectors.
   *
   * It is kept because it is NOT equivalent to the hook's, despite looking
   * like it. The hook compares `roundForFile` of two CANONICAL values (1e-4
   * canonical); this compares `roundForFile` of two DISPLAY values, and for a
   * rate `toDisplay` DIVIDES by the unit factor, so 1e-4 in display space is
   * ~1.6e-4 in canonical space. This guard is strictly the coarser of the two
   * for the rate fields and suppresses commits the hook's would let through.
   * Deleting it would widen what counts as a change — a behaviour change, not
   * a cleanup. (For the min-charge fields, which pass `IDENTITY_CONVERSION`,
   * the two guards genuinely do coincide.)
   */
  function commitField(field: keyof TransportCosts, incoming: number, convert: DraftConversion) {
    if (canonicalUnit != null) {
      const stored = transportCosts[field];
      if (
        roundForFile(convert.toDisplay(incoming, canonicalUnit)) ===
        roundForFile(convert.toDisplay(stored, canonicalUnit))
      ) {
        return;
      }
    }
    onChange({ ...transportCosts, [field]: incoming });
  }

  const legs = [
    {
      key: "ic" as const,
      label: "Inbound",
      lane: "plant → warehouse",
      rateField: "icTransCost" as const,
      minField: "icMinTrans" as const,
    },
    {
      key: "ob" as const,
      label: "Outbound",
      lane: "warehouse → customer",
      rateField: "obTransCost" as const,
      minField: "obMinTrans" as const,
    },
  ];

  return (
    <div className="p-4 space-y-3" data-testid="transport-costs-tab">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Leg</TableHead>
            <TableHead data-testid="label-transport-rate-unit-head">
              Rate{rateLabel ? ` (${rateLabel})` : ""}
            </TableHead>
            <TableHead>Min ($/ton)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {legs.map(leg => (
            <TableRow key={leg.key} data-testid={`row-transport-${leg.key}`}>
              <TableCell className="text-xs">
                <div className="font-medium">{leg.label}</div>
                <div className="text-muted-foreground">{leg.lane}</div>
              </TableCell>
              <TableCell>
                <TransportCostField
                  canonicalUnit={canonicalUnit}
                  value={transportCosts[leg.rateField]}
                  max={UI_RATE_MAX}
                  convert={rateConvert}
                  disabled={disabled}
                  resetKey={scenarioId}
                  onCommitValid={v => commitField(leg.rateField, v, rateConvert)}
                  inputTestId={`input-transport-${leg.key}-rate`}
                  errorTestId={`error-transport-${leg.key}-rate`}
                  label={`${leg.label} rate`}
                />
                <span
                  className="text-[10px] text-muted-foreground"
                  data-testid={`label-transport-rate-unit-${leg.key}`}
                >
                  {rateLabel ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <TransportCostField
                  canonicalUnit={canonicalUnit}
                  value={transportCosts[leg.minField]}
                  max={UI_MIN_CHARGE_MAX}
                  convert={IDENTITY_CONVERSION}
                  disabled={disabled}
                  resetKey={scenarioId}
                  onCommitValid={v => commitField(leg.minField, v, IDENTITY_CONVERSION)}
                  inputTestId={`input-transport-${leg.key}-min`}
                  errorTestId={`error-transport-${leg.key}-min`}
                  label={`${leg.label} minimum charge`}
                />
                <span
                  className="text-[10px] text-muted-foreground"
                  data-testid={`label-transport-min-unit-${leg.key}`}
                >
                  $/ton
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground" data-testid="text-transport-formula">
        cost per ton = max(rate × distance, min)
      </p>

      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={disabled || !isCustom}
        onClick={onReset}
        data-testid="button-transport-reset"
      >
        Reset to textbook values
      </Button>
    </div>
  );
}
