import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperEntityDialog } from "@/components/workspace/super/SuperEntityDialog";

const products = [{ id: "K1", name: "Bolts" }, { id: "K2", name: "Nuts" }];
const base = { mode: "create" as const, kind: "cs" as const, initial: { id: "C-2", name: "", lat: 1, lng: 2, status: "active" },
  initialDemand: {}, products, takenIds: new Set(["C-1", "WH-1"]), onCancel: vi.fn() };

describe("SuperEntityDialog", () => {
  it("create: pre-filled id, one demand input per product, blank demand omitted", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    expect(screen.getByTestId("super-entity-id")).toHaveValue("C-2");
    fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K2"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ id: "C-2", name: "Acme", lat: 1, lng: 2, status: "active" }, { K2: 12 });
  });
  it("rejects a taken id, a blank name and a negative demand", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("already used");
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "C-5" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("Name is required");
    fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K1"), { target: { value: "-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("Bolts");
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("edit: id is read-only; a plant shows no status and no demand", () => {
    render(<SuperEntityDialog {...base} mode="edit" kind="pl" initial={{ id: "PL-1", name: "P", lat: 1, lng: 2 }} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("super-entity-id")).toHaveAttribute("readonly");
    expect(screen.queryByTestId("super-entity-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("super-entity-demand-K1")).not.toBeInTheDocument();
  });
});
