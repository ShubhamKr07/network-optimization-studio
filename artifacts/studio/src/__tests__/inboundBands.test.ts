import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { hasInboundBands, bandLaneLabels } from "@/lib/inboundBands";

const SOLVERS = resolve(__dirname, "../../../../solvers");
const manifests = readdirSync(SOLVERS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => ({ id: d.name, m: JSON.parse(readFileSync(resolve(SOLVERS, d.name, "manifest.json"), "utf8")) }));

describe("hasInboundBands (DU-4.1)", () => {
  it("is true for exactly the two two-echelon manifests, read from the real JSON", () => {
    const withIt = manifests.filter(({ m }) => hasInboundBands(m.inputsSchema)).map(x => x.id).sort();
    expect(withIt).toEqual(["two-echelon-gold-au", "two-echelon-jade-us"]);
    expect(manifests.length).toBeGreaterThanOrEqual(8);
  });
  it("never lists the key in required[] (a data-compat decision, plan constraint)", () => {
    for (const { m } of manifests) expect(m.inputsSchema?.required ?? []).not.toContain("inboundDistanceBands");
  });
  it("tolerates a missing schema", () => {
    expect(hasInboundBands(undefined)).toBe(false);
  });
});

describe("bandLaneLabels (Q2)", () => {
  it("JADE and gold get their own role words", () => {
    expect(bandLaneLabels("two-echelon-jade-us")).toEqual({
      outbound: "Customer-facing lanes (warehouse → customer)", inbound: "Inbound lanes (plant → warehouse)",
    });
    expect(bandLaneLabels("two-echelon-gold-au")).toEqual({
      outbound: "Customer-facing lanes (refinery → customer)", inbound: "Inbound lanes (mine → refinery)",
    });
  });
});
