export interface BadgeProps {
  /** success/warning/danger are the solve-status colors (succeeded / stale / failed). */
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "danger";
  /** Set for numeric or code-like content (uses IBM Plex Mono). */
  mono?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
