import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// jade B8 — two-echelon-jade-us's `distanceBands` (jadeInputsSchema,
// artifacts/api-server/src/validation/inputs/jadeInputs.ts:158-164) requires
// EXACTLY four positive, strictly-ascending integers. The shared chip editor
// (OptimizationParametersTab's add/remove UI, built for every other model)
// can violate all three of those invariants — wrong count, non-positive,
// duplicate, or descending — and only finds out via a 422 on Save.
//
// This is a fixed-4-slot editor: four ordered numeric inputs, NO add/remove
// controls, so the count invariant holds by construction (draft is always
// exactly 4 entries; there is no code path that can grow or shrink it).
// It enforces the full invariant client-side on every keystroke:
//   - `onChange` (publishes a valid 4-tuple upward) is called ONLY when the
//     current draft is fully valid — an invalid draft is never handed to the
//     caller, so it can never reach a PATCH.
//   - `onValidityChange(isValid)` fires on every render where validity
//     changes, so a caller (OptimizationParametersTab, SolveDialog, and
//     ultimately Workspace.tsx/INT) can gate Save/Run on it. This component
//     does NOT and CANNOT disable any Save button itself — Save lives in
//     Workspace.tsx, outside this component's ownership (spec §2 R6-1 +
//     plan review R-plan-2).
export interface JadeBandEditorProps {
  /** Current saved/draft bands. Expected to already be a valid 4-tuple in
   * steady state (jadeInputsSchema enforces this server-side); this editor
   * tolerates a shorter/longer/empty array on first mount (e.g. a
   * not-yet-loaded scenario) by padding/truncating its own draft to 4 slots,
   * but will never itself publish anything but a valid 4-tuple. */
  bands: number[];
  /** Called ONLY with a valid (length-4, positive, strictly-ascending
   * integer) array — never with an invalid draft. */
  onChange: (bands: number[]) => void;
  /** Fires on every validity transition. The caller (not this component)
   * is responsible for using this to gate Save/Run. */
  onValidityChange?: (isValid: boolean) => void;
  /** Active model's distance unit (manifest ModelInfo.distanceUnit), for the
   * label — mirrors the chip editor's own `distanceUnit` prop. */
  distanceUnit?: string;
}

function toDraft(bands: number[]): string[] {
  const seeded = bands.slice(0, 4).map((b) => String(b));
  while (seeded.length < 4) seeded.push("");
  return seeded;
}

interface ValidationResult {
  bands: number[] | null;
  error: string | null;
}

// Pure validator — exactly four positive, strictly-ascending integers.
// Returns the parsed bands on success, or `null` + a human-readable error.
function validateDraft(draft: string[]): ValidationResult {
  if (draft.length !== 4) {
    return { bands: null, error: "Exactly 4 bands are required." };
  }
  const parsed: number[] = [];
  for (const raw of draft) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return { bands: null, error: "Every band must be a positive whole number." };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { bands: null, error: "Every band must be a positive whole number." };
    }
    parsed.push(n);
  }
  const seen = new Set<number>();
  for (const n of parsed) {
    if (seen.has(n)) {
      return { bands: null, error: "Band values must be unique (no duplicates)." };
    }
    seen.add(n);
  }
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i] <= parsed[i - 1]) {
      return { bands: null, error: "Band values must be strictly ascending (each greater than the previous)." };
    }
  }
  return { bands: parsed, error: null };
}

export function JadeBandEditor({ bands, onChange, onValidityChange, distanceUnit = "mi" }: JadeBandEditorProps) {
  const bandsKey = bands.join(",");
  const [draft, setDraft] = useState<string[]>(() => toDraft(bands));

  // Resync the draft when the incoming `bands` prop actually changes (e.g.
  // scenario switch, history-step, or this same component's own `onChange`
  // echoing back through Workspace's localInputs). This never fires mid-typing
  // of an invalid value, because an invalid draft never calls `onChange`, so
  // `bands` (and therefore `bandsKey`) never changes underneath the user.
  useEffect(() => {
    setDraft(toDraft(bands));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey]);

  const { bands: validBands, error } = validateDraft(draft);
  const isValid = validBands !== null;

  useEffect(() => {
    onValidityChange?.(isValid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid]);

  function handleSlotChange(index: number, value: string) {
    const next = [...draft];
    next[index] = value;
    setDraft(next);
    const result = validateDraft(next);
    if (result.bands) {
      onChange(result.bands);
    }
  }

  return (
    <div className="space-y-2" data-testid="jade-band-editor">
      <Label className="text-xs font-semibold text-foreground">Distance bands ({distanceUnit})</Label>
      <div className="grid grid-cols-4 gap-2">
        {draft.map((value, i) => (
          <Input
            key={i}
            type="number"
            value={value}
            onChange={(e) => handleSlotChange(i, e.target.value)}
            className="h-8 text-xs font-mono"
            aria-label={`Band ${i + 1} boundary`}
            data-testid={`jade-band-slot-${i}`}
          />
        ))}
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="alert" data-testid="jade-band-error">
          {error}
        </p>
      )}
    </div>
  );
}
