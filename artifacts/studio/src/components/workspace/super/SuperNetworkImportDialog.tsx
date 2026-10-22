import { useState } from "react";
import { useImportScenarioNetwork } from "@workspace/api-client-react";
import type { Scenario } from "@workspace/api-client-react";
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { LIMIT_MESSAGE, describeImportError } from "@/components/ImportDialog";

type Mode = "replace" | "merge";

export interface SuperNetworkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: number;
  /** All seven tables empty: Replace needs no overwrite confirmation. */
  isEmpty: boolean;
  onApplied: (scenario: Scenario) => void;
}

/** JSON import of a whole network document (POST /network/import; the body IS the document). */
export function SuperNetworkImportDialog({ open, onOpenChange, scenarioId, isEmpty, onApplied }: SuperNetworkImportDialogProps) {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(isEmpty ? "replace" : "merge");
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const importMutation = useImportScenarioNetwork();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDoc(null);
      setFileError(null);
      setMode(isEmpty ? "replace" : "merge");
      setConfirmingOverwrite(false);
      importMutation.reset();
    }
    onOpenChange(next);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    importMutation.reset();
    setDoc(null);
    setConfirmingOverwrite(false);
    const reader = new FileReader(); // FileReader, as ImportDialog: jsdom's File has no .text()
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (new Blob([text]).size > MAX_IMPORT_BYTES) return setFileError(LIMIT_MESSAGE);
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        setDoc(parsed as Record<string, unknown>);
        setFileError(null);
      } catch {
        setFileError("File is not a valid network document (a JSON object).");
      }
    };
    reader.readAsText(file);
  }

  function handleConfirm() {
    if (!doc) return;
    if (mode === "replace" && !isEmpty && !confirmingOverwrite) return setConfirmingOverwrite(true);
    importMutation.mutate(
      { scenarioId, data: doc, params: { mode } },
      {
        onSuccess: ({ scenario }) => {
          toast({ title: "Network imported", description: `Network ${mode === "replace" ? "replaced" : "merged"}.` });
          onApplied(scenario);
          handleOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import network</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <input type="file" accept="application/json,.json" data-testid="super-import-file" onChange={handleFile} />
          {fileError && <p className="text-xs text-destructive" data-testid="super-import-file-error">{fileError}</p>}
          <fieldset className="space-y-1" onChange={() => setConfirmingOverwrite(false)}>
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
          {importMutation.isError && (
            <p className="text-xs text-destructive" data-testid="super-import-error">
              {describeImportError(importMutation.error, "Import failed.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!doc || importMutation.isPending} onClick={handleConfirm} data-testid="super-import-confirm">
            {importMutation.isPending ? "Importing…" : confirmingOverwrite ? "Replace everything" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
