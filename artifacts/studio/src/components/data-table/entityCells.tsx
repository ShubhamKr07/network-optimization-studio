// SCU-2.P4.10 — small cell components shared by the migrated entity input
// tables (Warehouses/Refineries, Customers, Plants, Mines, Stations). Each one
// replaces a block that was copy-pasted per table; behaviour is unchanged
// except that every control now takes `disabled` (D2: history read-only on
// base AND added rows).

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormattedNumberInput } from "./FormattedNumberInput";

export const READ_ONLY_TITLE = "Read-only while browsing result history.";

/** The segmented status control (warehouses: Potential/Fixed-Open/Inactive; customers: Active/Excluded). */
export function StatusToggle<S extends string>({
  options,
  value,
  labelOf,
  activeClassOf,
  onChange,
  disabled,
  testIdOf,
}: {
  options: readonly S[];
  value: S;
  labelOf: (s: S) => string;
  /** Classes for the selected option (e.g. "bg-primary text-white"). */
  activeClassOf: (s: S) => string;
  onChange: (s: S) => void;
  disabled: boolean;
  testIdOf: (s: S) => string;
}) {
  return (
    <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit mx-auto">
      {options.map(s => (
        <button
          key={s}
          type="button"
          data-testid={testIdOf(s)}
          onClick={() => onChange(s)}
          disabled={disabled}
          title={disabled ? READ_ONLY_TITLE : undefined}
          className={`px-2 py-1 transition-colors whitespace-nowrap ${
            value === s ? activeClassOf(s) : "bg-white text-muted-foreground hover:bg-muted"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {labelOf(s)}
        </button>
      ))}
    </div>
  );
}

/** The trailing ✕ on an added row. */
export function DeleteRowButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled: boolean; testId: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid={testId}
      className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

/** A capacity-style number input that commits on every keystroke (as the
 * WarehouseTable/MineTable inputs did) and keeps the raw keystroke text while
 * the committed value is what the parent now shows. An EXTERNAL change
 * (Discard, a history step, an import) drops the draft — the role of the old
 * per-table `lastCommittedRef` reconciliation. */
export function DraftNumberInput({
  value,
  parse,
  onCommit,
  disabled,
  placeholder,
  testId,
}: {
  value: number | null | undefined;
  /** raw input text → the value to commit (null = blank). */
  parse: (raw: string) => number | null;
  onCommit: (value: number | null) => void;
  disabled: boolean;
  placeholder?: string;
  testId: string;
}) {
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState<{ raw: string; committed: string } | null>(null);
  if (draft !== null && draft.committed !== shown) setDraft(null);
  return (
    <Input
      type="number"
      min={0}
      value={disabled || draft === null ? shown : draft.raw}
      onChange={e => {
        if (disabled) return;
        const raw = e.target.value;
        const next = parse(raw);
        setDraft({ raw, committed: next == null ? "" : String(next) });
        onCommit(next);
      }}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      placeholder={placeholder}
      className="h-7 text-xs w-full min-w-24 font-mono"
      data-testid={testId}
    />
  );
}

/** SCU-2.P4.11 (spec B2.9) — a demand cell: grouped FormattedNumberInput with
 * a visible suffix linked by aria-describedby (no aria-label is added). The
 * suffix is the adapter's: customers "Units", stations "tons" (user decision).
 * Emptying the field shows it blank until blur, then:
 *  - `clearCommits` (base rows, D3): the override is cleared → the base value
 *    returns on blur;
 *  - otherwise (added rows, user decision 2026-10-17): nothing is saved → the
 *    last valid value returns on blur.
 * Without the local `blank` flag FormattedNumberInput would snap back to the
 * unchanged prop value on the very next render, mid-edit. */
export function DemandCell({
  value,
  onCommit,
  clearCommits,
  suffix,
  integer,
  disabled,
  title,
  placeholder,
  testId,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  clearCommits: boolean;
  /** Visible unit after the input ("Units" for customers, "tons" for stations). */
  suffix: string;
  integer?: boolean;
  disabled: boolean;
  title?: string;
  placeholder?: string;
  testId: string;
}) {
  const [blank, setBlank] = useState(false);
  return (
    <FormattedNumberInput
      value={blank ? null : value}
      onChange={v => {
        if (v === null) {
          setBlank(true);
          if (clearCommits) onCommit(null);
          return;
        }
        setBlank(false);
        onCommit(v);
      }}
      onBlur={() => setBlank(false)}
      suffix={suffix}
      integer={integer}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      className="h-7 text-xs font-mono min-w-24"
      data-testid={testId}
    />
  );
}
