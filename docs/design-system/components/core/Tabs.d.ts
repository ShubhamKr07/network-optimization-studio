export interface TabsProps {
  tabs?: Array<string | { id: string; label: string }>;
  activeId?: string;
  onChange?: (id: string) => void;
  style?: React.CSSProperties;
}
