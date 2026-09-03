export interface DialogProps {
  open?: boolean;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  /** Action row, right-aligned on a sunken footer strip. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number | string;
}
