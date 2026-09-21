import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// chen-bands-units, Part A (decision 1i), Task 14 Step 5.
//
// Intercepts result-history navigation (`stepResultBack`/`stepResultForward`
// in Workspace.tsx) while an ORDINARY input edit is unsaved. `lensDirty`
// alone (an unsaved distance-band edit) never triggers this prompt — the
// band lens intentionally spans history (decision 1b) and is persisted by
// its own field-scoped route, independent of ordinary-input navigation.
//
// Workspace.tsx owns the actual step/save/discard orchestration; this
// component is deliberately "dumb" — it only renders the three choices and
// reports the outcome of a Save attempt (success vs a rejection, which it
// surfaces inline rather than silently swallowing). Rendered UNCONDITIONALLY
// in Workspace.tsx's single return (mirrors the file's own documented
// Dialog-in-an-unreachable-branch gotcha, CLAUDE.md — Workspace.tsx has no
// early-return branches, so there is only ever one place this needs to be
// mounted, and it's always reachable).
export interface DirtyNavPromptProps {
  open: boolean;
  /** Resolves once the save has genuinely succeeded; rejects (with a
   * message) on failure. The caller is responsible for proceeding with
   * navigation only after this resolves — a rejection must leave both the
   * history index and the draft exactly as they were. */
  onSave: () => Promise<unknown>;
  /** Reverts the ordinary draft to the last-saved snapshot, then proceeds
   * with the navigation that was intercepted. */
  onDiscard: () => void;
  /** Leaves both the index and the draft completely untouched. */
  onCancel: () => void;
}

export function DirtyNavPrompt({ open, onSave, onDiscard, onCancel }: DirtyNavPromptProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveClick() {
    setSaving(true);
    setError(null);
    try {
      await onSave();
      // On success the caller flips `open` to false (and proceeds with the
      // navigation) via its own state update — nothing further to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(next: boolean) {
    // Only a Cancel (or clicking outside / Esc) should close this dialog
    // without side effects — a successful Save closes it via the caller's
    // own `open` prop update instead.
    if (!next) onCancel();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dirty-nav-prompt">
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            This scenario has unsaved input changes. Save them before navigating, discard them, or cancel.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" data-testid="save-error">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} data-testid="dirty-nav-cancel">
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={onDiscard} data-testid="dirty-nav-discard">
            Discard
          </Button>
          <Button size="sm" onClick={handleSaveClick} disabled={saving} data-testid="dirty-nav-save">
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
