// A0.1 — Workspace tab-state: open/activate/close mechanics only. No tab
// contents live here (those land in A1.1-A3.1) — this is pure, UI-agnostic
// state so SidebarTree/TabBar/Workspace can all drive it without duplicating
// the "is this tab already open" logic.

export type WorkspaceTabKind = "input" | "output" | "report";

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  /** Model-specific entity slug this tab shows, e.g. "warehouses", "flows". */
  entity: string;
  label: string;
}

export interface WorkspaceTabState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export const initialWorkspaceTabState: WorkspaceTabState = {
  tabs: [],
  activeTabId: null,
};

export type WorkspaceTabAction =
  | { type: "open"; tab: WorkspaceTab }
  | { type: "activate"; id: string }
  | { type: "close"; id: string };

/** Deterministic id for an (kind, entity) pair — open() uses this to dedupe. */
export function workspaceTabId(kind: WorkspaceTabKind, entity: string): string {
  return `${kind}:${entity}`;
}

export function workspaceTabsReducer(state: WorkspaceTabState, action: WorkspaceTabAction): WorkspaceTabState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.find(t => t.id === action.tab.id);
      if (existing) {
        // Already open — just activate it, don't duplicate or reorder.
        return state.activeTabId === action.tab.id ? state : { ...state, activeTabId: action.tab.id };
      }
      return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.id };
    }
    case "activate": {
      if (!state.tabs.some(t => t.id === action.id)) return state;
      return state.activeTabId === action.id ? state : { ...state, activeTabId: action.id };
    }
    case "close": {
      const closedIndex = state.tabs.findIndex(t => t.id === action.id);
      if (closedIndex === -1) return state;
      const tabs = state.tabs.filter(t => t.id !== action.id);
      if (state.activeTabId !== action.id) {
        return { tabs, activeTabId: state.activeTabId };
      }
      // Closing the active tab: activate its neighbor — the tab that took
      // its old index (the one to the right), else the one before it, else
      // none left.
      const next = tabs[closedIndex] ?? tabs[closedIndex - 1] ?? null;
      return { tabs, activeTabId: next ? next.id : null };
    }
    default:
      return state;
  }
}
