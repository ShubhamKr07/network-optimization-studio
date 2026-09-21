import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { ExportProvider, type ExportProviderValue } from "@/contexts/ExportContext";
import { UnitProvider } from "@/contexts/UnitContext";

// SCN chen-bands-units, Task 11b — shared test helper. Task 14b's 26
// converted export controls (and Task 14's own provider-derivation tests)
// are expected to reuse this rather than each hand-rolling their own
// `ExportProvider` wrapper.

const DEFAULT_EXPORT_PROVIDER_VALUE: ExportProviderValue = {
  scenarioId: 1,
  unit: "mi",
};

export function makeExportProviderValue(overrides: Partial<ExportProviderValue> = {}): ExportProviderValue {
  return { ...DEFAULT_EXPORT_PROVIDER_VALUE, ...overrides };
}

/**
 * Both providers a converted export control needs, composed once.
 *
 * Task 14b's tabs call `useExport()` AND (via T11-T13) `useDisplayUnit()`, and
 * both hooks throw without their provider. Pass as RTL's `wrapper` **option**,
 * never as a wrapping JSX element — an element is silently dropped by
 * `rerender(...)`, which fails intermittently and confusingly.
 *
 *   rtlRender(ui, { wrapper: AllProviders, ...options })
 *
 * Tests needing a non-default export value (a disabled reason, a runId, an
 * unresolved unit) should wrap explicitly with `ExportProviderTestWrapper`
 * instead of using this default.
 */
export function AllProviders({ children }: { children: ReactNode }) {
  return (
    <UnitProvider>
      <ExportProvider value={makeExportProviderValue()}>{children}</ExportProvider>
    </UnitProvider>
  );
}

/** For `renderHook(fn, { wrapper: exportProviderWrapper({...}) })`. */
export function exportProviderWrapper(overrides: Partial<ExportProviderValue> = {}) {
  const value = makeExportProviderValue(overrides);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ExportProvider value={value}>{children}</ExportProvider>;
  };
}

/** For wrapping a rendered element directly, e.g. `render(<ExportProviderTestWrapper>...</ExportProviderTestWrapper>)`. */
export function ExportProviderTestWrapper({
  value,
  children,
}: {
  value?: Partial<ExportProviderValue>;
  children: ReactNode;
}) {
  return <ExportProvider value={makeExportProviderValue(value)}>{children}</ExportProvider>;
}

/**
 * `@testing-library/react`'s `render`, pre-wrapped in an `ExportProvider`.
 * The intended entry point for Task 14b's component tests (the 26
 * converted export controls) — `renderHook`-based tests should prefer
 * `exportProviderWrapper` above instead.
 */
export function renderWithExportProvider(
  ui: ReactElement,
  options?: {
    value?: Partial<ExportProviderValue>;
    renderOptions?: Omit<RenderOptions, "wrapper">;
  },
): RenderResult {
  return render(<ExportProviderTestWrapper value={options?.value}>{ui}</ExportProviderTestWrapper>, options?.renderOptions);
}
