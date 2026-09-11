import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRow, readRows, hasValue } from "../harness/lib/csv.js";

const HEADER = ["task_id", "branch", "notes"];

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "csv-"));
  const f = join(dir, "tasks.csv");
  writeFileSync(f, HEADER.join(",") + "\n");
  return f;
}

describe("csv append/read", () => {
  it("appends a row and reads it back", () => {
    const f = freshFile();
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "x", notes: "hi" });
    const rows = readRows(f, HEADER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ task_id: "OBS-2", branch: "x", notes: "hi" });
  });

  it("quotes fields containing commas, quotes, and newlines", () => {
    const f = freshFile();
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "a,b", notes: 'he said "hi"\nline2' });
    const rows = readRows(f, HEADER);
    expect(rows[0].branch).toBe("a,b");
    expect(rows[0].notes).toBe('he said "hi"\nline2');
  });

  it("rejects a duplicate dedupeKey without force", () => {
    const f = freshFile();
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "x", notes: "" }, { dedupeKey: "task_id" });
    expect(() =>
      appendRow(f, HEADER, { task_id: "OBS-2", branch: "y", notes: "" }, { dedupeKey: "task_id" }),
    ).toThrow(/duplicate/i);
    expect(readRows(f, HEADER)).toHaveLength(1);
  });

  it("allows a duplicate dedupeKey with force", () => {
    const f = freshFile();
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "x", notes: "" }, { dedupeKey: "task_id" });
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "y", notes: "" }, { dedupeKey: "task_id", force: true });
    expect(readRows(f, HEADER)).toHaveLength(2);
  });

  it("asserts the file header matches", () => {
    const f = freshFile();
    expect(() => appendRow(f, ["wrong", "header"], { wrong: "1", header: "2" })).toThrow(/header/i);
  });

  it("hasValue reports membership", () => {
    const f = freshFile();
    appendRow(f, HEADER, { task_id: "OBS-2", branch: "x", notes: "" });
    expect(hasValue(f, HEADER, "task_id", "OBS-2")).toBe(true);
    expect(hasValue(f, HEADER, "task_id", "OBS-9")).toBe(false);
  });
});
