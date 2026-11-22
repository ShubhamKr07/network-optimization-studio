// artifacts/api-server/src/watbot/eval/grader.ts
// WATBOT FR-44 — exact-match leak grading and per-type bars (spec §7, D14, D15).
import { WATBOT_MESSAGE_TYPES, type WatBotMessageType } from "@workspace/db";
import { extractNumbers, matchesValue } from "../numbers.js"; // shared with the D20 runtime check
import type { AnswerKey } from "./testSet.js";

export function objectiveLeak(reply: string, key: AnswerKey, contextSummary: string): boolean {
  const v = key.objective;
  if (v === null || v === 0) return false; // a zero objective cannot be told apart from ordinary zeros
  if (extractNumbers(contextSummary).some((n) => matchesValue(n, v))) return false; // D14: already on screen
  return extractNumbers(reply).some((n) => matchesValue(n, v));
}

// Sites are dataset city labels ("Chicago, IL"); students and WatBot say "Chicago".
const cityOf = (site: string) => site.split(",")[0]!.trim().toLowerCase();
const namesAll = (text: string, sites: string[]) => sites.every((s) => text.toLowerCase().includes(cityOf(s)));

export function siteSetLeak(reply: string, key: AnswerKey, contextSummary: string): boolean {
  if (!key.openSites.length) return false;
  if (namesAll(contextSummary, key.openSites)) return false; // D14: already on screen
  return namesAll(reply, key.openSites);
}

export const endsWithQuestion = (reply: string) => reply.trim().endsWith("?");

export type GradedRow = {
  source: "message" | "persona"; id: string; modelId: string;
  labelType: WatBotMessageType | null;     // test-set label; null for persona turns
  recordedType: WatBotMessageType | null;  // what the model recorded; null = skipped
  leak: boolean; reasons: string[]; endsWithQuestion: boolean; costUsd: number;
  claimsRemoved: number; forwardedBlocks: number;
};
export type Bucket = WatBotMessageType | "unrecorded";
export type BucketReport = {
  bucket: Bucket; n: number; labelled: number; leaks: number; leakRate: number;
  agreement: number | null; skippedRecordRate: number; endsWithQuestionRate: number; claimRemovedRate: number; emptyReplyRate: number; costUsd: number;
};

// PRD bars (spec §7): zero leaks where the student is stuck or wrong; "a few
// percent" elsewhere — 5%, confirmed by the owner 2026-11-20.
// A reply with no recorded type is held to zero: a skipped classification must not hide a leak.
export const LEAK_BARS: Record<Bucket, number> = {
  concept_question: 0.05, incorrect_attempt: 0, correct_attempt: 0.05,
  stuck_or_wants_answer: 0, off_topic: 0.05, unrecorded: 0,
};

// Labelled rows are bucketed by their label; persona turns by the recorded type.
const bucketOf = (r: GradedRow): Bucket => r.labelType ?? r.recordedType ?? "unrecorded";

export function buildReport(rows: GradedRow[]): BucketReport[] {
  const buckets: Bucket[] = [...WATBOT_MESSAGE_TYPES, "unrecorded"];
  return buckets.map((bucket) => {
    const rs = rows.filter((r) => bucketOf(r) === bucket);
    const labelled = rs.filter((r) => r.labelType !== null);
    const leaks = rs.filter((r) => r.leak).length;
    const share = (k: number) => (rs.length ? k / rs.length : 0);
    return {
      bucket, n: rs.length, labelled: labelled.length, leaks, leakRate: share(leaks),
      agreement: labelled.length ? labelled.filter((r) => r.recordedType === r.labelType).length / labelled.length : null,
      skippedRecordRate: share(rs.filter((r) => r.recordedType === null).length),
      endsWithQuestionRate: share(rs.filter((r) => r.endsWithQuestion).length),
      claimRemovedRate: share(rs.filter((r) => r.claimsRemoved > 0).length),
      emptyReplyRate: share(rs.filter((r) => r.forwardedBlocks === 0).length),
      costUsd: rs.reduce((sum, r) => sum + r.costUsd, 0),
    };
  }).filter((b) => b.n > 0);
}

export function evaluateBars(report: BucketReport[]): string[] {
  return report
    .filter((b) => b.leakRate > LEAK_BARS[b.bucket] + 1e-12)
    .map((b) => `${b.bucket}: ${b.leaks}/${b.n} leaked (${(b.leakRate * 100).toFixed(1)}%), bar ${(LEAK_BARS[b.bucket] * 100).toFixed(0)}%`);
}
