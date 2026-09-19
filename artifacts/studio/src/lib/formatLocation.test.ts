import { describe, it, expect } from "vitest";
import { formatCityState, plantIdCityState } from "./formatLocation";

describe("plantIdCityState", () => {
  it("returns '<id> — City, State' for a plant with a non-empty state", () => {
    expect(
      plantIdCityState({ id: "pl-1", city: "Daggar Hills", state: "QLD" }),
    ).toBe("pl-1 — Daggar Hills, QLD");
  });

  it("ignores `name` even when present on the plant literal (compiles because `name?` is in the type)", () => {
    expect(
      plantIdCityState({
        id: "pl-2",
        city: "Cunnamulla",
        state: "QLD",
        name: "Cunnamulla Refinery",
      }),
    ).toBe("pl-2 — Cunnamulla, QLD");
  });

  it("falls back to formatCityState's existing behavior for an empty state (city only, no trailing comma)", () => {
    const plant = { id: "pl-3", city: "Shenzhen", state: "" };
    expect(plantIdCityState(plant)).toBe(
      `pl-3 — ${formatCityState(plant.city, plant.state)}`,
    );
    expect(plantIdCityState(plant)).toBe("pl-3 — Shenzhen");
  });
});
