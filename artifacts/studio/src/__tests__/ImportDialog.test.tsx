import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
