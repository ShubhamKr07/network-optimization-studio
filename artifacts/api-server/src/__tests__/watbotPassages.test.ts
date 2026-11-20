// artifacts/api-server/src/__tests__/watbotPassages.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { gte } from "drizzle-orm";
import { db, coursePassagesTable } from "@workspace/db";
import { loadBundle, searchBook, getPassage } from "../watbot/passages.js";

// Fixture chapters 901-903 cannot collide with the real corpus (book has 15 chapters).
beforeAll(async () => {
  await db.delete(coursePassagesTable).where(gte(coursePassagesTable.chapter, 900));
  await db.insert(coursePassagesTable).values([
    { sourceKind: "book", chapter: 901, locator: "2", ordinal: 2, label: "Ch 901 · p.2", body: "second page about capacity" },
    { sourceKind: "book", chapter: 901, locator: "1", ordinal: 1, label: "Ch 901 · p.1", body: "first page about warehouses" },
    { sourceKind: "book", chapter: 902, locator: "1", ordinal: 1, label: "Ch 902 · p.1", body: "aggregation of customers into zones" },
    { sourceKind: "notebook", chapter: 901, locator: "4", ordinal: 4, label: "NB 901 · cell 4", body: "solver code cell" },
  ]);
});
afterAll(async () => {
  await db.delete(coursePassagesTable).where(gte(coursePassagesTable.chapter, 900));
});

describe("loadBundle", () => {
  it("returns one doc per reading-list entry, pages in ordinal order", async () => {
    const docs = await loadBundle([{ kind: "book", chapter: 901 }, { kind: "notebook", chapter: 901 }]);
    expect(docs.map((d) => d.title)).toEqual(["Chapter 901", "Notebook 901"]);
    expect(docs[0]!.passages.map((p) => p.label)).toEqual(["Ch 901 · p.1", "Ch 901 · p.2"]);
  });
  it("skips reading-list entries with no passages (corpus not yet ingested)", async () => {
    expect(await loadBundle([{ kind: "book", chapter: 903 }])).toEqual([]);
  });
});

describe("searchBook", () => {
  it("finds a matching passage (non-vacuity: the probe can return rows)", async () => {
    const hits = await searchBook("customer aggregation", []);
    expect(hits.map((h) => h.label)).toContain("Ch 902 · p.1");
  });
  it("excludes passages already in the bundle", async () => {
    const hits = await searchBook("customer aggregation", [{ kind: "book", chapter: 902 }]);
    expect(hits.map((h) => h.label)).not.toContain("Ch 902 · p.1");
  });
  it("returns [] for a query with no lexemes instead of throwing", async () => {
    expect(await searchBook("the of and", [])).toEqual([]);
  });
});

describe("getPassage", () => {
  it("returns undefined for an unknown id", async () => {
    expect(await getPassage(-1)).toBeUndefined();
  });
});
