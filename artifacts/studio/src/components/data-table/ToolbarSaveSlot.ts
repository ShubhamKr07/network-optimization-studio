import { createContext, type ReactNode } from "react";

/** WQF-C2 — the Workspace Save cluster, rendered by DataTable beside its Filter button.
 * `null` (the default) = this table shows no Save. Provided by Workspace.tsx only on the
 * model/tab pairs in `SAVE_BESIDE_FILTER_TABS`. */
export const ToolbarSaveSlot = createContext<ReactNode>(null);
