import fs from "fs";
import path from "path";
import type { ZodType } from "zod";
import { SOLVERS_ROOT, ManifestSchema, type Manifest } from "@workspace/dataset-schema";
import { pMedianInputsSchema } from "../validation/inputs/pMedian.js";
import { transportLpInputsSchema } from "../validation/inputs/transportLp.js";
import { twoEchelonInputsSchema } from "../validation/inputs/twoEchelon.js";

// Discovery is manifest-driven (scans solvers/*/manifest.json at boot) so a
// new dataset+manifest+solver directory shows up in listModels()/GET
// /api/models with zero code changes. Actually *validating* a model's
// inputs still needs a hand-written Zod schema (inputsSchema in the
// manifest is JSON Schema, descriptive only — Phase 3.5 doesn't generate an
// executable validator from it) — this map is deliberately separate from
// discovery below, so a manifest-only model is listable without being
// solvable.
const KNOWN_SCHEMAS: Record<string, ZodType> = {
  "p-median-us": pMedianInputsSchema,
  "p-median-brazil": pMedianInputsSchema,
  "transport-coal": transportLpInputsSchema,
  "two-echelon-gold-au": twoEchelonInputsSchema,
};

function discoverManifests(): Map<string, Manifest> {
  const map = new Map<string, Manifest>();
  for (const entry of fs.readdirSync(SOLVERS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(SOLVERS_ROOT, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    // One corrupt/invalid manifest must NOT take down the whole registry —
    // every other model would vanish from GET /api/models alongside it.
    // Wrap each manifest's parse+validate in its own try/catch so a bad
    // manifest is logged and skipped, and the rest still register.
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      map.set(entry.name, ManifestSchema.parse(raw));
    } catch (err) {
      // Use console.error (not the app logger) — discoverManifests runs at
      // module load, before the logger is initialised, and a registry scan
      // failure is an operator-visible boot problem, not request-scoped.
      console.error(
        `[modelRegistry] skipping invalid manifest ${manifestPath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return map;
}

const MANIFESTS = discoverManifests();

// Public shape for GET /api/models — omits datasetDir (a server-side
// filesystem path, not something the frontend needs).
export interface PublicModelInfo {
  id: string;
  name: string;
  chapter: string;
  countryBounds: Manifest["countryBounds"];
  capabilities: Manifest["capabilities"];
  inputsSchema: Manifest["inputsSchema"];
}

function toPublic(manifest: Manifest): PublicModelInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    chapter: manifest.chapter,
    countryBounds: manifest.countryBounds,
    capabilities: manifest.capabilities,
    inputsSchema: manifest.inputsSchema,
  };
}

export function listModels(): PublicModelInfo[] {
  return Array.from(MANIFESTS.values()).map(toPublic);
}

export function getManifest(modelId: string): Manifest | undefined {
  return MANIFESTS.get(modelId);
}

export type ValidateInputsResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

export function validateInputs(modelId: string, inputs: unknown): ValidateInputsResult {
  const schema = KNOWN_SCHEMAS[modelId];
  if (!schema) {
    return { success: false, error: `Unknown model_id: ${modelId}` };
  }
  const result = schema.safeParse(inputs);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true, data: result.data as Record<string, unknown> };
}
