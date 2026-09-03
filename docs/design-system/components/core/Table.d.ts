export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Numeric columns render in IBM Plex Mono. */
  mono?: boolean;
}
export interface TableProps {
  columns?: TableColumn[];
  /** Row objects keyed by column key; values may be ReactNodes (e.g. a Badge). */
  rows?: Array<Record<string, React.ReactNode>>;
  compact?: boolean;
  maxHeight?: number | string;
  style?: React.CSSProperties;
}
