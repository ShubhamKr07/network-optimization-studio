// QFX-2a — XLSX for the chapter per-table menus: CSV text -> one-sheet workbook (download), first sheet -> CSV text (upload).
import { describe, it, expect, vi, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { csvTextToXlsxBlob, xlsxFileToCsvText } from "@/lib/xlsxFile";
import { downloadAs, XLSX_MIME } from "@/lib/clientCsv";
import { readFileAs } from "@/lib/superFiles";

const readBook = async (blob: Blob) =>
  XLSX.read((await readFileAs(new File([blob], "x.xlsx"), "buffer")) as ArrayBuffer, { type: "array" });
const xlsxFile = (sheets: Record<string, (string | number)[][]>, name = "book.xlsx") => {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer], name, { type: XLSX_MIME });
};
// SheetJS refuses to WRITE a workbook with no sheets ("Workbook is empty"), so this is a hand-zipped minimal package.
const noSheetFile = () => {
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
  return new File([zip], "empty.xlsx", { type: XLSX_MIME });
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("csvTextToXlsxBlob (QFX-2a)", () => {
  it("one sheet named sheetName, same header; only plain decimals become numbers; '=' text is never a formula", async () => {
    const blob = csvTextToXlsxBlob("id,city,lat,note\n007,\"Atlanta, GA\",33.749001234567,'=SUM(A1)\n12,,-84.5,=x\n01.5,1e5,0,x\n", "warehouses");
    expect(blob.type).toBe(XLSX_MIME);
    const wb = await readBook(blob);
    expect(wb.SheetNames).toEqual(["warehouses"]);
    const ws = wb.Sheets.warehouses!;
    const cell = (a: string) => ({ t: ws[a]?.t, v: ws[a]?.v, f: ws[a]?.f });
    expect(["A1", "B1", "C1", "D1"].map(a => ws[a]?.v)).toEqual(["id", "city", "lat", "note"]);
    expect(cell("A2")).toEqual({ t: "s", v: "007", f: undefined });
    expect(cell("B2")).toEqual({ t: "s", v: "Atlanta, GA", f: undefined });
    expect(cell("C2")).toEqual({ t: "n", v: 33.749001234567, f: undefined });
    expect(cell("D2")).toEqual({ t: "s", v: "'=SUM(A1)", f: undefined });   // server CSV guard kept verbatim
    expect(cell("A3")).toEqual({ t: "n", v: 12, f: undefined });
    expect(cell("B3")).toEqual({ t: "s", v: "", f: undefined });            // blank -> text cell
    expect(cell("C3")).toEqual({ t: "n", v: -84.5, f: undefined });
    expect(cell("D3")).toEqual({ t: "s", v: "=x", f: undefined });
    expect(cell("A4")).toEqual({ t: "s", v: "01.5", f: undefined });
    expect(cell("B4")).toEqual({ t: "s", v: "1e5", f: undefined });
    expect(ws["!ref"]).toBe("A1:D4");                                        // the trailing newline adds no row
  });
});

describe("xlsxFileToCsvText (QFX-2a)", () => {
  it("converts the FIRST sheet only (its name and the other sheets are ignored) at full number precision", async () => {
    const r = await xlsxFileToCsvText(xlsxFile({ Anything: [["id", "lat"], ["007", 33.749001234567], ["CHI", 0.30000000000000004]], second: [["junk"], ["x"]] }));
    expect(r).toEqual({ ok: true, csvText: "id,lat\n007,33.749001234567\nCHI,0.30000000000000004" });
  });
  it("a workbook with no sheets", async () => {
    expect(await xlsxFileToCsvText(noSheetFile())).toEqual({ ok: false, message: "The workbook has no sheets." });
  });
  it("a first sheet with no header row (later sheets are not consulted)", async () => {
    expect(await xlsxFileToCsvText(xlsxFile({ blank: [], data: [["id"], ["x"]] }))).toEqual({ ok: false, message: "The first sheet is empty." });
  });
});

describe("downloadAs xlsx (QFX-2a)", () => {
  it("saves <base>.xlsx: a one-sheet workbook named base, built from the CSV text", async () => {
    // jsdom has no URL.createObjectURL, so spyOn cannot attach; assign mocks (restored in afterEach).
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await downloadAs("assignments", "xlsx", "a,b\n1,x\n");
    expect(names).toEqual(["assignments.xlsx"]);
    const blob = created.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe(XLSX_MIME);
    const wb = await readBook(blob);
    expect(wb.SheetNames).toEqual(["assignments"]);
    expect(XLSX.utils.sheet_to_csv(wb.Sheets.assignments!)).toBe("a,b\n1,x");
  });
  it("refuses a non-CSV payload", async () => {
    await expect(downloadAs("x", "xlsx", { rows: [] })).rejects.toThrow("XLSX downloads are built from CSV text");
  });
});
