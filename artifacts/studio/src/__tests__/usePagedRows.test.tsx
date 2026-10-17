import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PAGE_SIZE, pageResetKey, usePagedRows } from "@/components/data-table/usePagedRows";
import { TablePager } from "@/components/data-table/TablePager";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("usePagedRows", () => {
  it("pins the spec page size", () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it("50 rows: one page, no pager; 51 rows: two pages, pager", () => {
    const a = renderHook(() => usePagedRows(range(50), "k")).result.current;
    expect([a.pageCount, a.pageRows.length, a.showPager]).toEqual([1, 50, false]);
    const b = renderHook(() => usePagedRows(range(51), "k")).result.current;
    expect([b.pageCount, b.pageRows.length, b.showPager]).toEqual([2, 50, true]);
  });

  it("empty list has one empty page", () => {
    const r = renderHook(() => usePagedRows([], "")).result.current;
    expect([r.page, r.pageCount, r.pageRows]).toEqual([1, 1, []]);
  });

  it("setPage slices the requested page", () => {
    const { result } = renderHook(() => usePagedRows(range(120), "k"));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.pageRows).toEqual(range(120).slice(100));
  });

  it("a page beyond the end clamps to the last page", () => {
    const { result } = renderHook(() => usePagedRows(range(120), "k"));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
  });

  it("shrinking rows under the same key clamps down instead of stranding", () => {
    const { result, rerender } = renderHook(({ rows }) => usePagedRows(rows, "k"), {
      initialProps: { rows: range(120) },
    });
    act(() => result.current.setPage(3));
    rerender({ rows: range(60) });
    expect(result.current.page).toBe(2);
  });

  it("a resetKey change returns to page 1; same key (cell edit) keeps the page", () => {
    const { result, rerender } = renderHook(({ rows, k }) => usePagedRows(rows, k), {
      initialProps: { rows: range(120), k: "a" },
    });
    act(() => result.current.setPage(2));
    rerender({ rows: range(120).map(x => x), k: "a" });
    expect(result.current.page).toBe(2);
    rerender({ rows: range(120), k: "b" });
    expect(result.current.page).toBe(1);
  });

  it("setPage(page, forResetKey) survives the key change it anticipates", () => {
    const { result, rerender } = renderHook(({ k }) => usePagedRows(range(120), k), {
      initialProps: { k: "filtered" },
    });
    act(() => result.current.setPage(3, "all"));
    rerender({ k: "all" });
    expect(result.current.page).toBe(3);
  });
});

describe("pageResetKey", () => {
  const key = (r: { id: string }) => r.id;
  const a = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("is order-insensitive in rows", () => {
    expect(pageResetKey([...a].reverse(), key, {})).toBe(pageResetKey(a, key, {}));
  });

  it("changes when a row key is added or removed", () => {
    expect(pageResetKey([...a, { id: "d" }], key, {})).not.toBe(pageResetKey(a, key, {}));
    expect(pageResetKey(a.slice(1), key, {})).not.toBe(pageResetKey(a, key, {}));
  });

  it("is insensitive to filter-state key order and select-value order", () => {
    const one = pageResetKey(a, key, {
      city: { type: "select", values: ["x", "y"] },
      dist: { type: "number", min: 1 },
    });
    const two = pageResetKey(a, key, {
      dist: { type: "number", min: 1, max: undefined },
      city: { type: "select", values: ["y", "x"] },
    });
    expect(two).toBe(one);
  });

  it("changes when any filter value changes", () => {
    const base = pageResetKey(a, key, { t: { type: "text", value: "a" } });
    expect(pageResetKey(a, key, { t: { type: "text", value: "ab" } })).not.toBe(base);
    expect(pageResetKey(a, key, {})).not.toBe(base);
  });
});

describe("TablePager", () => {
  it("renders the literal testids and Page X of Y", () => {
    render(
      <TablePager
        page={2}
        pageCount={3}
        onPageChange={() => {}}
        testIds={{ pager: "p", prev: "button-x-prev", next: "button-x-next", indicator: "x-page-indicator" }}
      />,
    );
    expect(screen.getByTestId("x-page-indicator")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("p")).toContainElement(screen.getByTestId("button-x-prev"));
  });

  it("omitted testids emit no data-testid attribute", () => {
    const { container } = render(<TablePager page={1} pageCount={1} onPageChange={() => {}} />);
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });

  it("disables Prev on the first page and Next on the last; clicks report the target page", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <TablePager page={1} pageCount={2} onPageChange={onPageChange} testIds={{ prev: "prev", next: "next" }} />,
    );
    expect(screen.getByTestId("prev")).toBeDisabled();
    await user.click(screen.getByTestId("next"));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<TablePager page={2} pageCount={2} onPageChange={onPageChange} testIds={{ prev: "prev", next: "next" }} />);
    expect(screen.getByTestId("next")).toBeDisabled();
    await user.click(screen.getByTestId("prev"));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });
});
