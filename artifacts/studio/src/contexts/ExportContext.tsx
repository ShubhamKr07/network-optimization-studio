import { createContext, useContext, useMemo, type ReactNode } from "react";
import { downloadEntityExport, type ExportEntity } from "@/lib/exportEntity";

// SCN chen-bands-units, Task 11b
// (docs/superpowers/plans/2026-09-20-chen-bands-units.md:1438).
//
// Context ONLY — this file has zero consumers as of this task. Task 14
// mounts and populates `ExportProvider` in `Workspace.tsx`; Task 14b
// converts the 26 export controls across the tab files to `useExport()`.
// A provider with no consumers is inert, so it's safe to land ahead of
// them; converting consumers first would commit a broken intermediate
// state (`useExport()` deliberately throws without a provider) and would
// also mask the exact "provider never mounted" regression that throw
// exists to catch.

/** null === the model's canonical unit hasn't resolved yet (manifest still loading). */
export type ExportUnit = "km" | "mi" | null;

/**
 * The ten input entities. Exported so input/result classification lives
 * HERE, once — never as 16 component-local checks. A per-entity gate
 * updated for one entity and forgotten for a sibling is this repo's
 * most-recurring bug class (Chapter 10, SCN v0.3, Bundle 2.2 all hit it) —
 * do not reintroduce it here.
 */
export const INPUT_ENTITIES = [
  "warehouses",
  "customers",
  "mines",
  "stations",
  "refineries",
  "distances",
  "laneCosts",
  "legDistances",
  "plants",
  "plantCapabilities",
] as const;

/** The five result entities. INPUT_ENTITIES ∪ RESULT_ENTITIES === ExportEntity. */
export const RESULT_ENTITIES = ["assignments", "openWarehouses", "costSummary", "serviceStats", "flows"] as const;

// Compile-time proof the two arrays partition `ExportEntity` EXACTLY — not
// merely "assignable" (an assignability check alone would still pass with
// an entity missing, duplicated, or on the wrong side). This fails to
// compile if `ExportEntity` ever gains/loses a member without a matching
// update here. See `ExportContext.test.tsx` for the runtime disjointness
// check this type-level check cannot express (duplicates within/across
// the two literal arrays as written, independent of `ExportEntity` itself).
type Covered = (typeof INPUT_ENTITIES)[number] | (typeof RESULT_ENTITIES)[number];
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _AssertPartitionIsExact = Equal<ExportEntity, Covered> extends true ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _partitionIsExact: _AssertPartitionIsExact = true;

/** What `ExportProvider` ACCEPTS — pure state, no behavior. Populated by Task 14. */
export interface ExportProviderValue {
  /** null when no scenario is selected — `download()` refuses to fire. */
  scenarioId: number | null;
  /** null until the model's canonical unit resolves — no fallback unit is guessed here. */
  unit: ExportUnit;
  /** The displayed history entry's run id; undefined means "the latest result". */
  runId?: number;
  /** Set only for an UNADDRESSABLE historical entry (spec 1g). */
  resultDisabledReason?: string;
  /** Set for ANY historical entry (spec 1k). */
  inputDisabledReason?: string;
}

/** What `useExport()` RETURNS — provider state plus the behavior the provider adds. */
export interface ExportApi extends ExportProviderValue {
  disabledReasonFor(entity: ExportEntity): string | undefined;
  download(entity: ExportEntity, format: "csv" | "json"): Promise<void>;
}

const ExportContext = createContext<ExportProviderValue | null>(null);

export function ExportProvider({
  value,
  children,
}: {
  value: ExportProviderValue;
  children: ReactNode;
}) {
  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

export function useExport(): ExportApi {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error("useExport must be used within an ExportProvider");

  const { scenarioId, unit, runId, resultDisabledReason, inputDisabledReason } = ctx;

  return useMemo<ExportApi>(() => {
    // Sole family classifier — do not duplicate this branch anywhere else.
    const disabledReasonFor = (entity: ExportEntity): string | undefined => {
      if (scenarioId == null || unit == null) return "Loading…";
      return (INPUT_ENTITIES as readonly string[]).includes(entity) ? inputDisabledReason : resultDisabledReason;
    };

    const download = async (entity: ExportEntity, format: "csv" | "json"): Promise<void> => {
      // Hard guard — three independent checks, in this order, matching the
      // locked contract verbatim. The third subsumes the second once
      // `unit == null` always yields a disabled reason via
      // `disabledReasonFor`, but each check stays explicit rather than
      // relying on that overlap so the contract reads literally here.
      if (scenarioId == null) return;
      if (unit == null) return;
      if (disabledReasonFor(entity) != null) return;

      // `unit` is always appended, for every entity including non-distance
      // ones — the server validates unit= for any entity and simply
      // ignores it (byte-identical output) when it doesn't apply. `runId`
      // is appended only when defined (an explicit historical run vs. "the
      // latest result").
      await downloadEntityExport(scenarioId, entity, format, { unit, runId });
    };

    return {
      scenarioId,
      unit,
      runId,
      resultDisabledReason,
      inputDisabledReason,
      disabledReasonFor,
      download,
    };
  }, [scenarioId, unit, runId, resultDisabledReason, inputDisabledReason]);
}
