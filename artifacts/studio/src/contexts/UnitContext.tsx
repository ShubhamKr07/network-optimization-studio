import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  type CanonicalUnit,
  type DisplayUnitPref,
  effectiveUnit as effectiveUnitFn,
  fromDisplay as fromDisplayFn,
  toDisplay as toDisplayFn,
} from "@workspace/units";

// SCN chen-bands-units, Part D. `@workspace/units` is the single authority
// for every conversion; this context is a thin, React-only wrapper that
// binds the user's persisted display preference to those pure functions.
// Never infer a unit from `modelId` here — the canonical unit always comes
// from the caller (manifest / envelope), never guessed by this layer.

const STORAGE_KEY = "nos:display-unit-pref";
const VALID_PREFS: readonly DisplayUnitPref[] = ["auto", "km", "mi"];

function isValidPref(value: string | null): value is DisplayUnitPref {
  return value != null && (VALID_PREFS as readonly string[]).includes(value);
}

function readStoredPref(): DisplayUnitPref {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidPref(raw) ? raw : "auto";
  } catch {
    // localStorage unavailable (private mode, disabled, SSR) — default.
    return "auto";
  }
}

export interface UnitApi {
  pref: DisplayUnitPref;
  setPref(p: DisplayUnitPref): void;
  effectiveUnit(canonical: CanonicalUnit): CanonicalUnit;
  toDisplay(canonicalValue: number, canonical: CanonicalUnit): number;
  fromDisplay(displayValue: number, canonical: CanonicalUnit): number;
  format(canonicalValue: number, canonical: CanonicalUnit, opts?: Intl.NumberFormatOptions): string;
}

const UnitContext = createContext<UnitApi | null>(null);

export function UnitProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<DisplayUnitPref>(() => readStoredPref());

  const setPref = useCallback((next: DisplayUnitPref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting failed (private mode, quota, SSR) — the in-memory pref
      // for this session is still correct, just won't survive a reload.
    }
  }, []);

  const api = useMemo<UnitApi>(() => {
    const effectiveUnit = (canonical: CanonicalUnit): CanonicalUnit => effectiveUnitFn(pref, canonical);
    const toDisplay = (canonicalValue: number, canonical: CanonicalUnit): number =>
      toDisplayFn(canonicalValue, canonical, effectiveUnit(canonical));
    const fromDisplay = (displayValue: number, canonical: CanonicalUnit): number =>
      fromDisplayFn(displayValue, effectiveUnit(canonical), canonical);
    const format = (
      canonicalValue: number,
      canonical: CanonicalUnit,
      opts?: Intl.NumberFormatOptions,
    ): string => {
      const unit = effectiveUnit(canonical);
      const value = toDisplay(canonicalValue, canonical);
      return `${value.toLocaleString(undefined, opts)} ${unit}`;
    };
    return { pref, setPref, effectiveUnit, toDisplay, fromDisplay, format };
  }, [pref, setPref]);

  return <UnitContext.Provider value={api}>{children}</UnitContext.Provider>;
}

export function useDisplayUnit(): UnitApi {
  const ctx = useContext(UnitContext);
  if (!ctx) throw new Error("useDisplayUnit must be used within a UnitProvider");
  return ctx;
}
