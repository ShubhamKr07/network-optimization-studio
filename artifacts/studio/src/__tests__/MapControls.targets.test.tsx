import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LayerCheckbox } from "@/components/workspace/map/mapControls";

// DU-2.6 (PR2-11) — class assertions only: jsdom has no layout, so DU-2.9 measures
// the real 24px hit area in a browser.
describe("LayerCheckbox hit area", () => {
  it("row is min-h-6 and the box wrapper is 24x24", () => {
    render(<LayerCheckbox checked onToggle={() => {}} testId="lc">Warehouses</LayerCheckbox>);
    const row = screen.getByTestId("lc");
    expect(row).toHaveAttribute("role", "checkbox");
    expect(row).toHaveClass("min-h-6");
    expect(row.querySelector("span.h-6.w-6")).not.toBeNull();
  });
});
