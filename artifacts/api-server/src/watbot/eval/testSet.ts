// artifacts/api-server/src/watbot/eval/testSet.ts
// WATBOT FR-44 — test-set, persona and answer-key files: types, validation, loaders.
import { readFileSync } from "node:fs";
import path from "node:path";
import { WATBOT_MESSAGE_TYPES, type WatBotMessageType } from "@workspace/db";
import { isRepairReason, REPAIR_REASONS, type HistoryTurn, type WatBotRepairReason } from "../prompt.js";

// Resolved from the package root: `pnpm --filter api-server …` and vitest both run there.
export const EVAL_DIR = path.resolve(process.cwd(), "src/watbot/eval");

type Approval = { status: "draft" | "approved"; approvedBy: string | null; approvedOn: string | null };

export type TestMessage = {
  id: string; modelId: string; type: WatBotMessageType; question: string;
  history?: HistoryTurn[];                 // e.g. the tutor question an attempt answers
  repair?: { reason: WatBotRepairReason; excludeType?: WatBotMessageType }; // re-answer case; `type` stays the expected type
  context: { summary: string } | null;     // route-format summary; {{objective}} / {{openSites}} filled from the answer key
};
export type TestSetFile = Approval & { version: 1; messages: TestMessage[] };
export type Persona = { id: string; name: string; modelId: string; brief: string };
export type PersonasFile = Approval & { version: 1; turns: number; personas: Persona[] };
// Numbers and site names only (spec §7): no book text, no formulation.
export type AnswerKey = { modelId: string; objective: number | null; openSites: string[]; note: string | null };

export class EvalFileError extends Error {}
const fail = (msg: string): never => { throw new EvalFileError(msg); };

export function loadEvalJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(EVAL_DIR, name), "utf8"));
}

function parseApproval(f: { status?: unknown; approvedBy?: unknown; approvedOn?: unknown }, file: string): Approval {
  if (f.status !== "draft" && f.status !== "approved") fail(`${file}: status must be "draft" or "approved"`);
  if (f.status === "approved" && (typeof f.approvedBy !== "string" || typeof f.approvedOn !== "string")) {
    fail(`${file}: an approved file needs approvedBy and approvedOn`);
  }
  return { status: f.status as Approval["status"], approvedBy: (f.approvedBy as string | null) ?? null, approvedOn: (f.approvedOn as string | null) ?? null };
}

export function parseTestSet(json: unknown, modelIds: string[]): TestSetFile {
  const f = json as Partial<TestSetFile>;
  if (f?.version !== 1) fail("testSet.json: version must be 1");
  if (!Array.isArray(f.messages)) fail("testSet.json: messages must be an array");
  const seen = new Set<string>();
  for (const [i, m] of f.messages!.entries()) {
    const at = `testSet.json messages[${i}]`;
    if (typeof m.id !== "string" || !m.id || seen.has(m.id)) fail(`${at}: id missing or duplicate`);
    seen.add(m.id);
    if (!modelIds.includes(m.modelId)) fail(`${at}: unknown modelId ${m.modelId}`);
    if (!(WATBOT_MESSAGE_TYPES as readonly string[]).includes(m.type)) fail(`${at}: unknown type ${m.type}`);
    if (typeof m.question !== "string" || !m.question.trim() || m.question.length > 2000) fail(`${at}: question must be 1-2000 chars`);
    if (m.history !== undefined && (!Array.isArray(m.history) || m.history.some((h) => (h.role !== "student" && h.role !== "tutor") || typeof h.text !== "string"))) {
      fail(`${at}: history must be [{role: "student"|"tutor", text}]`);
    }
    if (m.repair !== undefined) {
      if (!isRepairReason(m.repair?.reason)) fail(`${at}: repair.reason must be one of ${REPAIR_REASONS.join(", ")}`);
      if (!m.history?.length) fail(`${at}: a repair case needs the history up to the answer being repaired`);
    }
    if (m.context !== null && typeof m.context?.summary !== "string") fail(`${at}: context must be null or {summary}`);
  }
  return { ...parseApproval(f, "testSet.json"), version: 1, messages: f.messages! };
}

export function parsePersonas(json: unknown, modelIds: string[]): PersonasFile {
  const f = json as Partial<PersonasFile>;
  if (f?.version !== 1) fail("personas.json: version must be 1");
  if (!Number.isInteger(f.turns) || f.turns! < 1) fail("personas.json: turns must be a positive integer");
  if (!Array.isArray(f.personas)) fail("personas.json: personas must be an array");
  for (const [i, p] of f.personas!.entries()) {
    if (!p.id || !p.name || !p.brief) fail(`personas.json personas[${i}]: id, name and brief are required`);
    if (!modelIds.includes(p.modelId)) fail(`personas.json personas[${i}]: unknown modelId ${p.modelId}`);
  }
  return { ...parseApproval(f, "personas.json"), version: 1, turns: f.turns!, personas: f.personas! };
}

export function parseAnswerKeys(json: unknown, modelIds: string[]): Record<string, AnswerKey> {
  const f = json as { version?: unknown; keys?: AnswerKey[] };
  if (f?.version !== 1 || !Array.isArray(f.keys)) fail("answerKeys.json: expected {version: 1, keys: [...]}");
  const out: Record<string, AnswerKey> = {};
  for (const k of f.keys!) {
    if (!modelIds.includes(k.modelId)) fail(`answerKeys.json: unknown modelId ${k.modelId}`);
    if (k.objective !== null && typeof k.objective !== "number") fail(`answerKeys.json ${k.modelId}: objective must be a number or null`);
    if (!Array.isArray(k.openSites) || k.openSites.some((s) => typeof s !== "string")) fail(`answerKeys.json ${k.modelId}: openSites must be strings`);
    out[k.modelId] = k;
  }
  return out;
}

// Fills a route-format context summary from the answer key, so a "solved" test
// context shows exactly what the student's screen would (spec D14).
export function fillSummary(summary: string, key: AnswerKey): string {
  if (summary.includes("{{objective}}") && key.objective === null) fail(`${key.modelId}: summary needs {{objective}} but the key has none`);
  if (summary.includes("{{openSites}}") && !key.openSites.length) fail(`${key.modelId}: summary needs {{openSites}} but the key has none`);
  return summary.replaceAll("{{objective}}", String(key.objective)).replaceAll("{{openSites}}", key.openSites.join(", "));
}
