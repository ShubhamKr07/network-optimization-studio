import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OVERFLOW_BAND } from "@workspace/units";
import { BandLabel } from "@/components/BandLabel";

describe("BandLabel (DU-2.2)", () => {
  it("renders range text, colour swatch and dash pattern for a real band", () => {
    const { container } = render(<BandLabel index={1} bands={[200, 400]} unit="mi" />);
    expect(screen.getByText("200–400 mi")).toBeInTheDocument();
    expect(container.querySelector("[data-band-swatch]")).toHaveStyle({ backgroundColor: "var(--band-1)" });
    expect(container.querySelector("svg line")?.getAttribute("stroke-dasharray")).toBe("10 4");
  });
  it("overflow: '> last' text, overflow colour, solid line", () => {
    const { container } = render(<BandLabel index={OVERFLOW_BAND} bands={[200, 400]} unit="mi" />);
    expect(screen.getByText("> 400 mi")).toBeInTheDocument();
    expect(container.querySelector("[data-band-swatch]")).toHaveStyle({ backgroundColor: "var(--band-overflow)" });
    expect(container.querySelector("svg line")?.hasAttribute("stroke-dasharray")).toBe(false);
  });
});
