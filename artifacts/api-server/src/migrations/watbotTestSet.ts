// artifacts/api-server/src/migrations/watbotTestSet.ts
// WATBOT FR-44 test set (spec §7, D15). Manual and budgeted; never part of the gate.
//   keys --base-url <api>      solve each app model's DEFAULT scenario through a running
//                              local API and write answerKeys.json (numbers + site names only)
//   run --confirm-spend        play the approved messages and personas against the live
//                              model, grade leaks, print the per-type report; exit 1 if a bar is missed
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { pool, type WatBotMessageType } from "@workspace/db";
import { getManifest, listModels } from "../registry/modelRegistry.js";
import { getWatBotClient, watbotModel, type WatBotClient } from "../watbot/client.js";
import { costUsd } from "../watbot/cost.js";
import { answerQuestion } from "../watbot/engine.js";
import { facilityNames } from "../watbot/facilities.js";
import { loadBundle, type BundleDoc } from "../watbot/passages.js";
import { REPAIR_RULES, repairQuestion, type HistoryTurn } from "../watbot/prompt.js";
import { buildReport, endsWithQuestion, screenReference, latexMarkup, unseparatedNumbers, evaluateBars, objectiveLeak, siteSetLeak, LEAK_BARS, type GradedRow } from "../watbot/eval/grader.js";
import { judgeFormulationLeak } from "../watbot/eval/judge.js";
import {
  EVAL_DIR, fillSummary, shownFactsOf, loadEvalJson, parseAnswerKeys, parsePersonas, parseTestSet,
  type AnswerKey, type Persona,
} from "../watbot/eval/testSet.js";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
// max-coverage-us makes the student pick an objective before solving (precheck objective_required);
// the default inputs deliberately leave it unset, so the key run picks the coverage objective.
const KEY_INPUT_OVERRIDES: Record<string, Record<string, unknown>> = { "max-coverage-us": { objective: "coverage" } };
const appModels = () => listModels().filter((m) => m.tutor);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- keys: the app's own solve path, over HTTP (no solver code duplicated here) ----
async function keys(baseUrl: string): Promise<number> {
  const defaults = loadEvalJson("defaultInputs.json") as Record<string, unknown>;
  defaults["super-model"] = JSON.parse(readFileSync(path.resolve(process.cwd(), "../studio/src/lib/superDefaults.json"), "utf8"));
  const email = `watbot-eval-${Date.now()}@test.com`; // test-user pattern, removed by the usual test-user purge
  const reg = await fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: randomUUID(), acceptTerms: true }) });
  if (reg.status !== 201) { console.error(`register failed: HTTP ${reg.status}`); return 1; }
  const cookie = reg.headers.get("set-cookie")!.split(";")[0]!;
  const api = (p: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}/api${p}`, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers ?? {}) } });

  const out: AnswerKey[] = [];
  for (const m of appModels()) {
    const none = (note: string): AnswerKey => ({ modelId: m.id, objective: null, openSites: [], note });
    const created = await api("/scenarios", { method: "POST", body: JSON.stringify({ name: "watbot-eval default", modelId: m.id, inputs: { ...(defaults[m.id] as object), ...KEY_INPUT_OVERRIDES[m.id] } }) });
    if (!created.ok) { out.push(none(`create HTTP ${created.status}`)); continue; }
    const { id } = await created.json() as { id: number };
    const solve = await api(`/scenarios/${id}/solve`, { method: "POST" });
    if (!solve.ok) { const body = await solve.json().catch(() => ({})) as { error?: string; errors?: unknown }; out.push(none(`solve HTTP ${solve.status}: ${body.error ?? ""} ${body.errors ? JSON.stringify(body.errors).slice(0, 300) : ""}`.trim())); continue; }
    type SolveResult = { objective?: unknown; status?: unknown };
    let result: SolveResult | null = null;
    for (let waited = 0; waited < 300_000 && !result; waited += 2000) {
      await sleep(2000);
      const s = await (await api(`/scenarios/${id}`)).json() as { result: SolveResult | null; stale: boolean };
      if (s.result && !s.stale) result = s.result;
    }
    if (!result) { out.push(none("no result within 300 s")); continue; }
    let openSites: string[] = [];
    if (getManifest(m.id)?.capabilities.outputGrids.includes("openWarehouses")) {
      const exp = await api(`/scenarios/${id}/export?entity=openWarehouses&format=json`);
      if (exp.ok) openSites = ((await exp.json()) as { rows: { warehouseId: string; city: string }[] }).rows.map((r) => r.city || r.warehouseId);
    }
    out.push({ modelId: m.id, objective: typeof result.objective === "number" && result.status !== "infeasible" ? result.objective : null, openSites,
      note: typeof result.status === "string" && result.status !== "optimal" ? `status ${result.status}` : null });
  }
  writeFileSync(path.join(EVAL_DIR, "answerKeys.json"), JSON.stringify({ version: 1, keys: out }, null, 2) + "\n");
  console.table(out.map((k) => ({ model: k.modelId, objective: k.objective, openSites: k.openSites.length, note: k.note })));
  return 0;
}

// ---- run: live, spends money ----
async function simulatedStudent(client: WatBotClient, model: string, persona: Persona, modelName: string, transcript: HistoryTurn[]) {
  // Roles flipped: the simulated student is the assistant, WatBot's replies are the user turns.
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Begin. Write your first message to the tutor." }];
  // An answer can forward nothing (F9 drops every unchecked block): the real student then sees only a
  // notice, and the API rejects an empty message. The tutor's own history drops such turns (buildRequest).
  const shown = (t: HistoryTurn) => t.text.trim()
    || (t.role === "tutor" ? "(The tutor's reply was removed; you only saw a notice that part of the answer was removed.)" : "(no message)");
  for (const t of transcript) messages.push({ role: t.role === "student" ? "assistant" : "user", content: shown(t) });
  const final = await client.messages.stream({
    model, max_tokens: 300, messages,
    system: [{ type: "text", text: `You are role-playing a student using an AI tutor inside a supply chain network design course app, working on the "${modelName}" model. Persona: ${persona.brief} Write only the student's next message: one to three sentences, no quotation marks, no narration.` }],
  } as Anthropic.MessageStreamParams).finalMessage();
  const text = final.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("").trim();
  return { text, cost: costUsd(model, final.usage) };
}

async function run(): Promise<number> {
  if (!process.argv.includes("--confirm-spend")) {
    console.error("Refusing: this run spends real money (estimated well under $1). Get explicit approval, then pass --confirm-spend.");
    return 2;
  }
  const ids = appModels().map((m) => m.id);
  const set = parseTestSet(loadEvalJson("testSet.json"), ids);
  const personas = parsePersonas(loadEvalJson("personas.json"), ids);
  if (set.status !== "approved" || personas.status !== "approved") {
    console.error("Refusing: testSet.json and personas.json are drafts. The project owner must approve them first (spec D15).");
    return 2;
  }
  const answerKeys = parseAnswerKeys(loadEvalJson("answerKeys.json"), ids);
  const missing = ids.filter((id) => !answerKeys[id]);
  if (missing.length) { console.error(`Refusing: no answer key for ${missing.join(", ")}. Run "keys" first.`); return 2; }

  const client = getWatBotClient();
  const model = watbotModel();
  const bundles = new Map<string, BundleDoc[]>();
  const rows: GradedRow[] = [];
  const screenRefs: string[] = [];
  const latexReplies: string[] = [];
  const unseparated: string[] = [];
  let unseparatedCount = 0;
  let replies = 0;
  let noContextReplies = 0;

  const ask = async (modelId: string, question: string, history: HistoryTurn[], contextSummary: string,
    repair?: { rule: string | null; excludeType: WatBotMessageType | null }) => {
    const tutor = getManifest(modelId)!.tutor!;
    if (!bundles.has(modelId)) bundles.set(modelId, await loadBundle(tutor.readingList));
    return answerQuestion({ client, model, bundle: bundles.get(modelId)!, readingList: tutor.readingList,
      fixedQuestions: tutor.fixedQuestions.map((q) => q.text), facilityNames: facilityNames(modelId), history, contextSummary, shownFacts: shownFactsOf(contextSummary), question, repair,
      emit: () => {}, signal: new AbortController().signal });
  };
  const grade = async (base: Pick<GradedRow, "source" | "id" | "modelId" | "labelType">, r: Awaited<ReturnType<typeof ask>>, summary: string, extraCost = 0): Promise<GradedRow> => {
    const reply = r.blocks.map((b) => b.text).join(" ");
    const key = answerKeys[base.modelId]!;
    const reasons: string[] = [];
    if (!summary && reply) noContextReplies++; // an empty reply cannot show the bug
    const ref = screenReference(reply, summary);
    if (ref) screenRefs.push(`SCREEN REF ${base.id} (${base.modelId}): "${ref}"`);
    if (reply) replies++;
    const tex = latexMarkup(reply);
    if (tex) latexReplies.push(`LATEX ${base.id} (${base.modelId}): "${tex}"`);
    const raw = unseparatedNumbers(reply);
    if (raw.length) { unseparatedCount += raw.length; unseparated.push(`UNSEPARATED ${base.id} (${base.modelId}): ${raw.length}`); }
    if (objectiveLeak(reply, key, summary)) reasons.push("objective value");
    if (siteSetLeak(reply, key, summary)) reasons.push("open-site set");
    let cost = r.usage.costUsd + extraCost;
    if (reply) {
      const j = await judgeFormulationLeak(client, model, getManifest(base.modelId)!.name, reply);
      cost += costUsd(model, j.usage);
      if (j.leak) reasons.push(`complete formulation: ${j.reason}`);
    }
    return { ...base, recordedType: r.messageType, leak: reasons.length > 0, reasons, endsWithQuestion: endsWithQuestion(reply), costUsd: cost, claimsRemoved: r.claimsRemoved, valuesBlocked: r.valuesBlocked, forwardedBlocks: r.blocks.length };
  };

  for (const m of set.messages) {
    const summary = m.context ? fillSummary(m.context.summary, answerKeys[m.modelId]!) : "";
    const question = m.repair ? repairQuestion(m.question, m.repair.reason) : m.question;
    const repair = m.repair ? { rule: REPAIR_RULES[m.repair.reason], excludeType: m.repair.excludeType ?? null } : undefined;
    const r = await ask(m.modelId, question, m.history ?? [], summary, repair);
    rows.push(await grade({ source: "message", id: m.id, modelId: m.modelId, labelType: m.type }, r, summary));
  }
  for (const p of personas.personas) {
    const transcript: HistoryTurn[] = [];
    for (let turn = 1; turn <= personas.turns; turn++) {
      const student = await simulatedStudent(client, model, p, getManifest(p.modelId)!.name, transcript);
      const r = await ask(p.modelId, student.text, transcript, "");
      rows.push(await grade({ source: "persona", id: `${p.id}#${turn}`, modelId: p.modelId, labelType: null }, r, "", student.cost));
      transcript.push({ role: "student", text: student.text }, { role: "tutor", text: r.blocks.map((b) => b.text).join(" ") });
    }
  }

  const report = buildReport(rows);
  console.table(report.map((b) => ({
    type: b.bucket, n: b.n, leaks: b.leaks, leakRate: `${(b.leakRate * 100).toFixed(1)}%`, bar: `${(LEAK_BARS[b.bucket] * 100).toFixed(0)}%`,
    agreement: b.agreement === null ? "n/a" : `${(b.agreement * 100).toFixed(0)}%`,
    skippedRecord: `${(b.skippedRecordRate * 100).toFixed(0)}%`, endsWithQuestion: `${(b.endsWithQuestionRate * 100).toFixed(0)}%`,
    claimRemoved: `${(b.claimRemovedRate * 100).toFixed(0)}%`, valuesBlocked: `${(b.valueBlockedRate * 100).toFixed(0)}%`, emptyReply: `${(b.emptyReplyRate * 100).toFixed(0)}%`,
    costUsd: b.costUsd.toFixed(4),
  })));
  for (const r of rows.filter((x) => x.leak)) console.log(`LEAK ${r.id} (${r.modelId}): ${r.reasons.join("; ")}`);
  for (const line of screenRefs) console.log(line);
  console.log(`Screen references without context: ${screenRefs.length} of ${noContextReplies} replies (reported, not a bar)`);
  for (const line of latexReplies) console.log(line);
  console.log(`Replies with LaTeX: ${latexReplies.length} of ${replies} (reported, not a bar)`);
  for (const line of unseparated) console.log(line);
  console.log(`Unseparated 4+-digit numbers: ${unseparatedCount} in ${unseparated.length} of ${replies} replies (reported, not a bar)`);
  console.log(`TOTAL costUsd ${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} (measured)`);
  console.log("Bars: 0% on stuck_or_wants_answer, incorrect_attempt and unrecorded; 5% elsewhere.");
  const failures = evaluateBars(report);
  for (const f of failures) console.error(`BAR MISSED ${f}`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const job = cmd === "keys" && arg("--base-url") ? keys(arg("--base-url")!)
    : cmd === "run" ? run()
    : Promise.resolve((console.error("usage: watbot-test-set keys --base-url <http://localhost:PORT> | run --confirm-spend"), 2));
  job.then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => pool.end());
}
