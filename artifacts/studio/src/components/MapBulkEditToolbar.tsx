import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MapBulkEditToolbarProps {
  selectedWarehouseIds: string[];
  selectedCustomerIds: string[];
  capacityMode: "none" | "uniform" | "per_wh";
  onSetWarehouseCapacity: (ids: string[], capacity: number) => void;
  onSetWarehouseStatus: (ids: string[], status: "active" | "forced_open" | "inactive") => void;
  onSetCustomerDemand: (ids: string[], demand: number) => void;
  onSetCustomerStatus: (ids: string[], status: "active" | "excluded") => void;
  onClearSelection: () => void;
}

export function MapBulkEditToolbar({
  selectedWarehouseIds, selectedCustomerIds, capacityMode,
  onSetWarehouseCapacity, onSetWarehouseStatus,
  onSetCustomerDemand, onSetCustomerStatus,
  onClearSelection,
}: MapBulkEditToolbarProps) {
  const [capacityDraft, setCapacityDraft] = useState("");
  const [demandDraft, setDemandDraft] = useState("");

  const hasWarehouses = selectedWarehouseIds.length > 0;
  const hasCustomers = selectedCustomerIds.length > 0;
  const isMixed = hasWarehouses && hasCustomers;

  if (!hasWarehouses && !hasCustomers) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-2 z-20 text-xs"
      data-testid="map-bulk-edit-toolbar"
    >
      {isMixed ? (
        <span className="text-muted-foreground italic">
          Select only one entity type at a time to bulk-edit (warehouses or customers, not both).
        </span>
      ) : hasWarehouses ? (
        <>
          <span className="font-semibold">{selectedWarehouseIds.length} warehouse{selectedWarehouseIds.length > 1 ? "s" : ""} selected</span>
          {capacityMode === "per_wh" && (
            <>
              <Input
                type="number"
                min={0}
                placeholder="Capacity"
                value={capacityDraft}
                onChange={(e) => setCapacityDraft(e.target.value)}
                className="h-7 text-xs w-24"
                data-testid="input-bulk-capacity"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="button-bulk-set-capacity"
                disabled={capacityDraft === ""}
                onClick={() => onSetWarehouseCapacity(selectedWarehouseIds, Math.max(0, parseInt(capacityDraft, 10) || 0))}
              >
                Set capacity
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-force-open"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "forced_open")}>
            Force open
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-inactive"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "inactive")}>
            Set inactive
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "active")}>
            Clear overrides
          </Button>
        </>
      ) : (
        <>
          <span className="font-semibold">{selectedCustomerIds.length} customer{selectedCustomerIds.length > 1 ? "s" : ""} selected</span>
          <Input
            type="number"
            min={0}
            placeholder="Demand"
            value={demandDraft}
            onChange={(e) => setDemandDraft(e.target.value)}
            className="h-7 text-xs w-24"
            data-testid="input-bulk-demand"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="button-bulk-set-demand"
            disabled={demandDraft === ""}
            onClick={() => onSetCustomerDemand(selectedCustomerIds, Math.max(0, parseInt(demandDraft, 10) || 0))}
          >
            Set demand
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-exclude"
            onClick={() => onSetCustomerStatus(selectedCustomerIds, "excluded")}>
            Exclude
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
            onClick={() => onSetCustomerStatus(selectedCustomerIds, "active")}>
            Clear overrides
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-cancel" onClick={onClearSelection}>
        Cancel
      </Button>
    </div>
  );
}
