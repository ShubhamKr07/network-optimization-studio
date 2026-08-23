import { describe, it, expect } from "vitest";
import { pickBaseline } from "@/lib/pickBaseline";

describe("pickBaseline", () => {
  it("returns null for an empty list", () => {
    expect(pickBaseline([])).toBeNull();
  });

  it("returns the scenario named 'Baseline' (case/whitespace-insensitive) when one exists", () => {
    const scenarios = [
      { id: 1, name: "Scenario A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, name: "  baseline  ", createdAt: "2026-02-01T00:00:00Z" },
      { id: 3, name: "Scenario B", createdAt: "2025-12-01T00:00:00Z" },
    ];
    expect(pickBaseline(scenarios)?.id).toBe(2);
  });

  it("falls back to the oldest scenario by createdAt when no scenario is named 'Baseline'", () => {
    const scenarios = [
      { id: 1, name: "Scenario A", createdAt: "2026-02-01T00:00:00Z" },
      { id: 2, name: "Scenario B", createdAt: "2025-12-01T00:00:00Z" },
      { id: 3, name: "Scenario C", createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(pickBaseline(scenarios)?.id).toBe(2);
  });
});
