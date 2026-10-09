// ONE-OFF (Ch4 US migration, MIG-5/MIG-6). Builds Chapter 4's own copy of
// Al's Athletics data from Chapter 3's package. Kept in the tree for
// provenance; not part of any build step.
//
// Two transforms, both deliberate:
//  1. Re-key by entity id. p-median-us keys entities by ordinal ("1","2")
//     with the real id inside the record; Chapter 4's loader keys by id.
//  2. Re-key only. Chapter 4 is miles-canonical (§2.1 of the 2026-10-09 design):
//     the matrix IS Chapter 3's integer-mile matrix, used as-is. NO unit
//     conversion and no circuity factor -- stored == solved == displayed ==
//     exported.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { createHash } from "crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "solvers", "p-median-us", "dataset");
const OUT = path.join(ROOT, "solvers", "max-coverage-us", "dataset");

const read = (f: string) => JSON.parse(readFileSync(path.join(SRC, f), "utf8"));

const srcW = read("warehouses.json") as Record<string, { id: string }>;
const srcC = read("customers.json") as Record<string, { id: string }>;
const srcD = read("distances.json") as Record<string, number>;

const warehouses: Record<string, unknown> = {};
for (const row of Object.values(srcW)) warehouses[row.id] = row;

const customers: Record<string, unknown> = {};
for (const row of Object.values(srcC)) customers[row.id] = row;

const distances: Record<string, number> = {};
for (const [key, miles] of Object.entries(srcD)) {
  const [wOrd, cOrd] = key.split(",");
  distances[`${srcW[wOrd].id},${srcC[cOrd].id}`] = miles;
}

mkdirSync(OUT, { recursive: true });
const files: Record<string, unknown> = {
  "customers.json": customers,
  "distances.json": distances,
  "warehouses.json": warehouses,
};
for (const [name, value] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + "\n");
}

// sha256 over the three data files in sorted filename order -- byte-identical
// to lib/dataset-schema's computeSha256(), which version.json is checked
// against at load time.
const hash = createHash("sha256");
for (const name of Object.keys(files).sort()) {
  hash.update(readFileSync(path.join(OUT, name)));
}
// CH4O-P1 (MINOR #5) -- `version` is a CACHE KEY, not a label: solver/
// jobRunner.ts mixes `readVersion(modelId).version` (the integer, NOT the
// sha) into computeInputsHash, and solver/recoveryContractIdentity.ts mixes
// it into the recovery identity. Content that changes under an unchanged
// version therefore serves every pre-existing scenario a stale cached result
// -- model-integration-precheck.md's failure-table row 2 ("My fix did
// nothing -- result cache keyed on dataset version") verbatim. Hardcoding
// `version: 1` here made that the DEFAULT outcome of any dataset-only
// regeneration. Derive it from the sha instead: identical bytes keep the
// version (so a no-op re-run stays a no-op), changed bytes bump it, and
// neither depends on anyone remembering.
const sha256 = hash.digest("hex");
const versionPath = path.join(OUT, "version.json");
const prev = existsSync(versionPath)
  ? (JSON.parse(readFileSync(versionPath, "utf8")) as { version: number; sha256: string })
  : null;
const version = prev == null ? 1 : prev.sha256 === sha256 ? prev.version : prev.version + 1;
writeFileSync(versionPath, JSON.stringify({ version, sha256 }, null, 2) + "\n");

console.log(
  `wrote ${Object.keys(warehouses).length} warehouses, ` +
  `${Object.keys(customers).length} customers, ` +
  `${Object.keys(distances).length} distances ` +
  `(dataset version ${version}${prev != null && prev.version !== version ? ` -- bumped from ${prev.version}, content changed` : ""})`,
);
