import { readFileSync, appendFileSync } from "node:fs";

export interface AppendOpts {
  /** If set, throw when a row with this column value already exists (unless force). */
  dedupeKey?: string;
  force?: boolean;
}

/** Quote a field iff it contains a comma, double-quote, CR, or LF (RFC-4180). */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Parse CSV text into an array of string arrays, honoring quotes and embedded newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush a trailing field/row not terminated by a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function assertHeader(file: string, header: string[]): string[][] {
  const text = readFileSync(file, "utf8");
  const rows = parseCsv(text);
  const fileHeader = rows[0] ?? [];
  if (fileHeader.join(",") !== header.join(",")) {
    throw new Error(
      `header mismatch in ${file}: expected [${header.join(",")}], found [${fileHeader.join(",")}]`,
    );
  }
  return rows;
}

/** Read all data rows (excluding the header) as objects keyed by `header`. */
export function readRows(file: string, header: string[]): Record<string, string>[] {
  const rows = assertHeader(file, header);
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] ?? "";
    });
    return obj;
  });
}

/** True iff any data row has `col === value`. */
export function hasValue(file: string, header: string[], col: string, value: string): boolean {
  return readRows(file, header).some((r) => r[col] === value);
}

/** Append one row (object keyed by `header`); asserts header, optionally dedupes. */
export function appendRow(
  file: string,
  header: string[],
  row: Record<string, string>,
  opts: AppendOpts = {},
): void {
  assertHeader(file, header);
  if (opts.dedupeKey && !opts.force) {
    const key = opts.dedupeKey;
    if (hasValue(file, header, key, row[key] ?? "")) {
      throw new Error(`duplicate ${key}: ${row[key]} already in ${file} (use --force to override)`);
    }
  }
  const line = header.map((h) => escapeField(row[h] ?? "")).join(",");
  appendFileSync(file, line + "\n");
}
