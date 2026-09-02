import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppFooter, FOOTER_H } from "@/components/AppFooter";

describe("AppFooter", () => {
  it("renders the copyright symbol followed by 'Developed by hx1'", () => {
    render(<AppFooter />);
    const footer = screen.getByTestId("app-footer");
    expect(footer.textContent).toContain("©");
    expect(footer.textContent).toContain("Developed by hx1");
    // Copyright symbol precedes the attribution text.
    expect(footer.textContent?.indexOf("©")).toBeLessThan(
      footer.textContent?.indexOf("Developed by hx1") ?? -1
    );
  });

  it("is centered", () => {
    render(<AppFooter />);
    const footer = screen.getByTestId("app-footer");
    expect(footer.className).toContain("justify-center");
    expect(footer.className).toContain("items-center");
  });

  it("has a height of FOOTER_H (24px)", () => {
    expect(FOOTER_H).toBe(24);
    render(<AppFooter />);
    const footer = screen.getByTestId("app-footer");
    expect(footer.style.height).toBe(`${FOOTER_H}px`);
  });
});
