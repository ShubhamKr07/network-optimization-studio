import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableFilters, type ColumnFilterDescriptor } from "./useTableFilters";

interface Row {
  id: string;
  name: string;
  status: string;
  amount: number | undefined;
}

const rows: Row[] = [
  { id: "1", name: "Alpha Warehouse", status: "open", amount: 100 },
  { id: "2", name: "Beta Warehouse", status: "closed", amount: 200 },
  { id: "3", name: "Gamma Depot", status: "open", amount: 300 },
  { id: "4", name: "Delta Depot", status: "inactive", amount: undefined },
];

const descriptors: ColumnFilterDescriptor<Row>[] = [
  { key: "name", label: "Name", type: "text", accessor: r => r.name },
  { key: "status", label: "Status", type: "select", accessor: r => r.status },
  { key: "amount", label: "Amount", type: "number", accessor: r => r.amount },
];

describe("useTableFilters", () => {
  it("returns all rows unfiltered by default", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    expect(result.current.filteredRows).toHaveLength(4);
    expect(result.current.totalCount).toBe(4);
    expect(result.current.filteredCount).toBe(4);
    expect(result.current.filterState).toEqual({});
  });

  describe("text filter", () => {
    it("narrows via case-insensitive substring match", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("name", { type: "text", value: "depot" }));
      expect(result.current.filteredRows.map(r => r.id)).toEqual(["3", "4"]);
      expect(result.current.filteredCount).toBe(2);
      expect(result.current.totalCount).toBe(4);
    });

    it("an empty/whitespace value matches everything", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("name", { type: "text", value: "   " }));
      expect(result.current.filteredRows).toHaveLength(4);
    });

    it("matches nothing when the substring isn't present", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("name", { type: "text", value: "zzz" }));
      expect(result.current.filteredRows).toHaveLength(0);
    });
  });

  describe("select filter", () => {
    it("derives distinct values from the UNFILTERED rows", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      expect(result.current.distinctValuesByKey.status).toEqual(["open", "closed", "inactive"]);
    });

    it("distinct values stay the same even while another filter is active (unfiltered-derivation contract)", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("name", { type: "text", value: "warehouse" }));
      // status "inactive"/"open" (Gamma/Delta Depot) are filtered OUT of
      // filteredRows by the name filter, but must still appear as options.
      expect(result.current.distinctValuesByKey.status).toEqual(["open", "closed", "inactive"]);
    });

    it("multi-select narrows via OR semantics across selected values", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("status", { type: "select", values: ["open", "inactive"] }));
      expect(result.current.filteredRows.map(r => r.id).sort()).toEqual(["1", "3", "4"]);
    });

    it("an empty values array matches everything", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("status", { type: "select", values: [] }));
      expect(result.current.filteredRows).toHaveLength(4);
    });

    it("excludes rows whose accessor value is undefined once active", () => {
      const withUndefinedStatus: Row[] = [...rows, { id: "5", name: "Epsilon", status: undefined as unknown as string, amount: 50 }];
      const { result } = renderHook(() => useTableFilters(withUndefinedStatus, descriptors));
      act(() => result.current.setFilter("status", { type: "select", values: ["open"] }));
      expect(result.current.filteredRows.some(r => r.id === "5")).toBe(false);
    });
  });

  describe("number filter", () => {
    it("narrows via an inclusive [min,max] range", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("amount", { type: "number", min: 100, max: 200 }));
      expect(result.current.filteredRows.map(r => r.id).sort()).toEqual(["1", "2"]);
    });

    it("boundary values are inclusive", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("amount", { type: "number", min: 100, max: 100 }));
      expect(result.current.filteredRows.map(r => r.id)).toEqual(["1"]);
    });

    it("supports a min-only or max-only bound", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("amount", { type: "number", min: 250 }));
      expect(result.current.filteredRows.map(r => r.id)).toEqual(["3"]);
    });

    it("excludes rows with no numeric value once active", () => {
      const { result } = renderHook(() => useTableFilters(rows, descriptors));
      act(() => result.current.setFilter("amount", { type: "number", min: 0 }));
      expect(result.current.filteredRows.some(r => r.id === "4")).toBe(false);
    });
  });

  it("combines multiple active filters with AND semantics", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    act(() => {
      result.current.setFilter("status", { type: "select", values: ["open"] });
      result.current.setFilter("amount", { type: "number", min: 250 });
    });
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["3"]);
  });

  it("setFilter(key, undefined) clears a single filter", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    act(() => result.current.setFilter("name", { type: "text", value: "depot" }));
    expect(result.current.filteredCount).toBe(2);
    act(() => result.current.setFilter("name", undefined));
    expect(result.current.filteredCount).toBe(4);
    expect(result.current.filterState.name).toBeUndefined();
  });

  it("clearAll resets every active filter", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    act(() => {
      result.current.setFilter("name", { type: "text", value: "depot" });
      result.current.setFilter("status", { type: "select", values: ["open"] });
    });
    expect(result.current.filteredCount).toBe(1);
    act(() => result.current.clearAll());
    expect(result.current.filterState).toEqual({});
    expect(result.current.filteredRows).toHaveLength(4);
  });
});
