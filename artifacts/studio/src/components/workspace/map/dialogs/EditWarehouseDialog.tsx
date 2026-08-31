import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { warehouseStatusPresentation, type WhStatus } from "@/components/workspace/map/statusPresentation";
import type { MapWarehouse } from "@/components/workspace/map/types";

const STATUS_OPTIONS: WhStatus[] = ["active", "forced_open", "inactive"];

interface EditWarehouseDialogProps {
  entity: MapWarehouse;
  capacityMode: "none" | "uniform" | "per_wh";
  onSubmit: (patch: { status: WhStatus; capacity?: number | null }) => void;
  onCancel: () => void;
}

// T6 (Input Map v2) — presentational-only: emits a `{status, capacity}`
// patch and lets the caller decide base→override vs added→row-edit (this
// dialog has no idea which). Radix Dialog already gives us focus-trap /
// Escape-to-close / focus-restore for free, so we don't hand-roll any of
// that here — only the form state is local.
export function EditWarehouseDialog({ entity, capacityMode, onSubmit, onCancel }: EditWarehouseDialogProps) {
  const [status, setStatus] = useState<WhStatus>(entity.status);
  const [capacity, setCapacity] = useState<string>(entity.capacity != null ? String(entity.capacity) : "");

  const handleSave = () => {
    const patch: { status: WhStatus; capacity?: number | null } = { status };
    if (capacityMode === "per_wh") {
      patch.capacity = capacity === "" ? null : Number(capacity);
    }
    onSubmit(patch);
  };

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="edit-warehouse-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit warehouse</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Code</span>
              <p data-testid="edit-warehouse-display-code">{entity.displayCode}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">City / State</span>
              <p data-testid="edit-warehouse-location">
                {entity.city}, {entity.state}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Latitude</span>
              <p data-testid="edit-warehouse-lat">{entity.lat}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p data-testid="edit-warehouse-lng">{entity.lng}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">Status</Label>
            <RadioGroup
              value={status}
              onValueChange={v => setStatus(v as WhStatus)}
              data-testid="edit-warehouse-status"
            >
              {STATUS_OPTIONS.map(option => (
                <div key={option} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={option}
                    id={`edit-warehouse-status-${option}`}
                    data-testid={`edit-warehouse-status-${option}`}
                  />
                  <Label htmlFor={`edit-warehouse-status-${option}`} className="text-sm font-normal">
                    {warehouseStatusPresentation[option].label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {capacityMode === "per_wh" && (
            <div className="space-y-2">
              <Label htmlFor="edit-warehouse-capacity" className="text-xs font-semibold text-foreground">
                Capacity
              </Label>
              <Input
                id="edit-warehouse-capacity"
                type="number"
                min={0}
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                data-testid="edit-warehouse-capacity"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="edit-warehouse-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} data-testid="edit-warehouse-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
