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
import { cityCode, nextDisplayCode } from "@/lib/entityId";

interface MoveConfirmDialogProps {
  kind: "wh" | "cs";
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
    () => nextDisplayCode(kind, nearest.state, cityCode(nearest.city), codesExcludingOwn),
    [kind, nearest, codesExcludingOwn],
  );

  const handleConfirm = () => {
    onConfirm({ displayCode, city: nearest.city, state: nearest.state, lat: newLat, lng: newLng });
  };

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="move-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Move {kind === "wh" ? "warehouse" : "customer"}</DialogTitle>
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
              <p data-testid="move-confirm-lat">{newLat}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p data-testid="move-confirm-lng">{newLng}</p>
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
