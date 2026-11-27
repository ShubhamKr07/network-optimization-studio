import { describe, it, expect, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render } from "@testing-library/react";

// jsdom has no layout, so ResponsiveContainer would render nothing; give the chart a fixed size.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 500, height: 200 } as object),
}));

import { BarListCard } from "@/components/admin/BarListCard";

const fmt = (v: number) => String(v);

describe("BarListCard axes", () => {
  it("renders every category label (with the full name as a title) in the horizontal layout", () => {
    const { container } = render(
      <BarListCard id="t" title="T" valueHead="Students" horizontal fmt={fmt}
        items={[["Delivery Company Teaching Example", 1], ["AL Athletics", 8]]} />,
    );
    const ticks = [...container.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick text")];
    expect(ticks).toHaveLength(2);
    expect(ticks.map((t) => t.querySelector("title")?.textContent)).toEqual(["Delivery Company Teaching Example", "AL Athletics"]);
    expect(ticks[0].lastChild?.textContent).toContain("…");
    expect(ticks[1].lastChild?.textContent).toBe("AL Athletics");
  });

  it("renders the x-axis labels in the vertical layout", () => {
    const { container } = render(
      <BarListCard id="t" title="T" valueHead="Sessions" fmt={fmt} items={[["9 Nov", 3], ["16 Nov", 5]]} />,
    );
    const ticks = [...container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick text")].map((t) => t.textContent);
    expect(ticks).toEqual(["9 Nov", "16 Nov"]);
  });
});
