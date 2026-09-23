import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockToast, mockExportScenario } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockExportScenario: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));
vi.mock("@workspace/api-client-react", () => ({
  exportScenario: mockExportScenario,
}));

import { downloadEntityExport } from "@/lib/exportEntity";

// A9 (SCND correctness, §2.7.1/A8) — the 409 LEGACY_RESULT_REQUIRES_RESOLVE
// export rejection must surface a distinct "re-solve to export" resolve
// prompt, never the generic "Export failed" toast. Handled entity-agnostic
// (its exact firing scope across assignments/openWarehouses/costSummary/
// serviceStats/flows is a pending backend design decision per the task
// brief), so these tests exercise it against a couple of different entities
// rather than asserting a hardcoded allowlist.

beforeEach(() => {
  mockToast.mockClear();
  mockExportScenario.mockReset();
  // jsdom has no real Blob download plumbing under test — stub the parts
  // downloadEntityExport touches on its success path so a non-rejection
  // test doesn't crash on missing browser APIs.
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
});

function make409(code: string, error = "This result predates verified solve tracking."): { status: number; data: { code: string; error: string } } {
  return { status: 409, data: { code, error } };
}

describe("downloadEntityExport — 409 LEGACY_RESULT_REQUIRES_RESOLVE resolve prompt", () => {
  it("shows a distinct 're-solve to export' prompt, not the generic 'Export failed' toast, for a costSummary export", async () => {
    mockExportScenario.mockRejectedValue(make409("LEGACY_RESULT_REQUIRES_RESOLVE"));
    await downloadEntityExport(1, "costSummary", "csv");

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Re-solve to export" }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export failed" }),
    );
  });

  it("handles the SAME 409 code gracefully for a different output entity (assignments) — not hardcoded to one entity", async () => {
    mockExportScenario.mockRejectedValue(make409("LEGACY_RESULT_REQUIRES_RESOLVE"));
    await downloadEntityExport(1, "assignments", "json");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Re-solve to export" }),
    );
  });

  it("does NOT render as a destructive/error toast (variant) — it's a prompt, not a failure", async () => {
    mockExportScenario.mockRejectedValue(make409("LEGACY_RESULT_REQUIRES_RESOLVE"));
    await downloadEntityExport(1, "flows", "csv");

    const call = mockToast.mock.calls[0][0];
    expect(call.variant).not.toBe("destructive");
  });

  it("falls through to the generic 'Export failed' toast for a DIFFERENT 409 code (not the stable LEGACY_RESULT_REQUIRES_RESOLVE discriminator)", async () => {
    mockExportScenario.mockRejectedValue(make409("SOME_OTHER_CODE"));
    await downloadEntityExport(1, "costSummary", "csv");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export failed", variant: "destructive" }),
    );
  });

  it("falls through to the generic 'Export failed' toast for a plain network/other error (no status/data shape at all)", async () => {
    mockExportScenario.mockRejectedValue(new Error("Network error"));
    await downloadEntityExport(1, "costSummary", "csv");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export failed", variant: "destructive", description: "Network error" }),
    );
  });

  it("falls through to the generic toast for a 422 (unrelated error shape, same status-code family as export's other rejections)", async () => {
    mockExportScenario.mockRejectedValue({ status: 422, data: { error: "Invalid entity" } });
    await downloadEntityExport(1, "costSummary", "csv");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export failed" }),
    );
  });
});
