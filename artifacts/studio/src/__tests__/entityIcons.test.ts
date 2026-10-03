import { describe, it, expect } from "vitest";
import { Circle } from "lucide-react";
import { iconForEntity, SCENARIOS_ICON, ENTITY_ICON_IDS } from "@/components/workspace/entityIcons";
import { inputEntriesForModel } from "@/pages/Workspace";
import type { StudioModelType } from "@/lib/chapters";

// Every model whose chapter has `workspace: true` (src/lib/chapters.ts).
const MODEL_IDS: StudioModelType[] = [
  "p-median-us",
  "p-median-brazil",
  "transport-coal",
  "two-echelon-gold-au",
  "two-echelon-jade-us",
  "max-coverage-us",
  "delivery-teaching-us",
];

// Mirrors OUTPUT_ENTRIES in src/pages/Workspace.tsx:1347-1354, which is
// module-private. If that list grows, this array must grow with it — the
// "no entity falls back to Circle" assertion below is what catches a new
// output entity shipping without an icon.
const OUTPUT_IDS = [
  "output-map",
  "cost-summary",
  "open-warehouses",
  "customer-assignments",
  "flows",
  "service-stats",
];

describe("entityIcons", () => {
  it("maps every input entity of every model to a real icon, never the fallback", () => {
    for (const modelId of MODEL_IDS) {
      for (const entry of inputEntriesForModel(modelId)) {
        expect(iconForEntity(entry.id), `${modelId}/${entry.id}`).not.toBe(Circle);
      }
    }
  });

  it("maps every output entity to a real icon, never the fallback", () => {
    for (const id of OUTPUT_IDS) {
      expect(iconForEntity(id), id).not.toBe(Circle);
    }
  });

  it("never gives two different entities the same icon", () => {
    const seen = new Map<unknown, string>();
    for (const id of ENTITY_ICON_IDS) {
      const icon = iconForEntity(id);
      const previous = seen.get(icon);
      expect(previous, `${id} shares an icon with ${previous}`).toBeUndefined();
      seen.set(icon, id);
    }
    // The Scenarios rail icon must not collide with an entity icon either.
    expect(seen.has(SCENARIOS_ICON)).toBe(false);
  });

  it("falls back to Circle for an unmapped id instead of throwing", () => {
    expect(iconForEntity("some-entity-that-does-not-exist-yet")).toBe(Circle);
  });
});
