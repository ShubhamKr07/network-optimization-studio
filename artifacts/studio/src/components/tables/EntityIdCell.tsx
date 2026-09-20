// SCN v0.3 workspace-fixups-2, item 2 (T3) — the one shared entity-id cell,
// extracted from OpenWarehousesTab.tsx's own reference stacked-cell pattern
// (`City, State` primary, mono `displayId` sub-label) so every other
// >10-row table (T10/T11) renders it identically instead of re-implementing
// the same two `<span>`s per table.
//
// This component does NOT look anything up — the caller resolves
// `identityById[entityId]` (lib/entityIdentity.ts's `buildEntityIdentityById`)
// and passes the resolved `displayId`/`location` down. Keeping the lookup
// out of this component means it stays a pure presentational leaf with no
// dependency on any specific identity-map shape.
import { formatCityState } from "@/lib/formatLocation";

export interface EntityIdCellProps {
  /** Canonical id used only for a `data-testid`/key by the caller — kept on
   * the props for callers that want it, but this component never looks
   * anything up by it. */
  entityId: string;
  /** What the user sees: an added row's display code, or the canonical id
   * when no display code exists (see entityIdentity.ts's precedence). */
  displayId: string;
  /** Omitted (or `undefined`) when no location is known for this entity —
   * renders the bare `displayId` in that case, matching the Open
   * Warehouses reference's `loc ? (...) : codeById[id] ?? id` fallback. */
  location?: { city: string; state: string };
}

export function EntityIdCell({ displayId, location }: EntityIdCellProps) {
  if (!location) {
    return <>{displayId}</>;
  }
  return (
    <div className="flex flex-col">
      <span>{formatCityState(location.city, location.state)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{displayId}</span>
    </div>
  );
}
