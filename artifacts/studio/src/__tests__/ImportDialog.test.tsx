import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import * as xlsxFile from "@/lib/xlsxFile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportDialog } from "@/components/ImportDialog";
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";
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

// WF-3 gap fix — the preview and apply mutations both used to render
// `error.message` straight to the student, which is custom-fetch.ts's
// `buildErrorMessage` output: "HTTP 422 Unprocessable Content: <the clean
// sentence WF-1's server-side formatter just built>". Both must route
// through describeWriteError instead, same as every Workspace.tsx site.
function errorResponse(body: unknown, status = 422, statusText = "Unprocessable Content") {
  return new Response(JSON.stringify(body), { status, statusText, headers: { "content-type": "application/json" } });
}

describe("ImportDialog — write-failure messages (WF-3 gap fix)", () => {
  it("shows the server's clean sentence, not the raw HTTP-prefixed dump, when the preview request 422s", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return errorResponse({ error: "Column 'id' is required." });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    renderDialog();

    await uploadFile();

    await waitFor(() => expect(screen.getByTestId("import-preview-error")).toBeInTheDocument());
    expect(screen.getByTestId("import-preview-error")).toHaveTextContent("Column 'id' is required.");
    expect(screen.getByTestId("import-preview-error").textContent).not.toMatch(/HTTP 422/);
  });

  it("shows the server's clean sentence, not the raw HTTP-prefixed dump, when the apply request 422s", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) {
        return jsonResponse({ errors: [], changes: [{ id: "CHI", line: 2, before: {}, after: {} }], warnings: [] });
      }
      if (url.endsWith("/import/apply")) return errorResponse({ error: "The scenario was modified by someone else." });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    renderDialog();

    await uploadFile();
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(screen.getByTestId("import-apply-error")).toBeInTheDocument());
    expect(screen.getByTestId("import-apply-error")).toHaveTextContent("The scenario was modified by someone else.");
    expect(screen.getByTestId("import-apply-error").textContent).not.toMatch(/HTTP 422/);
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

describe("ImportDialog — JSON format and the 2 MB limit (SCU-2.P2.2)", () => {
  const document = {
    templateVersion: 1,
    entity: "warehouses",
    rows: [{ templateVersion: 1, id: "ATL", displayCode: null, city: "Atlanta", state: "GA", lat: 33.75, lng: -84.39, capacity: null, status: "forced_open", overridden: true }],
  };
  const sentBody = (call = 0) => JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
  const LIMIT = "File is larger than the 2 MB import limit.";

  it("csv (default) keeps accept=.csv and still sends { entity, csvText } with no format key", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog();
    expect(screen.getByTestId("input-import-file-warehouses")).toHaveAttribute("accept", ".csv,text/csv");
    await uploadFile();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", csvText: "id,line\nCHI,2" });
  });

  it("json sends { entity, format: 'json', document } and re-sends it with the mode on apply", async () => {
    mockFetchRoutes(
      { errors: [], changes: [{ id: "ATL", line: 2, rowIndex: 0, before: { status: "active", value: null }, after: { status: "forced_open", value: null } }], warnings: [] },
      { applied: 1, errors: [] },
    );
    renderDialog({ format: "json" });
    const input = screen.getByTestId("input-import-file-warehouses");
    expect(input).toHaveAttribute("accept", ".json,application/json");
    await userEvent.upload(input, new File([JSON.stringify(document)], "warehouses.json", { type: "application/json" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(0)).toEqual({ entity: "warehouses", format: "json", document });
    await userEvent.click(await screen.findByTestId("button-import-confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(1)).toEqual({ entity: "warehouses", format: "json", document, mode: "all_or_nothing" });
  });

  it("a file that is not a JSON document is rejected before any request", async () => {
    renderDialog({ format: "json" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), new File(["{not json"], "bad.json", { type: "application/json" }));
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent("not a valid import document");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the check is on the serialized request BODY: a CSV just under 2 MiB whose body exceeds the wire limit is refused before sending", async () => {
    renderDialog();
    const file = new File(["x".repeat(MAX_IMPORT_BYTES - 10)], "big.csv", { type: "text/csv" });
    expect(file.size).toBeLessThan(MAX_IMPORT_BYTES);
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent(LIMIT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a pretty-printed JSON file over 2 MiB whose compact body fits is sent", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog({ format: "json" });
    const padded = JSON.stringify(document) + " ".repeat(MAX_IMPORT_BYTES); // trailing whitespace is valid JSON
    const file = new File([padded], "pretty.json", { type: "application/json" });
    expect(file.size).toBeGreaterThan(MAX_IMPORT_BYTES);
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", format: "json", document });
  });

  it("a server 413 shows the limit sentence, never the raw code", async () => {
    fetchMock.mockImplementation(async () => errorResponse({ error: "payload_too_large" }, 413, "Payload Too Large"));
    renderDialog();
    await uploadFile();
    const shown = await screen.findByTestId("import-preview-error");
    expect(shown).toHaveTextContent(LIMIT);
    expect(shown).not.toHaveTextContent("payload_too_large");
  });

  it("JSON errors and changes show their row index", async () => {
    mockFetchRoutes({
      errors: [{ errorClass: "syntax", line: null, rowIndex: 3, field: "bogus", message: 'Unknown field "bogus".' }],
      changes: [{ id: "ATL", line: 3, rowIndex: 1, before: { status: "active", value: null }, after: { status: "forced_open", value: null } }],
      warnings: [],
    });
    renderDialog({ format: "json" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), new File([JSON.stringify(document)], "w.json", { type: "application/json" }));
    expect(await screen.findByTestId("import-error-row-0")).toHaveTextContent("row 4");
    expect(screen.getByTestId("import-change-row-0")).toHaveTextContent("row 2");
  });
});

describe("ImportDialog — XLSX (QFX-2a: first sheet -> CSV text, unchanged CSV import path)", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const sentBody = (call = 0) => JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
  const wbFile = (sheets: Record<string, (string | number)[][]>) => {
    const wb = XLSX.utils.book_new();
    for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
    return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "warehouses.xlsx", { type: XLSX_MIME });
  };

  it("accepts .xlsx and sends the FIRST sheet as { entity, csvText } — no format key, sheet name ignored", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    renderDialog({ format: "xlsx" });
    const input = screen.getByTestId("input-import-file-warehouses");
    expect(input).toHaveAttribute("accept", `.xlsx,${XLSX_MIME}`);
    await userEvent.upload(input, wbFile({ Sheet9: [["id", "line"], ["CHI", 2]], other: [["x"], ["y"]] }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ entity: "warehouses", csvText: "id,line\nCHI,2" });
  });

  it("QFX-R1: the result of an older selection is dropped when it resolves last", async () => {
    mockFetchRoutes({ errors: [], changes: [], warnings: [] });
    let releaseSlow!: () => void;
    const spy = vi.spyOn(xlsxFile, "xlsxFileToCsvText").mockImplementation(async f => {
      if (f.name === "slow.xlsx") {
        await new Promise<void>(r => { releaseSlow = r; });
        return { ok: false, message: "SLOW ERROR" };
      }
      return { ok: true, csvText: "id\nCHI" };
    });
    renderDialog({ format: "xlsx" });
    const input = screen.getByTestId("input-import-file-warehouses");
    await userEvent.upload(input, new File(["x"], "slow.xlsx"));
    await userEvent.upload(input, new File(["x"], "fast.xlsx"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    releaseSlow();
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId("import-file-error")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("an empty first sheet is refused before any request", async () => {
    renderDialog({ format: "xlsx" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), wbFile({ s: [] }));
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent("The first sheet is empty.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
