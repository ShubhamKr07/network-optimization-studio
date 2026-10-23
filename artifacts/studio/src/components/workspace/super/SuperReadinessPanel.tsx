import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { downloadSuperFile, SUPER_SAMPLE_URL, SUPER_TEMPLATE_URL } from "@/lib/superNetwork";

const fromJson = (url: string, base: string, format: "csv" | "xlsx") => async () => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await downloadSuperFile(base, format, await res.json());
  } catch {
    toast({ title: "Download failed", description: "Could not build the file.", variant: "destructive" });
  }
};

export interface SuperReadinessPanelProps {
  precheck?: { ok: boolean; errors: { code: string; message: string }[] };
  isEmpty: boolean;
  onImport(): void;
}

export function SuperReadinessPanel({ precheck, isEmpty, onImport }: SuperReadinessPanelProps) {
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="super-empty-state">
        <h2 className="text-base font-semibold">Import a network to get started</h2>
        <Button size="sm" onClick={onImport} data-testid="super-open-import">Import network</Button>
        <div className="flex flex-wrap gap-4 text-xs">
          <a className="underline" href={SUPER_TEMPLATE_URL} download data-testid="super-download-template">Template (JSON)</a>
          <button className="underline" onClick={fromJson(SUPER_TEMPLATE_URL, "super-model-template", "csv")} data-testid="super-download-template-csv">Template (CSV zip)</button>
          <button className="underline" onClick={fromJson(SUPER_TEMPLATE_URL, "super-model-template", "xlsx")} data-testid="super-download-template-xlsx">Template (XLSX)</button>
          <a className="underline" href={SUPER_SAMPLE_URL} download data-testid="super-download-sample">Sample (JSON)</a>
          <button className="underline" onClick={fromJson(SUPER_SAMPLE_URL, "super-model-sample", "csv")} data-testid="super-download-sample-csv">Sample (CSV zip)</button>
          <button className="underline" onClick={fromJson(SUPER_SAMPLE_URL, "super-model-sample", "xlsx")} data-testid="super-download-sample-xlsx">Sample (XLSX)</button>
        </div>
      </div>
    );
  }
  if (!precheck) return null;
  return (
    <div className="mb-3 text-xs" data-testid="super-readiness-panel">
      {precheck.errors.length === 0 ? (
        <p className="text-green-700" data-testid="super-readiness-ok">Ready to solve</p>
      ) : (
        <ul className="space-y-1 text-amber-800">
          {precheck.errors.map((e, i) => <li key={i} data-testid={`super-readiness-error-${i}`}>{e.message}</li>)}
        </ul>
      )}
    </div>
  );
}
