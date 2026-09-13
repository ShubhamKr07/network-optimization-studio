// T4 (Input Map v2) — the single exported stored-enum <-> label <->
// marker-style mapping for warehouse status. Every consumer (WarehouseTable,
// EntityMarkers, MapLegend, and later T5/T6's dialogs) imports THIS
// constant rather than re-declaring its own copy — this is what closes the
// recurring "shared status vocabulary drifts between callers" bug class
// this repo has hit before (see CLAUDE.md's DD-6 note). Label vocabulary
// (Potential / Fixed-Open / Inactive) is unchanged from WarehouseTable's
// previous private STATUS_LABEL — only its location moved.
// jade-T12 (Chapter 9 JADE) — a plant (PLANT_ROLE, types.ts) has NO status
// vocabulary at all (`hasStatus: false`, no addition to this 3-value enum):
// solve_jade has no facility-open binary for plants, only warehouses get
// one (jadeInputs.ts's own file-header comment). JADE's warehouses DO use
// this exact WhStatus/warehouseStatusPresentation vocabulary unchanged
// (JADE_WAREHOUSE_ROLE, types.ts) — only the plant echelon has nothing to
// fold in here, by design, not by omission.
export type WhStatus = "active" | "forced_open" | "inactive";

export const warehouseStatusPresentation: Record<
  WhStatus,
  {
    label: "Potential" | "Fixed-Open" | "Inactive";
    marker: "outline" | "filled" | "dashed";
  }
> = {
  active: { label: "Potential", marker: "outline" }, // NOT filled — `active` is Potential
  forced_open: { label: "Fixed-Open", marker: "filled" },
  inactive: { label: "Inactive", marker: "dashed" },
};
