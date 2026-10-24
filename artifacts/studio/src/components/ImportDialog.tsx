import { useState } from "react";
import {
  usePreviewScenarioImport,
  useApplyScenarioImport,
} from "@workspace/api-client-react";
import type { Scenario, ImportApplyMode, ImportDocument, ImportError, ImportRequest, ImportRowChange } from "@workspace/api-client-react";
import { MAX_IMPORT_BYTES, type ImportEntity } from "@workspace/import-schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { describeWriteError } from "@/lib/describeWriteError";
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";
import { XLSX_MIME } from "@/lib/clientCsv";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: number;
  // SCU-2.P2.2 — @workspace/import-schema's IMPORT_ENTITIES, the list the OpenAPI
  // ImportEntity enum is pinned to (importSchemaContract.test.ts). Passing it
  // into the generated request type is a compile-time check of the same thing.
  entity: ImportEntity;
  /** SCU-2.P2.2 (B2.6) — which file the user picks. Defaults to csv (every existing caller).
   *  QFX-2a — xlsx: the first sheet is converted to CSV text in the browser and sent exactly like a CSV upload. */
  format?: DownloadFormat;
  onApplied?: (scenario: Scenario) => void;
  /** B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in gate for the shared
   * A3 `FilterMenu`/`useTableFilters`, wired into the Errors and Changes
   * preview grids as TWO SEPARATE tables — each shows/hides its own
   * FilterMenu by its own unfiltered row count (spec §10's explicit call-
   * out). Defaults `false`: every existing caller (every non-JADE
   * ImportDialog usage) is byte-identical to before this task. */
  enableFilters?: boolean;
}

export const LIMIT_MESSAGE = `File is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.`; // same sentence for the client check and a server 413

/** A 413 is the body limit; say it the way the client-side guard does, never as the raw code. */
export function describeImportError(err: unknown, fallback: string): string {
  return (err as { status?: unknown } | null)?.status === 413 ? LIMIT_MESSAGE : describeWriteError(err, fallback);
}

/** null unless the text is a JSON object with a rows array (anything else the server would 400). */
function parseJsonDocument(text: string): ImportDocument | null {
  try {
    const doc: unknown = JSON.parse(text);
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc) && Array.isArray((doc as { rows?: unknown }).rows)) {
      return doc as ImportDocument;
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}

const ACCEPT: Record<DownloadFormat, string> = { csv: ".csv,text/csv", json: ".json,application/json", xlsx: `.xlsx,${XLSX_MIME}` };

const rowLabel = (rowIndex: number | undefined) => (rowIndex === undefined ? undefined : `row ${rowIndex + 1}`);

export function ImportDialog({ open, onOpenChange, scenarioId, entity, format = "csv", onApplied, enableFilters = false }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportApplyMode>("all_or_nothing");

  const previewMutation = usePreviewScenarioImport();
  const applyMutation = useApplyScenarioImport();

  function reset() {
    setFileName(null);
    setRequest(null);
    setFileError(null);
    setMode("all_or_nothing");
    previewMutation.reset();
    applyMutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    applyMutation.reset();
    previewMutation.reset();
    setRequest(null);
    setFileName(file.name);
    if (format === "xlsx") {
      void submitXlsx(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (format === "json") {
        const document = parseJsonDocument(text);
        if (!document) {
          setFileError("File is not a valid import document (a JSON object with a rows array).");
          return;
        }
        submit({ entity, format: "json", document });
      } else {
        submit({ entity, csvText: text });
      }
    };
    reader.readAsText(file);
  }

  // QFX-2a — no server change: the workbook's first sheet becomes the same csvText a CSV upload sends.
  async function submitXlsx(file: File) {
    try {
      const { xlsxFileToCsvText } = await import("@/lib/xlsxFile");
      const r = await xlsxFileToCsvText(file);
      if (r.ok) submit({ entity, csvText: r.csvText });
      else setFileError(r.message);
    } catch {
      setFileError("Could not read the file.");
    }
  }

  function submit(next: ImportRequest) {
    // SCU-2.P2.2 (B2.6; review #10) — the limit is on the WIRE body, so measure
    // the serialized request (with mode, the larger of preview/apply), never file.size.
    if (new Blob([JSON.stringify({ ...next, mode: "all_or_nothing" })]).size > MAX_IMPORT_BYTES) {
      setFileError(LIMIT_MESSAGE);
      return;
    }
    setFileError(null);
    setRequest(next);
    previewMutation.mutate({ scenarioId, data: next });
  }

  function handleConfirm() {
    if (!request) return;
    applyMutation.mutate(
      { scenarioId, data: { ...request, mode } },
      {
        onSuccess: (result) => {
          toast({
            title: "Import applied",
            description: `${result.applied} change${result.applied === 1 ? "" : "s"} applied${
              result.errors.length ? `, ${result.errors.length} row(s) skipped` : ""
            }.`,
          });
          if (result.scenario) onApplied?.(result.scenario);
          handleOpenChange(false);
        },
      }
    );
  }

  const preview = previewMutation.data;

  // B7 — the Errors grid and the Changes grid are SEPARATE tables for the
  // filter threshold (spec §10's explicit call-out): each independently
  // shows/hides its own FilterMenu by its OWN unfiltered row count. Both
  // hooks are called unconditionally (Rules of Hooks); when `preview` is
  // undefined they operate on an empty array, which is harmless.
  const errorFilterDescriptors: ColumnFilterDescriptor<ImportError>[] = [
    { key: "line", label: "Line", type: "number", accessor: err => err.line ?? undefined },
    { key: "errorClass", label: "Class", type: "select", accessor: err => err.errorClass },
    { key: "message", label: "Message", type: "text", accessor: err => err.message },
  ];
  const errorTableFilters = useTableFilters(preview?.errors ?? [], errorFilterDescriptors);
  const displayedErrors = errorTableFilters.filteredRows;
  const showErrorFilterMenu = enableFilters && (preview?.errors.length ?? 0) > 10;

  const changeFilterDescriptors: ColumnFilterDescriptor<ImportRowChange>[] = [
    { key: "id", label: "ID", type: "text", accessor: c => c.id },
    { key: "line", label: "Line", type: "number", accessor: c => c.line },
  ];
  const changeTableFilters = useTableFilters(preview?.changes ?? [], changeFilterDescriptors);
  const displayedChanges = changeTableFilters.filteredRows;
  const showChangeFilterMenu = enableFilters && (preview?.changes.length ?? 0) > 10;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {entity}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept={ACCEPT[format]}
              onChange={handleFileChange}
              data-testid={`input-import-file-${entity}`}
              className="text-xs"
            />
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          </div>
          {fileError && (
            <p className="text-xs text-destructive" data-testid="import-file-error">{fileError}</p>
          )}

          {previewMutation.isPending && <p className="text-xs text-muted-foreground">Parsing…</p>}
          {previewMutation.isError && (
            <p className="text-xs text-destructive" data-testid="import-preview-error">
              {describeImportError(previewMutation.error, "Could not parse file.")}
            </p>
          )}

          {preview && (
            <>
              {preview.errors.length > 0 && (
                <div className="space-y-1" data-testid="import-errors-section">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-destructive">Errors ({preview.errors.length})</p>
                    {showErrorFilterMenu && (
                      <FilterMenu descriptors={errorFilterDescriptors} tableFilters={errorTableFilters} />
                    )}
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-red-200 rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Line</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedErrors.map((err, i) => (
                          <TableRow key={i} className="bg-red-50" data-testid={`import-error-row-${i}`}>
                            <TableCell className="text-xs">{err.line ?? rowLabel(err.rowIndex) ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">
                                {err.errorClass}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-red-700">{err.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {preview.changes.length > 0 && (
                <div className="space-y-1" data-testid="import-changes-section">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-green-700">Changes ({preview.changes.length})</p>
                    {showChangeFilterMenu && (
                      <FilterMenu descriptors={changeFilterDescriptors} tableFilters={changeTableFilters} />
                    )}
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-green-200 rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Line</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedChanges.map((c, i) => (
                          <TableRow key={i} className="bg-green-50" data-testid={`import-change-row-${i}`}>
                            <TableCell className="text-xs font-mono">{c.id}</TableCell>
                            <TableCell className="text-xs">{rowLabel(c.rowIndex) ?? c.line}</TableCell>
                            <TableCell className="text-xs font-mono">{JSON.stringify(c.before)}</TableCell>
                            <TableCell className="text-xs font-mono">{JSON.stringify(c.after)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {preview.errors.length === 0 && preview.changes.length === 0 && (
                <p className="text-xs text-muted-foreground">No changes detected — file matches the scenario's current state.</p>
              )}

              {preview.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid={`import-warning-${i}`}>
                  {w}
                </p>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="import-all-or-nothing"
                  checked={mode === "all_or_nothing"}
                  onCheckedChange={checked => setMode(checked ? "all_or_nothing" : "partial")}
                  data-testid="checkbox-import-all-or-nothing"
                />
                <Label htmlFor="import-all-or-nothing" className="text-xs">
                  All-or-nothing (reject entire file if any row has an error)
                </Label>
              </div>

              {mode === "all_or_nothing" && preview.errors.length > 0 && (
                <p className="text-[10px] text-destructive">
                  This file has errors — switch to partial mode to apply the valid rows, or fix the file and re-upload.
                </p>
              )}

              {applyMutation.isError && (
                <p className="text-xs text-destructive" data-testid="import-apply-error">
                  {describeImportError(applyMutation.error, "Import failed.")}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} data-testid="button-import-cancel">
            Cancel
          </Button>
          {preview && (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={applyMutation.isPending}
              data-testid="button-import-confirm"
            >
              {applyMutation.isPending ? "Applying…" : "Apply"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
