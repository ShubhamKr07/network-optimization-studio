import { describe, it, expect } from "vitest";
import { medianOf, rateOf, countBy, numeric, isoWeek } from "../harness/lib/stats.js";

describe("stats helpers", () => {
  it("numeric drops unknown/blank/non-numeric", () => {
    expect(numeric(["3", "unknown", "", "5", "x"])).toEqual([3, 5]);
  });

  it("medianOf ignores unknown and returns unknown for an all-unknown column", () => {
    expect(medianOf(["10", "20", "30"])).toBe("20");
    expect(medianOf(["10", "unknown", "20"])).toBe("15");
    expect(medianOf(["unknown", "unknown"])).toBe("unknown");
    expect(medianOf([])).toBe("unknown");
  });

  it("rateOf counts yes over known yes/no, unknown when none known", () => {
    const rows = [{ g: "yes" }, { g: "no" }, { g: "yes" }, { g: "unknown" }];
    expect(rateOf(rows, "g", "yes")).toBe("67% (2/3)");
    expect(rateOf([{ g: "unknown" }], "g", "yes")).toBe("unknown");
  });

  it("countBy tallies distinct values", () => {
    const m = countBy([{ c: "a" }, { c: "b" }, { c: "a" }], "c");
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
  });

  it("isoWeek computes the ISO week id", () => {
    expect(isoWeek(new Date("2026-09-11T00:00:00Z"))).toBe("2026-37");
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});
