import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SuperReadinessPanel } from "@/components/workspace/super/SuperReadinessPanel";
import { toast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/clientCsv";
import { SUPER_SAMPLE_URL, SUPER_TEMPLATE_URL } from "@/lib/superNetwork";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/clientCsv", async orig => ({ ...(await orig<typeof import("@/lib/clientCsv")>()), downloadBlob: vi.fn() }));

describe("SuperReadinessPanel", () => {
  it("empty state: heading, import button, template and sample downloads", () => {
    const onImport = vi.fn();
    render(<SuperReadinessPanel isEmpty onImport={onImport} />);
    expect(screen.getByText("Import a network to get started")).toBeInTheDocument();
    expect(screen.getByTestId("super-download-template")).toHaveAttribute("href", SUPER_TEMPLATE_URL);
    expect(screen.getByTestId("super-download-sample")).toHaveAttribute("href", SUPER_SAMPLE_URL);
    expect(screen.getByTestId("super-download-sample")).toHaveAttribute("download");
    fireEvent.click(screen.getByTestId("super-open-import"));
    expect(onImport).toHaveBeenCalled();
  });

  it("lists each precheck error", () => {
    render(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={{ ok: false, errors: [{ code: "a", message: "No plants" }, { code: "b", message: "Zero demand" }] }} />);
    expect(screen.getByTestId("super-readiness-error-0")).toHaveTextContent("No plants");
    expect(screen.getByTestId("super-readiness-error-1")).toHaveTextContent("Zero demand");
    expect(screen.queryByTestId("super-readiness-ok")).not.toBeInTheDocument();
  });

  it("renders the road fetch action only when onFetchRoad is set", () => {
    const onFetchRoad = vi.fn();
    const pre = { ok: false, errors: [{ code: "roadDistancesMissing", message: "Road distances not fetched" }] };
    const { rerender } = render(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={pre} />);
    expect(screen.queryByTestId("super-readiness-fetch-road")).toBeNull();
    rerender(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={pre} onFetchRoad={onFetchRoad} />);
    fireEvent.click(screen.getByTestId("super-readiness-fetch-road"));
    expect(onFetchRoad).toHaveBeenCalled();
  });

  it("ready state", () => {
    render(<SuperReadinessPanel isEmpty={false} onImport={vi.fn()} precheck={{ ok: true, errors: [] }} />);
    expect(screen.getByTestId("super-readiness-ok")).toHaveTextContent("Ready to solve");
  });

  it("SM2-5: offers the template and sample as JSON, CSV zip and XLSX", () => {
    render(<SuperReadinessPanel isEmpty onImport={vi.fn()} />);
    for (const id of ["super-download-template", "super-download-sample", "super-download-template-csv", "super-download-template-xlsx", "super-download-sample-csv", "super-download-sample-xlsx"])
      expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it("SM2-5: the CSV sample download builds a zip from the JSON sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ products: [{ id: "k", name: "K" }] }))));
    render(<SuperReadinessPanel isEmpty onImport={vi.fn()} />);
    fireEvent.click(screen.getByTestId("super-download-sample-csv"));
    await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalledWith("super-model-sample.zip", expect.any(Uint8Array), "application/zip"));
    vi.unstubAllGlobals();
  });

  it("SM2-5: a failed template fetch shows a toast and downloads nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    vi.mocked(downloadBlob).mockClear();
    render(<SuperReadinessPanel isEmpty onImport={vi.fn()} />);
    fireEvent.click(screen.getByTestId("super-download-template-xlsx"));
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ title: "Download failed" })));
    expect(vi.mocked(downloadBlob)).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
