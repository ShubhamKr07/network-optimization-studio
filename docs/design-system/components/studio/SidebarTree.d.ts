export interface SidebarItem {
  id: string;
  label: string;
  /** Outputs are disabled until a solved, non-stale run exists. */
  disabled?: boolean;
}
export interface SidebarSection {
  title: string;
  items: SidebarItem[];
  /** Renders a + action in the section header (e.g. create scenario). */
  onAction?: () => void;
  actionLabel?: string;
  emptyLabel?: string;
}
export interface SidebarTreeProps {
  /** Conventional sections: Scenarios (+ create), Inputs, Outputs. */
  sections?: SidebarSection[];
  activeId?: string;
  onSelect?: (id: string) => void;
  width?: number | string;
  style?: React.CSSProperties;
}
