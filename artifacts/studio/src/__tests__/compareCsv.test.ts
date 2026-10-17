// SCU-1.3 (spec B1.3) — the compare-mode CSV writer: `metric` column, then
// one column per compared scenario in on-screen order (header = name); raw
// values; a missing value is an EMPTY cell (the on-screen "—" is
// display-only); rows in the order given (the table's own row model).
import { describe, it, expect } from "vitest";
import { buildCompareCsv } from "@/lib/compareCsv";

describe("buildCompareCsv", () => {
  it("writes a metric column then one column per scenario, in the given order", () => {
    expect(buildCompareCsv(
      [{ csvLabel: "Objective", cells: [{ raw: 100 }, { raw: 120 }] }],
      [{ name: "Baseline" }, { name: "Alt P" }],
    )).toBe("metric,Baseline,Alt P\nObjective,100,120");
  });

  it("renders a missing value (null) as an empty cell, never '—'", () => {
    expect(buildCompareCsv([{ csvLabel: "Inbound cost", cells: [{ raw: null }, { raw: 5 }] }], [{ name: "A" }, { name: "B" }]))
      .toBe("metric,A,B\nInbound cost,,5");
  });

  it("keeps raw numbers unformatted (no thousands separators, full precision)", () => {
    expect(buildCompareCsv([{ csvLabel: "Inbound cost", cells: [{ raw: 1234567.891 }] }], [{ name: "A" }]))
      .toBe("metric,A\nInbound cost,1234567.891");
  });

  it("quotes names and values containing commas or quotes", () => {
    expect(buildCompareCsv([{ csvLabel: "Open facilities", cells: [{ raw: "Chicago, IL" }] }], [{ name: 'Best "3", DCs' }]))
      .toBe('metric,"Best ""3"", DCs"\nOpen facilities,"Chicago, IL"');
  });

  it("mixed optional rows keep row order and column alignment", () => {
    const rows = [
      { csvLabel: "Objective", cells: [{ raw: 1 }, { raw: 2 }, { raw: 3 }] },
      { csvLabel: "Max coverable demand (Model 1)", cells: [{ raw: null }, { raw: 900 }, { raw: null }] },
      { csvLabel: "Quality", cells: [{ raw: "Proven optimal" }, { raw: "No incumbent" }, { raw: "Proven optimal" }] },
    ];
    expect(buildCompareCsv(rows, [{ name: "A" }, { name: "B" }, { name: "C" }])).toBe(
      "metric,A,B,C\nObjective,1,2,3\nMax coverable demand (Model 1),,900,\nQuality,Proven optimal,No incumbent,Proven optimal",
    );
  });
});
