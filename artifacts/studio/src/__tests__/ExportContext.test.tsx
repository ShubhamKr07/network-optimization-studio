import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  ExportProvider,
  useExport,
  INPUT_ENTITIES,
  RESULT_ENTITIES,
  type ExportProviderValue,
} from "@/contexts/ExportContext";
import { exportProviderWrapper } from "@/__tests__/helpers/renderWithExportProvider";
import type { ExportEntity } from "@/lib/exportEntity";

// SCN chen-bands-units, Task 11b. Context-only coverage — nothing here
// exercises a real button/tab, since T11b has zero consumers by design.
// State is injected via `ExportProviderValue`; only the context's own
// behavior (disabledReasonFor / download's hard guard / unit+runId
// forwarding) is under test.

vi.mock("@/lib/exportEntity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/exportEntity")>("@/lib/exportEntity");
  return {
    ...actual,
    downloadEntityExport: vi.fn().mockResolvedValue(undefined),
  };
});

import { downloadEntityExport } from "@/lib/exportEntity";

const mockedDownload = vi.mocked(downloadEntityExport);

beforeEach(() => {
  mockedDownload.mockClear();
});

describe("INPUT_ENTITIES / RESULT_ENTITIES partition", () => {
  it("are disjoint and duplicate-free", () => {
    const all = [...INPUT_ENTITIES, ...RESULT_ENTITIES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("useExport", () => {
  it("throws when used without an ExportProvider ancestor", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useExport())).toThrow(/ExportProvider/);
    spy.mockRestore();
  });

  it("the hook result is a complete ExportApi: state plus disabledReasonFor plus download", () => {
    const { result } = renderHook(() => useExport(), {
      wrapper: exportProviderWrapper({ scenarioId: 42, unit: "km", runId: 7 }),
    });
    expect(result.current.scenarioId).toBe(42);
    expect(result.current.unit).toBe("km");
    expect(result.current.runId).toBe(7);
    expect(typeof result.current.disabledReasonFor).toBe("function");
    expect(typeof result.current.download).toBe("function");
  });

  describe("disabledReasonFor", () => {
    it("routes a RESULT entity to resultDisabledReason", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 1,
          unit: "mi",
          resultDisabledReason: "No solved result for this run",
          inputDisabledReason: "Historical inputs unavailable",
        }),
      });
      expect(result.current.disabledReasonFor("assignments")).toBe("No solved result for this run");
      expect(result.current.disabledReasonFor("openWarehouses")).toBe("No solved result for this run");
      expect(result.current.disabledReasonFor("costSummary")).toBe("No solved result for this run");
      expect(result.current.disabledReasonFor("serviceStats")).toBe("No solved result for this run");
      expect(result.current.disabledReasonFor("flows")).toBe("No solved result for this run");
    });

    it("routes an INPUT entity to inputDisabledReason", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 1,
          unit: "mi",
          resultDisabledReason: "No solved result for this run",
          inputDisabledReason: "Historical inputs unavailable",
        }),
      });
      expect(result.current.disabledReasonFor("warehouses")).toBe("Historical inputs unavailable");
      expect(result.current.disabledReasonFor("distances")).toBe("Historical inputs unavailable");
      expect(result.current.disabledReasonFor("plantCapabilities")).toBe("Historical inputs unavailable");
    });

    it("returns undefined for both families when neither reason is set (the live/current-run case)", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 1, unit: "mi" }),
      });
      expect(result.current.disabledReasonFor("warehouses")).toBeUndefined();
      expect(result.current.disabledReasonFor("assignments")).toBeUndefined();
    });

    it("reports the unresolved reason ahead of either family when scenarioId is null", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: null,
          unit: "mi",
          resultDisabledReason: "should not surface",
          inputDisabledReason: "should not surface either",
        }),
      });
      expect(result.current.disabledReasonFor("warehouses")).toBe("Loading…");
      expect(result.current.disabledReasonFor("assignments")).toBe("Loading…");
    });

    it("reports the unresolved reason ahead of either family when unit is null", () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 1,
          unit: null,
          resultDisabledReason: "should not surface",
          inputDisabledReason: "should not surface either",
        }),
      });
      expect(result.current.disabledReasonFor("warehouses")).toBe("Loading…");
      expect(result.current.disabledReasonFor("assignments")).toBe("Loading…");
    });
  });

  describe("download", () => {
    const cases: Array<{ entity: ExportEntity; family: "input" | "result" }> = [
      { entity: "distances", family: "input" },
      { entity: "warehouses", family: "input" },
      { entity: "assignments", family: "result" },
    ];

    it.each(cases)("appends unit= for $entity ($family entity) for every injected resolved unit", async ({ entity }) => {
      for (const unit of ["km", "mi"] as const) {
        mockedDownload.mockClear();
        const { result } = renderHook(() => useExport(), {
          wrapper: exportProviderWrapper({ scenarioId: 5, unit }),
        });
        await act(async () => {
          await result.current.download(entity, "csv");
        });
        expect(mockedDownload).toHaveBeenCalledTimes(1);
        expect(mockedDownload).toHaveBeenCalledWith(5, entity, "csv", { unit, runId: undefined });
      }
    });

    it("forwards runId to the helper when injected", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 5, unit: "mi", runId: 12 }),
      });
      await act(async () => {
        await result.current.download("warehouses", "json");
      });
      expect(mockedDownload).toHaveBeenCalledWith(5, "warehouses", "json", { unit: "mi", runId: 12 });
    });

    it("omits runId when it is not injected (undefined, not a made-up default)", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 5, unit: "mi" }),
      });
      await act(async () => {
        await result.current.download("warehouses", "json");
      });
      expect(mockedDownload).toHaveBeenCalledWith(5, "warehouses", "json", { unit: "mi", runId: undefined });
    });

    it("refuses to fire when scenarioId is null", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: null, unit: "mi" }),
      });
      await act(async () => {
        await result.current.download("warehouses", "csv");
      });
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it("refuses to fire when unit is null", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({ scenarioId: 5, unit: null }),
      });
      await act(async () => {
        await result.current.download("warehouses", "csv");
      });
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it("refuses to fire when the entity is disabled (result entity, resultDisabledReason set)", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 5,
          unit: "mi",
          resultDisabledReason: "unaddressable historical entry",
        }),
      });
      await act(async () => {
        await result.current.download("assignments", "csv");
      });
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it("refuses to fire when the entity is disabled (input entity, inputDisabledReason set)", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 5,
          unit: "mi",
          inputDisabledReason: "historical entry",
        }),
      });
      await act(async () => {
        await result.current.download("distances", "csv");
      });
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it("still fires a RESULT entity when only inputDisabledReason is set (families are independent)", async () => {
      const { result } = renderHook(() => useExport(), {
        wrapper: exportProviderWrapper({
          scenarioId: 5,
          unit: "mi",
          inputDisabledReason: "historical entry",
        }),
      });
      await act(async () => {
        await result.current.download("assignments", "csv");
      });
      expect(mockedDownload).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ExportProvider", () => {
  it("supplies the exact injected value through the context (a plain pass-through)", () => {
    const value: ExportProviderValue = { scenarioId: 9, unit: "km", runId: 3 };
    const { result } = renderHook(() => useExport(), {
      wrapper: ({ children }) => <ExportProvider value={value}>{children}</ExportProvider>,
    });
    expect(result.current.scenarioId).toBe(9);
    expect(result.current.unit).toBe("km");
    expect(result.current.runId).toBe(3);
  });
});
