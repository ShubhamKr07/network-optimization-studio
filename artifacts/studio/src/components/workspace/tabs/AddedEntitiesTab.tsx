import { useEffect, useState, type ReactNode } from "react";

// T9 (Workspace fixups bundle, item 4 part B). Spec §4.
//
// One dedicated sidebar tab ("Added Entities") per model, holding the
// scenario-local "Added <entity>" sections that used to live inline beneath
// each base entity tab's table (WarehousesTab/CustomersTab/MinesTab/
// StationsTab/PlantsTab, all T8) — relocated, not rewritten: T8 taught each
// base tab a `showBaseTable={false}` flag that hides everything except the
// add-row form + added-rows table + precheck chips + delete, and this
// component is a thin generic segmented-tab shell around whatever content
// the caller (Workspace.tsx / INT) supplies for each sub-tab.
//
// Deliberately generic — this component has ZERO knowledge of which base
// tab, model, or entity type is behind any given sub-tab. The caller passes
// the model's supported added-entity sub-tab set as a `subTabs` prop, each
// entry already carrying its own fully-wired content (typically
// `<WarehousesTab showBaseTable={false} .../>`,
// `<CustomersTab showBaseTable={false} .../>`, etc., with whatever
// entity-specific props — `entity`, callbacks, precheck data,
// `hasStateColumn` — that particular base tab needs already bound in by the
// caller). This component just renders the segmented control and forwards
// (renders) the active sub-tab's content — no per-model switch statement
// here, so a new model/entity type needs zero changes to this file.
//
// Inner-tab pattern mirrors `JadeFlowsTab.tsx`'s `innerTab` segmented
// control exactly (same `role="group"`, `aria-pressed`, and Tailwind
// classes) for a consistent Workspace look.

export interface AddedEntitiesSubTab {
  /** Stable id for this sub-tab (e.g. "warehouses", "customers", "mines", "stations", "refineries", "plants"). Used as the segmented-control button's key/testid suffix and to track the active selection. */
  id: string;
  /** Human-facing label shown on the segmented control (e.g. "Warehouses", "Customers"). */
  label: string;
  /** The fully-wired base tab element for this sub-tab, rendered with `showBaseTable={false}` by the caller — this component renders it as-is, with no further prop manipulation. */
  content: ReactNode;
}

interface AddedEntitiesTabProps {
  /** The model's supported added-entity sub-tab set, in display order. Empty/absent renders a neutral empty state rather than crashing — defensive, mirrors every other Workspace tab's "absent capability" posture. */
  subTabs?: AddedEntitiesSubTab[];
}

export function AddedEntitiesTab({ subTabs = [] }: AddedEntitiesTabProps) {
  const [activeId, setActiveId] = useState<string | null>(subTabs[0]?.id ?? null);

  // If the sub-tab set changes out from under the current selection (e.g.
  // switching models/scenarios, or a model whose sub-tab set is computed
  // from capabilities), and the currently-selected id is no longer present,
  // fall back to the new first sub-tab rather than rendering nothing.
  useEffect(() => {
    if (subTabs.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!subTabs.some(t => t.id === activeId)) {
      setActiveId(subTabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTabs.map(t => t.id).join(",")]);

  if (subTabs.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="added-entities-empty">
        No added-entity types are available for this model.
      </div>
    );
  }

  const active = subTabs.find(t => t.id === activeId) ?? subTabs[0];

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="added-entities-tab">
      <div className="flex items-center gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <span className="text-sm font-medium">Added Entities</span>
        <div
          className="inline-flex rounded border border-border overflow-hidden"
          role="group"
          aria-label="Added entity type"
          data-testid="added-entities-inner-tabs"
        >
          {subTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              data-testid={`button-added-entities-inner-${tab.id}`}
              aria-pressed={tab.id === active.id}
              onClick={() => setActiveId(tab.id)}
              className={`text-xs px-3 py-1 transition-colors ${
                tab.id === active.id ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto flex-1 p-2" data-testid={`added-entities-body-${active.id}`}>
        {active.content}
      </div>
    </div>
  );
}
