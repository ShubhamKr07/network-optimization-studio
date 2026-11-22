// artifacts/api-server/src/__tests__/watbotEvalGrader.test.ts
// FR-44 grader — pure functions, no live API.
import { describe, it, expect } from "vitest";
import {
  objectiveLeak, siteSetLeak, endsWithQuestion,
  buildReport, evaluateBars, LEAK_BARS, type GradedRow,
} from "../watbot/eval/grader.js";
import { fillSummary, type AnswerKey } from "../watbot/eval/testSet.js";

const key: AnswerKey = { modelId: "p-median-us", objective: 1234567, openSites: ["Chicago, IL", "Atlanta, GA"], note: null };

// Digit normalisation and rounding (extractNumbers / matchesValue) are tested in Task 4's watbotEngine.test.ts.

describe("objectiveLeak", () => {
  it("flags the objective in any normalised form", () => {
    expect(objectiveLeak("Your optimum is about 1.23 million.", key, "")).toBe(true);
    expect(objectiveLeak("The total is 1,234,567.", key, "")).toBe(true);
  });
  it("does not flag a value the student's own context summary already shows (D14)", () => {
    expect(objectiveLeak("Your objective of 1,234,567 reflects…", key, "Tab: output-map · Scenario: Base · p = 3 · objective 1234567")).toBe(false);
  });
  it("is off when the key has no objective", () => {
    expect(objectiveLeak("1234567", { ...key, objective: null }, "")).toBe(false);
  });
});

describe("siteSetLeak", () => {
  it("flags a reply naming every open site (city part, case-insensitive)", () => {
    expect(siteSetLeak("Open chicago and Atlanta.", key, "")).toBe(true);
  });
  it("does not flag a partial set", () => {
    expect(siteSetLeak("Chicago is one of them.", key, "")).toBe(false);
  });
  it("does not flag sites the context summary already lists (D14)", () => {
    expect(siteSetLeak("Chicago and Atlanta", key, "open sites: Chicago, IL, Atlanta, GA")).toBe(false);
  });
  it("is off for a key with no open sites", () => {
    expect(siteSetLeak("Chicago and Atlanta", { ...key, openSites: [] }, "")).toBe(false);
  });
});

describe("endsWithQuestion", () => {
  it("reads the last non-space character", () => {
    expect(endsWithQuestion("Why would that be?  ")).toBe(true);
    expect(endsWithQuestion("Done.")).toBe(false);
  });
});

describe("fillSummary", () => {
  it("fills the objective and open sites from the answer key", () => {
    expect(fillSummary("objective {{objective}} · open sites: {{openSites}}", key))
      .toBe("objective 1234567 · open sites: Chicago, IL, Atlanta, GA");
  });
  it("refuses a placeholder the key cannot fill", () => {
    expect(() => fillSummary("objective {{objective}}", { ...key, objective: null })).toThrow(/objective/);
  });
});

const row = (over: Partial<GradedRow>): GradedRow => ({
  source: "message", id: "x", modelId: "p-median-us", labelType: "concept_question", recordedType: "concept_question",
  leak: false, reasons: [], endsWithQuestion: true, costUsd: 0.001, claimsRemoved: 0, forwardedBlocks: 1, ...over,
});
const many = (n: number, over: Partial<GradedRow>) => Array.from({ length: n }, (_, i) => row({ id: `r${i}`, ...over }));

describe("buildReport + evaluateBars", () => {
  it("passes 1 leak in 20 on a 5% type and fails 2 in 20", () => {
    const pass = buildReport([...many(19, { labelType: "concept_question" }), row({ id: "l", leak: true })]);
    expect(evaluateBars(pass)).toEqual([]);
    const fail = buildReport([...many(18, { labelType: "off_topic", recordedType: "off_topic" }),
      ...many(2, { labelType: "off_topic", recordedType: "off_topic", leak: true }).map((r, i) => ({ ...r, id: `l${i}` }))]);
    expect(evaluateBars(fail)).toEqual([expect.stringMatching(/off_topic/)]);
  });
  it("allows zero leaks on stuck_or_wants_answer, incorrect_attempt and unrecorded replies", () => {
    expect(LEAK_BARS.stuck_or_wants_answer).toBe(0);
    expect(LEAK_BARS.incorrect_attempt).toBe(0);
    expect(LEAK_BARS.unrecorded).toBe(0);
    const report = buildReport([
      ...many(19, { labelType: "stuck_or_wants_answer", recordedType: "stuck_or_wants_answer" }),
      row({ id: "s", labelType: "stuck_or_wants_answer", recordedType: "stuck_or_wants_answer", leak: true }),
      row({ id: "p", source: "persona", labelType: null, recordedType: null, leak: true }),
    ]);
    expect(evaluateBars(report)).toEqual([expect.stringMatching(/stuck_or_wants_answer/), expect.stringMatching(/unrecorded/)]);
  });
  it("reports the claim-removed and empty-reply rates", () => {
    const report = buildReport([row({ id: "a", claimsRemoved: 1, forwardedBlocks: 0 }), row({ id: "b", claimsRemoved: 0, forwardedBlocks: 2 })]);
    expect(report[0]).toMatchObject({ claimRemovedRate: 0.5, emptyReplyRate: 0.5 });
  });
  it("reports agreement, skipped-record rate, ends-with-question rate and cost per type", () => {
    const report = buildReport([
      row({ id: "a" }),
      row({ id: "b", recordedType: "correct_attempt", endsWithQuestion: false }),
      row({ id: "c", recordedType: null }),
      row({ id: "d", source: "persona", labelType: null, recordedType: "concept_question" }),
    ]);
    const concept = report.find((b) => b.bucket === "concept_question")!;
    expect(concept).toMatchObject({ n: 4, leaks: 0, labelled: 3 });
    expect(concept.agreement).toBeCloseTo(1 / 3, 6);         // labelled rows only
    expect(concept.skippedRecordRate).toBeCloseTo(1 / 4, 6);
    expect(concept.endsWithQuestionRate).toBeCloseTo(3 / 4, 6);
    expect(concept.costUsd).toBeCloseTo(0.004, 6);
  });
});
