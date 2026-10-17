// SCU-2.P1 (spec B2.9) — a non-negative decimal input that shows en-US
// grouping ("1,234.5") and reformats on every keystroke, keeping the caret
// on the same significant character (digits + "."). Emits
// `onChange(number | null)`: null = empty = clear override (D3).
//
// Rejected input (anything but digits, one ".", grouping commas/spaces —
// so also "-" and exponents) and values above Number.MAX_SAFE_INTEGER leave
// the field and the value unchanged. IME composition is passed through raw
// and only formatted on `compositionend`. A visible suffix (e.g. "Units")
// sits OUTSIDE the input and is linked via aria-describedby. The component
// never adds an aria-label: whatever accessible name the caller gives the
// input today (none, for the demand cells) is passed through unchanged.
// `integer` (station demand) also rejects ".".

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FormattedNumberInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Visible text after the input, e.g. "Units". */
  suffix?: string;
  /** Integers only (station demand): "." is rejected like any other non-digit; inputMode "numeric". */
  integer?: boolean;
  "data-testid"?: string;
}

const isSig = (ch: string) => (ch >= "0" && ch <= "9") || ch === ".";

/** Strips grouping commas and spaces; returns null when anything else is invalid
 * (with `integer`, a "." is invalid too). */
export function sanitizeNumberText(raw: string, integer = false): string | null {
  const s = raw.replace(/[,\s]/g, "");
  if (!(integer ? /^\d*$/ : /^\d*\.?\d*$/).test(s)) return null;
  return s;
}

/** "0012.50" → "12.50", "." → "0.", "" → "" (no grouping). */
function normalize(s: string): string {
  if (s === "") return "";
  const dot = s.indexOf(".");
  const int = (dot < 0 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const frac = dot < 0 ? null : s.slice(dot + 1);
  return frac === null ? int : `${int === "" ? "0" : int}.${frac}`;
}

/** Groups the integer part of a normalized string: "1234.50" → "1,234.50". */
export function groupNumberText(s: string): string {
  const n = normalize(s);
  const dot = n.indexOf(".");
  const int = dot < 0 ? n : n.slice(0, dot);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot < 0 ? grouped : `${grouped}${n.slice(dot)}`;
}

export function formatNumberValue(value: number | null): string {
  return value === null ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

function parse(s: string): number | null {
  return s === "" ? null : Number(s === "." ? "0" : s);
}

function caretAfterSig(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSig(text[i]) && ++seen === n) return i + 1;
  }
  return text.length;
}

export const FormattedNumberInput = React.forwardRef<HTMLInputElement, FormattedNumberInputProps>(
  function FormattedNumberInput(
    { value, onChange, suffix, integer = false, className, onCompositionStart, onCompositionEnd, ...rest },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const composing = React.useRef(false);
    const pendingCaret = React.useRef<number | null>(null);
    const suffixId = React.useId();
    const [text, setText] = React.useState(() => formatNumberValue(value));
    const [seenValue, setSeenValue] = React.useState(value);

    // External value change (scenario switch, import, reset): resync unless the
    // current text already means that value (e.g. "12." while typing 12.5).
    if (value !== seenValue) {
      setSeenValue(value);
      const current = sanitizeNumberText(text, integer);
      if (current === null || parse(current) !== value) setText(formatNumberValue(value));
    }

    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (el && pendingCaret.current !== null && document.activeElement === el) {
        el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      }
      pendingCaret.current = null;
    });

    const accept = (raw: string, caret: number) => {
      const clean = sanitizeNumberText(raw, integer);
      const next = clean === null ? null : parse(clean);
      // Rejected: no state change, so React restores the controlled value to `text`.
      if (clean === null || (next !== null && next > Number.MAX_SAFE_INTEGER)) return;
      let sig = 0;
      for (let i = 0; i < caret && i < raw.length; i++) if (isSig(raw[i])) sig++;
      const formatted = groupNumberText(clean);
      pendingCaret.current = caretAfterSig(formatted, sig);
      setText(formatted);
      if (next !== value) {
        setSeenValue(next);
        onChange(next);
      }
    };

    const describedBy = [rest["aria-describedby"], suffix ? suffixId : undefined].filter(Boolean).join(" ") || undefined;

    return (
      <span className="inline-flex items-center gap-1 w-full">
        <Input
          {...rest}
          ref={el => {
            innerRef.current = el;
            if (typeof forwardedRef === "function") forwardedRef(el);
            else if (forwardedRef) forwardedRef.current = el;
          }}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          aria-describedby={describedBy}
          className={cn("w-full", className)}
          onChange={e => {
            const raw = e.target.value;
            if (composing.current) {
              setText(raw);
              return;
            }
            accept(raw, e.target.selectionStart ?? raw.length);
          }}
          onCompositionStart={e => {
            composing.current = true;
            onCompositionStart?.(e);
          }}
          onCompositionEnd={e => {
            composing.current = false;
            const el = e.currentTarget;
            accept(el.value, el.selectionStart ?? el.value.length);
            onCompositionEnd?.(e);
          }}
        />
        {suffix && (
          <span id={suffixId} className="text-xs text-muted-foreground whitespace-nowrap">
            {suffix}
          </span>
        )}
      </span>
    );
  },
);
