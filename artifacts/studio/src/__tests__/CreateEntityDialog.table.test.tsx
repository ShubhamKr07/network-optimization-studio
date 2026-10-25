// SCU-2.P4.2 (spec B2.8, B2.9) — CreateEntityDialog opened from an input
// table ("+ Add {Entity}"). The map flow is covered, unchanged, by
// CreateEntityDialog.test.tsx; this file covers the table mode: editable
// lat/lng, per-kind fields, the inline forms' validation messages verbatim,
// empty demand blocking submit, and the discriminated submit for six kinds.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CreateEntityDialog,
  type CreateEntityKind,
  type CreateEntitySubmit,
} from "@/components/workspace/map/dialogs/CreateEntityDialog";

function open(
  entityKind: CreateEntityKind,
  extra: Partial<{
    capacityMode: "none" | "uniform" | "per_wh";
    hasStateColumn: boolean;
    products: { id: string; name: string }[];
    existingCodes: string[];
  }> = {},
) {
  const onCreate = vi.fn<(r: CreateEntitySubmit) => void>();
  const onCancel = vi.fn();
  render(
    <CreateEntityDialog
      source="table"
      entityKind={entityKind}
      existingCodes={extra.existingCodes ?? []}
      capacityMode={extra.capacityMode}
      hasStateColumn={extra.hasStateColumn}
      products={extra.products}
      onCreate={onCreate}
      onCancel={onCancel}
    />,
  );
  return { onCreate, onCancel };
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const submit = () => fireEvent.click(screen.getByTestId("create-entity-submit"));
const errorText = () => screen.getByTestId("create-entity-error").textContent;

function fillLocation(city = "Akron", state = "OH", lat = "41.08", lng = "-81.52") {
  type("create-entity-city", city);
  type("create-entity-state", state);
  type("create-entity-lat", lat);
  type("create-entity-lng", lng);
}

describe("CreateEntityDialog — table mode (SCU-2.P4.2)", () => {
  it("lat/lng are editable inputs, empty on open, filled from the gazetteer on City/State blur", () => {
    open("customer");
    const latInput = screen.getByTestId("create-entity-lat");
    expect(latInput.tagName).toBe("INPUT");
    expect(latInput).toHaveValue("");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("41.080456");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it("a lat/lng the student focused and typed is never overwritten by a later City/State blur", () => {
    open("customer");
    fireEvent.focus(screen.getByTestId("create-entity-lat"));
    type("create-entity-lat", "1");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-city"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it("the first focus clears a gazetteer-filled lat (the inline forms' 'touched' rule)", () => {
    open("customer");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("41.080456");
    fireEvent.focus(screen.getByTestId("create-entity-lat"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it.each<[CreateEntityKind, { capacity: boolean; status: boolean; demand: boolean }]>([
    ["warehouse", { capacity: false, status: true, demand: false }],
    ["refinery", { capacity: false, status: true, demand: false }],
    ["plant", { capacity: false, status: false, demand: false }],
    ["mine", { capacity: true, status: false, demand: false }],
    ["station", { capacity: false, status: false, demand: true }],
    ["customer", { capacity: false, status: false, demand: true }],
  ])("%s shows exactly its own fields", (kind, f) => {
    open(kind);
    expect(screen.queryByTestId("create-entity-capacity") !== null).toBe(f.capacity);
    expect(screen.queryByTestId("create-entity-status") !== null).toBe(f.status);
    expect(screen.queryByTestId("create-entity-demand") !== null).toBe(f.demand);
  });

  it("warehouse capacity appears only for capacityMode per_wh", () => {
    open("warehouse", { capacityMode: "per_wh" });
    expect(screen.getByTestId("create-entity-capacity")).toBeInTheDocument();
  });

  it("uses the inline forms' validation messages, in the inline forms' order", () => {
    open("warehouse", { capacityMode: "per_wh", existingCodes: ["WH-OH-AKRON-01"] });
    submit();
    expect(errorText()).toBe("City and state are both required.");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    type("create-entity-display-code", "WH-OH-AKRON-01");
    submit();
    expect(errorText()).toBe("Display code 'WH-OH-AKRON-01' is already in use by another warehouse in this scenario.");
    type("create-entity-display-code", "WH-OH-AKRON-07");
    submit();
    expect(errorText()).toBe("Latitude and longitude must both be numbers.");
    type("create-entity-lat", "41.08");
    type("create-entity-lng", "-81.52");
    type("create-entity-capacity", "0");
    submit();
    expect(errorText()).toBe("Capacity must be a positive number, or left blank.");
  });

  it("no State field and 'City is required.' when the dataset has no state column", () => {
    open("customer", { hasStateColumn: false });
    expect(screen.queryByTestId("create-entity-state")).toBeNull();
    submit();
    expect(errorText()).toBe("City is required.");
  });

  it("mine capacity uses the mines form's message", () => {
    open("mine");
    fillLocation("Pikeville", "KY", "37.54", "-82.75");
    type("create-entity-capacity", "-3");
    submit();
    expect(errorText()).toBe("Capacity must be a positive number, or left blank for unconstrained.");
  });

  it("an EMPTY scalar demand blocks submit (B2.9), and demand is grouped, labelled with its unit, and has no suffix", () => {
    const { onCreate } = open("customer");
    fillLocation();
    submit();
    expect(errorText()).toBe("Demand must be a number ≥ 0.");
    expect(onCreate).not.toHaveBeenCalled();
    const demand = screen.getByTestId("create-entity-demand");
    type("create-entity-demand", "12345.5");
    expect(demand).toHaveValue("12,345.5");
    expect(demand).not.toHaveAttribute("aria-label");
    expect(demand).not.toHaveAttribute("aria-describedby");
    expect(screen.getByLabelText("Demand (units)")).toBe(demand);
    expect(screen.queryByText("Units")).toBeNull();
  });

  it("JADE: an empty per-product demand blocks submit with that product's message (no silent 0)", () => {
    const products = [
      { id: "product-1", name: "Hats" },
      { id: "product-2", name: "Shoes" },
    ];
    const { onCreate } = open("customer", { products });
    expect(screen.queryByTestId("create-entity-demand")).toBeNull();
    fillLocation();
    type("create-entity-demand-product-1", "10");
    submit();
    expect(errorText()).toBe("Demand for Shoes must be a number ≥ 0.");
    expect(onCreate).not.toHaveBeenCalled();
    type("create-entity-demand-product-2", "0");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const r = onCreate.mock.calls[0]![0];
    expect(r.kind).toBe("customer");
    expect(r.entity).toMatchObject({ demand: 10, demands: { "product-1": 10, "product-2": 0 } });
  });

  it("station demand is integer-only ('.' rejected)", () => {
    open("station");
    type("create-entity-demand", "12.5");
    expect(screen.getByTestId("create-entity-demand")).toHaveValue("");
    type("create-entity-demand", "8000000");
    expect(screen.getByTestId("create-entity-demand")).toHaveValue("8,000,000");
    // DU-2.3: the unit is in the label, not a suffix (coal stations pass "tons")
    expect(screen.getByTestId("create-entity-demand")).not.toHaveAttribute("aria-describedby");
  });

  it.each<[CreateEntityKind, RegExp, Record<string, unknown>]>([
    ["warehouse", /^aw-/, { status: "forced_open" }],
    ["refinery", /^aw-/, { status: "forced_open" }],
    ["plant", /^ap-/, {}],
    ["mine", /^am-/, { capacity: 25000000 }],
    ["station", /^as-/, { demand: 8000000 }],
    ["customer", /^ac-/, { demand: 205375 }],
  ])("submits a discriminated %s result with a minted id and the derived display code", (kind, idPattern, extra) => {
    const { onCreate } = open(kind);
    fillLocation();
    if (kind === "warehouse" || kind === "refinery") fireEvent.click(screen.getByTestId("create-entity-status-forced_open"));
    if (kind === "mine") type("create-entity-capacity", "25000000");
    if (kind === "station") type("create-entity-demand", "8000000");
    if (kind === "customer") type("create-entity-demand", "205375");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const r = onCreate.mock.calls[0]![0];
    expect(r.kind).toBe(kind);
    expect(r.entity.id).toMatch(idPattern);
    expect(r.entity).toMatchObject({ city: "Akron", state: "OH", lat: 41.08, lng: -81.52, ...extra });
    expect(r.entity.displayCode).toMatch(/^(WH|PL|MN|ST|CS)-OH-AKRON-01$/);
    if (kind === "plant") expect(Object.keys(r.entity).sort()).toEqual(["city", "displayCode", "id", "lat", "lng", "state"]);
    if (kind === "refinery") expect(r.entity).not.toHaveProperty("capacity");
  });

  it("readOnly (D2 history) disables every field and submit with the read-only title; Cancel stays enabled", () => {
    const onCreate = vi.fn<(r: CreateEntitySubmit) => void>();
    const onCancel = vi.fn();
    render(
      <CreateEntityDialog
        source="table"
        entityKind="warehouse"
        existingCodes={[]}
        capacityMode="per_wh"
        readOnly
        onCreate={onCreate}
        onCancel={onCancel}
      />,
    );
    const fields = [
      "create-entity-city",
      "create-entity-state",
      "create-entity-lat",
      "create-entity-lng",
      "create-entity-display-code",
      "create-entity-capacity",
      "create-entity-status-forced_open",
      "create-entity-submit",
    ];
    for (const id of fields) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
    fireEvent.click(screen.getByTestId("create-entity-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Cancel calls onCancel and never onCreate", () => {
    const { onCreate, onCancel } = open("plant");
    fireEvent.click(screen.getByTestId("create-entity-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
