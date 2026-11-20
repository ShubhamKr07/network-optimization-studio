// artifacts/api-server/src/__tests__/watbotCorpus.test.ts
import { describe, it, expect } from "vitest";
import { parseCorpusFile, bundleTokenReport, assertHostConfirmed, BUNDLE_TOKEN_LIMIT } from "../watbot/corpus.js";

const page = (chapter: number, locator: string, chars: number, sourceKind: "book" | "notebook" = "book") => ({
  sourceKind, chapter, locator, ordinal: Number(locator), label: `Ch ${chapter} · p.${locator}`, body: "x".repeat(chars),
});

describe("parseCorpusFile", () => {
  it("accepts a valid v1 file", () => {
    expect(parseCorpusFile({ version: 1, passages: [page(3, "38", 10)] })).toHaveLength(1);
  });
  it.each([
    [{ version: 2, passages: [] }, /version/],
    [{ version: 1, passages: [{ ...page(3, "38", 10), body: "" }] }, /body/],
    [{ version: 1, passages: [page(3, "38", 10), page(3, "38", 10)] }, /duplicate/],
    [{ version: 1, passages: [{ ...page(3, "38", 10), sourceKind: "slides" }] }, /sourceKind/],
  ])("rejects %j", (input, msg) => {
    expect(() => parseCorpusFile(input)).toThrow(msg);
  });
});

describe("bundleTokenReport", () => {
  it("sums chars/4 over the reading list only", () => {
    const passages = parseCorpusFile({ version: 1, passages: [page(3, "1", 400), page(2, "1", 40), page(9, "1", 4000)] });
    const report = bundleTokenReport(passages, [{ id: "m", tutor: { readingList: [{ kind: "book", chapter: 3 }, { kind: "book", chapter: 2 }], fixedQuestions: [] } }]);
    expect(report).toEqual([{ modelId: "m", tokens: 110 }]);
  });
  it("exposes the 100K Haiku price-tier bound", () => {
    expect(BUNDLE_TOKEN_LIMIT).toBe(100_000);
  });
});

describe("assertHostConfirmed", () => {
  it("allows localhost without confirmation", () => {
    expect(() => assertHostConfirmed("postgresql://u@localhost:5432/nos_dev", undefined)).not.toThrow();
  });
  it("refuses a remote host unless --confirm-host matches it exactly", () => {
    const url = "postgresql://u:p@db.example.internal:5432/x";
    expect(() => assertHostConfirmed(url, undefined)).toThrow(/Refusing/);
    expect(() => assertHostConfirmed(url, "other.host")).toThrow(/Refusing/);
    expect(() => assertHostConfirmed(url, "db.example.internal")).not.toThrow();
  });
});
