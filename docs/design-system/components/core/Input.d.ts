export interface InputProps {
  /** Optional field label rendered above the control. */
  label?: string;
  size?: "default" | "sm";
  /** Mono digits — set for numeric model parameters. */
  mono?: boolean;
  value?: string | number;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  onChange?: (e: any) => void;
  style?: React.CSSProperties;
}
