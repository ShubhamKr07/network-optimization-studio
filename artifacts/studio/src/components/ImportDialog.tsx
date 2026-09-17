import { useState } from "react";
import {
  usePreviewScenarioImport,
  useApplyScenarioImport,
} from "@workspace/api-client-react";
import type { Scenario, ImportApplyRequestMode, ImportError, ImportRowChange } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: number;
  // T11 (Chapter 9 JADE) — "plants"/"plantCapabilities" added, matching T3.5's
  // already-generated `ImportRequestEntity` (openapi.yaml) exactly.
  entity: "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts" | "legDistances" | "plants" | "plantCapabilities";
  onApplied?: (scenario: Scenario) => void;
  /** B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in gate for the shared
   * A3 `FilterMenu`/`useTableFilters`, wired into the Errors and Changes
   * preview grids as TWO SEPARATE tables — each shows/hides its own
   * FilterMenu by its own unfiltered row count (spec §10's explicit call-
   * out). Defaults `false`: every existing caller (every non-JADE
   * ImportDialog usage) is byte-identical to before this task. */
  enableFilters?: boolean;
}

export function ImportDialog({ open, onOpenChange, scenarioId, entity, onApplied, enableFilters = false }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [mode, setMode] = useState<ImportApplyRequestMode>("all_or_nothing");

  const previewMutation = usePreviewScenarioImport();
  const applyMutation = useApplyScenarioImport();

  function reset() {
    setFileName(null);
    setCsvText("");
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
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      setFileName(file.name);
      previewMutation.mutate({ scenarioId, data: { entity, csvText: text } });
    };
    reader.readAsText(file);
  }

  function handleConfirm() {
    applyMutation.mutate(
      { scenarioId, data: { entity, csvText, mode } },
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
              accept=".csv,text/csv"
              onChange={handleFileChange}
              data-testid={`input-import-file-${entity}`}
              className="text-xs"
            />
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          </div>

          {previewMutation.isPending && <p className="text-xs text-muted-foreground">Parsing…</p>}
          {previewMutation.isError && (
            <p className="text-xs text-destructive" data-testid="import-preview-error">
              {previewMutation.error instanceof Error ? previewMutation.error.message : "Could not parse file."}
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
                            <TableCell className="text-xs">{err.line ?? "—"}</TableCell>
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
                            <TableCell className="text-xs">{c.line}</TableCell>
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
                  {applyMutation.error instanceof Error ? applyMutation.error.message : "Import failed."}
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
