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
import {
  WAREHOUSE_ROLE,
  CUSTOMER_ROLE,
  type AddedCustomerInput,
  type AddedWarehouseInput,
  type EntityRoleConfig,
} from "@/components/workspace/map/types";
import { nearestCity } from "@/lib/gazetteer";
import { newUid, nextDisplayCode } from "@/lib/entityId";

const STATUS_OPTIONS: WhStatus[] = ["active", "forced_open", "inactive"];

type CopyFrom =
  | AddedWarehouseInput
  | AddedCustomerInput
  | { capacity?: number | null; demand?: number };

function valueFromCopy(copyFrom: CopyFrom | undefined, key: "capacity" | "demand"): number | undefined {
  if (!copyFrom) return undefined;
  if (key === "capacity" && "capacity" in copyFrom && copyFrom.capacity != null) return copyFrom.capacity;
  if (key === "demand" && "demand" in copyFrom && copyFrom.demand != null) return copyFrom.demand;
  return undefined;
}

interface CreateEntityDialogProps {
  /** Rendering role — "wh" is a triangle marker (warehouse/mine/refinery),
   * "cs" is a demand bubble (customer/station). Which fields actually apply
   * (status, capacity vs demand, uid/display-code prefix) is `role`'s job,
   * not this. */
  kind: "wh" | "cs";
  /** T4 (Bundle 2, Step 0) — the entity's real role config. Defaults to
   * WAREHOUSE_ROLE ("wh") / CUSTOMER_ROLE ("cs") — today's exact
   * p-median-us behavior, unchanged for every existing call site that
   * doesn't pass this. */
  role?: EntityRoleConfig;
  /** Cleanup pass — mirrors EditWarehouseDialog's own `capacityMode` prop
   * exactly: p-median-us/brazil gate their Capacity field on it (only
   * `per_wh` shows it), transport-coal's mines have no capacityMode concept
   * and always show it (leave undefined), two-echelon's refineries pass
   * "none" to suppress it entirely (refineries have no capacity concept —
   * `addedRefinerySchema` has no capacity field, the value is stripped
   * server-side even if sent). Optional so this stays backward-compatible
   * with any test/caller that doesn't pass it. */
  capacityMode?: "none" | "uniform" | "per_wh";
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
  role = kind === "wh" ? WAREHOUSE_ROLE : CUSTOMER_ROLE,
  capacityMode,
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
  // DD-7 — the uid/display-code prefix comes from the role's `uidKind`, not
  // `kind`: a mine (kind="wh", so it renders as a triangle) still mints an
  // "am-"/"MN-..." id, never "aw-"/"WH-...".
  const id = useMemo(() => newUid(role.uidKind), [role.uidKind]);

  const copyCapacity = valueFromCopy(copyFrom, "capacity");
  const copyDemand = valueFromCopy(copyFrom, "demand");

  const [status, setStatus] = useState<WhStatus>("active");
  const [capacity, setCapacity] = useState<string>(copyCapacity != null ? String(copyCapacity) : "");
  const [demand, setDemand] = useState<string>(String(copyDemand ?? medianDemand));

  const displayCode = useMemo(
    () => nextDisplayCode(role.uidKind, state, city, existingCodes),
    [role.uidKind, state, city, existingCodes],
  );

  // Mirrors EditWarehouseDialog's own `showValueField` gate exactly: a role
  // without a capacity value field (customers/stations never reach this —
  // they're kind==="cs") never shows it; a role that HAS one shows it only
  // when there's no capacityMode gate at all (mines — undefined) or the
  // caller's capacityMode says per_wh (p-median-us/brazil's per-warehouse
  // capacity). "none"/"uniform" both hide it — a uniform-capacity scenario
  // has no per-warehouse override to set, and two-echelon's refineries
  // always pass "none" (no capacity concept for that role at all).
  const showCapacity = role.valueField?.key === "capacity" && (capacityMode === undefined || capacityMode === "per_wh");

  const handleSubmit = () => {
    if (kind === "wh") {
      // role.hasStatus:false (e.g. MINE_ROLE) and !showCapacity (e.g.
      // REFINERY_ROLE with capacityMode="none") both omit the key entirely
      // from the emitted object, not just leave it undefined, so it can
      // never round-trip into a PATCH payload as a stray no-op field.
      const input = {
        id,
        displayCode,
        city,
        state,
        lat,
        lng,
        ...(showCapacity ? { capacity: capacity === "" ? null : Number(capacity) } : {}),
        ...(role.hasStatus ? { status } : {}),
      };
      onSubmit(input as unknown as AddedWarehouseInput);
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

  const title = `New ${role.label}`;

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
              {role.hasStatus && (
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
              )}
              {showCapacity && (
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
              )}
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
