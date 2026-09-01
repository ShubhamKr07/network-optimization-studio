import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CUSTOMER_ROLE, type EntityRoleConfig, type MapCustomer } from "@/components/workspace/map/types";

const DEMAND_SLIDER_MAX = 50000;
const DEMAND_SLIDER_STEP = 100;

interface EditCustomerDialogProps {
  entity: MapCustomer;
  /** T4 (Bundle 2, Step 0) — defaults to CUSTOMER_ROLE. STATION_ROLE (same
   * hasStatus/valueField shape, different label) only changes the dialog
   * title — every field/testid here already applies to both. */
  role?: EntityRoleConfig;
  onSubmit: (patch: { demand: number }) => void;
  /** Fires on every slider/number change so the parent can resize the map's
   * demand bubble live, before Save commits anything. Cancel is the parent's
   * cue to roll that preview back — this dialog never touches the map. */
  onLivePreview: (demand: number) => void;
  onCancel: () => void;
}

// T6 (Input Map v2) — presentational-only, same contract as
// EditWarehouseDialog: emits a `{demand}` patch, no inputs-shape knowledge.
export function EditCustomerDialog({
  entity,
  role = CUSTOMER_ROLE,
  onSubmit,
  onLivePreview,
  onCancel,
}: EditCustomerDialogProps) {
  const [demand, setDemand] = useState<number>(entity.demand);

  const applyDemand = (value: number) => {
    setDemand(value);
    onLivePreview(value);
  };

  // The slider's own max needs to stay >= the starting demand or a
  // large-demand customer would render with the thumb pinned past 100%.
  const sliderMax = Math.max(DEMAND_SLIDER_MAX, entity.demand);

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="edit-customer-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit {role.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Code</span>
              <p data-testid="edit-customer-display-code">{entity.displayCode}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">City / State</span>
              <p data-testid="edit-customer-location">
                {entity.city}, {entity.state}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Latitude</span>
              <p data-testid="edit-customer-lat">{entity.lat}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p data-testid="edit-customer-lng">{entity.lng}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">Demand</Label>
              <Input
                type="number"
                min={0}
                value={demand}
                onChange={e => applyDemand(Number(e.target.value) || 0)}
                className="h-8 w-28 text-sm"
                data-testid="edit-customer-demand-input"
              />
            </div>
            <Slider
              min={0}
              max={sliderMax}
              step={DEMAND_SLIDER_STEP}
              value={[demand]}
              onValueChange={([v]) => applyDemand(v)}
              data-testid="edit-customer-demand-slider"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="edit-customer-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={() => onSubmit({ demand })} data-testid="edit-customer-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
