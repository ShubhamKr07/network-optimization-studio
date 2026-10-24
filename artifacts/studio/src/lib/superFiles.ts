// SM2-4 (spec §7, D6) — CSV / XLSX <-> the §3.2 network document, entirely in the browser.
// The server stays the only validator: this module only reads cells into typed values.
import Papa from "papaparse";
import type { CellObject } from "xlsx";
import { csvText, XLSX_MIME } from "@/lib/clientCsv";
import type { DownloadFormat } from "@/components/data-table/DownloadMenu";

export type TableKey = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
interface Col { field: string; type: "text" | "number"; required: boolean }
const c = (field: string, type: Col["type"], required = true): Col => ({ field, type, required });
const LOC = [c("id", "text"), c("city", "text", false), c("state", "text", false), c("lat", "number"), c("lng", "number")];
/** QFX-7: location files written before `name` was removed still carry the column; it is accepted and its values discarded. */
export const LEGACY_LOCATION_COLUMNS = ["name"] as const;
export const SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[]; legacy?: readonly string[] }[] = [
  { key: "products", file: "products", cols: [c("id", "text"), c("name", "text")] },
  { key: "plants", file: "plants", cols: LOC, legacy: LEGACY_LOCATION_COLUMNS },
  { key: "warehouses", file: "warehouses", cols: [...LOC, c("status", "text", false)], legacy: LEGACY_LOCATION_COLUMNS },
  { key: "customers", file: "customers", cols: [...LOC, c("status", "text", false)], legacy: LEGACY_LOCATION_COLUMNS },
  { key: "plantProducts", file: "plant_products", cols: [c("plantId", "text"), c("productId", "text"), c("capacity", "number"), c("costPerUnit", "number")] },
  { key: "demand", file: "demand", cols: [c("customerId", "text"), c("productId", "text"), c("demand", "number")] },
  { key: "distanceOverrides", file: "distance_overrides", cols: [c("fromId", "text"), c("toId", "text"), c("miles", "number")] },
];
type TableFile = (typeof SUPER_TABLE_FILES)[number];
const tableFile = (key: TableKey): TableFile => SUPER_TABLE_FILES.find(t => t.key === key)!;

/** Collision-free composite key (matches the server's KEY / pairKey JSON.stringify keys, services/superNetwork.ts, SM2-3). */
export function superRowKey(table: TableKey, r: Record<string, unknown>): string {
  if (table === "plantProducts") return JSON.stringify([r.plantId, r.productId]);
  if (table === "demand") return JSON.stringify([r.customerId, r.productId]);
  if (table === "distanceOverrides") return JSON.stringify([r.fromId, r.toId]);
  return String(r.id ?? "");
}
export const PARAMETER_KEYS = ["p", "gap", "timeLimitSec", "distanceMethod", "circuityFactor",
  "transportCosts.icTransCost", "transportCosts.icMinTrans", "transportCosts.obTransCost", "transportCosts.obMinTrans"] as const;
const PARAMS = "parameters";

export interface Source { source: string; headerRow: number; rows: number[] }
export type Sources = Record<string, Source>;
export interface ParseError { where: string; message: string }
export type ParseResult = { ok: true; doc: Record<string, unknown>; sources: Sources } | { ok: false; errors: ParseError[] };

type Cell = { kind: "text"; v: string } | { kind: "number"; v: number } | { kind: "empty" } | { kind: "bad"; why: string };
interface Sheet { name: string; source: string; csv: boolean; firstRow: number; rows: Cell[][] }
const EMPTY: Cell = { kind: "empty" };
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const GUARDED = /^'[=+\-@\t\r]/;                       // reverses clientCsv.ts csvCell's prefix

/** FileReader, not File.text()/arrayBuffer(): jsdom's File has neither. Shared by every in-browser file parser. */
export const readFileAs = (file: File, how: "text" | "buffer") => new Promise<string | ArrayBuffer>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string | ArrayBuffer);
  r.onerror = () => reject(r.error);
  if (how === "text") r.readAsText(file); else r.readAsArrayBuffer(file);
});

function asText(cell: Cell, csv: boolean): string | null | { error: string } {
  if (cell.kind === "bad") return { error: cell.why };
  if (cell.kind === "number") return String(cell.v);
  if (cell.kind === "empty") return null;
  const t = cell.v.trim();
  if (t === "") return null;
  return csv && GUARDED.test(t) ? t.slice(1) : t;
}
function asNumber(cell: Cell): number | null | { error: string } {
  if (cell.kind === "bad") return { error: cell.why };
  if (cell.kind === "number") return Number.isFinite(cell.v) ? cell.v : { error: "is not a finite number" };
  if (cell.kind === "empty" || cell.v.trim() === "") return null;
  if (!NUMBER.test(cell.v.trim())) return { error: "is not a number" };
  const n = Number(cell.v.trim());
  return Number.isFinite(n) ? n : { error: "is not a finite number" };
}
const isBlank = (row: Cell[]) => row.every(x => x.kind === "empty" || (x.kind === "text" && x.v.trim() === ""));

function readSheet(sh: Sheet, cols: Col[], errors: ParseError[], legacy: readonly string[] = []): { rows: Record<string, unknown>[]; fileRows: number[] } {
  const header = (sh.rows[0] ?? []).map(h => asText(h, false));
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    if (h === null || typeof h === "object" || legacy.includes(h)) return;   // a legacy column is known, never read
    if (!cols.some(col => col.field === h)) errors.push({ where: `${sh.source} column ${h}`, message: "unknown column" });
    else if (at.has(h)) errors.push({ where: `${sh.source} column ${h}`, message: "duplicate column" });
    else at.set(h, i);
  });
  for (const col of cols) if (col.required && !at.has(col.field)) errors.push({ where: `${sh.source} column ${col.field}`, message: "required column is missing" });
  const rows: Record<string, unknown>[] = [], fileRows: number[] = [];
  sh.rows.slice(1).forEach((row, i) => {
    if (isBlank(row)) return;
    const rowNo = sh.firstRow + i + 1;
    const out: Record<string, unknown> = {};
    row.forEach((cell, idx) => {            // a value under no header is data we would silently drop
      if (typeof header[idx] === "string" || (cell.kind !== "bad" && isBlank([cell]))) return;
      errors.push({ where: `${sh.source} row ${rowNo} column position ${idx + 1}`, message: "has a value but no column header" });
    });
    for (const col of cols) {
      const idx = at.get(col.field);
      if (idx === undefined) continue;
      const cell = row[idx] ?? EMPTY;
      const v = col.type === "number" ? asNumber(cell) : asText(cell, sh.csv);
      const where = `${sh.source} row ${rowNo} column ${col.field}`;
      if (v !== null && typeof v === "object") errors.push({ where, message: v.error });
      else if (v === null) { if (col.required) errors.push({ where, message: "is required" }); }
      else out[col.field] = v;
    }
    rows.push(out); fileRows.push(rowNo);
  });
  return { rows, fileRows };
}

function readParameters(sh: Sheet, doc: Record<string, unknown>, sources: Sources, errors: ParseError[]): void {
  const { rows, fileRows } = readSheet(sh, [c("key", "text"), c("value", "text", false)], errors);
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const key = String(r.key), where = `${sh.source} row ${fileRows[i]}`;
    if (!(PARAMETER_KEYS as readonly string[]).includes(key)) return void errors.push({ where, message: `unknown parameter ${key}` });
    if (seen.has(key)) return void errors.push({ where, message: `duplicate parameter ${key}` });
    seen.add(key);
    if (r.value === undefined) return;                                   // empty value = absent (§7.2)
    let value: unknown = r.value;
    if (key !== "distanceMethod") {
      const n = asNumber({ kind: "text", v: String(r.value) });
      if (n === null || typeof n === "object") return void errors.push({ where: `${where} column value`, message: "is not a number" });
      value = n;
    }
    const [head, sub] = key.split(".");
    if (sub) doc[head] = { ...(doc[head] as Record<string, unknown> | undefined), [sub]: value };
    else doc[head] = value;
    sources[key] = { source: sh.source, headerRow: sh.firstRow, rows: [fileRows[i]] };
  });
}

function sheetsToDocument(sheets: Sheet[]): ParseResult {
  const errors: ParseError[] = [], doc: Record<string, unknown> = {}, sources: Sources = {};
  for (const sh of sheets) {
    if (sh.name === PARAMS) { readParameters(sh, doc, sources, errors); continue; }
    const t = SUPER_TABLE_FILES.find(x => x.file === sh.name);
    if (!t) { errors.push({ where: sh.source, message: sh.csv ? "unknown file name" : "unknown sheet name" }); continue; }
    const { rows, fileRows } = readSheet(sh, t.cols, errors, t.legacy);
    doc[t.key] = rows;
    sources[t.key] = { source: sh.source, headerRow: sh.firstRow, rows: fileRows };
  }
  return errors.length ? { ok: false, errors } : { ok: true, doc, sources };
}

export function parseJsonText(text: string): ParseResult {
  try {
    const v: unknown = JSON.parse(text);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return { ok: true, doc: v as Record<string, unknown>, sources: {} };
  } catch { /* fall through */ }
  return { ok: false, errors: [{ where: "file", message: "is not a valid network document (a JSON object)" }] };
}

function csvSheet(name: string, source: string, text: string, errors: ParseError[]): Sheet {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: "," });
  for (const e of parsed.errors) errors.push({ where: `${source} row ${(e.row ?? 0) + 1}`, message: e.message });
  return { name, source, csv: true, firstRow: 1, rows: parsed.data.map(r => r.map((v): Cell => (v === "" ? EMPTY : { kind: "text", v }))) };
}

export function parseCsvFiles(files: { name: string; text: string }[]): ParseResult {
  const sheets: Sheet[] = [], errors: ParseError[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    const stem = lower.endsWith(".csv") ? lower.slice(0, -4) : lower;
    if (stem === lower) { errors.push({ where: f.name, message: "unknown file name" }); continue; }
    sheets.push(csvSheet(stem, f.name, f.text, errors));
  }
  if (errors.length) return { ok: false, errors };
  return sheetsToDocument(sheets);
}

function xlsxCell(cell: CellObject | undefined): Cell {
  if (!cell || cell.t === "z") return EMPTY;
  if (cell.f !== undefined && cell.v === undefined) return { kind: "bad", why: "is a formula with no cached value" };
  if (cell.t === "n") return { kind: "number", v: cell.v as number };
  if (cell.t === "s") return cell.v === "" ? EMPTY : { kind: "text", v: String(cell.v) };
  if (cell.t === "b") return { kind: "text", v: String(cell.v) };
  if (cell.t === "d") return { kind: "bad", why: "is a date cell" };
  return { kind: "bad", why: "is an error cell" };
}

/** null = SheetJS could not read the bytes. */
async function readXlsxSheets(data: ArrayBuffer): Promise<Sheet[] | null> {
  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try { wb = XLSX.read(data, { type: "array", cellDates: true }); }
  catch { return null; }
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name], ref = ws["!ref"];
    const sheet: Sheet = { name, source: `sheet ${name}`, csv: false, firstRow: 1, rows: [] };
    if (!ref) return sheet;
    const r = XLSX.utils.decode_range(ref);
    sheet.firstRow = r.s.r + 1;
    for (let y = r.s.r; y <= r.e.r; y++) {
      const row: Cell[] = [];
      for (let x = r.s.c; x <= r.e.c; x++) row.push(xlsxCell(ws[XLSX.utils.encode_cell({ r: y, c: x })] as CellObject | undefined));
      sheet.rows.push(row);
    }
    return sheet;
  });
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParseResult> {
  const sheets = await readXlsxSheets(data);
  return sheets ? sheetsToDocument(sheets) : { ok: false, errors: [{ where: "workbook", message: "is not a readable .xlsx file" }] };
}

const tableSheetRows = (t: TableFile, rows: Record<string, unknown>[]): (string | number)[][] =>
  [t.cols.map(col => col.field), ...rows.map(r => t.cols.map(col => (r[col.field] ?? "") as string | number))];

/** Header + rows per table (every table, header-only when empty) + a key,value parameters sheet. */
function documentToSheets(doc: Record<string, unknown>): { name: string; rows: (string | number)[][] }[] {
  const out = SUPER_TABLE_FILES.map(t => ({ name: t.file, rows: tableSheetRows(t, (doc[t.key] as Record<string, unknown>[] | undefined) ?? []) }));
  const params: (string | number)[][] = [["key", "value"]];
  for (const key of PARAMETER_KEYS) {
    const [head, sub] = key.split(".");
    const v = sub ? (doc[head] as Record<string, unknown> | undefined)?.[sub] : doc[head];
    if (v !== undefined) params.push([key, v as string | number]);
  }
  return [...out, { name: PARAMS, rows: params }];
}

export function toCsvFiles(doc: Record<string, unknown>): { name: string; text: string }[] {
  return documentToSheets(doc).map(s => ({ name: `${s.name}.csv`, text: `${csvText(s.rows)}\n` }));
}
export async function toCsvZip(doc: Record<string, unknown>): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync(Object.fromEntries(toCsvFiles(doc).map(f => [f.name, strToU8(f.text)])));
}
async function sheetsToXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  // aoa_to_sheet writes strings as "s" cells and numbers as "n" cells, never formulas (spec §7.2).
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
export function toXlsx(doc: Record<string, unknown>): Promise<ArrayBuffer> {
  return sheetsToXlsx(documentToSheets(doc));
}

/** §7.1: path[0] -> file/sheet, path[1] -> file row via the row map, path[2] -> column. Contract: see the Task 4 Interfaces. */
export function describeIssue(issue: { path: (string | number)[]; message: string }, sources: Sources): string {
  const [head, second, third] = issue.path;
  const param = typeof second === "string" ? sources[`${head}.${second}`] : undefined;
  const src = param ?? sources[String(head)];
  if (!src) return `${issue.path.join(".")}: ${issue.message}`;
  if (param || (PARAMETER_KEYS as readonly string[]).includes(String(head))) return `${src.source} row ${src.rows[0]}: ${issue.message}`;
  if (typeof second !== "number") return `${src.source}: ${issue.message}`;
  const row = src.rows[second];
  if (row === undefined) return `${src.source} (unmapped row index ${second}): ${issue.message}`;   // never a guessed row (P4)
  const col = typeof third === "string" ? ` column ${third}` : "";
  return `${src.source} row ${row}${col}: ${issue.message}`;
}

export type TableParseResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; errors: ParseError[] };

/** QFX-2b — one super table from a per-table file. The format comes from the extension; the file and sheet NAMES never
 *  route (XLSX: first sheet only). Duplicate keys inside the file are rejected here, with the server's key rules
 *  (services/superNetwork.ts docDuplicateIssues; one table per file), before any Replace/Merge choice is offered. */
export async function parseSuperTableFile(tableKey: TableKey, file: File): Promise<TableParseResult> {
  const t = tableFile(tableKey), source = file.name, errors: ParseError[] = [];
  const fail = (message: string): TableParseResult => ({ ok: false, errors: [{ where: source, message }] });
  const ext = file.name.toLowerCase().split(".").pop();
  let rows: Record<string, unknown>[] = [], rowNos: number[] = [];
  try {
    if (ext === "json") {
      let v: unknown;
      try { v = JSON.parse(String(await readFileAs(file, "text"))); } catch { return fail("is not valid JSON"); }
      const list = v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 ? (v as Record<string, unknown>)[tableKey] : undefined;
      if (!Array.isArray(list) || !list.every(r => r !== null && typeof r === "object" && !Array.isArray(r))) return fail(`This file must contain only ${tableKey}.`);
      rows = list as Record<string, unknown>[];
      rowNos = rows.map((_, i) => i + 1);
    } else if (ext === "csv" || ext === "xlsx") {
      let sh: Sheet;
      if (ext === "csv") sh = csvSheet(t.file, source, String(await readFileAs(file, "text")), errors);
      else {
        const sheets = await readXlsxSheets((await readFileAs(file, "buffer")) as ArrayBuffer);
        if (!sheets) return fail("is not a readable .xlsx file");
        if (sheets.length === 0) return fail("The workbook has no sheets.");
        sh = { ...sheets[0]!, source };
      }
      ({ rows, fileRows: rowNos } = readSheet(sh, t.cols, errors, t.legacy));
    } else return fail("must be a .csv, .json or .xlsx file");
  } catch {
    return fail("could not be read");
  }
  const firstAt = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = superRowKey(tableKey, r), at = firstAt.get(k);
    if (at === undefined) firstAt.set(k, rowNos[i]!);
    else errors.push({ where: `${source} row ${rowNos[i]}`, message: `duplicate key (first at row ${at})` });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

/** QFX-2b — the per-table download: exactly the table's SUPER_TABLE_FILES columns, so the file is also a valid part of a
 *  whole-network import. Async because SheetJS is lazy-loaded (see sheetsToXlsx). */
export async function superTableToFile(tableKey: TableKey, rows: Record<string, unknown>[], format: DownloadFormat): Promise<{ blob: Blob; filename: string }> {
  const t = tableFile(tableKey);
  if (format === "json") return { blob: new Blob([JSON.stringify({ [tableKey]: rows }, null, 2)], { type: "application/json" }), filename: `${t.file}.json` };
  const sheet = tableSheetRows(t, rows);
  if (format === "csv") return { blob: new Blob([`${csvText(sheet)}\n`], { type: "text/csv" }), filename: `${t.file}.csv` };
  return { blob: new Blob([await sheetsToXlsx([{ name: t.file, rows: sheet }])], { type: XLSX_MIME }), filename: `${t.file}.xlsx` };
}
