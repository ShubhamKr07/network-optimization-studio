import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nearestCity } from "@/lib/gazetteer";
import { nextDisplayCode } from "@/lib/entityId";
import { WAREHOUSE_ROLE, CUSTOMER_ROLE, type EntityRoleConfig } from "@/components/workspace/map/types";

interface MoveConfirmDialogProps {
  kind: "wh" | "cs";
  /** T4 (Bundle 2, Step 0) — defaults to WAREHOUSE_ROLE ("wh") / CUSTOMER_ROLE
   * ("cs"). Drives the display-code prefix (role.uidKind, DD-7 — a mine
   * regenerates "MN-..." on move, not "WH-...") and the dialog title. */
  role?: EntityRoleConfig;
  entity: { id: string; displayCode?: string };
  newLat: number;
  newLng: number;
  existingCodes: Iterable<string>;
  onConfirm: (next: { displayCode: string; city: string; state: string; lat: number; lng: number }) => void;
  onCancel: () => void;
}

// T7 (Input Map v2) — confirms a drag/relocate of an ADDED entity (base
// entities aren't draggable — see MapWarehouse.isAdded). Reverse-geocodes
// the drop point and regenerates the display code, same derivation as
// CreateEntityDialog, with one difference: the entity's OWN current display
// code is excluded from the collision set before regenerating, so a nudge
// that stays within the same city keeps its existing number instead of
// spuriously bumping to -02 against itself. `id` never changes on a move —
// it isn't part of `onConfirm` at all.
export function MoveConfirmDialog({
  kind,
  role = kind === "wh" ? WAREHOUSE_ROLE : CUSTOMER_ROLE,
  entity,
  newLat,
  newLng,
  existingCodes,
  onConfirm,
  onCancel,
}: MoveConfirmDialogProps) {
  const nearest = useMemo(() => nearestCity(newLat, newLng), [newLat, newLng]);

  const codesExcludingOwn = useMemo(() => {
    const codes = Array.from(existingCodes);
    return entity.displayCode ? codes.filter(code => code !== entity.displayCode) : codes;
  }, [existingCodes, entity.displayCode]);

  const displayCode = useMemo(
    () => nextDisplayCode(role.uidKind, nearest.state, nearest.city, codesExcludingOwn),
    [role.uidKind, nearest, codesExcludingOwn],
  );

  const handleConfirm = () => {
    onConfirm({ displayCode, city: nearest.city, state: nearest.state, lat: newLat, lng: newLng });
  };

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="move-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Move {role.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-muted-foreground">Current code</span>
              <p data-testid="move-confirm-old-code">{entity.displayCode ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">New code</span>
              <p data-testid="move-confirm-new-code">{displayCode}</p>
            </div>
          </div>

          <div>
            <span className="text-xs text-muted-foreground">New location</span>
            <p data-testid="move-confirm-location">
              {nearest.city}, {nearest.state}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-muted-foreground">Latitude</span>
              <p className="font-mono" data-testid="move-confirm-lat">{newLat}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p className="font-mono" data-testid="move-confirm-lng">{newLng}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="move-confirm-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} data-testid="move-confirm-confirm">
            Confirm move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
