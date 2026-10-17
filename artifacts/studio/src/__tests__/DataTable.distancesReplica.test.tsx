// SCU-2.P1.5 — proves the DataTable testid-mapping API can reproduce a real
// table's testids. Renders the REAL DistancesTab and a DataTable adapter fed
// the same rows, then compares every testid inside the table and pager.
// No production table is migrated here; the adapter below is test-only and
// is the template the P4 DistancesTab migration starts from.
//
// The comparison is the COMPLETE testid multiset under each root
// (`distances-tab`): root, toolbar, scroll/table, rows, cells, pager, empty
// state, filter trigger and the add-row trigger. Expected, spec-mandated
// differences (B2.2), applied to the real set before comparing:
//   - `input-filter-from` / `input-filter-to` boxes are removed;
//   - the FilterMenu trigger `button-filter-menu-trigger` appears (> 10 rows).
// The fixture has 60 rows so both pagers render (DataTable: > 50 only).
// Toolbar buttons are inert stand-ins with the real testids (their behaviour
// is P2/P4's); only the testid contract is under test here.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { DistancesTab, type DistanceOverride } from "@/components/workspace/tabs/DistancesTab";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef, DataTableTestIds } from "@/components/data-table/types";

interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: DistanceOverride;
}

// 3 warehouses × 20 customers = 60 rows. WH03 and C020 are unknown ids (warning icons).
const current: DistanceOverride[] = [];
for (const w of ["WH01", "WH02", "WH03"]) {
  for (let c = 1; c <= 20; c++) {
    current.push({ fromId: w, toId: `C${String(c).padStart(3, "0")}`, distance: 100 + c, estimated: w === "WH02" && c === 5 });
  }
}
// Saved state: the last row is new (unsaved) and the second-to-last differs → both "Changed".
const saved = current.slice(0, 59).map((o, i) => (i === 58 ? { ...o, distance: 1 } : o));
const warehouseIds = ["WH01", "WH02"];
const customerIds = Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(3, "0")}`);

const savedByKey = new Map(saved.map(o => [`${o.fromId}|${o.toId}`, o]));
const isChanged = (r: MergedRow) => {
  const s = savedByKey.get(`${r.fromId}|${r.toId}`);
  if (!s && !r.override) return false;
  if (!s || !r.override) return true;
  return s.distance !== r.override.distance;
};

// The adapter: columns + literal testid map reproducing DistancesTab.tsx:733-856.
const columns: ColumnDef<MergedRow>[] = [
  {
    id: "from",
    header: "From",
    kind: "text",
    filter: "text",
    value: r => r.fromId,
    cellClassName: "text-xs",
    cell: r => (
      <div className="flex items-center gap-1">
        <EntityIdCell entityId={r.fromId} displayId={r.fromId} />
        {!warehouseIds.includes(r.fromId) && (
          <span data-testid={`warning-unknown-from-${r.fromId}-${r.toId}`}>
            <AlertTriangle className="w-3 h-3 text-amber-600" />
          </span>
        )}
      </div>
    ),
  },
  {
    id: "to",
    header: "To",
    kind: "text",
    filter: "text",
    value: r => r.toId,
    cellClassName: "text-xs",
    cell: r => (
      <div className="flex items-center gap-1">
        <EntityIdCell entityId={r.toId} displayId={r.toId} />
        {!customerIds.includes(r.toId) && (
          <span data-testid={`warning-unknown-to-${r.fromId}-${r.toId}`}>
            <AlertTriangle className="w-3 h-3 text-amber-600" />
          </span>
        )}
      </div>
    ),
  },
  { id: "base", header: "Base (mi)", kind: "number", value: r => r.base, cellClassName: "font-mono text-xs", cell: r => r.base ?? "—" },
  {
    id: "override",
    header: "Override (mi)",
    kind: "number",
    value: r => r.override?.distance ?? null,
    cell: r => (
      <div className="flex items-center gap-1.5">
        <input readOnly value={r.override?.distance ?? ""} data-testid={`input-distance-${r.fromId}-${r.toId}`} />
        {r.override?.estimated && <span data-testid={`badge-distance-estimated-${r.fromId}-${r.toId}`}>Estimated</span>}
        {isChanged(r) && <span data-testid={`badge-distance-changed-${r.fromId}-${r.toId}`}>Changed</span>}
      </div>
    ),
  },
  {
    id: "remove",
    header: "",
    kind: "text",
    filter: false,
    value: () => null,
    cell: r =>
      (r.override || r.base == null) && (
        <button type="button" data-testid={`button-remove-distance-${r.fromId}-${r.toId}`}>
          <X className="w-3.5 h-3.5" />
        </button>
      ),
  },
];

const testIds: DataTableTestIds<MergedRow> = {
  root: "distances-tab",
  toolbar: "distances-tab-toolbar",
  row: r => `row-distance-${r.fromId}-${r.toId}`,
  pagerPrev: "button-distances-prev",
  pagerNext: "button-distances-next",
  pageIndicator: "distances-page-indicator",
  empty: "distances-tab-empty",
};

// Today's row order: base pairs, then added (here: no reference matrix → all rows are "added").
const rows: MergedRow[] = current.map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o }));

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

/** Every data-testid at or under `root`, sorted (a multiset: duplicates are kept). */
function allTestIds(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll("[data-testid]"))]
    .map(el => el.getAttribute("data-testid"))
    .filter((id): id is string => id !== null)
    .sort();
}

/** The real set after B2.2's two deliberate changes. */
function expectedFromReal(realIds: string[], filterShown: boolean): string[] {
  const kept = realIds.filter(id => id !== "input-filter-from" && id !== "input-filter-to");
  return (filterShown ? [...kept, "button-filter-menu-trigger"] : kept).sort();
}

const EMPTY_TEXT = "No distance overrides yet — add one below, or upload a CSV/JSON file.";

function Replica({ data, ids = testIds }: { data: MergedRow[]; ids?: DataTableTestIds<MergedRow> }) {
  return (
    <DataTable<MergedRow>
      rows={data}
      rowKey={r => `${r.fromId}|${r.toId}`}
      columns={columns}
      testIds={ids}
      ctx={{ readOnly: false, demandEditable: true, isChanged }}
      rowClassName={(r, ctx) => (ctx.isChanged(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={EMPTY_TEXT}
      toolbar={{
        download: (
          <>
            <button type="button" data-testid="button-export-distances-csv">CSV</button>
            <button type="button" data-testid="button-export-distances-json">JSON</button>
          </>
        ),
        upload: <button type="button" data-testid="button-import-distances">Upload</button>,
      }}
      footer={<button type="button" data-testid="button-add-distance-row">+ Add row</button>}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderReal(overrides: DistanceOverride[], savedOverrides: DistanceOverride[]) {
  const real = render(
    <DistancesTab
      distanceOverrides={overrides}
      savedDistanceOverrides={savedOverrides}
      warehouseIds={warehouseIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
    />,
    { wrapper: Providers },
  );
  return { real, realRoot: real.getByTestId("distances-tab") };
}

describe("DataTable reproduces DistancesTab's testid map (P1 replica harness)", () => {
  function measureReal() {
    const { real, realRoot } = renderReal(current, saved);
    const page1 = allTestIds(realRoot);
    const headers = within(realRoot).getAllByRole("columnheader").map(th => th.textContent);
    const rowClasses = within(realRoot)
      .getAllByTestId(/^row-distance-/)
      .map(tr => [tr.getAttribute("data-testid"), tr.className.includes("bg-amber-50")]);
    fireEvent.click(within(realRoot).getByTestId("button-distances-next"));
    const page2 = allTestIds(realRoot);
    real.unmount();
    return { page1, page2, headers, rowClasses };
  }

  it("emits the identical complete testid set under the root, on page 1 and page 2", () => {
    const real = measureReal();
    // Non-vacuity: 50 rows × (row + input + remove) = 150, plus warnings, badges, toolbar and pager.
    expect(real.page1.length).toBeGreaterThan(150);
    expect(real.page1).toEqual(expect.arrayContaining(["distances-tab", "distances-tab-toolbar", "button-add-distance-row"]));
    expect(real.page2).toContain("badge-distance-changed-WH03-C020");
    const { getByTestId } = render(<Replica data={rows} />);
    const replicaRoot = getByTestId("distances-tab");
    expect(allTestIds(replicaRoot)).toEqual(expectedFromReal(real.page1, true));
    fireEvent.click(within(replicaRoot).getByTestId("button-distances-next"));
    expect(allTestIds(replicaRoot)).toEqual(expectedFromReal(real.page2, true));
  });

  it("the filter trigger is the REPLICA's own, inside its toolbar", () => {
    const { getByTestId } = render(<Replica data={rows} />);
    const toolbar = within(getByTestId("distances-tab")).getByTestId("distances-tab-toolbar");
    expect(within(toolbar).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(within(getByTestId("distances-tab")).getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
  });

  it("empty state: identical complete testid set (no filter trigger at 0 rows)", () => {
    const { real, realRoot } = renderReal([], []);
    const realEmpty = allTestIds(realRoot);
    real.unmount();
    expect(realEmpty).toContain("distances-tab-empty");
    const { getByTestId } = render(<Replica data={[]} />);
    expect(allTestIds(getByTestId("distances-tab"))).toEqual(expectedFromReal(realEmpty, false));
    expect(screen.getByTestId("distances-tab-empty")).toHaveTextContent("No distance overrides yet");
  });

  it("renders the same headers in the same order", () => {
    const real = measureReal();
    const { getByTestId } = render(<Replica data={rows} />);
    expect(within(getByTestId("distances-tab")).getAllByRole("columnheader").map(th => th.textContent)).toEqual(real.headers);
  });

  it("renders the same rows in the same order with the same amber 'changed' highlighting", () => {
    const real = measureReal();
    const { getByTestId } = render(<Replica data={rows} />);
    const replicaRowClasses = within(getByTestId("distances-tab"))
      .getAllByTestId(/^row-distance-/)
      .map(tr => [tr.getAttribute("data-testid"), tr.className.includes("bg-amber-50")]);
    expect(replicaRowClasses).toEqual(real.rowClasses);
  });

  // Deliberate breaks: each wrong mapping must make the complete-set comparison fail.
  it.each<[string, DataTableTestIds<MergedRow>]>([
    ["root", { ...testIds, root: "distances-tab-x" }],
    ["toolbar", { ...testIds, toolbar: "distances-tab-toolbar-x" }],
    ["filter trigger", { ...testIds, filterTrigger: "button-filter-x" }],
    ["table (an id the real table does not emit)", { ...testIds, table: "distances-table" }],
    ["row", { ...testIds, row: r => `row-dist-${r.fromId}-${r.toId}` }],
  ])("a wrong %s mapping is detected", (_name, broken) => {
    const real = measureReal();
    const { container } = render(<Replica data={rows} ids={broken} />);
    const replicaRoot = container.firstElementChild as HTMLElement;
    expect(allTestIds(replicaRoot)).not.toEqual(expectedFromReal(real.page1, true));
  });
});
