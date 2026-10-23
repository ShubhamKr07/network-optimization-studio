import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
});
