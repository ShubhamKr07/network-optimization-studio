import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperReadinessPanel } from "@/components/workspace/super/SuperReadinessPanel";
import { SUPER_SAMPLE_URL, SUPER_TEMPLATE_URL } from "@/lib/superNetwork";

describe("SuperReadinessPanel", () => {
  it("empty state: heading, import button, template and sample downloads", () => {
    const onImport = vi.fn();
    render(<SuperReadinessPanel isEmpty onImport={onImport} />);
    expect(screen.getByText("Import a network to get started")).toBeInTheDocument();
    expect(screen.getByTestId("super-download-template")).toHaveAttribute("href", SUPER_TEMPLATE_URL);
    expect(screen.getByTestId("super-download-sample")).toHaveAttribute("href", SUPER_SAMPLE_URL);
    expect(screen.getByTestId("super-download-sample")).toHaveAttribute("download");
    fireEvent.click(screen.getByTestId("super-open-import"));
    expect(onImport).toHaveBeenCalled();
  });

  it("lists each precheck error", () => {
    render(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={{ ok: false, errors: [{ code: "a", message: "No plants" }, { code: "b", message: "Zero demand" }] }} />);
    expect(screen.getByTestId("super-readiness-error-0")).toHaveTextContent("No plants");
    expect(screen.getByTestId("super-readiness-error-1")).toHaveTextContent("Zero demand");
    expect(screen.queryByTestId("super-readiness-ok")).not.toBeInTheDocument();
  });

  it("ready state", () => {
    render(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={{ ok: true, errors: [] }} />);
    expect(screen.getByTestId("super-readiness-ok")).toHaveTextContent("Ready to solve");
  });
});
