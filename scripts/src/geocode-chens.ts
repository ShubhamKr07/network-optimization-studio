// One-time script (Task C4.1b): assigns DISPLAY-ONLY postal codes ("zip") to
// every Chen's-Cosmetics warehouse/customer row from the GeoNames CN postal
// export, by nearest lat/lng match. Zip NEVER affects goldens — it is metadata
// for the UI only, spliced onto the dataset record-map rows.
//
// Source (rule 1): GeoNames CN postal export, downloaded fresh at run time:
//   curl -sSL -o CN.zip https://download.geonames.org/export/zip/CN.zip
//   unzip → CN.txt (tab-separated; columns:
//     0 country, 1 postalcode, 2 placename, 3 admin1name, 4 admin1code,
//     5 admin2name, 6 admin2code, 7 admin3name, 8 admin3code,
//     9 lat, 10 lng, 11 accuracy)
// GeoNames postal data is CC-BY 4.0 — attribution is MANDATORY (rule 5/7).
// If the download/unzip fails → STOP, report, write nothing (rule 1).
//
// Match (rule 2): for each dataset row, find the nearest GeoNames CN point by
// haversine. Assign its postalcode ONLY if the nearest is within 25 km.
//   - Tie-break (candidates within TIE_EPS_KM of the minimum distance): prefer
//     the code with the MOST trailing zeros (city-level "200000" over district
//     "201xxx"); if still tied, the lowest numeric code.
//   - Beyond 25 km → "miss_too_far" (blank, no zip).
//
// HK/Macau exclusion (rule 3, CRITICAL): Hong Kong and Macau have no PRC postal
// system, so those rows get NO zip (status "blank_no_cn_postal") — they must NOT
// snap to a mainland Shenzhen/Zhuhai code.
//
//   *** DELIBERATE DEVIATION FROM THE LITERAL SPEC — see the report/commit body ***
//   The task specified bounding boxes (HK lat 22.13–22.58/lng 113.82–114.45,
//   Macau lat 22.10–22.23/lng 113.52–113.61). Those boxes CANNOT implement the
//   task's own enumerated 11-row blank list, because the dataset places two
//   cross-border pairs ~1 km apart that require OPPOSITE decisions:
//     • Aomen/Macau  cs-6  (22.27,113.56)  ~1.3 km from  Zhuhai   cs-195 (22.28,113.57 → keep 519xxx)
//     • Shiongshui   cs-134(22.52,114.12)  ~1.1 km from  Shenzhen cs-131 (22.53,114.13 → keep 518xxx)
//   No bounding box can separate 1 km-apart points, and the literal boxes both
//   (a) MISS Aomen (its 22.27 lat is just north of the Macau box's 22.23) and
//   (b) WRONGLY CATCH Shenzhen (a genuine mainland city, absent from the blank
//   list). So the task's enumerated list is the authoritative source of intent.
//   Implementation: boxes are still computed for provenance/cross-check, then
//   the blank decision is driven by the enumerated city-name set below. Net
//   blank set = exactly the 11 rows the task enumerated. Every box-vs-list
//   discrepancy is logged (to console + provenance boxDiscrepancies).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATASET_DIR = path.join(REPO_ROOT, "solvers", "chens-cosmetics-cn", "dataset");
const PROVENANCE_PATH = path.join(REPO_ROOT, "docs", "dataset-audit", "chens-geocode-provenance.json");
const README_PATH = path.join(DATASET_DIR, "README.md");
// Data files hashed for version.json, in sorted-filename order (matches
// lib/dataset-schema computeSha256 — version.json itself is NOT hashed).
const PACKAGE_FILES = ["customers.json", "distances.json", "warehouses.json"];

const GEONAMES_URL = "https://download.geonames.org/export/zip/CN.zip";
const TOTAL_ROWS = 222;
const COVERAGE_FLOOR = 0.85;
const MATCH_RADIUS_KM = 25;
const TIE_EPS_KM = 1.0; // candidates within this of the nearest are "~same distance" for tie-break

// Rule 3 enumerated blank set (HK/Macau territory rows) — the authoritative
// intent, since bounding boxes cannot separate the 1 km cross-border pairs.
// These 10 distinct dataset city names cover exactly 11 rows (Jiulong ×2).
const HK_MACAU_CITIES = new Set([
  "Jiulong",      // Kowloon, HK (wh-77 + cs-77)
  "Aomen",        // Macau (cs-6) — sits just N of the literal Macau box
  "Daipo",        // Tai Po, HK (cs-27)
  "Quanwan",      // Tsuen Wan, HK (cs-118)
  "Shatian",      // Sha Tin, HK (cs-129)
  "Shiongshui",   // Sheung Shui, HK (cs-134)
  "Xianggangdao", // Hong Kong Island (cs-161)
  "Xigong",       // Sai Kung, HK (cs-164)
  "Yuanlong",     // Yuen Long, HK (cs-184)
  "Zhunmen",      // Tuen Mun, HK (cs-197)
]);

type Status = "hit" | "blank_no_cn_postal" | "miss_too_far";

interface DatasetRow {
  file: "warehouses" | "customers";
  key: string;
  city: string;
  lat: number;
  lng: number;
}

interface GeoPoint {
  postalcode: string;
  placename: string;
  lat: number;
  lng: number;
}

interface ProvenanceRow {
  id: string;
  city: string;
  lat: number;
  lng: number;
  status: Status;
  assignedZip: string | null;
  matchDistanceKm: number | null;
  geonamesPlacename: string | null;
  geonamesCode: string | null;
}

// --- helpers ---------------------------------------------------------------

const R_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Trailing-zero count of a postal code string (city-level codes have more). */
function trailingZeros(code: string): number {
  let n = 0;
  for (let i = code.length - 1; i >= 0 && code[i] === "0"; i--) n++;
  return n;
}

/** Literal bounding boxes from the task spec — kept for provenance cross-check. */
function inHkBox(lat: number, lng: number): boolean {
  return lat >= 22.13 && lat <= 22.58 && lng >= 113.82 && lng <= 114.45;
}
function inMacauBox(lat: number, lng: number): boolean {
  return lat >= 22.1 && lat <= 22.23 && lng >= 113.52 && lng <= 113.61;
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmpPath, filePath);
}

function recomputeVersion(): void {
  const hash = createHash("sha256");
  for (const filename of [...PACKAGE_FILES].sort()) {
    hash.update(readFileSync(path.join(DATASET_DIR, filename)));
  }
  const versionPath = path.join(DATASET_DIR, "version.json");
  const current = JSON.parse(readFileSync(versionPath, "utf8")) as { version: number; sha256: string };
  atomicWriteJson(versionPath, { version: current.version + 1, sha256: hash.digest("hex") });
}

/** Appends the mandatory CC-BY GeoNames attribution to the dataset README (rule 7). */
function ensureReadmeAttribution(): void {
  const line = "Postal codes derived from GeoNames (https://www.geonames.org/), CC-BY 4.0.";
  if (existsSync(README_PATH)) {
    const body = readFileSync(README_PATH, "utf8");
    if (body.includes("GeoNames")) return; // already attributed
    writeFileSync(README_PATH, body.replace(/\n*$/, "\n") + "\n" + line + "\n");
  } else {
    writeFileSync(
      README_PATH,
      "# Chen's Cosmetics (China) dataset\n\n" +
        "Display-only postal codes on warehouse/customer rows are sourced externally.\n\n" +
        line + "\n",
    );
  }
}

// --- GeoNames download + parse --------------------------------------------

function downloadGeoNames(): GeoPoint[] {
  const tmpDir = path.join(os.tmpdir(), "geonames-cn-chens");
  const zipPath = path.join(tmpDir, "CN.zip");
  const txtPath = path.join(tmpDir, "CN.txt");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    execFileSync("curl", ["-sSL", "-o", zipPath, GEONAMES_URL], { stdio: "inherit" });
    execFileSync("unzip", ["-o", zipPath, "-d", tmpDir], { stdio: "inherit" });
  } catch (err) {
    throw new Error(`GeoNames download/unzip failed: ${(err as Error).message}`);
  }
  if (!existsSync(txtPath)) throw new Error(`CN.txt not found after unzip in ${tmpDir}`);

  const points: GeoPoint[] = [];
  for (const line of readFileSync(txtPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("\t");
    const postalcode = (f[1] ?? "").trim();
    const placename = (f[2] ?? "").trim();
    const lat = parseFloat(f[9]);
    const lng = parseFloat(f[10]);
    if (!postalcode || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({ postalcode, placename, lat, lng });
  }
  if (points.length === 0) throw new Error("Parsed zero usable GeoNames CN points");
  return points;
}

// --- matching --------------------------------------------------------------

function matchRow(row: DatasetRow, points: GeoPoint[]): ProvenanceRow {
  const base: ProvenanceRow = {
    id: row.key,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    status: "miss_too_far",
    assignedZip: null,
    matchDistanceKm: null,
    geonamesPlacename: null,
    geonamesCode: null,
  };

  // HK/Macau exclusion takes precedence over any distance match (rule 3).
  if (HK_MACAU_CITIES.has(row.city)) {
    return { ...base, status: "blank_no_cn_postal" };
  }

  // Nearest point + candidate set within TIE_EPS_KM of the minimum distance.
  let minD = Infinity;
  const dists: Array<{ p: GeoPoint; d: number }> = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const d = haversineKm(row.lat, row.lng, p.lat, p.lng);
    dists[i] = { p, d };
    if (d < minD) minD = d;
  }

  const nearest = dists.reduce((a, b) => (b.d < a.d ? b : a));

  if (minD > MATCH_RADIUS_KM) {
    // Record the nearest (too-far) candidate for audit; assign nothing.
    return {
      ...base,
      status: "miss_too_far",
      matchDistanceKm: Number(nearest.d.toFixed(3)),
      geonamesPlacename: nearest.p.placename,
      geonamesCode: nearest.p.postalcode,
    };
  }

  const candidates = dists.filter((x) => x.d <= minD + TIE_EPS_KM);
  candidates.sort((a, b) => {
    const tz = trailingZeros(b.p.postalcode) - trailingZeros(a.p.postalcode);
    if (tz !== 0) return tz; // more trailing zeros (city-level) first
    const na = Number(a.p.postalcode);
    const nb = Number(b.p.postalcode);
    return na - nb; // then lowest numeric code
  });
  const chosen = candidates[0];

  return {
    ...base,
    status: "hit",
    assignedZip: chosen.p.postalcode,
    matchDistanceKm: Number(chosen.d.toFixed(3)),
    geonamesPlacename: chosen.p.placename,
    geonamesCode: chosen.p.postalcode,
  };
}

// --- main ------------------------------------------------------------------

function main(): void {
  const whPath = path.join(DATASET_DIR, "warehouses.json");
  const csPath = path.join(DATASET_DIR, "customers.json");
  const warehouses = JSON.parse(readFileSync(whPath, "utf8")) as Record<
    string,
    { city: string; lat: number; lng: number; zip?: string }
  >;
  const customers = JSON.parse(readFileSync(csPath, "utf8")) as Record<
    string,
    { city: string; lat: number; lng: number; zip?: string }
  >;

  const rows: DatasetRow[] = [
    ...Object.entries(warehouses).map(([key, v]) => ({ file: "warehouses" as const, key, city: v.city, lat: v.lat, lng: v.lng })),
    ...Object.entries(customers).map(([key, v]) => ({ file: "customers" as const, key, city: v.city, lat: v.lat, lng: v.lng })),
  ];
  if (rows.length !== TOTAL_ROWS) {
    throw new Error(`Expected ${TOTAL_ROWS} rows, found ${rows.length} — dataset shape changed, aborting.`);
  }

  console.log(`[geocode-chens] downloading GeoNames CN from ${GEONAMES_URL} ...`);
  const points = downloadGeoNames(); // throws → aborts run, no writes
  console.log(`[geocode-chens] parsed ${points.length} GeoNames CN postal points.`);

  const provenance: ProvenanceRow[] = [];
  const zipById = new Map<string, string>();
  let hits = 0;
  let blanks = 0;
  let misses = 0;

  // Provenance cross-check: log every box-vs-enumerated-list discrepancy (rule 3 deviation).
  const boxDiscrepancies: string[] = [];

  for (const row of rows) {
    const p = matchRow(row, points);
    provenance.push(p);
    if (p.status === "hit") {
      hits++;
      zipById.set(row.key, p.assignedZip!);
    } else if (p.status === "blank_no_cn_postal") {
      blanks++;
    } else {
      misses++;
    }

    const inBox = inHkBox(row.lat, row.lng) || inMacauBox(row.lat, row.lng);
    const isBlank = p.status === "blank_no_cn_postal";
    if (inBox && !isBlank) {
      boxDiscrepancies.push(
        `${row.key} "${row.city}" (${row.lat},${row.lng}) is INSIDE a literal HK/Macau box but KEPT ` +
          `(mainland city, not in enumerated blank list) → ${p.assignedZip ?? p.status}`,
      );
    } else if (!inBox && isBlank) {
      boxDiscrepancies.push(
        `${row.key} "${row.city}" (${row.lat},${row.lng}) is OUTSIDE the literal boxes but BLANKED ` +
          `(enumerated HK/Macau territory)`,
      );
    }

    console.log(
      `[geocode-chens] ${row.key} "${row.city}" → ${p.status}` +
        (p.assignedZip ? ` (${p.assignedZip}, ${p.matchDistanceKm}km, ${p.geonamesPlacename})` : ""),
    );
  }

  const coverageRate = hits / TOTAL_ROWS;
  console.log(
    `\n[geocode-chens] ${hits} hits, ${blanks} blank_no_cn_postal, ${misses} miss_too_far / ${TOTAL_ROWS} rows` +
      ` — coverage ${(coverageRate * 100).toFixed(1)}%`,
  );
  if (boxDiscrepancies.length) {
    console.log(`[geocode-chens] box-vs-enumerated-list reconciliations (${boxDiscrepancies.length}):`);
    for (const d of boxDiscrepancies) console.log(`   - ${d}`);
  }

  // Always write provenance first (auditable even on abort; uncommitted if floor fails).
  mkdirSync(path.dirname(PROVENANCE_PATH), { recursive: true });
  atomicWriteJson(PROVENANCE_PATH, {
    source: "GeoNames CN postal export (https://download.geonames.org/export/zip/CN.zip)",
    license: "CC-BY 4.0",
    attribution: "Postal data © GeoNames, licensed CC-BY 4.0",
    retrievedVia: "nearest lat/lng within 25km, most-trailing-zeros tie-break, HK/Macau excluded",
    generatedAt: new Date().toISOString(),
    notes:
      "HK/Macau exclusion uses the task's enumerated 11-row list as the authoritative source: " +
      "the literal bounding boxes cannot separate the ~1km cross-border pairs Aomen/Zhuhai and " +
      "Shiongshui/Shenzhen (opposite decisions), and both miss Aomen while wrongly catching Shenzhen. " +
      "boxDiscrepancies lists every row where the literal box and the enumerated list disagree.",
    boxDiscrepancies,
    totals: {
      rows: rows.length,
      hits,
      blank_no_cn_postal: blanks,
      miss_too_far: misses,
      coverageRate: Number(coverageRate.toFixed(4)),
    },
    rows: provenance,
  });

  if (coverageRate < COVERAGE_FLOOR) {
    console.error(
      `[geocode-chens] coverage ${(coverageRate * 100).toFixed(1)}% is below the ${COVERAGE_FLOOR * 100}% floor` +
        ` — ABORTING with NO dataset write. warehouses/customers/version left untouched.` +
        ` Provenance written to ${PROVENANCE_PATH} for inspection.`,
    );
    process.exit(1);
  }

  // Passed the floor — splice zips onto hit rows ONLY (rule 6), recompute version, attribute.
  for (const [key, zip] of zipById) {
    if (key in warehouses) warehouses[key] = { ...warehouses[key], zip };
    else if (key in customers) customers[key] = { ...customers[key], zip };
  }
  atomicWriteJson(whPath, warehouses);
  atomicWriteJson(csPath, customers);
  recomputeVersion();
  ensureReadmeAttribution();
  console.log(`[geocode-chens] spliced ${zipById.size} zips; version.json recomputed; README attribution ensured.`);
}

main();
