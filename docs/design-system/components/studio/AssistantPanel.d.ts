export interface AssistantContext {
  /** Active scenario name. */
  scenario?: string;
  /** Whether the current scenario has a solve result. */
  solved?: boolean;
  /** Whether inputs changed since the last solve. */
  stale?: boolean;
  /** p-value (warehouses to open). */
  p?: number;
}

export interface AssistantPanelProps {
  /** Active scenario name, shown in the header (mono 9.5px). */
  scenario?: string;
  /** Whether the current scenario has a solve result. */
  solved?: boolean;
  /** Whether inputs changed since the last solve. */
  stale?: boolean;
  /** p-value (warehouses to open), used for context-aware replies. */
  p?: number;
  /** Close the panel. */
  onClose?: () => void;
}

/**
 * Canned stub reply resolver — the single seam a real LLM call replaces in
 * Bundle 7. Keep the (text, ctx) signature stable when swapping in the LLM.
 */
export function getReply(text: string, ctx: AssistantContext): string;

export function AssistantPanel(props: AssistantPanelProps): JSX.Element;
