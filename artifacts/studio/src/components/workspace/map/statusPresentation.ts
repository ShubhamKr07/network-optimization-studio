// T4 (Input Map v2) — the single exported stored-enum <-> label <->
// marker-style mapping for warehouse status. Every consumer (WarehouseTable,
// EntityMarkers, MapLegend, and later T5/T6's dialogs) imports THIS
// constant rather than re-declaring its own copy — this is what closes the
// recurring "shared status vocabulary drifts between callers" bug class
// this repo has hit before (see CLAUDE.md's DD-6 note). Label vocabulary
// (Potential / Fixed-Open / Inactive) is unchanged from WarehouseTable's
// previous private STATUS_LABEL — only its location moved.
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
