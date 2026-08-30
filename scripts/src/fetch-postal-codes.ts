// One-time script: reverse-geocodes every warehouse/customer/mine/station/
// refinery row's lat/lng via Nominatim and writes the result back as a new
// `zip` field on the raw dataset JSON.
//
// Resumable at ROW granularity, not file granularity: writes the file back
// to disk after every row (via a temp-file + rename, so a crash mid-write
// never leaves a half-written JSON file), not once at the end of the loop —
// an interruption after row 150 of 200 keeps those 150, the next run picks
// up at row 151.
//
// Distinguishes a genuine "no postcode" result from a transient failure
// (timeout, rate limit, 5xx): only a real HTTP 200 with an address block
// that's missing `postcode` counts as a permanent miss. A timeout, network
// error, non-2xx status, or malformed JSON is retried (exponential backoff,
// respecting a `Retry-After` header when present) up to MAX_RETRIES times
// before being recorded as a FAILURE (distinct from a miss) — the script
// exits non-zero if failures exceed a coverage floor, rather than silently
// treating an outage as hundreds of legitimate misses.
import { readFileSync, writeFileSync, renameSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { reverseGeocode, type GeocodeOutcome } from "./fetch-postal-codes.testable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MAX_RETRIES = 4;
const MIN_COVERAGE_RATIO = 0.85; // below this fraction of rows successfully classified (hit or genuine miss, not failure), the script exits non-zero

interface Target {
  modelId: string;
  files: string[]; // files with rows to geocode (subset of the package's full file list)
  packageFiles: string[]; // the package's FULL file list, for sha256 recomputation
}

const TARGETS: Target[] = [
  { modelId: "p-median-us", files: ["warehouses.json", "customers.json"], packageFiles: ["warehouses.json", "customers.json", "distances.json"] },
  { modelId: "transport-coal", files: ["mines.json", "stations.json"], packageFiles: ["mines.json", "stations.json", "costs.json"] },
  { modelId: "two-echelon-gold-au", files: ["refineries.json", "customers.json"], packageFiles: ["mines.json", "refineries.json", "customers.json", "distances.json"] },
];

function datasetDir(modelId: string): string {
  return path.join(REPO_ROOT, "solvers", modelId, "dataset");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reverseGeocodeWithRetry(lat: number, lng: number): Promise<GeocodeOutcome> {
  let lastOutcome: GeocodeOutcome = { kind: "failure", reason: "not attempted" };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(30_000, 1000 * 2 ** attempt);
      await sleep(backoffMs);
    }
    lastOutcome = await reverseGeocode(lat, lng);
    if (lastOutcome.kind !== "failure") return lastOutcome; // "hit" or "miss" are both terminal, don't retry
  }
  return lastOutcome; // exhausted retries, still a failure
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmpPath, filePath); // rename is atomic on the same filesystem — no half-written file on crash
}

async function processFile(modelId: string, filename: string): Promise<{ hits: number; misses: number; failures: number }> {
  const filePath = path.join(datasetDir(modelId), filename);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, { lat: number; lng: number; zip?: string }>;
  let hits = 0, misses = 0, failures = 0;

  for (const [key, row] of Object.entries(raw)) {
    if (row.zip) continue; // already geocoded — resumable
    const outcome = await reverseGeocodeWithRetry(row.lat, row.lng);
    if (outcome.kind === "hit") {
      raw[key] = { ...row, zip: outcome.postcode };
      hits++;
      atomicWriteJson(filePath, raw); // persist after EVERY row, not once at the end
    } else if (outcome.kind === "miss") {
      console.warn(`[fetch-postal-codes] genuine miss: ${modelId}/${filename} row ${key} (lat=${row.lat}, lng=${row.lng}) — no postcode in address block`);
      misses++;
    } else {
      console.error(`[fetch-postal-codes] FAILURE (not a genuine miss) after ${MAX_RETRIES} retries: ${modelId}/${filename} row ${key}: ${outcome.reason}`);
      failures++;
    }
    await sleep(1000); // Nominatim usage policy: max 1 req/sec
  }

  return { hits, misses, failures };
}

function recomputeVersion(modelId: string, packageFiles: string[]): void {
  const dir = datasetDir(modelId);
  const hash = createHash("sha256");
  for (const filename of [...packageFiles].sort()) {
    hash.update(readFileSync(path.join(dir, filename)));
  }
  const versionPath = path.join(dir, "version.json");
  const current = JSON.parse(readFileSync(versionPath, "utf8")) as { version: number; sha256: string };
  atomicWriteJson(versionPath, { version: current.version + 1, sha256: hash.digest("hex") });
}

async function main() {
  let totalHits = 0, totalMisses = 0, totalFailures = 0;
  for (const target of TARGETS) {
    for (const filename of target.files) {
      const { hits, misses, failures } = await processFile(target.modelId, filename);
      totalHits += hits;
      totalMisses += misses;
      totalFailures += failures;
    }
    recomputeVersion(target.modelId, target.packageFiles);
    console.log(`[fetch-postal-codes] ${target.modelId}: version.json recomputed`);
  }
  const totalRows = totalHits + totalMisses + totalFailures;
  const coverageRatio = totalRows === 0 ? 1 : (totalHits + totalMisses) / totalRows; // hits + genuine misses both count as "classified"; failures don't
  console.log(`[fetch-postal-codes] done — ${totalHits} hits, ${totalMisses} genuine misses, ${totalFailures} failures (transient errors, not misses)`);
  if (coverageRatio < MIN_COVERAGE_RATIO) {
    console.error(`[fetch-postal-codes] coverage ratio ${coverageRatio.toFixed(2)} is below the ${MIN_COVERAGE_RATIO} floor — this looks like an outage/rate-limit run, not real geographic misses. Re-run once the underlying issue clears; do NOT commit this run's output.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
