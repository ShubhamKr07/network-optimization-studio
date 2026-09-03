export interface ButtonProps {
  /** Visual style. Primary = solid green; outline for neutral actions; ghost for chrome; destructive for deletes. */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
