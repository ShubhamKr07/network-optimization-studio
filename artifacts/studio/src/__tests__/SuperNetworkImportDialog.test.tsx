import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toCsvFiles, toXlsx } from "@/lib/superFiles";
import { SUPER_NETWORK_MAX_BYTES } from "@workspace/import-schema";
import { SuperNetworkImportDialog } from "@/components/workspace/super/SuperNetworkImportDialog";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;
const scenario = { id: 1, name: "S", modelId: "super-model", inputs: { products: [] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderDialog(isEmpty: boolean) {
  const onApplied = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SuperNetworkImportDialog open onOpenChange={vi.fn()} scenarioId={1} isEmpty={isEmpty} onApplied={onApplied} />
    </QueryClientProvider>,
  );
  return { onApplied };
}
const upload2 = (name: string, content: string) => userEvent.upload(screen.getByTestId("super-import-file"), new File([content], name));
const upload = (content: string) => userEvent.upload(screen.getByTestId("super-import-file"), new File([content], "net.json", { type: "application/json" }));
const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/network/import"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).includes("/network/import")) return json({ scenario });
    throw new Error(`Unhandled fetch: ${String(input)}`);
  });
});

describe("SuperNetworkImportDialog", () => {
  it("merge posts the parsed file as the body to ?mode=merge and calls onApplied", async () => {
    const { onApplied } = renderDialog(false);
    await upload('{"products":[{"id":"p1"}]}');
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(scenario));
    const [url, init] = calls()[0];
    expect(String(url)).toMatch(/\/api\/scenarios\/1\/network\/import\?mode=merge$/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ products: [{ id: "p1" }] });
  });

  it("replace on a non-empty scenario asks for confirmation first", async () => {
    const { onApplied } = renderDialog(false);
    await upload("{}");
    await userEvent.click(screen.getByTestId("super-import-mode-replace"));
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    expect(screen.getByTestId("super-import-confirm-overwrite")).toHaveTextContent("replaces every table");
    expect(calls()).toHaveLength(0);
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(String(calls()[0][0])).toContain("mode=replace");
  });

  it("replace is the default on an empty scenario and needs no confirmation", async () => {
    const { onApplied } = renderDialog(true);
    await upload("{}");
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(String(calls()[0][0])).toContain("mode=replace");
  });

  it("reopening after a successful replace re-seeds the mode from the current isEmpty", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const ui = (open: boolean, isEmpty: boolean) => (
      <QueryClientProvider client={qc}>
        <SuperNetworkImportDialog open={open} onOpenChange={vi.fn()} scenarioId={1} isEmpty={isEmpty} onApplied={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(true, true));
    await upload("{}");
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(calls()).toHaveLength(1));
    rerender(ui(false, false));
    rerender(ui(true, false));
    expect(screen.getByTestId("super-import-mode-merge")).toBeChecked();
  });

  it("renders a 422 error text", async () => {
    fetchMock.mockImplementation(async () => json({ error: "customers[3]: unknown product p9" }, 422));
    renderDialog(true);
    await upload("{}");
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-import-error")).toHaveTextContent("unknown product p9"));
  });

  it("a non-JSON file shows a file error and posts nothing", async () => {
    renderDialog(true);
    await upload("not json {");
    expect(await screen.findByTestId("super-import-file-error")).toBeInTheDocument();
    expect(screen.getByTestId("super-import-confirm")).toBeDisabled();
    expect(calls()).toHaveLength(0);
  });

  const csvFile = (name: string, text: string) => new File([text], name, { type: "text/csv" });
  const posted = () => JSON.parse((calls()[0][1] as RequestInit).body as string);
  const uploadMany = (files: File[]) => userEvent.upload(screen.getByTestId("super-import-file"), files);

  it("SM2-5: a CSV set is parsed in the browser and posted as one JSON document", async () => {
    const doc = { products: [{ id: "k", name: "K" }], p: 2 };
    renderDialog(true);
    await uploadMany(toCsvFiles(doc).map(f => csvFile(f.name, f.text)));
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(calls()).toHaveLength(1));
    expect(posted()).toMatchObject(doc);
  });

  it("SM2-5: an XLSX workbook is parsed and posted", async () => {
    const buf = await toXlsx({ products: [{ id: "k", name: "K" }] });
    renderDialog(true);
    await uploadMany([new File([buf], "net.xlsx")]);
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(calls()).toHaveLength(1));
    expect(posted().products).toEqual([{ id: "k", name: "K" }]);
  });

  it("SM2-5: mixed kinds and parse errors are shown and nothing is posted", async () => {
    renderDialog(true);
    await uploadMany([csvFile("products.csv", "id,name\nk,K\n"), new File(["{}"], "n.json")]);
    await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("one .json file, one .xlsx workbook, or a set of .csv files"));
    await uploadMany([csvFile("plants.csv", "id,name,lat,lng\nA,P,north,2\n")]);
    await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("plants.csv row 2 column lat: is not a number"));
    expect(screen.getByTestId("super-import-confirm")).toBeDisabled();
    expect(calls()).toHaveLength(0);
  });

  it("SM2-5: a server 422 with issues is shown as file / row / column for a CSV import", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Demand row 1 …", issues: [{ path: ["demand", 0, "customerId"], message: 'Unknown customer "ghost"' }] }, 422));
    renderDialog(true);
    await uploadMany([csvFile("demand.csv", "customerId,productId,demand\nghost,k,1\n")]);
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-import-issues")).toHaveTextContent('demand.csv row 2 column customerId: Unknown customer "ghost"'));
  });

  it("SM2-5: a JSON import with a 422 keeps showing the error string", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Demand row 1 customer id is unknown.", issues: [{ path: ["demand", 0], message: "x" }] }, 422));
    renderDialog(true);
    await upload('{"demand":[]}');
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-import-error")).toHaveTextContent("Demand row 1 customer id is unknown."));
    expect(screen.queryByTestId("super-import-issues")).not.toBeInTheDocument();
  });

  it("SM2-5: the pre-POST size check uses SUPER_NETWORK_MAX_BYTES (4 MiB) at the exact boundary", async () => {
    const fill = (bytes: number) => JSON.stringify({ note: "x".repeat(bytes - '{"note":""}'.length) });
    expect(fill(SUPER_NETWORK_MAX_BYTES).length).toBe(SUPER_NETWORK_MAX_BYTES);
    renderDialog(true);
    await upload(fill(SUPER_NETWORK_MAX_BYTES + 1));
    await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("4 MB"));
    expect(screen.getByTestId("super-import-confirm")).toBeDisabled();
    await upload(fill(SUPER_NETWORK_MAX_BYTES));
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    expect(screen.queryByTestId("super-import-file-error")).not.toBeInTheDocument();
  });

  it("SM2-5: a server 413 shows the Super limit (4 MB), not the shared 2 MB message", async () => {
    fetchMock.mockImplementation(async () => json({ error: "payload_too_large" }, 413));
    renderDialog(true);
    await upload("{}");
    await userEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-import-error")).toHaveTextContent("4 MB"));
    expect(screen.getByTestId("super-import-error")).not.toHaveTextContent("2 MB");
  });

  describe("FileReader failures and races", () => {
    const RealFR = globalThis.FileReader;
    const gates = new Map<string, () => void>();
    afterEach(() => { globalThis.FileReader = RealFR; gates.clear(); });
    // Stub: "bad.*" errors; "slow.*" waits for gates.get(name)(); others read normally.
    function stubReader() {
      globalThis.FileReader = class {
        result: string | null = null; error = new Error("boom");
        onload: (() => void) | null = null; onerror: (() => void) | null = null;
        readAsText(f: File) {
          if (f.name.startsWith("bad")) return void queueMicrotask(() => this.onerror?.());
          const done = () => { const r = new RealFR(); r.onload = () => { this.result = r.result as string; this.onload?.(); }; r.readAsText(f); };
          if (f.name.startsWith("slow")) gates.set(f.name, done); else done();
        }
        readAsArrayBuffer() {}
      } as unknown as typeof FileReader;
    }
    it("SM2-5: a reader error shows 'Could not read the file.'", async () => {
      stubReader();
      renderDialog(true);
      await upload2("bad.json", "{}");
      await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("Could not read the file."));
    });
    it("SM2-5: the result of an older selection is dropped when it resolves last", async () => {
      stubReader();
      renderDialog(true);
      await upload2("slow.json", "not json {");        // first, slow, would show a parse error
      await upload2("fast.json", '{"products":[]}');   // second, valid
      await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
      gates.get("slow.json")!();
      await new Promise(r => setTimeout(r, 50));
      expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled();
      expect(screen.queryByTestId("super-import-file-error")).not.toBeInTheDocument();
    });
  });
});
