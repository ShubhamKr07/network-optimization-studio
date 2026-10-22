import { Button } from "@/components/ui/button";
import { SUPER_SAMPLE_URL, SUPER_TEMPLATE_URL } from "@/lib/superNetwork";

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
        <div className="flex gap-4 text-xs">
          <a className="underline" href={SUPER_TEMPLATE_URL} download data-testid="super-download-template">Download template</a>
          <a className="underline" href={SUPER_SAMPLE_URL} download data-testid="super-download-sample">Download sample</a>
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
