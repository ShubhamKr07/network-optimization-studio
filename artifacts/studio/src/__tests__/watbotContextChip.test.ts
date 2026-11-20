import { describe, it, expect } from "vitest";
import { buildContextChip } from "@/components/workspace/watbot/contextChip";

describe("buildContextChip", () => {
  it("joins tab label, scenario name and p", () => {
    expect(buildContextChip({ id: "o", kind: "output", entity: "output-map", label: "Output Map" } as never, { name: "Baseline", inputs: { p: 4 } }))
      .toEqual({ label: "Output Map · Baseline · p = 4", tab: "output-map" });
  });
  it("omits p when the model has none", () => {
    expect(buildContextChip({ id: "f", kind: "output", entity: "flows", label: "Flows" } as never, { name: "Base", inputs: {} })!.label).toBe("Flows · Base");
  });
  it("returns null with no view and no scenario", () => {
    expect(buildContextChip(null, null)).toBeNull();
  });
});
