import { describe, it, expect } from "vitest";
import {
  getLegColor,
  isInboundLeg,
  isOutboundLeg,
  INBOUND_LEG_COLOR,
  OUTBOUND_LEG_COLOR,
  NEUTRAL_LEG_COLOR,
} from "@/lib/legPalette";

describe("getLegColor", () => {
  it("colors the two Chapter-10 legs (mine_to_refinery inbound, refinery_to_customer outbound)", () => {
    expect(getLegColor("mine_to_refinery")).toBe(INBOUND_LEG_COLOR);
    expect(getLegColor("refinery_to_customer")).toBe(OUTBOUND_LEG_COLOR);
  });

  it("colors the two JADE legs (plant_to_warehouse inbound, warehouse_to_customer outbound)", () => {
    expect(getLegColor("plant_to_warehouse")).toBe(INBOUND_LEG_COLOR);
    expect(getLegColor("warehouse_to_customer")).toBe(OUTBOUND_LEG_COLOR);
  });

  it("gives JADE's two legs distinct colors from each other", () => {
    expect(getLegColor("plant_to_warehouse")).not.toBe(getLegColor("warehouse_to_customer"));
  });

  it("classifies the same-role legs from different models identically (semantic, not per-model)", () => {
    expect(getLegColor("mine_to_refinery")).toBe(getLegColor("plant_to_warehouse"));
    expect(getLegColor("refinery_to_customer")).toBe(getLegColor("warehouse_to_customer"));
  });

  it("returns undefined for an absent leg so the caller falls back to band coloring", () => {
    expect(getLegColor(undefined)).toBeUndefined();
    expect(getLegColor(null)).toBeUndefined();
    expect(getLegColor("")).toBeUndefined();
  });

  it("returns the neutral fallback color for an unknown leg value, never throws", () => {
    expect(() => getLegColor("some_future_leg")).not.toThrow();
    expect(getLegColor("some_future_leg")).toBe(NEUTRAL_LEG_COLOR);
  });
});

describe("isInboundLeg / isOutboundLeg", () => {
  it("classifies JADE + Chapter-10 legs correctly", () => {
    expect(isInboundLeg("plant_to_warehouse")).toBe(true);
    expect(isInboundLeg("mine_to_refinery")).toBe(true);
    expect(isOutboundLeg("warehouse_to_customer")).toBe(true);
    expect(isOutboundLeg("refinery_to_customer")).toBe(true);
  });

  it("returns false for absent/unknown legs on both classifiers", () => {
    expect(isInboundLeg(undefined)).toBe(false);
    expect(isOutboundLeg(undefined)).toBe(false);
    expect(isInboundLeg("some_future_leg")).toBe(false);
    expect(isOutboundLeg("some_future_leg")).toBe(false);
  });
});
