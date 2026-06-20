import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Solve</Button>);
    expect(screen.getByRole("button", { name: "Solve" })).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies variant classes — destructive variant includes bg-destructive", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button").className).toMatch(/bg-destructive/);
  });

  it("applies size sm class", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button").className).toMatch(/px-3/);
  });

  it("renders as a custom element when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/solve">Solve link</a>
      </Button>
    );
    expect(screen.getByRole("link", { name: "Solve link" })).toBeInTheDocument();
  });
});
