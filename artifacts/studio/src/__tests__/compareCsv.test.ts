// SCU-1.3 (spec B1.3) — the compare-mode CSV writer: `metric` column, then
// one column per compared scenario in on-screen order (header = name); raw
// values; a missing value is an EMPTY cell (the on-screen "—" is
// display-only); rows in the order given (the table's own row model).
import { describe, it, expect } from "vitest";
import { buildCompareCsv, buildCompareJson } from "@/lib/compareCsv";

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

// SCU-2.P3.8 (spec B2.4) — the compare JSON: same row model as the CSV.

describe("buildCompareJson", () => {
  const rows = [
    { csvLabel: "Objective", cells: [{ raw: 1 }, { raw: 2 }] },
    { csvLabel: "Inbound cost", cells: [{ raw: null }, { raw: 5 }] },
  ];
  const scenarios = [{ id: 7, name: "A" }, { id: 9, name: "A" }];

  it("one row per metric, one value per scenario keyed by id (names may repeat), null kept", () => {
    expect(buildCompareJson(rows, scenarios, "mi")).toEqual({
      entity: "costSummaryCompare",
      unit: "mi",
      rows: [
        { metric: "Objective", values: [{ scenarioId: 7, scenario: "A", value: 1 }, { scenarioId: 9, scenario: "A", value: 2 }] },
        { metric: "Inbound cost", values: [{ scenarioId: 7, scenario: "A", value: null }, { scenarioId: 9, scenario: "A", value: 5 }] },
      ],
    });
  });

  it("omits unit while the display unit is unresolved", () => {
    expect("unit" in buildCompareJson(rows, scenarios, null)).toBe(false);
  });
});

describe("buildCompareJson — rows the CSV omits", () => {
  it("drops a csvLabel: null row exactly as buildCompareCsv does", () => {
    const doc = buildCompareJson([{ csvLabel: null, cells: [{ raw: 1 }] }, { csvLabel: "Objective", cells: [{ raw: 2 }] }], [{ id: 1, name: "A" }], "mi");
    expect(doc.rows.map(r => r.metric)).toEqual(["Objective"]);
  });
});
