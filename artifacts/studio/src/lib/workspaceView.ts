// COSM-1 — the active-view type, all that survives of the deleted
// workspaceTabs reducer. Workspace.tsx holds one active view at a time in
// plain useState; there is no tab strip and no multi-view state.

export type WorkspaceViewKind = "input" | "output" | "report";

export interface WorkspaceView {
  id: string;
  kind: WorkspaceViewKind;
  /** Model-specific entity slug this view shows, e.g. "warehouses", "flows". */
  entity: string;
  label: string;
}

/** Deterministic id for a (kind, entity) pair. */
export function workspaceViewId(kind: WorkspaceViewKind, entity: string): string {
  return `${kind}:${entity}`;
}
