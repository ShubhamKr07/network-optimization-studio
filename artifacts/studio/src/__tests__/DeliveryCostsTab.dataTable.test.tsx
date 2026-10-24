// SCU-2.P4.7 — DeliveryCostsTab (delivery-teaching-us) on the shared
// DataTable with the sparse `deliveryCosts` Upload ▾ / Download ▾ (B2.3,
// B2.4, B2.7), the pager only above 50 rows (was always on), override-present
// amber, centred numbers and history read-only (D2).

import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";

const mockUseGetReferenceCosts = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetReferenceCosts: (...args: unknown[]) => mockUseGetReferenceCosts(...args),
  getGetReferenceCostsQueryKey: vi.fn((id: string) => ["reference-costs", id]),
}));
const downloadEntityExport = vi.fn();
vi.mock("@/lib/exportEntity", () => ({ downloadEntityExport: (...a: unknown[]) => downloadEntityExport(...a) }));
vi.mock("@/components/ImportDialog", () => ({
  ImportDialog: (p: { entity: string; format: string }) => (
    <div data-testid="stub-import-dialog" data-entity={p.entity} data-format={p.format} />
  ),
}));

import { DeliveryCostsTab } from "@/components/workspace/tabs/DeliveryCostsTab";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

function pairs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    fromId: `W${(i % 33) + 1}`,
    fromCode: "",
    toId: `C${i + 1}`,
    toCode: "",
    cost: 10 + i,
  }));
}

beforeEach(() => {
  mockUseGetReferenceCosts.mockReset();
  downloadEntityExport.mockReset();
  mockUseGetReferenceCosts.mockReturnValue({ data: { pairs: pairs(12), distanceUnit: "mi" }, isLoading: false, isError: false });
});

const renderTab = (props: Partial<React.ComponentProps<typeof DeliveryCostsTab>> = {}) =>
  render(
    <DeliveryCostsTab
      laneCostOverrides={[{ fromId: "W1", toId: "C1", cost: 99 }]}
      onChange={vi.fn()}
      modelId="delivery-teaching-us"
      scenarioId={3}
      {...props}
    />,
    { wrapper: AllProviders },
  );

describe("DeliveryCostsTab on DataTable (SCU-2.P4.7)", () => {
  it("emits every testid in the matrix map, plus the deliveryCosts menus", () => {
    renderTab();
    for (const id of [
      "delivery-costs-tab",
      "delivery-costs-tab-toolbar",
      "button-import-deliverycosts",
      "button-download-deliverycosts",
      "button-filter-menu-trigger",
      "row-deliverycost-W1-C1",
      "input-deliverycost-W1-C1",
      "badge-deliverycost-overridden-W1-C1",
      "button-remove-deliverycost-W1-C1",
      "button-add-deliverycost-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("Download ▾ exports the deliveryCosts entity; Upload ▾ opens the dialog for it", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-download-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-export-deliverycosts-json"));
    // billable miles: no unit= is sent for deliveryCosts (B2.7, D1)
    expect(downloadEntityExport).toHaveBeenCalledWith(1, "deliveryCosts", "json", { unit: undefined, runId: undefined });
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-csv"));
    expect(screen.getByTestId("stub-import-dialog")).toHaveAttribute("data-entity", "deliveryCosts");
  });

  it("the pager is hidden at ≤ 50 rows and shown above 50 (it was always on)", () => {
    const { unmount } = renderTab();
    expect(screen.queryByTestId("delivery-costs-page-indicator")).toBeNull();
    unmount();
    mockUseGetReferenceCosts.mockReturnValue({
      data: { pairs: pairs(51), distanceUnit: "mi" },
      isLoading: false,
      isError: false,
    });
    renderTab();
    expect(screen.getByTestId("delivery-costs-page-indicator")).toHaveTextContent("Page 1 of 2");
  });

  it("loading / error states keep their testids", () => {
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = renderTab();
    expect(screen.getByTestId("delivery-costs-tab-loading")).toHaveTextContent("Loading cost data");
    unmount();
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderTab();
    expect(screen.getByTestId("delivery-costs-tab-error")).toHaveTextContent("Failed to load cost data");
  });

  it("amber marks override-present rows; numbers centred", () => {
    renderTab();
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveClass("bg-warning-bg");
    expect(screen.getByTestId("row-deliverycost-W2-C2")).not.toHaveClass("bg-warning-bg");
    const headers = within(screen.getByTestId("delivery-costs-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From", "To", "Base", "Cost", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[3]).toHaveClass("text-center");
  });

  it("history read-only (D2): cost cells, remove and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toBeDisabled();
    expect(screen.getByTestId("input-deliverycost-W2-C2")).toBeDisabled();
    expect(screen.getByTestId("button-remove-deliverycost-W1-C1")).toBeDisabled();
    expect(screen.getByTestId("button-add-deliverycost-row")).toBeDisabled();
  });

  it("edit round-trip: a base row's cost becomes an override", () => {
    function Parent() {
      const [r, setR] = useState<LaneCostOverride[]>([]);
      return <DeliveryCostsTab laneCostOverrides={r} onChange={setR} modelId="delivery-teaching-us" />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-deliverycost-W2-C2"), { target: { value: "0" } });
    fireEvent.blur(screen.getByTestId("input-deliverycost-W2-C2"));
    expect(screen.getByTestId("badge-deliverycost-overridden-W2-C2")).toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W2-C2")).toHaveClass("bg-warning-bg");
  });
  it("an OPEN add-row form goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    for (const id of [
      "input-new-deliverycost-from",
      "input-new-deliverycost-to",
      "input-new-deliverycost-value",
      "button-add-deliverycost-confirm",
    ])
      expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <DeliveryCostsTab
        laneCostOverrides={[{ fromId: "W1", toId: "C1", cost: 99 }]}
        onChange={vi.fn()}
        modelId="delivery-teaching-us"
        scenarioId={3}
        readOnly
      />,
    );
    for (const id of [
      "input-new-deliverycost-from",
      "input-new-deliverycost-to",
      "input-new-deliverycost-value",
      "button-add-deliverycost-confirm",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    expect(screen.getByTestId("button-add-deliverycost-cancel")).toBeEnabled();
  });
});
