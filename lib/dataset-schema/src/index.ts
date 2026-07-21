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
