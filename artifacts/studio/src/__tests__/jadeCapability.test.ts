import { describe, it, expect } from "vitest";
import {
  isCellEnabled,
  cellCapacity,
  JADE_ENABLED_CAPACITY,
  type CapabilityOverride,
} from "@/lib/jadeCapability";
import type { PlantProductCapability } from "@workspace/api-client-react";

const baseCapabilities: PlantProductCapability[] = [
  { plantId: "p1", productId: "prod-a", capacity: 5_000_000 },
  // p1/prod-b is an off-diagonal cell: no base entry at all (implicitly 0).
  { plantId: "p2", productId: "prod-a", capacity: 0 },
];

describe("JADE_ENABLED_CAPACITY", () => {
  it("is the merge_inputs.py Big-M constant", () => {
    expect(JADE_ENABLED_CAPACITY).toBe(210_000_000);
  });
});

describe("isCellEnabled", () => {
  it("defaults to enabled when the base cell has capacity > 0", () => {
    expect(isCellEnabled(baseCapabilities, [], "p1", "prod-a")).toBe(true);
  });

  it("defaults to disabled when the base cell is explicitly capacity 0", () => {
    expect(isCellEnabled(baseCapabilities, [], "p2", "prod-a")).toBe(false);
  });

  it("defaults to disabled when there is no base entry at all (e.g. an added plant)", () => {
    expect(isCellEnabled(baseCapabilities, [], "added-plant", "prod-a")).toBe(false);
  });

  it("an override wins over the base default (enabling an off-diagonal cell)", () => {
    const overrides: CapabilityOverride[] = [{ plantId: "p1", productId: "prod-b", enabled: true }];
    expect(isCellEnabled(baseCapabilities, overrides, "p1", "prod-b")).toBe(true);
  });

  it("an override wins over the base default (disabling a base-enabled cell)", () => {
    const overrides: CapabilityOverride[] = [{ plantId: "p1", productId: "prod-a", enabled: false }];
    expect(isCellEnabled(baseCapabilities, overrides, "p1", "prod-a")).toBe(false);
  });

  it("removing an override falls back to the base default", () => {
    const withOverride: CapabilityOverride[] = [{ plantId: "p1", productId: "prod-a", enabled: false }];
    expect(isCellEnabled(baseCapabilities, withOverride, "p1", "prod-a")).toBe(false);
    // Override removed -> falls back to base (capacity > 0 -> enabled).
    expect(isCellEnabled(baseCapabilities, [], "p1", "prod-a")).toBe(true);
  });
});

describe("cellCapacity", () => {
  it("a disabled cell is always 0, regardless of base capacity", () => {
    expect(cellCapacity(baseCapabilities, "p1", "prod-a", false)).toBe(0);
  });

  it("an enabled cell with real base capacity uses the base capacity", () => {
    expect(cellCapacity(baseCapabilities, "p1", "prod-a", true)).toBe(5_000_000);
  });

  it("enabling a base off-diagonal cell (base capacity 0) uses JADE_ENABLED_CAPACITY", () => {
    // p1/prod-b has no base entry (implicit 0) — an enabled override on it
    // must resolve to the Big-M constant, matching merge_inputs.py:869.
    expect(cellCapacity(baseCapabilities, "p1", "prod-b", true)).toBe(210_000_000);
  });

  it("enabling an explicitly-zero base cell also uses JADE_ENABLED_CAPACITY", () => {
    expect(cellCapacity(baseCapabilities, "p2", "prod-a", true)).toBe(210_000_000);
  });

  it("an added-plant cell (no base entry) enabled uses JADE_ENABLED_CAPACITY", () => {
    expect(cellCapacity(baseCapabilities, "added-plant", "prod-a", true)).toBe(210_000_000);
  });

  it("an added-plant cell disabled is 0", () => {
    expect(cellCapacity(baseCapabilities, "added-plant", "prod-a", false)).toBe(0);
  });
});

describe("isCellEnabled + cellCapacity composed (the real call pattern)", () => {
  it("enabling a base off-diagonal cell end-to-end yields 210,000,000", () => {
    const overrides: CapabilityOverride[] = [{ plantId: "p1", productId: "prod-b", enabled: true }];
    const enabled = isCellEnabled(baseCapabilities, overrides, "p1", "prod-b");
    expect(cellCapacity(baseCapabilities, "p1", "prod-b", enabled)).toBe(210_000_000);
  });

  it("an added-plant cell enabled via override end-to-end yields 210,000,000", () => {
    const overrides: CapabilityOverride[] = [{ plantId: "added-plant", productId: "prod-a", enabled: true }];
    const enabled = isCellEnabled(baseCapabilities, overrides, "added-plant", "prod-a");
    expect(cellCapacity(baseCapabilities, "added-plant", "prod-a", enabled)).toBe(210_000_000);
  });

  it("a disabled cell end-to-end yields 0", () => {
    const overrides: CapabilityOverride[] = [{ plantId: "p1", productId: "prod-a", enabled: false }];
    const enabled = isCellEnabled(baseCapabilities, overrides, "p1", "prod-a");
    expect(cellCapacity(baseCapabilities, "p1", "prod-a", enabled)).toBe(0);
  });
});
