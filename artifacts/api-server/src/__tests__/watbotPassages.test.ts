// artifacts/api-server/src/__tests__/watbotPassages.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { gte } from "drizzle-orm";
import { db, coursePassagesTable } from "@workspace/db";
import { loadBundle, searchBook, getPassage, maxBundleTokens, resetMaxBundleTokensForTests } from "../watbot/passages.js";
import { bundleTokens, reservationUsd } from "../watbot/cost.js";

// Fixture chapters 901-903 cannot collide with the real corpus (book has 15 chapters).
beforeAll(async () => {
  await db.delete(coursePassagesTable).where(gte(coursePassagesTable.chapter, 900));
  await db.insert(coursePassagesTable).values([
    { sourceKind: "book", chapter: 901, locator: "2", ordinal: 2, label: "Ch 901 · p.2", body: "second page about capacity" },
    { sourceKind: "book", chapter: 901, locator: "1", ordinal: 1, label: "Ch 901 · p.1", body: "first page about warehouses" },
    { sourceKind: "book", chapter: 902, locator: "1", ordinal: 1, label: "Ch 902 · p.1", body: "aggregation of customers into zones (quokkafixture)" },
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
    // A fixture-only word: a shared nos_dev may hold the real corpus, whose pages would outrank the fixture.
    const hits = await searchBook("customer aggregation quokkafixture", []);
    expect(hits.map((h) => h.label)).toContain("Ch 902 · p.1");
  });
  it("excludes passages already in the bundle", async () => {
    const hits = await searchBook("customer aggregation quokkafixture", [{ kind: "book", chapter: 902 }]);
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

describe("maxBundleTokens (cap-status worst case)", () => {
  it("equals the admission reservation for the largest bundle, memoised per process", async () => {
    resetMaxBundleTokensForTests();
    // Largest list deliberately last and not the only non-empty one.
    const lists = [[{ kind: "book" as const, chapter: 902 }], [{ kind: "book" as const, chapter: 903 }],
      [{ kind: "book" as const, chapter: 901 }, { kind: "notebook" as const, chapter: 901 }]];
    const perList = await Promise.all(lists.map(async (rl) => bundleTokens(await loadBundle(rl))));
    expect(Math.max(...perList)).toBeGreaterThan(perList[0]!); // the fixture really has a unique largest
    const status = reservationUsd("claude-haiku-5-5", await maxBundleTokens(lists));
    const admission = Math.max(...perList.map((t) => reservationUsd("claude-haiku-5-5", t)));
    expect(status).toBe(admission);
    expect(await maxBundleTokens([])).toBe(await maxBundleTokens(lists)); // memoised: a later call reuses the first value
    resetMaxBundleTokensForTests();
  });
});
