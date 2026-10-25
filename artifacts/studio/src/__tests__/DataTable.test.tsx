import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "@/components/data-table/DataTable";
import { StatusToggle } from "@/components/data-table/entityCells";
import type { ColumnDef, DataTableFocus, DataTableProps } from "@/components/data-table/types";

interface Row {
  id: string;
  city: string;
  demand: number | null;
  added?: boolean;
}

const makeRows = (n: number, prefix = "C"): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, city: `City${i + 1}`, demand: (i + 1) * 10 }));

const columns: ColumnDef<Row>[] = [
  { id: "id", header: "ID", kind: "text", value: r => r.id, cell: r => <span data-testid={`id-${r.id}`}>{r.id}</span>, filter: "text" },
  { id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city, headerTestId: "head-city" },
  {
    id: "demand",
    header: "Demand",
    kind: "number",
    value: r => r.demand,
    cell: r => r.demand,
    cellTestId: r => `cell-demand-${r.id}`,
    cellClassName: "font-mono",
  },
  { id: "region", header: "Region", kind: "enum", value: () => "east", cell: () => "east", hidden: true },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <DataTable<Row>
      rows={makeRows(3)}
      rowKey={r => r.id}
      columns={columns}
      testIds={{ row: r => `row-${r.id}` }}
      {...props}
    />,
  );
}

const headerTexts = () => screen.getAllByRole("columnheader").map(th => th.textContent);
const visibleIds = () => screen.queryAllByTestId(/^row-/).map(tr => tr.getAttribute("data-testid"));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DataTable — markup", () => {
  it("renders real thead/th in column order and skips hidden columns", () => {
    renderTable();
    expect(headerTexts()).toEqual(["ID", "City", "Demand"]);
    expect(document.querySelector("table thead tr th")).not.toBeNull();
    expect(screen.getByRole("table")).toHaveClass("table-auto");
  });

  it("centre-aligns kind:number header and cells only; applies cellClassName", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Demand" })).toHaveClass("text-center");
    expect(screen.getByRole("columnheader", { name: "City" })).not.toHaveClass("text-center");
    expect(screen.getByTestId("cell-demand-C1")).toHaveClass("text-center", "font-mono", "px-3", "py-1.5");
    expect(screen.getByRole("columnheader", { name: "City" })).toHaveClass("whitespace-nowrap");
  });

  it("puts cell() output directly inside the <td> — no wrapper element", () => {
    renderTable();
    const td = screen.getByTestId("id-C1").parentElement!;
    expect(td.tagName).toBe("TD");
  });

  it("emits exactly the mapped testids and nothing else", () => {
    const { container } = render(
      <DataTable<Row>
        rows={makeRows(2)}
        rowKey={r => r.id}
        columns={[{ id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city }]}
      />,
    );
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });

  it("maps root/toolbar/scroll/table/row/header/cell testids literally", () => {
    renderTable({
      testIds: { root: "t-root", toolbar: "t-toolbar", scroll: "t-scroll", table: "t-table", row: r => `row-${r.id}` },
    });
    const root = screen.getByTestId("t-root");
    expect(root).toContainElement(screen.getByTestId("t-toolbar"));
    expect(screen.getByTestId("t-scroll")).toContainElement(screen.getByTestId("t-table"));
    expect(screen.getByTestId("t-table").tagName).toBe("TABLE");
    expect(screen.getByTestId("row-C2").tagName).toBe("TR");
    expect(screen.getByTestId("head-city").tagName).toBe("TH");
    expect(screen.getByTestId("cell-demand-C3")).toHaveTextContent("30");
  });

  it("passes the row to rowClassName", () => {
    renderTable({ rowClassName: r => (r.id === "C2" ? "bg-warning-bg" : undefined) });
    expect(screen.getByTestId("row-C2")).toHaveClass("bg-warning-bg");
    expect(screen.getByTestId("row-C1")).not.toHaveClass("bg-warning-bg");
  });
});

describe("DataTable — filter", () => {
  it("no filter menu at 10 rows; one at 11 with the default trigger testid", () => {
    const { unmount } = renderTable({ rows: makeRows(10) });
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
    unmount();
    renderTable({ rows: makeRows(11) });
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
  });

  it("filterTrigger maps the trigger testid", () => {
    renderTable({ rows: makeRows(11), testIds: { filterTrigger: "button-filter-pw" } });
    expect(screen.getByTestId("button-filter-pw")).toBeInTheDocument();
  });

  it("descriptor ids are column ids and filtering reads value(); a hidden column is still filterable", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(12) });
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    const pop = screen.getByTestId("filter-menu-popover");
    expect(within(pop).getByTestId("filter-control-id")).toBeInTheDocument();
    expect(within(pop).getByTestId("select-filter-city")).toBeInTheDocument(); // text, 12 distinct ≤ 20 → select
    expect(within(pop).getByTestId("input-filter-demand-min")).toBeInTheDocument(); // number → range
    expect(within(pop).getByTestId("filter-control-region")).toBeInTheDocument(); // hidden column
    await user.type(within(pop).getByTestId("input-filter-demand-min"), "100");
    expect(visibleIds()).toEqual(["row-C10", "row-C11", "row-C12"]);
  });

  it("a filter matching nothing renders one full-width no-match row", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(12), testIds: { row: r => `row-${r.id}`, noMatch: "t-nomatch" } });
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-id"), "zzz");
    expect(visibleIds()).toEqual([]);
    const cell = screen.getByTestId("t-nomatch");
    expect(cell).toHaveTextContent("No rows match the current filter.");
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("filterResetKey change clears only that column's filter", async () => {
    const user = userEvent.setup();
    const cols = (k: number): ColumnDef<Row>[] => [
      { ...columns[0] },
      { ...columns[2], filterResetKey: k },
    ];
    const { rerender } = render(
      <DataTable<Row>
      rows={makeRows(12)} rowKey={r => r.id} columns={cols(1)} testIds={{ row: r => `row-${r.id}` }} />,
    );
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "100");
    await user.type(screen.getByTestId("input-filter-id"), "C1");
    expect(visibleIds()).toEqual(["row-C10", "row-C11", "row-C12"]);
    rerender(<DataTable<Row>
      rows={makeRows(12)} rowKey={r => r.id} columns={cols(2)} testIds={{ row: r => `row-${r.id}` }} />);
    // demand range cleared, id text filter "C1" kept → C1, C10, C11, C12
    expect(visibleIds()).toEqual(["row-C1", "row-C10", "row-C11", "row-C12"]);
  });

  it("count testid renders an always-visible 'filtered of total' counter", () => {
    renderTable({ rows: makeRows(4), testIds: { count: "text-x-count" } });
    expect(screen.getByTestId("text-x-count")).toHaveTextContent("4 of 4");
  });

  it("countNoun reads '12 plants' unfiltered and '4 of 12 plants' filtered", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(12), testIds: { count: "text-x-count" }, countNoun: "plants" });
    expect(screen.getByTestId("text-x-count")).toHaveTextContent(/^12 plants$/);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-id"), "C1");
    expect(screen.getByTestId("text-x-count")).toHaveTextContent(/^4 of 12 plants$/);
  });
});

describe("DataTable — paging", () => {
  const pagerIds = { row: (r: Row) => `row-${r.id}`, pager: "t-pager", pagerPrev: "t-prev", pagerNext: "t-next", pageIndicator: "t-ind" };

  it("no pager at 50 rows", () => {
    renderTable({ rows: makeRows(50), testIds: pagerIds });
    expect(screen.queryByTestId("t-pager")).toBeNull();
    expect(visibleIds()).toHaveLength(50);
  });

  it("51 rows: pager with literal testids; Next shows row 51", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(51), testIds: pagerIds });
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    expect(visibleIds()).toEqual(["row-C51"]);
  });

  it("a filter change returns to page 1 and hides the pager once ≤ 50 rows match", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(120), testIds: pagerIds });
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "500");
    expect(screen.queryByTestId("t-pager")).toBeNull();
    expect(visibleIds()[0]).toBe("row-C1");
    expect(visibleIds()).toHaveLength(50);
  });

  it("a filter change that still matches every row also returns to page 1", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(120), testIds: pagerIds });
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "1");
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
  });

  it("editing a row (same keys, new array) keeps the page", async () => {
    const user = userEvent.setup();
    function Editable() {
      const [rows, setRows] = useState(makeRows(60));
      return (
        <>
          <button onClick={() => setRows(rs => rs.map(r => (r.id === "C55" ? { ...r, demand: 1 } : r)))}>edit</button>
          <DataTable<Row>
      rows={rows} rowKey={r => r.id} columns={columns} testIds={pagerIds} />
        </>
      );
    }
    render(<Editable />);
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByText("edit"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    expect(screen.getByTestId("cell-demand-C55")).toHaveTextContent("1");
  });

  it("a NEW columns array with the same ids (adapter rebuilt per render) keeps the filter and the page", async () => {
    const user = userEvent.setup();
    const rows = makeRows(120);
    const { rerender } = render(<DataTable<Row> rows={rows} rowKey={r => r.id} columns={columns} testIds={pagerIds} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "100");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    rerender(<DataTable<Row> rows={rows} rowKey={r => r.id} columns={columns.map(c => ({ ...c }))} testIds={pagerIds} />);
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(visibleIds()[0]).toBe("row-C60"); // filter kept: unfiltered page 2 would start at C51
  });
});

describe("DataTable — page reset semantics (B2.2)", () => {
  const ids = { row: (r: Row) => `row-${r.id}`, pagerNext: "t-next", pageIndicator: "t-ind" };
  // 120 rows, demand 10…1200; the filter "demand ≤ 1000" keeps C1…C100 (2 pages).
  function Mutable({ mutate }: { mutate: (rows: Row[]) => Row[] }) {
    const [rows, setRows] = useState(makeRows(120));
    return (
      <>
        <button onClick={() => setRows(mutate)}>mutate</button>
        <DataTable<Row> rows={rows} rowKey={r => r.id} columns={columns} testIds={ids} />
      </>
    );
  }
  async function onFilteredPage2(mutate: (rows: Row[]) => Row[]) {
    const user = userEvent.setup();
    render(<Mutable mutate={mutate} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "1000");
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    await user.click(screen.getByText("mutate"));
    return screen.getByTestId("t-ind").textContent;
  }
  const extra: Row = { id: "X1", city: "X", demand: 5 };

  it("adding a row the filter HIDES resets to page 1", async () => {
    expect(await onFilteredPage2(rs => [...rs, { ...extra, demand: 5000 }])).toBe("Page 1 of 2");
  });
  it("deleting a row the filter HIDES resets to page 1", async () => {
    expect(await onFilteredPage2(rs => rs.filter(r => r.id !== "C120"))).toBe("Page 1 of 2");
  });
  it("adding a row the filter SHOWS resets to page 1", async () => {
    expect(await onFilteredPage2(rs => [...rs, extra])).toBe("Page 1 of 3");
  });
  it("deleting a row the filter SHOWS resets to page 1", async () => {
    expect(await onFilteredPage2(rs => rs.filter(r => r.id !== "C1"))).toBe("Page 1 of 2");
  });
  it("editing a filtered column so a row leaves the filter keeps the page (same key set)", async () => {
    expect(await onFilteredPage2(rs => rs.map(r => (r.id === "C60" ? { ...r, demand: 5000 } : r)))).toBe("Page 2 of 2");
    expect(screen.queryByTestId("row-C60")).toBeNull();
  });
  it("reordering the rows keeps the page", async () => {
    expect(await onFilteredPage2(rs => [...rs].reverse())).toBe("Page 2 of 2");
  });
});

describe("DataTable — empty, toolbar, footer", () => {
  it("empty rows render emptyState (with its testid) instead of the table; toolbar slots still render", () => {
    renderTable({
      rows: [],
      emptyState: "Nothing here",
      testIds: { empty: "t-empty", toolbar: "t-toolbar" },
      toolbar: { download: <button data-testid="dl">CSV</button> },
    });
    expect(screen.getByTestId("t-empty")).toHaveTextContent("Nothing here");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("t-toolbar")).toContainElement(screen.getByTestId("dl"));
  });

  it("toolbar slots render in upload, download, add, extra order; footer after the table", () => {
    renderTable({
      toolbar: {
        extra: <span>extra</span>,
        add: <span>add</span>,
        download: <span>download</span>,
        upload: <span>upload</span>,
      },
      footer: <p data-testid="t-footer">note</p>,
    });
    const order = ["upload", "download", "add", "extra"].map(t => screen.getByText(t));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByRole("table").compareDocumentPosition(screen.getByTestId("t-footer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("downloadAlign 'right' renders download last — after the count and the filter trigger", () => {
    renderTable({
      rows: makeRows(11),
      testIds: { row: r => `row-${r.id}`, count: "t-count" },
      toolbar: { upload: <span>upload</span>, download: <span data-testid="dl">download</span>, downloadAlign: "right" },
    });
    const dl = screen.getByTestId("dl");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    for (const before of [screen.getByText("upload"), screen.getByTestId("t-count"), screen.getByTestId("button-filter-menu-trigger")]) {
      expect(before.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("DataTable — sections", () => {
  const base = makeRows(3);
  const added: Row[] = [{ id: "A1", city: "New", demand: null, added: true }];
  const deleteCol: ColumnDef<Row> = { id: "del", header: "", kind: "text", value: () => null, cell: r => <button data-testid={`del-${r.id}`}>x</button>, filter: false };

  const sectioned = (rows: Row[]) =>
    render(
      <DataTable<Row>
        rows={rows}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "base", testId: "sec-base", tableTestId: "tbl-base", includes: r => !r.added, emptyState: <p data-testid="base-empty">No dataset rows</p> },
          {
            id: "added",
            title: "Added customers",
            testId: "sec-added",
            scrollTestId: "scroll-added",
            includes: r => !!r.added,
            columns: [...columns, deleteCol],
            rowTestId: r => `row-added-${r.id}`,
            footer: <button data-testid="button-add-customer-row">+ Add</button>,
          },
        ]}
        testIds={{ row: r => `row-${r.id}` }}
      />,
    );

  it("splits rows into titled groups with per-section columns and row testids", () => {
    sectioned([...base, ...added]);
    expect(within(screen.getByTestId("tbl-base")).getAllByRole("row")).toHaveLength(4); // header + 3
    expect(screen.getByTestId("row-C1")).toBeInTheDocument();
    expect(screen.getByTestId("row-added-A1")).toBeInTheDocument();
    expect(within(screen.getByTestId("sec-added")).getByText("Added customers")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-added")).toContainElement(screen.getByTestId("del-A1"));
    expect(within(screen.getByTestId("tbl-base")).queryByText("x")).toBeNull();
  });

  it("an empty base section shows its own emptyState; the added section and its footer still render", () => {
    sectioned(added);
    expect(screen.getByTestId("base-empty")).toBeInTheDocument();
    expect(screen.getByTestId("row-added-A1")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  it("a section footer renders even when that section has no rows", () => {
    sectioned(base);
    expect(screen.queryByTestId("scroll-added")).toBeNull();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  it("base and added share ONE filter menu", () => {
    sectioned([...makeRows(11), ...added]);
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
  });

  it("pages across the concatenated list: added rows appended after base", async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        rows={[...makeRows(50), ...added]}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "base", testId: "sec-base", includes: r => !r.added },
          { id: "added", testId: "sec-added", includes: r => !!r.added },
        ]}
        testIds={{ row: r => `row-${r.id}`, pagerNext: "t-next" }}
      />,
    );
    expect(screen.queryByTestId("sec-added")).toBeNull();
    await user.click(screen.getByTestId("t-next"));
    expect(screen.queryByTestId("sec-base")).toBeNull();
    expect(screen.getByTestId("row-A1")).toBeInTheDocument();
  });
});

describe("DataTable — focus jump", () => {
  function Focusable({ rows }: { rows: Row[] }) {
    const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
    return (
      <>
        <button onClick={() => setFocus({ token: Date.now(), matches: r => r.id === "C75" })}>jump</button>
        <DataTable<Row>
      rows={rows} rowKey={r => r.id} columns={columns} focus={focus} testIds={{ row: r => `row-${r.id}`, pageIndicator: "t-ind" }} />
      </>
    );
  }

  it("clears filters, lands on the target's page and scrolls the row into view", async () => {
    const user = userEvent.setup();
    render(<Focusable rows={makeRows(120)} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "100");
    expect(screen.queryByTestId("t-ind")).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("jump"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("row-C75")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("a focus that matches nothing leaves page and filters alone", async () => {
    const user = userEvent.setup();
    function NoMatch() {
      const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
      return (
        <>
          <button onClick={() => setFocus({ token: 1, matches: () => false })}>jump</button>
          <DataTable<Row>
      rows={makeRows(120)} rowKey={r => r.id} columns={columns} focus={focus} testIds={{ pagerNext: "t-next", pageIndicator: "t-ind" }} />
        </>
      );
    }
    render(<NoMatch />);
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByText("jump"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
  });
});

describe("DataTable — focus edge cases", () => {
  it("re-attempts an unmatched focus once the row appears, only while the token is unconsumed", async () => {
    const focus: DataTableFocus<Row> = { token: 7, matches: r => r.id === "C75" };
    const props = { rowKey: (r: Row) => r.id, columns, focus, testIds: { row: (r: Row) => `row-${r.id}`, pageIndicator: "t-ind" } };
    const { rerender } = render(<DataTable<Row> {...props} rows={makeRows(60)} />);
    expect(screen.queryByTestId("row-C75")).toBeNull();
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    rerender(<DataTable<Row> {...props} rows={makeRows(120)} />);
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("row-C75")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    // consumed: more rows must not jump again
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /prev|previous/i }));
    rerender(<DataTable<Row> {...props} rows={makeRows(121)} />);
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
  });

  it("re-aims a consumed jump when late-loading rows push the target to another page (R5a.1)", () => {
    const focus: DataTableFocus<Row> = { token: "WH", matches: r => r.id === "T" };
    const props = { rowKey: (r: Row) => r.id, columns, focus, testIds: { row: (r: Row) => `row-${r.id}`, pageIndicator: "t-ind" } };
    const target: Row = { id: "T", city: "Target", demand: 1 };
    const { rerender } = render(<DataTable<Row> {...props} rows={[target]} />);
    expect(screen.getByTestId("row-T")).toBeInTheDocument();
    // the base block loads AHEAD of the (override) target row
    rerender(<DataTable<Row> {...props} rows={[...makeRows(60), target]} />);
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    expect(screen.getByTestId("row-T")).toBeInTheDocument();
  });

  it("clears pendingScrollKey when the row is in no section instead of re-querying forever", () => {
    const spy = vi.spyOn(Element.prototype, "querySelectorAll");
    const sections = [{ id: "a", includes: (r: Row) => r.id === "C1" }];
    const focus: DataTableFocus<Row> = { token: 1, matches: r => r.id === "C2" };
    const props = { rowKey: (r: Row) => r.id, columns, focus, sections };
    const { rerender } = render(<DataTable<Row> {...props} rows={makeRows(3)} />);
    spy.mockClear();
    rerender(<DataTable<Row> {...props} rows={makeRows(3)} />);
    rerender(<DataTable<Row> {...props} rows={makeRows(3)} />);
    expect(spy.mock.calls.filter(c => c[0] === "tr[data-row-key]")).toHaveLength(0);
    spy.mockRestore();
  });
});


// SCU-2.P3.7 (spec B2.2 exception) — a table with no filterable column renders
// no filter menu, whatever its row count (the Solution Summary metric tables).
describe("DataTable — no filterable column (SCU-2.P3.7)", () => {
  it("renders no filter trigger above 10 rows when every column is filter: false", () => {
    render(
      <DataTable<Row>
        rows={makeRows(12)}
        rowKey={r => r.id}
        columns={[{ id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city, filter: false }]}
      />,
    );
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });
});

describe("DataTable — sort (QFX-4)", () => {
  // city: natural + case-insensitive ("a2" < "A10"; "b" ties "B"); blank city/demand go last.
  const mixed: Row[] = [
    { id: "r1", city: "b", demand: 10 },
    { id: "r2", city: "A10", demand: null },
    { id: "r3", city: "a2", demand: 2 },
    { id: "r4", city: "", demand: 10 },
    { id: "r5", city: "B", demand: 30 },
  ];
  const head = (name: string) => screen.getByRole("columnheader", { name });

  it("a header click cycles ascending → descending → off, with ▲/▼ and aria-sort", async () => {
    const user = userEvent.setup();
    renderTable({ rows: mixed });
    const th = head("Demand");
    const btn = within(th).getByRole("button");
    expect(th).toHaveAttribute("aria-sort", "none");
    await user.click(btn);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(th).toHaveTextContent("Demand▲");
    await user.click(btn);
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(th).toHaveTextContent("Demand▼");
    await user.click(btn);
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(th.textContent).toBe("Demand");
    expect(visibleIds()).toEqual(["row-r1", "row-r2", "row-r3", "row-r4", "row-r5"]);
  });

  it("a value-only edit in the sorted column keeps row order; the next header click re-sorts", async () => {
    const user = userEvent.setup();
    const props = { rowKey: (r: Row) => r.id, columns, testIds: { row: (r: Row) => `row-${r.id}` } };
    const { rerender } = render(<DataTable<Row> rows={mixed} {...props} />);
    await user.click(within(head("Demand")).getByRole("button"));
    expect(visibleIds()).toEqual(["row-r3", "row-r1", "row-r4", "row-r5", "row-r2"]);
    // r3 (2) is edited to 99 as if typed: new row object, same key set.
    const edited = mixed.map(r => (r.id === "r3" ? { ...r, demand: 99 } : r));
    rerender(<DataTable<Row> rows={edited} {...props} />);
    expect(visibleIds()).toEqual(["row-r3", "row-r1", "row-r4", "row-r5", "row-r2"]);
    await user.click(within(head("Demand")).getByRole("button"));
    expect(visibleIds()).toEqual(["row-r3", "row-r5", "row-r1", "row-r4", "row-r2"]);
  });

  it("numbers compare numerically; blanks last in both directions; ties keep input order", async () => {
    const user = userEvent.setup();
    renderTable({ rows: mixed });
    const btn = within(head("Demand")).getByRole("button");
    await user.click(btn);
    expect(visibleIds()).toEqual(["row-r3", "row-r1", "row-r4", "row-r5", "row-r2"]);
    await user.click(btn);
    expect(visibleIds()).toEqual(["row-r5", "row-r1", "row-r4", "row-r3", "row-r2"]);
  });

  it("strings use natural, case-insensitive order; blanks last in both directions; ties stable", async () => {
    const user = userEvent.setup();
    renderTable({ rows: mixed });
    const btn = within(head("City")).getByRole("button");
    await user.click(btn);
    expect(visibleIds()).toEqual(["row-r3", "row-r2", "row-r1", "row-r5", "row-r4"]);
    await user.click(btn);
    expect(visibleIds()).toEqual(["row-r1", "row-r5", "row-r2", "row-r3", "row-r4"]);
  });

  it("only one column is sorted at a time", async () => {
    const user = userEvent.setup();
    renderTable({ rows: mixed });
    await user.click(within(head("City")).getByRole("button"));
    await user.click(within(head("Demand")).getByRole("button"));
    expect(head("City")).toHaveAttribute("aria-sort", "none");
    expect(head("Demand")).toHaveAttribute("aria-sort", "ascending");
    expect(visibleIds()[0]).toBe("row-r3");
  });

  it("sortable: false renders the plain header — no button, no aria-sort", () => {
    renderTable({ columns: [columns[0], { ...columns[1], sortable: false }, columns[2]] });
    expect(within(head("City")).queryByRole("button")).toBeNull();
    expect(head("City")).not.toHaveAttribute("aria-sort");
    expect(within(head("ID")).getByRole("button")).toBeInTheDocument();
  });

  it("sorts BEFORE paging, and a sort change returns to page 1", async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row> rows={makeRows(120)} rowKey={r => r.id} columns={columns}
        testIds={{ row: r => `row-${r.id}`, pagerNext: "t-next", pageIndicator: "t-ind" }} />,
    );
    const btn = within(head("Demand")).getByRole("button");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    await user.click(btn); // ascending
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
    await user.click(screen.getByTestId("t-next"));
    await user.click(btn); // descending
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
    expect(visibleIds()[0]).toBe("row-C120"); // the global max, not page 1's max
  });

  it("never mutates or reorders the caller's rows array", async () => {
    const user = userEvent.setup();
    const rows = makeRows(3);
    const before = [...rows];
    renderTable({ rows });
    const btn = within(head("Demand")).getByRole("button");
    await user.click(btn);
    await user.click(btn);
    expect(visibleIds()).toEqual(["row-C3", "row-C2", "row-C1"]);
    expect(rows.every((r, i) => r === before[i])).toBe(true);
  });

  it("sections: rows sort within each section and section order is unchanged", async () => {
    const user = userEvent.setup();
    const added: Row[] = [
      { id: "A1", city: "Z", demand: 5, added: true },
      { id: "A2", city: "Y", demand: 50, added: true },
    ];
    render(
      <DataTable<Row>
        rows={[...makeRows(3), ...added]}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "base", testId: "sec-base", includes: r => !r.added },
          { id: "added", testId: "sec-added", includes: r => !!r.added },
        ]}
        testIds={{ row: r => `row-${r.id}` }}
      />,
    );
    const btn = within(screen.getAllByRole("columnheader", { name: "Demand" })[0]).getByRole("button");
    await user.click(btn);
    await user.click(btn); // descending: A2 (50) is the global max but stays in its own section
    const ids = (sec: string) => within(screen.getByTestId(sec)).getAllByTestId(/^row-/).map(tr => tr.getAttribute("data-testid"));
    expect(ids("sec-base")).toEqual(["row-C3", "row-C2", "row-C1"]);
    expect(ids("sec-added")).toEqual(["row-A2", "row-A1"]);
    expect(screen.getByTestId("sec-base").compareDocumentPosition(screen.getByTestId("sec-added")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const th of screen.getAllByRole("columnheader", { name: "Demand" })) expect(th).toHaveAttribute("aria-sort", "descending");
  });

  it("QFX-R1: after the sort is cleared, edits made while unsorted are honoured when the same sort is chosen again", async () => {
    const base: Row[] = [
      { id: "a", city: "A", demand: 1 },
      { id: "b", city: "B", demand: 2 },
      { id: "c", city: "C", demand: 3 },
    ];
    function Host() {
      const [rows, setRows] = useState(base);
      const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
      return (
        <>
          <button onClick={() => setFocus({ token: 1, matches: r => r.id === "b" })}>jump</button>
          <button onClick={() => setRows(base.map(r => (r.id === "a" ? { ...r, demand: 99 } : r)))}>edit</button>
          <DataTable<Row> rows={rows} rowKey={r => r.id} columns={columns} focus={focus} testIds={{ row: r => `row-${r.id}` }} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    await user.click(within(head("Demand")).getByRole("button"));
    expect(visibleIds()).toEqual(["row-a", "row-b", "row-c"]);
    await user.click(screen.getByText("jump")); // clears the sort
    expect(head("Demand")).toHaveAttribute("aria-sort", "none");
    await user.click(screen.getByText("edit"));
    await user.click(within(head("Demand")).getByRole("button"));
    expect(visibleIds()).toEqual(["row-b", "row-c", "row-a"]);
  });

  it("a focus jump clears the sort and lands on the target's page in unsorted order", async () => {
    function SortThenJump() {
      const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
      return (
        <>
          <button onClick={() => setFocus({ token: Date.now(), matches: r => r.id === "C75" })}>jump</button>
          <DataTable<Row> rows={makeRows(120)} rowKey={r => r.id} columns={columns} focus={focus}
            testIds={{ row: r => `row-${r.id}`, pageIndicator: "t-ind" }} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<SortThenJump />);
    const btn = within(head("Demand")).getByRole("button");
    await user.click(btn);
    await user.click(btn);
    expect(visibleIds()[0]).toBe("row-C120");
    await user.click(screen.getByText("jump"));
    expect(head("Demand")).toHaveAttribute("aria-sort", "none");
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("row-C75")).toBeInTheDocument();
  });
});

// DU-2.6 — jsdom cannot prove `position: sticky` or scrolling. These tests assert the
// CLASSES that produce the behaviour (sticky thead, single scroll ancestor, pinned
// pager, 24px targets); DU-2.9 verifies them in a real browser.
describe("DataTable — DU-2.6 affordances", () => {
  it("loading: the skeleton shows and wins over emptyState and rows", () => {
    renderTable({ rows: [], emptyState: <p>Nothing here</p>, loading: true });
    expect(screen.getByTestId("data-table-loading")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("loading wins over rows and honours testIds.loading", () => {
    renderTable({ loading: true, testIds: { loading: "my-skeleton", row: r => `row-${r.id}` } });
    expect(screen.getByTestId("my-skeleton")).toBeInTheDocument();
    expect(visibleIds()).toEqual([]);
  });

  it("not loading: no skeleton", () => {
    renderTable({ loading: false });
    expect(screen.queryByTestId("data-table-loading")).toBeNull();
  });

  it("thead cells are sticky and the Table wrapper is not its own scroll container", () => {
    renderTable({ testIds: { scroll: "scroll" } });
    for (const th of screen.getAllByRole("columnheader")) expect(th).toHaveClass("sticky", "top-0", "z-10", "bg-background");
    const wrapper = screen.getByRole("table").parentElement!;
    expect(wrapper).toHaveClass("overflow-visible");
    expect(wrapper).toHaveClass("relative");
    expect(screen.getByTestId("scroll")).toHaveClass("overflow-auto"); // default scrollClassName
  });

  it("the pager is the last child INSIDE the scroll wrapper and is sticky-bottom", () => {
    renderTable({ rows: makeRows(60), testIds: { scroll: "scroll", pager: "t-pager" } });
    const scroll = screen.getByTestId("scroll");
    const pager = screen.getByTestId("t-pager");
    expect(scroll.lastElementChild).toBe(pager);
    expect(pager).toHaveClass("sticky", "bottom-0", "z-10", "bg-background");
  });

  // DU-2.10 — jsdom cannot prove sticky/scroll; the real-browser proof is
  // e2e/design-upgrade-p2.spec.ts. These assert the cap that makes the wrapper the scroll ancestor.
  it("DU-2.10: flat tables cap the scroll wrapper by default; an explicit scrollClassName replaces (not stacks on) it", () => {
    const { unmount } = renderTable({ testIds: { scroll: "scroll" } });
    expect(screen.getByTestId("scroll")).toHaveClass("max-h-[55vh]", "overflow-auto");
    unmount();
    renderTable({ testIds: { scroll: "scroll" }, scrollClassName: "max-h-[40vh] overflow-y-auto" });
    expect(screen.getByTestId("scroll")).toHaveClass("max-h-[40vh]", "overflow-y-auto");
    expect(screen.getByTestId("scroll")).not.toHaveClass("max-h-[55vh]");
  });

  // DU-2.11 — jsdom cannot prove sticky; browser proof is e2e/design-upgrade-p2.spec.ts.
  it("DU-2.11: sections mode defaults the outer wrapper to the cap; sections carry no scroll cap; pager is its last child", () => {
    const rows = [...makeRows(30, "A"), ...makeRows(30, "B")];
    const props = {
      rows,
      rowKey: (r: Row) => r.id,
      columns,
      sections: [
        { id: "a", title: "Group A", testId: "sec-a", scrollTestId: "sec-scroll-a", includes: (r: Row) => r.id.startsWith("A") },
        { id: "b", title: "Group B", testId: "sec-b", includes: (r: Row) => r.id.startsWith("B") },
      ],
      testIds: { scroll: "scroll", pager: "t-pager" },
    };
    const { unmount } = render(<DataTable<Row> {...props} />);
    const scroll = screen.getByTestId("scroll");
    expect(scroll).toHaveClass("max-h-[55vh]", "overflow-auto");
    expect(scroll.lastElementChild).toBe(screen.getByTestId("t-pager"));
    expect(screen.getByTestId("t-pager")).toHaveClass("sticky", "bottom-0");
    for (const el of [screen.getByTestId("sec-a"), screen.getByTestId("sec-b"), screen.getByTestId("sec-scroll-a")]) {
      expect(el.className).not.toMatch(/overflow|max-h/);
    }
    unmount();
    render(<DataTable<Row> {...props} scrollClassName="max-h-[40vh] overflow-y-auto" />);
    expect(screen.getByTestId("scroll")).toHaveClass("max-h-[40vh]");
    expect(screen.getByTestId("scroll")).not.toHaveClass("max-h-[55vh]");
  });

  it("StatusToggle buttons are at least 24px", () => {
    render(
      <StatusToggle options={["a", "b"] as const} value="a" labelOf={s => s} activeClassOf={() => "x"} onChange={() => {}} disabled={false} testIdOf={s => `t-${s}`} />,
    );
    for (const id of ["t-a", "t-b"]) expect(screen.getByTestId(id)).toHaveClass("min-h-6", "min-w-6");
  });

  it("sections: ONE global pager inside the single scroll wrapper; a page spans both sections (PR2-9)", () => {
    const rows = [...makeRows(30, "A"), ...makeRows(30, "B")];
    render(
      <DataTable<Row>
        rows={rows}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "a", title: "Group A", testId: "sec-a", includes: r => r.id.startsWith("A") },
          { id: "b", title: "Group B", testId: "sec-b", includes: r => r.id.startsWith("B") },
        ]}
        testIds={{ row: r => `row-${r.id}`, scroll: "scroll", pager: "t-pager", pageIndicator: "t-ind" }}
      />,
    );
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 2");
    expect(within(screen.getByTestId("sec-a")).getAllByTestId(/^row-/)).toHaveLength(30);
    expect(within(screen.getByTestId("sec-b")).getAllByTestId(/^row-/)).toHaveLength(20);
    expect(screen.getByTestId("sec-a")).toHaveTextContent("Group A");
    expect(screen.getByTestId("sec-b")).toHaveTextContent("Group B");
    expect(screen.getAllByTestId("t-pager")).toHaveLength(1);
    expect(screen.getByTestId("scroll").lastElementChild).toBe(screen.getByTestId("t-pager"));
  });
});
