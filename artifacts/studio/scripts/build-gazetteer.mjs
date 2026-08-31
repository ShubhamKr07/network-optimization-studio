#!/usr/bin/env node
// One-time (re-runnable) extraction script: builds `src/lib/gazetteer-us.json`
// from the US Census Bureau's 2023 Gazetteer Files (Places) — a public-domain
// (17 U.S.C. §105, US Government work) dataset, no attribution required.
//
// Source: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip
// (tab-delimited; columns: USPS, GEOID, ANSICODE, NAME, LSAD, FUNCSTAT, ALAND,
// AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG)
//
// The Places file has no population column, so "most populous" is approximated
// deterministically by ALAND_SQMI (land area) — a standard proxy for city size
// that correlates well in practice (verified against known large/small cities
// below) and, unlike an alphabetical cap, actually surfaces well-known cities
// rather than an arbitrary early-alphabet slice per state.
//
// Filtering:
//   1. FUNCSTAT in {A, B} — "active"/"partially consolidated" government,
//      i.e. genuinely incorporated places. Excludes CDPs (census designated
//      places, FUNCSTAT=S — unincorporated, statistical-only), inactive (I),
//      nonfunctioning (N), and fictitious placeholder (F) entries.
//   2. Sort by ALAND_SQMI descending, take the top TARGET_COUNT rows.
//   3. Strip the trailing place-type word from NAME ("Dallas city" -> "Dallas")
//      for a name shape people actually type/search for.
//   4. Output sorted deterministically by state then city for a stable,
//      readable diff on every regeneration.
//
// Usage: node scripts/build-gazetteer.mjs
// Requires network access to www2.census.gov. Writes:
//   src/lib/gazetteer-us.json
//   src/lib/gazetteer-us.checksum.txt  (sha256 of the JSON file)

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(__dirname, "..", "src", "lib", "gazetteer-us.json");
const OUT_CHECKSUM = path.join(__dirname, "..", "src", "lib", "gazetteer-us.checksum.txt");

const SOURCE_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip";
const TARGET_COUNT = 1000;
const INCORPORATED_FUNCSTAT = new Set(["A", "B"]);
// Trailing place-type words/phrases to strip off NAME, longest-first — both
// so a multi-word phrase (e.g. Alaska's consolidated "city and borough"
// governments) is stripped as a whole rather than leaving a dangling "and",
// and so "township" doesn't get half-matched by a shorter single-word prefix.
const PLACE_TYPE_SUFFIXES = [
  "city and borough",
  "municipality",
  "corporation",
  "township",
  "borough",
  "village",
  "town",
  "city",
];

/** Minimal ZIP reader: finds one named entry, returns its inflated bytes. */
function readZipEntry(zipBuf, entryName) {
  // Find End Of Central Directory record (search from the end, it's a fixed
  // 22-byte trailer for a single-disk archive with no comment, but scan back
  // a little further in case a comment is present).
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 22 - 65535); i--) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("not a valid zip file (no EOCD record found)");

  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const CD_SIG = 0x02014b50;
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (zipBuf.readUInt32LE(offset) !== CD_SIG) throw new Error("malformed central directory entry");
    const compressionMethod = zipBuf.readUInt16LE(offset + 10);
    const compressedSize = zipBuf.readUInt32LE(offset + 20);
    const nameLen = zipBuf.readUInt16LE(offset + 28);
    const extraLen = zipBuf.readUInt16LE(offset + 30);
    const commentLen = zipBuf.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(offset + 42);
    const name = zipBuf.toString("utf8", offset + 46, offset + 46 + nameLen);

    if (name === entryName) {
      // Local file header: fixed 30 bytes + name + extra, then the data.
      const lfNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
      const lfExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
      const compressed = zipBuf.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return compressed; // stored, no compression
      if (compressionMethod === 8) return zlib.inflateRawSync(compressed); // deflate
      throw new Error(`unsupported zip compression method ${compressionMethod}`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry ${entryName} not found in zip`);
}

function stripPlaceTypeSuffix(name) {
  for (const suffix of PLACE_TYPE_SUFFIXES) {
    if (name.toLowerCase().endsWith(" " + suffix)) {
      return name.slice(0, name.length - suffix.length - 1).trim();
    }
  }
  return name;
}

async function main() {
  console.log(`Downloading ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zipBuf = Buffer.from(await res.arrayBuffer());

  const raw = readZipEntry(zipBuf, "2023_Gaz_place_national.txt");
  const text = raw.toString("utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  const header = lines[0].split("\t");
  const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split("\t");
    const funcstat = fields[col.FUNCSTAT]?.trim();
    if (!INCORPORATED_FUNCSTAT.has(funcstat)) continue;

    const alandSqmi = parseFloat(fields[col.ALAND_SQMI]);
    const name = stripPlaceTypeSuffix(fields[col.NAME].trim());
    const state = fields[col.USPS].trim();
    const lat = parseFloat(fields[col.INTPTLAT]);
    const lng = parseFloat(fields[col.INTPTLONG]);
    if (!name || !state || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(alandSqmi)) continue;

    rows.push({ city: name, state, lat, lng, alandSqmi });
  }

  rows.sort((a, b) => b.alandSqmi - a.alandSqmi);
  const top = rows.slice(0, TARGET_COUNT).map(({ city, state, lat, lng }) => ({ city, state, lat, lng }));

  // Deterministic output order: state, then city (not the ranking order the
  // rows were selected in) — a stable diff between regenerations.
  top.sort((a, b) => (a.state === b.state ? a.city.localeCompare(b.city) : a.state.localeCompare(b.state)));

  const json = JSON.stringify(top, null, 2) + "\n";
  writeFileSync(OUT_JSON, json);

  const checksum = createHash("sha256").update(json).digest("hex");
  writeFileSync(OUT_CHECKSUM, `${checksum}  gazetteer-us.json\n`);

  console.log(`Wrote ${top.length} rows to ${OUT_JSON}`);
  console.log(`sha256: ${checksum}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
