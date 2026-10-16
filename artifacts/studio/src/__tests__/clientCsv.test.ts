import { describe, it, expect } from "vitest";
import { csvCell } from "@/lib/clientCsv";

describe("csvCell", () => {
  it("quotes cells containing a carriage return", () => {
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });
  it("neutralises spreadsheet formulas in string cells", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+1+1")).toBe("'+1+1");
  });
  it("keeps numbers raw, including negatives and numeric strings", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("+3")).toBe("+3");
    expect(csvCell("Baseline")).toBe("Baseline");
  });
});
