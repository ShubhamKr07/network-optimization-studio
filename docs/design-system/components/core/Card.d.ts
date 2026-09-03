export interface CardProps {
  /** Mono uppercase eyebrow, e.g. "Chapter 3". */
  kicker?: string;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Green border when selected. */
  selected?: boolean;
  hoverable?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
