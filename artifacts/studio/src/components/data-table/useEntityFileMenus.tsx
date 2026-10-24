// SCU-2.P4.1 (spec B2.3/B2.4) — Upload ▾ and Download ▾ for one input entity,
// plus the ImportDialog they open. Every input table (B2.3's list) puts
// `upload` / `download` in its DataTable toolbar and renders `dialog` once.
// Testids are literal per table, keyed on the lowercase name the table's
// testids already use (`testIdEntity`, e.g. "legdistances"):
//   Upload trigger  button-import-{t}           (today's Upload button id, kept)
//   Upload items    button-import-{t}-csv|json|xlsx  (new)
//   Download trigger button-download-{t}        (new; P3's output convention)
//   Download items  button-export-{t}-csv|json|xlsx  (today's two button ids, kept)
// Both menus are disabled while browsing result history, with the same reason.

import { useState, type ReactNode } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { ImportEntity } from "@workspace/import-schema";
import { ImportDialog } from "@/components/ImportDialog";
import { useExport } from "@/contexts/ExportContext";
import type { ExportEntity } from "@/lib/exportEntity";
import { DownloadMenu, type DownloadFormat } from "./DownloadMenu";
import { ExpectedFieldsPanel } from "./ExpectedFieldsPanel";

export type FileEntity = Extract<ImportEntity, ExportEntity>;

export interface EntityFileMenusOptions {
  entity: FileEntity;
  /** The lowercase name in today's testids ("warehouses", "legdistances", "deliverycosts"). */
  testIdEntity: string;
  /** Narrows the expected-fields panel to the fields this model imports. */
  modelId?: string;
  /** Undefined until the scenario resolves — Upload stays disabled, as today (also disabled in history). */
  scenarioId?: number;
  onImportApplied?: (scenario: Scenario) => void;
  /** Threaded to ImportDialog's preview grids (JADE), as today. */
  enableFilters?: boolean;
}

export interface EntityFileMenus {
  upload: ReactNode;
  download: ReactNode;
  dialog: ReactNode;
}

export function useEntityFileMenus({
  entity,
  testIdEntity: t,
  modelId,
  scenarioId,
  onImportApplied,
  enableFilters,
}: EntityFileMenusOptions): EntityFileMenus {
  const { download, disabledReasonFor, inputDisabledReason } = useExport();
  const [importFormat, setImportFormat] = useState<DownloadFormat | null>(null);
  const panel = <ExpectedFieldsPanel entity={entity} modelId={modelId} />;

  const upload = (
    // DownloadMenu is the shared "one trigger, CSV + JSON items" control (P3);
    // here its chosen format opens the import dialog instead of downloading.
    <DownloadMenu
      label="Upload"
      testId={`button-import-${t}`}
      itemTestIds={{ csv: `button-import-${t}-csv`, json: `button-import-${t}-json`, xlsx: `button-import-${t}-xlsx` }}
      onDownload={setImportFormat}
      // History (user decision 2026-10-17): Upload is disabled with the same
      // reason Download shows (`inputDisabledReason`), not just the cells (D2).
      disabledReason={scenarioId == null ? "Loading…" : inputDisabledReason}
    >
      {panel}
    </DownloadMenu>
  );

  const downloadMenu = (
    <DownloadMenu
      testId={`button-download-${t}`}
      itemTestIds={{ csv: `button-export-${t}-csv`, json: `button-export-${t}-json`, xlsx: `button-export-${t}-xlsx` }}
      onDownload={format => void download(entity, format)}
      disabledReason={disabledReasonFor(entity)}
    >
      {panel}
    </DownloadMenu>
  );

  // Mounted only while open — ImportDialog runs its mutation hooks on render (as today).
  const dialog = importFormat != null && scenarioId != null && (
    <ImportDialog
      open
      onOpenChange={open => !open && setImportFormat(null)}
      scenarioId={scenarioId}
      entity={entity}
      format={importFormat}
      onApplied={onImportApplied}
      enableFilters={enableFilters}
    />
  );

  return { upload, download: downloadMenu, dialog };
}
