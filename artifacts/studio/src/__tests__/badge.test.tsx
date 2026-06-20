import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Optimal</Badge>);
    expect(screen.getByText("Optimal")).toBeInTheDocument();
  });

  it("default variant applies primary background", () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toHaveClass("bg-primary");
  });

  it("destructive variant applies destructive background", () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>);
    expect(container.firstChild).toHaveClass("bg-destructive");
  });

  it("secondary variant applies secondary background", () => {
    const { container } = render(<Badge variant="secondary">Solving</Badge>);
    expect(container.firstChild).toHaveClass("bg-secondary");
  });

  it("outline variant applies text-foreground class", () => {
    const { container } = render(<Badge variant="outline">Stale</Badge>);
    expect(container.firstChild).toHaveClass("text-foreground");
  });

  it("accepts additional className", () => {
    const { container } = render(<Badge className="custom-class">Tag</Badge>);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("never wraps text (whitespace-nowrap)", () => {
    const { container } = render(<Badge>Long solver status text</Badge>);
    expect(container.firstChild).toHaveClass("whitespace-nowrap");
  });
});
