import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { SuperTableTab } from "@/components/workspace/super/SuperTableTab";
import { SuperDistancesTab } from "@/components/workspace/super/SuperDistancesTab";

const options = { productIds: ["k1", "k2"], plantIds: ["p1"], customerIds: ["c1"] };
const rows = [
  { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
  { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
];

describe("SuperTableTab", () => {
  it("editing a capacity cell calls onChange with the new number", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.change(screen.getByTestId('super-plantProducts-["p1","k1"]-capacity'), { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledWith([{ ...rows[0], capacity: 9 }, rows[1]]);
  });
  it("composite keys are collision-free when an id contains '|'", () => {
    const onChange = vi.fn();
    const clash = [
      { plantId: "a|b", productId: "c", capacity: 1, costPerUnit: 0 },
      { plantId: "a", productId: "b|c", capacity: 2, costPerUnit: 0 },
    ];
    render(<SuperTableTab table="plantProducts" rows={clash} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId('super-plantProducts-["a|b","c"]-delete'));
    expect(onChange).toHaveBeenCalledWith([clash[1]]);
    expect(screen.getByTestId('super-plantProducts-["a","b|c"]-delete')).toBeInTheDocument();
  });
  it("+ Add row appends one row", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId("super-plantProducts-add"));
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
    expect(onChange.mock.calls[0][0][2]).toEqual({ plantId: "p1", productId: "k1", capacity: 0, costPerUnit: 0 });
  });
  it("delete on a composite table drops exactly that row", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId('super-plantProducts-["p1","k1"]-delete'));
    expect(onChange).toHaveBeenCalledWith([rows[1]]);
  });
  it("entity delete is delegated to onDelete, and readOnly disables everything", () => {
    const onDelete = vi.fn();
    const { rerender } = render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} onDelete={onDelete} readOnly={false} />);
    fireEvent.click(screen.getByTestId("super-products-k1-delete"));
    expect(onDelete).toHaveBeenCalledWith({ id: "k1", name: "K" });
    rerender(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly />);
    expect(screen.getByTestId("super-products-add")).toBeDisabled();
    expect(screen.getByTestId("super-products-k1-delete")).toBeDisabled();
  });
    it("QFX-4 regression: sorted descending, an edit and a delete each hit the intended underlying row", () => {
      const three = [
        { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
        { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
        { plantId: "p1", productId: "k3", capacity: 6, costPerUnit: 3 },
      ];
      const spy = vi.fn();
      function Harness() {
        const [rs, setRs] = useState<Record<string, unknown>[]>(three);
        return <SuperTableTab table="plantProducts" rows={rs} onChange={next => { spy(next); setRs(next); }} readOnly={false}
          options={{ productIds: ["k1", "k2", "k3"], plantIds: ["p1"] }} />;
      }
      render(<Harness />);
      const order = () => screen.getAllByTestId(/^super-row-plantProducts-/).map(tr => tr.getAttribute("data-testid"));
      const cap = screen.getByRole("columnheader", { name: "Capacity" });
      fireEvent.click(within(cap).getByRole("button"));
      fireEvent.click(within(cap).getByRole("button"));
      expect(cap).toHaveAttribute("aria-sort", "descending");
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k3"]', 'super-row-plantProducts-["p1","k1"]',
      ]);

      // Edit the row DISPLAYED second (k3 = original index 2), not original index 1.
      fireEvent.change(screen.getByTestId('super-plantProducts-["p1","k3"]-capacity'), { target: { value: "1" } });
      expect(spy).toHaveBeenLastCalledWith([three[0], three[1], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]',
      ]);

      // Delete the row DISPLAYED first (k2 = original index 1), not original index 0.
      fireEvent.click(screen.getByTestId('super-plantProducts-["p1","k2"]-delete'));
      expect(spy).toHaveBeenLastCalledWith([three[0], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual(['super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]']);
    });

    it("the delete column header is not sortable", () => {
      render(<SuperTableTab table="plantProducts" rows={rows} onChange={vi.fn()} readOnly={false} options={options} />);
      const heads = screen.getAllByRole("columnheader");
      expect(within(heads[heads.length - 1]).queryByRole("button")).toBeNull();
      expect(heads[heads.length - 1]).not.toHaveAttribute("aria-sort");
    });
});

describe("SuperDistancesTab", () => {
  const props = { overrides: [], plantIds: ["p1"], warehouseIds: ["w1"], customerIds: ["c1"], readOnly: false };
  it("method change patches distanceMethod; factor disabled under haversine", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab onFetchRoad={() => {}} fetchDisabledReason={null} {...props} distanceMethod="haversine" circuityFactor={1.17} onChange={onChange} />);
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
    fireEvent.change(screen.getByTestId("super-distance-method"), { target: { value: "circuity" } });
    expect(onChange).toHaveBeenCalledWith({ distanceMethod: "circuity" });
  });
  it("factor is enabled under circuity and out-of-range values are not committed", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab onFetchRoad={() => {}} fetchDisabledReason={null} {...props} distanceMethod="circuity" circuityFactor={1.17} onChange={onChange} />);
    const f = screen.getByTestId("super-circuity-factor");
    expect(f).toBeEnabled();
    fireEvent.change(f, { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(f, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 1.5 });
  });
  it("QFX-7: location tables have no Name column and + Add row appends a name-less row; products keep Name", () => {
    const onChange = vi.fn();
    const { unmount } = render(<SuperTableTab table="plants" rows={[{ id: "PL-1", city: "Ashland", state: "KY", lat: 1, lng: 2 }]} onChange={onChange} readOnly={false} />);
    expect(screen.getByTestId("super-plants-PL-1-city")).toBeInTheDocument();
    expect(screen.queryByTestId("super-plants-PL-1-name")).not.toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("super-plants-add"));
    expect(onChange.mock.calls[0][0][1]).toStrictEqual({ id: "", city: "", state: "", lat: 0, lng: 0 });
    unmount();
    for (const table of ["warehouses", "customers"] as const) {
      const { unmount: u } = render(<SuperTableTab table={table} rows={[{ id: "X-1", lat: 1, lng: 2, status: "active" }]} onChange={vi.fn()} readOnly={false} />);
      expect(screen.queryByTestId(`super-${table}-X-1-name`), table).not.toBeInTheDocument();
      u();
    }
    render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByTestId("super-products-k1-name")).toHaveValue("K");
  });
});

describe("SuperTableTab per-table Upload ▾ / Download ▾ (QFX-2b)", () => {
  afterEach(() => vi.restoreAllMocks());
  const pp = [
    { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
    { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
  ];
  const upload = async (table: string, format: "csv" | "json" | "xlsx", file: File) => {
    fireEvent.click(screen.getByTestId(`super-${table}-upload`));
    fireEvent.click(screen.getByTestId(`super-${table}-upload-${format}`));
    await userEvent.upload(screen.getByTestId(`super-upload-file-${table}`), file);
  };
  const csv = (text: string) => new File([text], "x.csv", { type: "text/csv" });

  it("Merge on plantProducts: counts, then overwrite in place + append + keep; the dialog closes", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np1,k2,70,3\np2,k1,9,4\n"));
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 2 rows (1 removed)");
    expect(screen.getByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 1 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-merge"));
    expect(onChange).toHaveBeenCalledWith([
      pp[0],
      { plantId: "p1", productId: "k2", capacity: 70, costPerUnit: 3 },
      { plantId: "p2", productId: "k1", capacity: 9, costPerUnit: 4 },
    ]);
    expect(screen.queryByTestId("super-upload-dialog")).toBeNull();
  });

  it("Replace on plantProducts makes the table exactly the file's rows", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np2,k1,9,4\n"));
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 1 rows (2 removed)");
    fireEvent.click(screen.getByTestId("super-upload-replace"));
    expect(onChange).toHaveBeenCalledWith([{ plantId: "p2", productId: "k1", capacity: 9, costPerUnit: 4 }]);
  });

  it("demand merges on (customerId, productId) from a JSON file", async () => {
    const dem = [{ customerId: "c1", productId: "k1", demand: 1 }, { customerId: "c1", productId: "k2", demand: 2 }];
    const onChange = vi.fn();
    render(<SuperTableTab table="demand" rows={dem} onChange={onChange} readOnly={false} options={options} />);
    await upload("demand", "json", new File([JSON.stringify({ demand: [{ customerId: "c1", productId: "k1", demand: 10 }] })], "d.json", { type: "application/json" }));
    expect(await screen.findByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 0 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-merge"));
    expect(onChange).toHaveBeenCalledWith([{ customerId: "c1", productId: "k1", demand: 10 }, dem[1]]);
  });

  it("distanceOverrides replaces on (fromId, toId) from an XLSX file (first sheet, any name)", async () => {
    const ov = [{ fromId: "p1", toId: "w1", miles: 3 }, { fromId: "w1", toId: "c1", miles: 4 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["fromId", "toId", "miles"], ["p1", "w1", 5]]), "Anything");
    const file = new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "o.xlsx");
    const onChange = vi.fn();
    render(<SuperTableTab table="distanceOverrides" rows={ov} onChange={onChange} readOnly={false} options={{ fromIds: ["p1", "w1"], toIds: ["w1", "c1"] }} />);
    await upload("distanceOverrides", "xlsx", file);
    expect(await screen.findByTestId("super-upload-replace-count")).toHaveTextContent("Replace: 1 rows (1 removed)");
    expect(screen.getByTestId("super-upload-merge-count")).toHaveTextContent("Merge: 0 added, 1 updated, 1 kept");
    fireEvent.click(screen.getByTestId("super-upload-replace"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "p1", toId: "w1", miles: 5 }]);
  });

  it("Cancel leaves the draft untouched", async () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={onChange} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np2,k1,9,4\n"));
    await screen.findByTestId("super-upload-replace-count");
    fireEvent.click(screen.getByTestId("super-upload-cancel"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("super-upload-dialog")).toBeNull();
  });

  it("parse errors show in place of the choices", async () => {
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={vi.fn()} readOnly={false} options={options} />);
    await upload("plantProducts", "csv", csv("plantId,productId,capacity,costPerUnit\np1,k1,1,1\np1,k1,2,2\n"));
    expect(await screen.findByTestId("super-upload-errors")).toHaveTextContent("x.csv row 3: duplicate key (first at row 2)");
    expect(screen.queryByTestId("super-upload-replace")).toBeNull();
    expect(screen.queryByTestId("super-upload-merge")).toBeNull();
    expect(screen.queryByTestId("super-upload-replace-count")).toBeNull();
  });

  it("read-only disables Upload (READ_ONLY_TITLE) and keeps Download", () => {
    render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly />);
    expect(screen.getByTestId("super-products-upload")).toBeDisabled();
    expect(screen.getByTestId("super-products-upload")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("super-products-download")).toBeEnabled();
  });

  it("Download CSV / JSON / XLSX are named after the table file", async () => {
    // jsdom has neither; assign so the spies below have something to restore to.
    URL.createObjectURL ??= () => "";
    URL.revokeObjectURL ??= () => {};
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<SuperTableTab table="plantProducts" rows={pp} onChange={vi.fn()} readOnly={false} options={options} />);
    for (const f of ["csv", "json", "xlsx"]) {
      fireEvent.click(screen.getByTestId("super-plantProducts-download"));
      fireEvent.click(screen.getByTestId(`super-plantProducts-download-${f}`));
    }
    await waitFor(() => expect([...names].sort()).toEqual(["plant_products.csv", "plant_products.json", "plant_products.xlsx"]));
  });
});
