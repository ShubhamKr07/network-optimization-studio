import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

describe("Alert", () => {
  it("renders with role=alert", () => {
    render(<Alert>Something happened</Alert>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders children content", () => {
    render(<Alert>Data integrity error</Alert>);
    expect(screen.getByText("Data integrity error")).toBeInTheDocument();
  });

  it("default variant has no destructive class", () => {
    render(<Alert>Info</Alert>);
    expect(screen.getByRole("alert").className).not.toMatch(/destructive/);
  });

  it("destructive variant includes border-destructive class", () => {
    render(<Alert variant="destructive">Error!</Alert>);
    expect(screen.getByRole("alert").className).toMatch(/border-destructive/);
  });

  it("accepts additional className", () => {
    render(<Alert className="my-custom">Alert</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("my-custom");
  });
});

describe("AlertTitle", () => {
  it("renders as h5 with given text", () => {
    render(<AlertTitle>Errors — must fix</AlertTitle>);
    const heading = screen.getByText("Errors — must fix");
    expect(heading.tagName).toBe("H5");
  });
});

describe("AlertDescription", () => {
  it("renders description content", () => {
    render(<AlertDescription>Forced Open exceeds P</AlertDescription>);
    expect(screen.getByText("Forced Open exceeds P")).toBeInTheDocument();
  });
});

describe("Alert composition", () => {
  it("renders full alert with title and description", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Validation Error</AlertTitle>
        <AlertDescription>Forced Open (4) exceeds P (3)</AlertDescription>
      </Alert>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Validation Error")).toBeInTheDocument();
    expect(screen.getByText("Forced Open (4) exceeds P (3)")).toBeInTheDocument();
  });
});
