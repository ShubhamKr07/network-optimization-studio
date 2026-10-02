import type { CanonicalUnit } from "@workspace/units";
import type { UnitApi } from "@/contexts/UnitContext";
import type { DraftConversion } from "@/hooks/useDistanceDraft";

// ch9-tc — the frontend's single source of truth for Chapter 9's four
// transportation cost parameters. Every consumer (the input tab, the
// Distances tab's derived columns, the cost summary's solved-at block, and
// their tests) imports from here, so no constant or formula is re-derived
// in two places.

export interface TransportCosts {
  /** $ per ton-mile, plant -> warehouse. */
  icTransCost: number;
  /** $ per ton minimum charge, plant -> warehouse. */
  icMinTrans: number;
  /** $ per ton-mile, warehouse -> customer. */
  obTransCost: number;
  /** $ per ton minimum charge, warehouse -> customer. */
  obMinTrans: number;
}

/** solve.py's JADE_IC_RATE / JADE_IC_MIN / JADE_OB_RATE / JADE_OB_MIN.
 *  Pinned against solve.py by transportCostsBounds.test.ts. */
export const TEXTBOOK_TRANSPORT_COSTS: TransportCosts = {
  icTransCost: 0.07,
  icMinTrans: 10,
  obTransCost: 0.12,
  obMinTrans: 10,
};

/** Must equal the manifest's `maximum` and jadeInputs.ts's `.max(...)` —
 *  pinned by transportCostsBounds.test.ts (UI leg) and
 *  jadeTransportCosts.test.ts (server leg). */
export const UI_RATE_MAX = 10;
export const UI_MIN_CHARGE_MAX = 10_000;

export const TRANSPORT_COST_KEYS: ReadonlyArray<keyof TransportCosts> = [
  "icTransCost", "icMinTrans", "obTransCost", "obMinTrans",
];

function isCompleteTransportCosts(value: unknown): value is TransportCosts {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return TRANSPORT_COST_KEYS.every(k => typeof v[k] === "number" && Number.isFinite(v[k] as number));
}

/** The EFFECTIVE rates for a scenario: its own when complete, the textbook
 *  values otherwise. A partial object can never reach here through the API
 *  (Zod rejects it), so falling back wholesale is the honest reading. */
export function transportCostsFromInputs(
  inputs: Record<string, unknown> | null | undefined,
): TransportCosts {
  const raw = inputs?.transportCosts;
  return isCompleteTransportCosts(raw) ? { ...raw } : { ...TEXTBOOK_TRANSPORT_COSTS };
}

/** True when the scenario actually carries rates — drives whether Reset is
 *  offered, and distinguishes "reset" from "never edited". */
export function hasCustomTransportCosts(
  inputs: Record<string, unknown> | null | undefined,
): boolean {
  return isCompleteTransportCosts(inputs?.transportCosts);
}

/** The per-lane price, $/ton. `distanceCanonical` is in the model's
 *  canonical unit (miles for JADE), matching the rate's denominator — the
 *  RESULT carries no distance unit and must not be converted for display. */
export function laneCostPerTon(distanceCanonical: number, rate: number, min: number): number {
  return Math.max(rate * distanceCanonical, min);
}

/** True when the minimum charge, not the rate, is what the lane pays. */
export function minChargeBinds(distanceCanonical: number, rate: number, min: number): boolean {
  return rate * distanceCanonical <= min;
}

/**
 * A rate is per UNIT DISTANCE, so converting it is the reciprocal of
 * converting a distance: `UnitApi.toDisplay` multiplies, which would make
 * 0.07 $/ton-mi read 0.1127 $/ton-km — freight getting more expensive
 * because someone flipped a display switch. Derived from the same
 * authority rather than hardcoding 1.609344.
 */
export function rateConversion(unit: UnitApi): DraftConversion {
  return {
    toDisplay: (rate, canonical) => rate / unit.toDisplay(1, canonical),
    fromDisplay: (rate, canonical) => rate * unit.toDisplay(1, canonical),
  };
}

/** A $/ton minimum charge has no distance dimension — the toggle leaves it
 *  alone. */
export const IDENTITY_CONVERSION: DraftConversion = {
  toDisplay: v => v,
  fromDisplay: v => v,
};

/** "$/ton-mi" | "$/ton-km", or null while the canonical unit is unresolved
 *  (never guess a unit — Part D's "no fallback unit" rule). */
export function rateUnitLabel(
  canonical: CanonicalUnit | null | undefined,
  unit: UnitApi,
): string | null {
  return canonical == null ? null : `$/ton-${unit.effectiveUnit(canonical)}`;
}
