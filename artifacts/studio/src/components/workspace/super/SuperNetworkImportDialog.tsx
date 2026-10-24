import { useEffect, useRef, useState } from "react";
import { useImportScenarioNetwork } from "@workspace/api-client-react";
import type { Scenario } from "@workspace/api-client-react";
import { SUPER_NETWORK_MAX_BYTES } from "@workspace/import-schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { describeImportError } from "@/components/ImportDialog";
import { describeIssue, parseCsvFiles, parseJsonText, parseXlsx, readFileAs, type ParseResult, type Sources } from "@/lib/superFiles";

const SUPER_LIMIT_MESSAGE = `File is larger than the ${SUPER_NETWORK_MAX_BYTES / (1024 * 1024)} MB network import limit.`;
type Kind = "json" | "csv" | "xlsx";
function kindOf(files: File[]): Kind | null {
  const ext = (f: File) => f.name.toLowerCase().split(".").pop();
  if (files.length > 0 && files.every(f => ext(f) === "csv")) return "csv";
  if (files.length === 1 && ext(files[0]) === "xlsx") return "xlsx";
  if (files.length === 1 && ext(files[0]) === "json") return "json";
  return null;
}
function issuesOf(err: unknown): { path: (string | number)[]; message: string }[] {
  const issues = (err as { data?: { issues?: unknown } } | null)?.data?.issues;
  return Array.isArray(issues) ? issues : [];
}

type Mode = "replace" | "merge";

export interface SuperNetworkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: number;
  /** All seven tables empty: Replace needs no overwrite confirmation. */
  isEmpty: boolean;
  onApplied: (scenario: Scenario) => void;
}

/** JSON / CSV / XLSX import of a whole network document, parsed in the browser (POST /network/import; the body IS the document). */
export function SuperNetworkImportDialog({ open, onOpenChange, scenarioId, isEmpty, onApplied }: SuperNetworkImportDialogProps) {
  const [parsed, setParsed] = useState<{ doc: Record<string, unknown>; kind: Kind; sources: Sources } | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const selection = useRef(0); // a slower read from an older selection must not overwrite a newer one
  const [mode, setMode] = useState<Mode>(isEmpty ? "replace" : "merge");
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const importMutation = useImportScenarioNetwork();

  // Re-seed on OPEN from the current isEmpty (a successful import flips it while closed).
  useEffect(() => { if (open) setMode(isEmpty ? "replace" : "merge"); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing mid-import would reset() (detaching the observer), so onSuccess never ran and the workspace stayed stale.
  function handleOpenChange(next: boolean) {
    if (!next && importMutation.isPending) return;
    finish(next);
  }
  function finish(next: boolean) {
    if (!next) {
      setParsed(null);
      setFileErrors([]);
      setConfirmingOverwrite(false);
      importMutation.reset();
    }
    onOpenChange(next);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    importMutation.reset(); setParsed(null); setConfirmingOverwrite(false); setFileErrors([]);
    const mine = ++selection.current;
    const kind = kindOf(files);
    if (!kind) return setFileErrors(["Choose one .json file, one .xlsx workbook, or a set of .csv files."]);
    let result: ParseResult;
    try {
      if (kind === "json") result = parseJsonText(String(await readFileAs(files[0], "text")));
      else if (kind === "xlsx") result = await parseXlsx((await readFileAs(files[0], "buffer")) as ArrayBuffer);
      else result = parseCsvFiles(await Promise.all(files.map(async f => ({ name: f.name, text: String(await readFileAs(f, "text")) }))));
    } catch {
      if (mine === selection.current) setFileErrors(["Could not read the file."]);
      return;
    }
    if (mine !== selection.current) return;
    if (!result.ok) return setFileErrors(result.errors.map(x => `${x.where}: ${x.message}`));
    // The serialized JSON request is what the server body limit measures, for every format.
    if (new Blob([JSON.stringify(result.doc)]).size > SUPER_NETWORK_MAX_BYTES) return setFileErrors([SUPER_LIMIT_MESSAGE]);
    setParsed({ doc: result.doc, kind, sources: result.sources });
  }

  function handleConfirm() {
    if (!parsed) return;
    if (mode === "replace" && !isEmpty && !confirmingOverwrite) return setConfirmingOverwrite(true);
    importMutation.mutate(
      { scenarioId, data: parsed.doc, params: { mode } },
      {
        onSuccess: ({ scenario }) => {
          toast({ title: "Network imported", description: `Network ${mode === "replace" ? "replaced" : "merged"}.` });
          onApplied(scenario);
          finish(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import network</DialogTitle>
          <DialogDescription>Upload a JSON, XLSX or CSV network document to replace or merge into this scenario.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <input type="file" multiple accept=".json,.xlsx,.csv,application/json,text/csv" aria-label="Network file" data-testid="super-import-file" onChange={handleFiles} />
          {fileErrors.length > 0 && (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-import-file-error">
              {fileErrors.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <fieldset className="space-y-1" onChange={() => setConfirmingOverwrite(false)}>
            <legend className="sr-only">Import mode</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="super-import-mode" checked={mode === "replace"} onChange={() => setMode("replace")} data-testid="super-import-mode-replace" />
              Replace all (absent tables reset to defaults)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="super-import-mode" checked={mode === "merge"} onChange={() => setMode("merge")} data-testid="super-import-mode-merge" />
              Merge by ID (upsert rows, never deletes)
            </label>
          </fieldset>
          {confirmingOverwrite && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid="super-import-confirm-overwrite">
              This replaces every table in this scenario.
            </p>
          )}
          {importMutation.isError && parsed && parsed.kind !== "json" && issuesOf(importMutation.error).length > 0 ? (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-import-issues">
              {issuesOf(importMutation.error).map((i, k) => <li key={k}>{describeIssue(i, parsed.sources)}</li>)}
            </ul>
          ) : importMutation.isError && (
            <p className="text-xs text-destructive" data-testid="super-import-error">
              {(importMutation.error as { status?: unknown } | null)?.status === 413 ? SUPER_LIMIT_MESSAGE : describeImportError(importMutation.error, "Import failed.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={importMutation.isPending} onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!parsed || importMutation.isPending} onClick={handleConfirm} data-testid="super-import-confirm">
            {importMutation.isPending ? "Importing…" : confirmingOverwrite ? "Replace everything" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
