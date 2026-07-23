import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SOLVERS_ROOT = path.resolve(__dirname, "..", "..", "..", "solvers");

export const WarehouseEntry = z.object({
  id: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const CustomerEntry = WarehouseEntry.extend({
  demand: z.number(),
});

export const DistanceMap = z.record(z.string(), z.number());

export const MineEntry = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number(),
});

export const StationEntry = z.object({
  id: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number(),
});

export const CostMap = z.record(z.string(), z.number());

export const BrazilWarehouseEntry = WarehouseEntry;

export const BrazilStateEntry = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number(),
});

export const VersionFile = z.object({
  version: z.number(),
  sha256: z.string(),
});

export interface ModelPackageSpec {
  modelId: string;
  /** filename -> zod schema for the record map it should validate as (Record<id, Entry>) */
  files: Record<string, z.ZodTypeAny>;
}

export const PACKAGE_SPECS: ModelPackageSpec[] = [
  {
    modelId: "p-median-us",
    files: {
      "warehouses.json": z.record(z.string(), WarehouseEntry),
      "customers.json": z.record(z.string(), CustomerEntry),
      "distances.json": DistanceMap,
    },
  },
  {
    modelId: "transport-coal",
    files: {
      "mines.json": z.record(z.string(), MineEntry),
      "stations.json": z.record(z.string(), StationEntry),
      "costs.json": CostMap,
    },
  },
  {
    modelId: "p-median-brazil",
    files: {
      "warehouses.json": z.record(z.string(), BrazilWarehouseEntry),
      "states.json": z.record(z.string(), BrazilStateEntry),
      "distances.json": DistanceMap,
    },
  },
];

function packageDir(modelId: string): string {
  return path.join(SOLVERS_ROOT, modelId, "dataset");
}

/** Reads and Zod-validates every file in a package. Throws on schema mismatch. */
export function validatePackage(spec: ModelPackageSpec): Record<string, unknown> {
  const dir = packageDir(spec.modelId);
  const parsed: Record<string, unknown> = {};
  for (const [filename, schema] of Object.entries(spec.files)) {
    const raw = JSON.parse(readFileSync(path.join(dir, filename), "utf8"));
    parsed[filename] = schema.parse(raw);
  }
  return parsed;
}

/** sha256 of the package's data files' raw bytes concatenated in sorted filename order. */
export function computeSha256(spec: ModelPackageSpec): string {
  const dir = packageDir(spec.modelId);
  const hash = createHash("sha256");
  for (const filename of Object.keys(spec.files).sort()) {
    hash.update(readFileSync(path.join(dir, filename)));
  }
  return hash.digest("hex");
}

/** Reads and validates version.json for a package. */
export function readVersion(modelId: string): z.infer<typeof VersionFile> {
  const raw = JSON.parse(readFileSync(path.join(packageDir(modelId), "version.json"), "utf8"));
  return VersionFile.parse(raw);
}

// Phase 3.5 (G1.1) — model manifests. `inputsSchema` is a JSON Schema blob,
// intentionally left opaque here (z.record(z.string(), z.unknown())): its
// job is to describe the model's inputs shape to *other* consumers (e.g. a
// future generic form renderer), not to be re-validated by this schema —
// that would just be re-deriving D0.3's Zod validators a second time.
export const ManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  chapter: z.string(),
  datasetDir: z.string(),
  countryBounds: z.object({
    sw: z.tuple([z.number(), z.number()]),
    ne: z.tuple([z.number(), z.number()]),
  }),
  capabilities: z.object({
    supportsP: z.boolean(),
    capacityModes: z.array(z.string()),
    demandEditable: z.boolean(),
  }),
  inputsSchema: z.record(z.string(), z.unknown()),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const MODEL_IDS = ["p-median-us", "transport-coal", "p-median-brazil"] as const;

/** Reads and Zod-validates a model's manifest.json. Throws on schema mismatch. */
export function readManifest(modelId: string): Manifest {
  const raw = JSON.parse(readFileSync(path.join(SOLVERS_ROOT, modelId, "manifest.json"), "utf8"));
  return ManifestSchema.parse(raw);
}
