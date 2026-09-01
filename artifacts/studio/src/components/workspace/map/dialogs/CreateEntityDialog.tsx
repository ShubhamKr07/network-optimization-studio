import { useMemo, useState } from "react";
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
import type { AddedCustomerInput, AddedWarehouseInput } from "@/components/workspace/map/types";
import { nearestCity } from "@/lib/gazetteer";
import { cityCode, newUid, nextDisplayCode } from "@/lib/entityId";

const STATUS_OPTIONS: WhStatus[] = ["active", "forced_open", "inactive"];

type CopyFrom =
  | AddedWarehouseInput
  | AddedCustomerInput
  | { capacity?: number | null; demand?: number };

interface CreateEntityDialogProps {
  kind: "wh" | "cs";
  lat: number;
  lng: number;
  existingCodes: Iterable<string>;
  copyFrom?: CopyFrom;
  medianDemand: number;
  onSubmit: (input: AddedWarehouseInput | AddedCustomerInput) => void;
  onCancel: () => void;
}

// T7 (Input Map v2) — dropped-pin / right-click / copy → new added entity.
// Reverse-geocodes once on open (T2's `nearestCity`), then lets the student
// correct the prefilled city/state before committing — the display code
// (T3's `nextDisplayCode`) is a DERIVED value recomputed from whatever
// city/state is on screen right now, never stored separately, so it can
// never disagree with the location shown. `id` is fixed via `useMemo` for
// the dialog's whole lifetime — regenerating it per keystroke would change
// the join key mid-edit, which the T3 uid contract forbids.
export function CreateEntityDialog({
  kind,
  lat,
  lng,
  existingCodes,
  copyFrom,
  medianDemand,
  onSubmit,
  onCancel,
}: CreateEntityDialogProps) {
  const nearest = useMemo(() => nearestCity(lat, lng), [lat, lng]);
  const [city, setCity] = useState(nearest.city);
  const [state, setState] = useState(nearest.state);
  const id = useMemo(() => newUid(kind), [kind]);

  const copyCapacity =
    copyFrom && "capacity" in copyFrom && copyFrom.capacity != null ? copyFrom.capacity : undefined;
  const copyDemand = copyFrom && "demand" in copyFrom && copyFrom.demand != null ? copyFrom.demand : undefined;

  const [status, setStatus] = useState<WhStatus>("active");
  const [capacity, setCapacity] = useState<string>(copyCapacity != null ? String(copyCapacity) : "");
  const [demand, setDemand] = useState<string>(String(copyDemand ?? medianDemand));

  const displayCode = useMemo(
    () => nextDisplayCode(kind, state, cityCode(city), existingCodes),
    [kind, state, city, existingCodes],
  );

  const handleSubmit = () => {
    if (kind === "wh") {
      const input: AddedWarehouseInput = {
        id,
        displayCode,
        city,
        state,
        lat,
        lng,
        capacity: capacity === "" ? null : Number(capacity),
        status,
      };
      onSubmit(input);
    } else {
      const input: AddedCustomerInput = {
        id,
        displayCode,
        city,
        state,
        lat,
        lng,
        demand: Number(demand) || 0,
      };
      onSubmit(input);
    }
  };

  const title = kind === "wh" ? "New warehouse" : "New customer";

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="create-entity-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {title}
            {copyFrom ? " (copy)" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Latitude</span>
              <p data-testid="create-entity-lat">{lat}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p data-testid="create-entity-lng">{lng}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-entity-city" className="text-xs font-semibold text-foreground">
                City
              </Label>
              <Input
                id="create-entity-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                data-testid="create-entity-city"
              />
            </div>
            <div>
              <Label htmlFor="create-entity-state" className="text-xs font-semibold text-foreground">
                State
              </Label>
              <Input
                id="create-entity-state"
                value={state}
                onChange={e => setState(e.target.value)}
                data-testid="create-entity-state"
              />
            </div>
          </div>

          <div>
            <span className="text-xs text-muted-foreground">Display code</span>
            <p data-testid="create-entity-display-code">{displayCode}</p>
          </div>

          {kind === "wh" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">Status</Label>
                <RadioGroup
                  value={status}
                  onValueChange={v => setStatus(v as WhStatus)}
                  data-testid="create-entity-status"
                >
                  {STATUS_OPTIONS.map(option => (
                    <div key={option} className="flex items-center gap-2">
                      <RadioGroupItem
                        value={option}
                        id={`create-entity-status-${option}`}
                        data-testid={`create-entity-status-${option}`}
                      />
                      <Label htmlFor={`create-entity-status-${option}`} className="text-sm font-normal">
                        {warehouseStatusPresentation[option].label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-entity-capacity" className="text-xs font-semibold text-foreground">
                  Capacity
                </Label>
                <Input
                  id="create-entity-capacity"
                  type="number"
                  min={0}
                  value={capacity}
                  onChange={e => setCapacity(e.target.value)}
                  data-testid="create-entity-capacity"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="create-entity-demand" className="text-xs font-semibold text-foreground">
                Demand
              </Label>
              <Input
                id="create-entity-demand"
                type="number"
                min={0}
                value={demand}
                onChange={e => setDemand(e.target.value)}
                data-testid="create-entity-demand"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="create-entity-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} data-testid="create-entity-submit">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
