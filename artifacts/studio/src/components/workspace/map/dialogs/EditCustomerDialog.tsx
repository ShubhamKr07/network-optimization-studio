import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
const CUSTOMER_STATUS_OPTIONS = ["active", "excluded"] as const;

interface EditCustomerDialogProps {
  entity: MapCustomer;
  /** T4 (Bundle 2, Step 0) — defaults to CUSTOMER_ROLE. STATION_ROLE (same
   * hasStatus/valueField shape, different label) only changes the dialog
   * title — every field/testid here already applies to both. */
  role?: EntityRoleConfig;
  /** T5 (Bundle 2, Step 1b) — false suppresses editing (Input + Slider
   * become read-only): p-median-brazil's manifest declares
   * `demandEditable: false` (textbook-fixed region demand). Defaults true —
   * every other existing call site (p-median-us, and an ADDED entity on any
   * model — PMedianInputMap always passes true for those, a newly-added row
   * has no textbook demand to protect) is unaffected. */
  demandEditable?: boolean;
  /** T8 (Bundle 2.2, A3) — model capability gate, consulted ONLY when
   * `entity.isAdded` (an added customer's exclusion control also needs
   * `capabilities.supportsAddedCustomerExclusion` — p-median-us and
   * two-echelon-gold-au true, p-median-brazil false). A BASE customer's
   * Active/Excluded control is gated on `role.supportsExclusion` alone
   * (Brazil still allows base-customer status) and ignores this prop.
   * Defaults false — an added entity's control stays hidden until the
   * caller explicitly opts in. */
  supportsAddedCustomerExclusion?: boolean;
  onSubmit: (patch: { demand: number; status?: "active" | "excluded" }) => void;
  /** Fires on every slider/number change so the parent can resize the map's
   * demand bubble live, before Save commits anything. Cancel is the parent's
   * cue to roll that preview back — this dialog never touches the map. */
  onLivePreview: (demand: number) => void;
  onCancel: () => void;
}

// T6 (Input Map v2) — presentational-only, same contract as
// EditWarehouseDialog: emits a `{demand}` patch, no inputs-shape knowledge.
// T8 (Bundle 2.2, A3) — also emits an optional `status` when the
// role/capability two-gate (see `showExclusion` below) allows it.
export function EditCustomerDialog({
  entity,
  role = CUSTOMER_ROLE,
  demandEditable = true,
  supportsAddedCustomerExclusion = false,
  onSubmit,
  onLivePreview,
  onCancel,
}: EditCustomerDialogProps) {
  const [demand, setDemand] = useState<number>(entity.demand);
  const [status, setStatus] = useState<"active" | "excluded">(entity.excluded ? "excluded" : "active");

  // Two gates: (1) role — only a role that supports exclusion at all
  // (CUSTOMER_ROLE, never STATION_ROLE) shows the control; (2) for an ADDED
  // entity specifically, the model must also support added-customer
  // exclusion (Brazil never does) — a BASE entity's status is role-gated
  // only, per this dialog's own `supportsAddedCustomerExclusion` comment.
  const showExclusion = (role.supportsExclusion ?? false) && (!entity.isAdded || supportsAddedCustomerExclusion);

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
                disabled={!demandEditable}
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
              disabled={!demandEditable}
              data-testid="edit-customer-demand-slider"
            />
            {!demandEditable && (
              <p className="text-[11px] text-muted-foreground" data-testid="edit-customer-demand-readonly-note">
                Demand for this entity is fixed by the textbook dataset and can't be edited.
              </p>
            )}
          </div>

          {showExclusion && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Status</Label>
              <RadioGroup
                value={status}
                onValueChange={v => setStatus(v as "active" | "excluded")}
                data-testid="edit-customer-status"
              >
                {CUSTOMER_STATUS_OPTIONS.map(option => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem
                      value={option}
                      id={`edit-customer-status-${option}`}
                      data-testid={`edit-customer-status-${option}`}
                    />
                    <Label htmlFor={`edit-customer-status-${option}`} className="text-sm font-normal">
                      {option === "active" ? "Active" : "Excluded"}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="edit-customer-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(showExclusion ? { demand, status } : { demand })}
            data-testid="edit-customer-save"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
