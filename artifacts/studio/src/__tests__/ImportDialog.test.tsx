import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportDialog } from "@/components/ImportDialog";
import type { ImportPreview, ImportApplyResult } from "@workspace/api-client-react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { toast } from "@/hooks/use-toast";
const mockToast = vi.mocked(toast);

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function mockFetchRoutes(preview: ImportPreview, apply?: ImportApplyResult) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/import")) return jsonResponse(preview);
    if (url.endsWith("/import/apply")) return jsonResponse(apply);
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof ImportDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const onApplied = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ImportDialog
        open
        onOpenChange={onOpenChange}
        scenarioId={1}
        entity="warehouses"
        onApplied={onApplied}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onOpenChange, onApplied };
}

function makeFile(content = "id,line\nCHI,2") {
  return new File([content], "warehouses.csv", { type: "text/csv" });
}

async function uploadFile() {
  const input = screen.getByTestId("input-import-file-warehouses");
  await userEvent.upload(input, makeFile());
}

beforeEach(() => {
  fetchMock.mockReset();
  mockToast.mockReset();
});

describe("ImportDialog", () => {
  it("shows all three error classes from a preview response", async () => {
    mockFetchRoutes({
      errors: [
        { errorClass: "format", line: null, message: "File is not keyed by warehouse ID" },
        { errorClass: "syntax", line: 4, message: "Wrong number of columns" },
        { errorClass: "logic", line: 7, message: "Unknown warehouse id ZZZ" },
      ],
      changes: [],
      warnings: [],
    });
    renderDialog();

    await uploadFile();

    await waitFor(() => expect(screen.getByText("Errors (3)")).toBeInTheDocument());
    expect(screen.getByText("format")).toBeInTheDocument();
    expect(screen.getByText("syntax")).toBeInTheDocument();
    expect(screen.getByText("logic")).toBeInTheDocument();
    expect(screen.getByText("File is not keyed by warehouse ID")).toBeInTheDocument();
    expect(screen.getByText("Wrong number of columns")).toBeInTheDocument();
    expect(screen.getByText("Unknown warehouse id ZZZ")).toBeInTheDocument();
  });

  it("shows changes when the preview has no errors", async () => {
    mockFetchRoutes({
      errors: [],
      changes: [{ id: "CHI", line: 2, before: { capacity: 1000 }, after: { capacity: 2000 } }],
      warnings: [],
    });
    renderDialog();

    await uploadFile();

    await waitFor(() => expect(screen.getByText("Changes (1)")).toBeInTheDocument());
    expect(screen.queryByText(/Errors \(/)).not.toBeInTheDocument();
    expect(screen.getByTestId("import-change-row-0")).toBeInTheDocument();
  });

  it("confirm applies the import, shows a success toast, and calls onApplied", async () => {
    const updatedScenario = { id: 1, name: "Scenario", modelId: "p-median-us", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    mockFetchRoutes(
      { errors: [], changes: [{ id: "CHI", line: 2, before: { capacity: 1000 }, after: { capacity: 2000 } }], warnings: [] },
      { applied: 1, errors: [], scenario: updatedScenario as any }
    );
    const { onOpenChange, onApplied } = renderDialog();

    await uploadFile();
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(updatedScenario));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Import applied" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancel closes the dialog without ever calling the apply endpoint", async () => {
    const { onOpenChange } = renderDialog();

    await userEvent.click(screen.getByTestId("button-import-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in `enableFilters`, wired
// into the Errors and Changes preview grids as TWO SEPARATE tables, each
// shown/hidden by its OWN unfiltered row count (>10).
function manyErrors(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    errorClass: (i % 2 === 0 ? "logic" : "syntax") as "logic" | "syntax",
    line: i + 1,
    message: `Row ${i + 1} is bad`,
  }));
}
function manyChanges(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ID${i + 1}`,
    line: i + 1,
    before: { x: i },
    after: { x: i + 1 },
  }));
}

describe("ImportDialog — enableFilters (B7, opt-in shared FilterMenu, independent Errors/Changes thresholds)", () => {
  it("omitting enableFilters never renders a FilterMenu, even with >10 errors and >10 changes", async () => {
    mockFetchRoutes({ errors: manyErrors(12), changes: manyChanges(12), warnings: [] });
    renderDialog();
    await uploadFile();
    await waitFor(() => expect(screen.getByText("Errors (12)")).toBeInTheDocument());
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("enableFilters=true: Errors grid shows its own FilterMenu when >10 unfiltered errors, while Changes stays hidden at <=10", async () => {
    mockFetchRoutes({ errors: manyErrors(11), changes: manyChanges(5), warnings: [] });
    renderDialog({ enableFilters: true });
    await uploadFile();
    await waitFor(() => expect(screen.getByText("Errors (11)")).toBeInTheDocument());

    const errorsSection = screen.getByTestId("import-errors-section");
    const changesSection = screen.getByTestId("import-changes-section");
    expect(within(errorsSection).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(within(changesSection).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("enableFilters=true: Changes grid shows its own FilterMenu when >10 unfiltered changes, while Errors stays hidden at <=10 (independent thresholds, reverse case)", async () => {
    mockFetchRoutes({ errors: manyErrors(3), changes: manyChanges(11), warnings: [] });
    renderDialog({ enableFilters: true });
    await uploadFile();
    await waitFor(() => expect(screen.getByText("Changes (11)")).toBeInTheDocument());

    const errorsSection = screen.getByTestId("import-errors-section");
    const changesSection = screen.getByTestId("import-changes-section");
    expect(within(errorsSection).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    expect(within(changesSection).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });

  it("enableFilters=true: filtering the Errors grid narrows its rows without touching the Changes grid", async () => {
    mockFetchRoutes({ errors: manyErrors(11), changes: manyChanges(11), warnings: [] });
    renderDialog({ enableFilters: true });
    await uploadFile();
    await waitFor(() => expect(screen.getByText("Errors (11)")).toBeInTheDocument());

    const errorsSection = screen.getByTestId("import-errors-section");
    const changesSection = screen.getByTestId("import-changes-section");
    expect(within(changesSection).getAllByTestId(/^import-change-row-/).length).toBe(11);

    const user = userEvent.setup();
    await user.click(within(errorsSection).getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-message"), "Row 1 is bad");

    expect(within(errorsSection).getAllByTestId(/^import-error-row-/).length).toBe(1);
    // Changes grid is completely untouched by the Errors grid's own filter.
    expect(within(changesSection).getAllByTestId(/^import-change-row-/).length).toBe(11);
  });
});
