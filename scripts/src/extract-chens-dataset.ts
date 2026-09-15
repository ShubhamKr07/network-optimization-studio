// scripts/src/extract-chens-dataset.ts
// Extract the Chen's Cosmetics (China) dataset into record-map JSON files with a
// flat direct-id-keyed DistanceMap in RAW km (no circuity ×1.17 — that lives in
// the solver). Slug ids: wh-<n> / cs-<n>.
//
// Run: pnpm tsx scripts/src/extract-chens-dataset.ts "<path to 'ChensCosmeticsV1 Step 3.ipynb'>"
//   (or set CHENS_NOTEBOOK=<path>). The notebook path is a runtime arg, never
//   committed into any script.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = "solvers/chens-cosmetics-cn/dataset";
const EXPECTED_WAREHOUSES = 25;
const EXPECTED_CUSTOMERS = 197;
const EXPECTED_DISTANCE_PAIRS = EXPECTED_WAREHOUSES * EXPECTED_CUSTOMERS; // 4925

const notebookPath = process.env.CHENS_NOTEBOOK ?? process.argv[2];
if (!notebookPath) {
  console.error(
    "Usage: tsx extract-chens-dataset.ts <path to 'ChensCosmeticsV1 Step 3.ipynb'>  (or set CHENS_NOTEBOOK)",
  );
  process.exit(1);
}

interface RawData {
  warehouses: Record<string, [string, string, string, number, number]>;
  customers: Record<string, [string, string, string, number, number]>;
  customer_demands: Record<string, number>;
  distance: Record<string, number>;
}

const raw: RawData = JSON.parse(
  execFileSync("python3", ["scripts/py/dump_chens.py", "--notebook", notebookPath], {
    encoding: "utf8",
  }),
);

const whN = Object.keys(raw.warehouses).map(Number).sort((a, b) => a - b);
const csN = Object.keys(raw.customers).map(Number).sort((a, b) => a - b);

interface WarehouseRow {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}
interface CustomerRow extends WarehouseRow {
  demand: number;
}

const warehouses: Record<string, WarehouseRow> = {};
for (const n of whN) {
  const w = raw.warehouses[n];
  warehouses[`wh-${n}`] = { id: `wh-${n}`, city: w[1], state: "", lat: w[3], lng: w[4] };
}
const customers: Record<string, CustomerRow> = {};
for (const n of csN) {
  const c = raw.customers[n];
  customers[`cs-${n}`] = {
    id: `cs-${n}`,
    city: c[1],
    state: "",
    lat: c[3],
    lng: c[4],
    demand: raw.customer_demands[n],
  };
}

// Flat DistanceMap keyed by direct entity ids "wh-<w>,cs-<c>", RAW km (no ×1.17).
const distances: Record<string, number> = {};
for (const w of whN) {
  for (const c of csN) {
    const km = raw.distance[`${w},${c}`];
    // An absent source pair becomes `undefined`; JSON.stringify would silently
    // drop it, so a print-only check would pass a corrupt dataset. Assert here.
    if (typeof km !== "number" || !Number.isFinite(km)) {
      throw new Error(
        `distance missing/non-finite for source pair (${w},${c}) -> wh-${w},cs-${c}: got ${JSON.stringify(km)}`,
      );
    }
    distances[`wh-${w},cs-${c}`] = km;
  }
}

// ---- INTEGRITY ASSERTIONS (throw before writing) ----

// Cardinality of ids.
if (whN.length !== EXPECTED_WAREHOUSES) {
  throw new Error(`expected ${EXPECTED_WAREHOUSES} warehouses, got ${whN.length}`);
}
if (csN.length !== EXPECTED_CUSTOMERS) {
  throw new Error(`expected ${EXPECTED_CUSTOMERS} customers, got ${csN.length}`);
}

// Unique slug ids per role (guards against a duplicate numeric id collapsing).
const whIds = new Set(Object.keys(warehouses));
if (whIds.size !== whN.length) {
  throw new Error("duplicate warehouse ids detected");
}
const csIds = new Set(Object.keys(customers));
if (csIds.size !== csN.length) {
  throw new Error("duplicate customer ids detected");
}

// Distances: exactly the 25×197 Cartesian product, no missing/extra/reversed.
const distKeys = Object.keys(distances);
if (distKeys.length !== EXPECTED_DISTANCE_PAIRS) {
  throw new Error(
    `expected ${EXPECTED_DISTANCE_PAIRS} distance pairs, got ${distKeys.length}`,
  );
}
for (const key of distKeys) {
  const [from, to] = key.split(",");
  if (!whIds.has(from) || !csIds.has(to)) {
    throw new Error(`distance key "${key}" is not a valid wh->cs pair (no reversed/foreign keys allowed)`);
  }
}

// Warehouse coords finite.
for (const [id, w] of Object.entries(warehouses)) {
  if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) {
    throw new Error(`warehouse ${id} has non-finite lat/lng: ${w.lat},${w.lng}`);
  }
}
// Customer coords finite + demand a nonnegative integer.
for (const [id, c] of Object.entries(customers)) {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
    throw new Error(`customer ${id} has non-finite lat/lng: ${c.lat},${c.lng}`);
  }
  if (!Number.isInteger(c.demand) || c.demand < 0) {
    throw new Error(`customer ${id} demand must be a nonnegative integer, got ${JSON.stringify(c.demand)}`);
  }
}

// ---- WRITE ----
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/warehouses.json`, JSON.stringify(warehouses, null, 2) + "\n");
writeFileSync(`${OUT}/customers.json`, JSON.stringify(customers, null, 2) + "\n");
writeFileSync(`${OUT}/distances.json`, JSON.stringify(distances, null, 2) + "\n");

// version.json: hash raw bytes of the three files in sorted-filename order
// (matches computeSha256 in lib/dataset-schema/src/index.ts).
const files = ["customers.json", "distances.json", "warehouses.json"]; // already sorted
const h = createHash("sha256");
for (const f of files) h.update(readFileSync(`${OUT}/${f}`));
writeFileSync(
  `${OUT}/version.json`,
  JSON.stringify({ version: 1, sha256: h.digest("hex") }, null, 2) + "\n",
);

console.error(
  `chens dataset written: ${whN.length} warehouses, ${csN.length} customers, ${distKeys.length} distance pairs`,
);
