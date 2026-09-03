export interface WorkspaceTab {
  id: string;
  label: string;
}
export interface TabBarProps {
  tabs?: WorkspaceTab[];
  activeTabId?: string | null;
  onActivate?: (id: string) => void;
  /** Omit to hide the per-tab close button. */
  onClose?: (id: string) => void;
}
