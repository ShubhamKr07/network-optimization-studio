export interface ConstraintChipsProps {
  /** Constraint summaries derived from scenario state, e.g. "p = 4", "Capacity: uniform 60M", "2 forced open". Click focuses the source input. */
  chips?: Array<string | { label: string; onClick?: () => void }>;
  /** Appends the amber Stale badge ("inputs changed since this solve"). */
  stale?: boolean;
}
