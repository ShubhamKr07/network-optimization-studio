import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterMenu } from "./FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";

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
];

const descriptors: ColumnFilterDescriptor<Row>[] = [
  { key: "name", label: "Name", type: "text", accessor: r => r.name },
  { key: "status", label: "Status", type: "select", accessor: r => r.status },
  { key: "amount", label: "Amount", type: "number", accessor: r => r.amount },
];

// A thin harness wiring the real `useTableFilters` hook to `FilterMenu`,
// exactly the pattern a real `*Tab.tsx` caller would use.
function Harness() {
  const tableFilters = useTableFilters(rows, descriptors);
  return (
    <div>
      <FilterMenu descriptors={descriptors} tableFilters={tableFilters} />
      <div data-testid="visible-rows">{tableFilters.filteredRows.map(r => r.id).join(",")}</div>
    </div>
  );
}

async function openMenu() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByTestId("button-filter-menu-trigger"));
  return user;
}

describe("FilterMenu", () => {
  it("renders one control per descriptor, keyed by type", async () => {
    await openMenu();
    const popover = screen.getByTestId("filter-menu-popover");
    expect(within(popover).getByTestId("input-filter-name")).toBeInTheDocument(); // text
    expect(within(popover).getByTestId("select-filter-status")).toBeInTheDocument(); // select
    expect(within(popover).getByTestId("input-filter-amount-min")).toBeInTheDocument(); // number
    expect(within(popover).getByTestId("input-filter-amount-max")).toBeInTheDocument();
  });

  it("shows a distinct-value checkbox per select option, derived from unfiltered rows", async () => {
    await openMenu();
    const popover = screen.getByTestId("filter-menu-popover");
    expect(within(popover).getByTestId("option-filter-status-open")).toBeInTheDocument();
    expect(within(popover).getByTestId("option-filter-status-closed")).toBeInTheDocument();
  });

  it("shows the initial count line as 'N of N'", async () => {
    await openMenu();
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("3 of 3");
  });

  it("typing into the text control narrows filteredRows and updates the count line", async () => {
    const user = await openMenu();
    await user.type(screen.getByTestId("input-filter-name"), "depot");
    expect(screen.getByTestId("visible-rows")).toHaveTextContent("3");
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("1 of 3");
  });

  it("checking a select option narrows filteredRows", async () => {
    const user = await openMenu();
    await user.click(screen.getByTestId("checkbox-filter-status-closed"));
    expect(screen.getByTestId("visible-rows")).toHaveTextContent("2");
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("1 of 3");
  });

  it("setting a number range narrows filteredRows", async () => {
    const user = await openMenu();
    await user.type(screen.getByTestId("input-filter-amount-min"), "150");
    expect(screen.getByTestId("visible-rows")).toHaveTextContent("2,3");
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("2 of 3");
  });

  it("a per-filter clear button removes just that filter", async () => {
    const user = await openMenu();
    await user.type(screen.getByTestId("input-filter-name"), "depot");
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("1 of 3");
    await user.click(screen.getByTestId("button-clear-filter-name"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("3 of 3");
    expect(screen.queryByTestId("button-clear-filter-name")).not.toBeInTheDocument();
  });

  it("clear-all resets every active filter and disables itself when nothing is active", async () => {
    const user = await openMenu();
    expect(screen.getByTestId("button-clear-all-filters")).toBeDisabled();

    await user.type(screen.getByTestId("input-filter-name"), "depot");
    await user.click(screen.getByTestId("checkbox-filter-status-open"));
    expect(screen.getByTestId("button-clear-all-filters")).not.toBeDisabled();

    await user.click(screen.getByTestId("button-clear-all-filters"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("3 of 3");
    expect(screen.getByTestId("button-clear-all-filters")).toBeDisabled();
  });

  it("shows an active-filter-count badge on the trigger once a filter is applied", async () => {
    const user = await openMenu();
    expect(screen.queryByTestId("text-filter-active-count")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("input-filter-name"), "depot");
    expect(screen.getByTestId("text-filter-active-count")).toHaveTextContent("1");
  });
});
