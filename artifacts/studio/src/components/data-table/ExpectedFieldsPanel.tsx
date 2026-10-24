// SCU-2.P4.1 (spec B2.3/B2.4) — the "expected fields" panel shown inside every
// input table's Upload ▾ and Download ▾ menu. Everything comes from
// @workspace/import-schema (the same descriptors the server imports with), so
// the panel cannot drift from what an upload actually accepts. A native
// <details> keeps it collapsed by default with no state of its own.

import {
  IMPORT_SCHEMAS,
  exampleCsv,
  exampleJsonDocument,
  type ImportEntity,
  type ImportFieldDescriptor,
} from "@workspace/import-schema";

/** "always" | "add rows" | "update rows" | "optional" — B2.3 "required (add vs update)". */
export function requiredText(f: ImportFieldDescriptor): string {
  if (f.requiredForAdd && f.requiredForUpdate) return "always";
  if (f.requiredForAdd) return "add rows";
  if (f.requiredForUpdate) return "update rows";
  return "optional";
}

/** Enum values, numeric bound and unit note — B2.3 "enum values, numeric bounds, unit". */
export function allowedText(f: ImportFieldDescriptor): string {
  const parts: string[] = [];
  if (f.enum) parts.push(f.enum.join(" | "));
  if (f.min !== undefined) parts.push(`${f.exclusiveMin ? ">" : "≥"} ${f.min}`);
  if (f.unitFamily === "distance") parts.push("in the file's unit");
  if (f.envelopeKey) parts.push(`JSON: may come from the envelope's ${f.envelopeKey}`);
  return parts.length ? parts.join("; ") : "—";
}

/** Every field of the version export emits. The CSV importer requires an exact header with ALL of them (no model filter), so none may be hidden. */
export function expectedFields(entity: ImportEntity): readonly ImportFieldDescriptor[] {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!.fields;
}

/** True when the column must still be present in a CSV but its value is ignored for `modelId`. */
export function ignoredForModel(f: ImportFieldDescriptor, modelId?: string): boolean {
  return !!modelId && !!f.models && !(f.models as readonly string[]).includes(modelId);
}

export function ExpectedFieldsPanel({ entity, modelId }: { entity: ImportEntity; modelId?: string }) {
  const schema = IMPORT_SCHEMAS[entity];
  const canAdd = modelId ? (schema.addModels as readonly string[]).includes(modelId) : schema.addModels.length > 0;
  return (
    <details className="text-xs" data-testid={`expected-fields-${entity}`}>
      <summary className="cursor-pointer px-2 py-1 text-muted-foreground">Expected fields</summary>
      <div className="space-y-2 px-2 pb-2">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-medium">CSV column</th>
              <th className="pr-2 font-medium">JSON key</th>
              <th className="pr-2 font-medium">Type</th>
              <th className="pr-2 font-medium">Required</th>
              <th className="font-medium">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {expectedFields(entity).map(f => {
              const ignored = ignoredForModel(f, modelId);
              return (
                <tr key={f.csvHeader} data-testid={`expected-field-${entity}-${f.csvHeader}`}>
                  <td className="pr-2 font-mono">{f.csvHeader}</td>
                  <td className="pr-2 font-mono">{f.jsonKey}</td>
                  <td className="pr-2">{f.type}</td>
                  <td className="pr-2">{ignored ? "column required in the CSV" : requiredText(f)}</td>
                  <td>{ignored ? "value ignored for this model" : allowedText(f)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canAdd && <p className="text-muted-foreground">Leave id blank to add a new row.</p>}
        <p className="text-muted-foreground">Example CSV</p>
        <pre className="overflow-x-auto rounded bg-muted p-1 font-mono text-2xs" data-testid={`expected-fields-${entity}-csv`}>
          {exampleCsv(entity)}
        </pre>
        <p className="text-muted-foreground">Example JSON</p>
        <pre className="overflow-x-auto rounded bg-muted p-1 font-mono text-2xs" data-testid={`expected-fields-${entity}-json`}>
          {JSON.stringify(exampleJsonDocument(entity), null, 2)}
        </pre>
      </div>
    </details>
  );
}
