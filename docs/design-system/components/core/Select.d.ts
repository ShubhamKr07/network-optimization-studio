export interface SelectProps {
  options?: Array<string | { value: string; label: string }>;
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  style?: React.CSSProperties;
}
