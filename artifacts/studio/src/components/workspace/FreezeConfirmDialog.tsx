import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface FreezeConfirmDialogProps {
  open: boolean;
  /** R3 — true while the confirm PATCH is in flight. Both buttons disable. */
  busy: boolean;
  /** R3 — set when the PATCH failed. The dialog STAYS OPEN and shows this;
   *  closing on failure would claim results were cleared when they were not. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// CH4-16 — the freeze is enforced by intercepting the EDIT, not by rendering
// read-only. No table or tab component in this repo accepts a `readOnly` prop,
// and adding one would touch components shared with five other chapters.
// Fields stay live; the first edit attempt raises this dialog; confirming bumps
// the epoch, drops BOTH results to `0 of 2`, and lets the edit proceed.
// Accepted cost: a student can begin typing before learning there is a
// consequence.
export function FreezeConfirmDialog({ open, busy, error, onConfirm, onCancel }: FreezeConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent data-testid="freeze-confirm-dialog">
        <DialogHeader>
          <DialogTitle>Editing Step 1 clears both results</DialogTitle>
          <DialogDescription>
            Step 1's data and parameters are frozen while its results stand. Changing
            them discards the Max Coverage result and the Min Distance result, and
            returns this scenario to 0 of 2 solved. The solves themselves are kept in
            history.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" data-testid="freeze-confirm-error">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel} data-testid="freeze-confirm-cancel">
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} data-testid="freeze-confirm-accept">
            {busy ? "Clearing…" : "Edit and clear results"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
