import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  deriveFilterDescriptors,
  FILTER_ROW_THRESHOLD,
  SELECT_DISTINCT_MAX,
} from "@/components/data-table/deriveFilterDescriptors";
import type { ColumnDef } from "@/components/data-table/types";
import { EMPTY_FILTER_LABEL, EMPTY_FILTER_VALUE, useTableFilters } from "@/lib/useTableFilters";

interface Row {
  id: string;
  city: string | null;
  distance: number | null;
  status: "open" | "closed";
}

const col = (over: Partial<ColumnDef<Row>> & Pick<ColumnDef<Row>, "id" | "kind" | "value">): ColumnDef<Row> => ({
  header: over.id,
  cell: () => null,
  ...over,
});

const rows: Row[] = [
  { id: "W1", city: "Austin", distance: 10, status: "open" },
  { id: "W2", city: null, distance: null, status: "closed" },
  { id: "W3", city: "Boston", distance: Number.NaN, status: "open" },
];

describe("deriveFilterDescriptors — spec constants", () => {
  it("pins the spec's thresholds", () => {
    expect(FILTER_ROW_THRESHOLD).toBe(10);
    expect(SELECT_DISTINCT_MAX).toBe(20);
    expect(EMPTY_FILTER_LABEL).toBe("(empty)");
  });

  it("the empty token is not a printable string any cell could hold", () => {
    expect(EMPTY_FILTER_VALUE).not.toBe(EMPTY_FILTER_LABEL);
    expect(EMPTY_FILTER_VALUE.charCodeAt(0)).toBe(0);
  });
});

describe("deriveFilterDescriptors — precedence", () => {
  it("explicit filter wins over kind", () => {
    const d = deriveFilterDescriptors(
      [
        col({ id: "a", kind: "number", value: r => r.distance, filter: "select" }),
        col({ id: "b", kind: "text", value: r => r.city, filter: "range" }),
        col({ id: "c", kind: "enum", value: r => r.status, filter: "text" }),
      ],
      rows,
    );
    expect(d.map(x => [x.key, x.type])).toEqual([["a", "select"], ["b", "number"], ["c", "text"]]);
  });

  it("filter: false drops the column", () => {
    const d = deriveFilterDescriptors([col({ id: "a", kind: "text", value: r => r.id, filter: false })], rows);
    expect(d).toEqual([]);
  });

  it("number → range, enum → select", () => {
    const d = deriveFilterDescriptors(
      [col({ id: "dist", kind: "number", value: r => r.distance }), col({ id: "status", kind: "enum", value: r => r.status })],
      rows,
    );
    expect(d.map(x => x.type)).toEqual(["number", "select"]);
  });

  it("text → select at exactly 20 distinct non-null values, text at 21; nulls not counted", () => {
    const make = (n: number): Row[] => [
      ...Array.from({ length: n }, (_, i) => ({ id: `W${i}`, city: `City${i}`, distance: i, status: "open" as const })),
      { id: "WX", city: null, distance: null, status: "open" as const },
    ];
    const c = col({ id: "city", kind: "text", value: r => r.city });
    expect(deriveFilterDescriptors([c], make(20))[0].type).toBe("select");
    expect(deriveFilterDescriptors([c], make(21))[0].type).toBe("text");
  });
});

describe("deriveFilterDescriptors — ids, labels, accessors", () => {
  it("descriptor key = column id; label = string header, else filterLabel, else id", () => {
    const d = deriveFilterDescriptors(
      [
        col({ id: "from", kind: "text", value: r => r.id, header: "From" }),
        col({ id: "base", kind: "number", value: r => r.distance, header: null, filterLabel: "Base (mi)" }),
        col({ id: "raw", kind: "number", value: r => r.distance, header: null }),
      ],
      rows,
    );
    expect(d.map(x => [x.key, x.label])).toEqual([["from", "From"], ["base", "Base (mi)"], ["raw", "raw"]]);
  });

  it("select maps null and NaN to the (empty) option; range and text map them to undefined", () => {
    const [sel, rng, txt] = deriveFilterDescriptors(
      [
        col({ id: "s", kind: "number", value: r => r.distance, filter: "select" }),
        col({ id: "r", kind: "number", value: r => r.distance }),
        col({ id: "t", kind: "text", value: r => r.city, filter: "text" }),
      ],
      rows,
    );
    expect(rows.map(sel.accessor)).toEqual([10, EMPTY_FILTER_VALUE, EMPTY_FILTER_VALUE]);
    expect(rows.map(rng.accessor)).toEqual([10, undefined, undefined]);
    expect(rows.map(txt.accessor)).toEqual(["Austin", undefined, "Boston"]);
  });
});

describe("deriveFilterDescriptors + useTableFilters", () => {
  const columns: ColumnDef<Row>[] = [
    col({ id: "city", kind: "text", value: r => r.city }),
    col({ id: "dist", kind: "number", value: r => r.distance }),
  ];
  const descriptors = deriveFilterDescriptors(columns, rows);

  it("(empty) select option matches only null rows", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    expect(result.current.distinctValuesByKey.city).toEqual(["Austin", EMPTY_FILTER_VALUE, "Boston"]);
    act(() => result.current.setFilter("city", { type: "select", values: [EMPTY_FILTER_VALUE] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W2"]);
  });

  it("a real cell whose text is literally '(empty)' is its own option and never matches the empty option", () => {
    const withLiteral: Row[] = [...rows, { id: "W4", city: "(empty)", distance: 1, status: "open" }];
    const d = deriveFilterDescriptors(columns, withLiteral);
    const { result } = renderHook(() => useTableFilters(withLiteral, d));
    expect(result.current.distinctValuesByKey.city).toEqual(["Austin", EMPTY_FILTER_VALUE, "Boston", "(empty)"]);
    act(() => result.current.setFilter("city", { type: "select", values: [EMPTY_FILTER_VALUE] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W2"]);
    act(() => result.current.setFilter("city", { type: "select", values: ["(empty)"] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W4"]);
  });

  it("an active range excludes null and NaN rows; no range keeps them", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    expect(result.current.filteredRows).toHaveLength(3);
    act(() => result.current.setFilter("dist", { type: "number", min: 0 }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W1"]);
  });
});
