// WATBOT — live smoke: ~10 questions per model against the real model and the loaded corpus.
// Spends real money; run only with explicit approval, and pass --confirm-spend.
// Prints message type, citation presence, search use, gap topic and cost. Writes nothing
// to the database. 429s wait retry-after through the engine's default gate (no queue in a CLI).
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { listModels } from "../registry/modelRegistry.js";
import { getWatBotClient, watbotModel } from "../watbot/client.js";
import { answerQuestion } from "../watbot/engine.js";
import { facilityNames } from "../watbot/facilities.js";
import { loadBundle } from "../watbot/passages.js";

const CROSS_CHAPTER = ["How should I aggregate customers before running this model?", "What is an optimized baseline and why compare against it?"];

async function main(): Promise<number> {
  if (!process.argv.includes("--confirm-spend")) {
    console.error("watbot-smoke spends real money (live model calls). Re-run with --confirm-spend after explicit approval.");
    return 2;
  }
  let total = 0;
  for (const m of listModels().filter((x) => x.tutor)) {
    const bundle = await loadBundle(m.tutor!.readingList);
    const fixedQuestions = m.tutor!.fixedQuestions.map((f) => f.text);
    for (const q of [...fixedQuestions, ...CROSS_CHAPTER]) {
      let searched = 0;
      const r = await answerQuestion({ client: getWatBotClient(), model: watbotModel(), bundle, readingList: m.tutor!.readingList,
        fixedQuestions, facilityNames: facilityNames(m.id), history: [], contextSummary: "", question: q, signal: new AbortController().signal,
        emit: (e) => { if (e.type === "searching") searched++; } });
      total += r.usage.costUsd;
      console.log(JSON.stringify({ model: m.id, q, type: r.messageType, blocks: r.blocks.length, cited: r.blocks.filter((b) => b.citations.length).length,
        removed: r.claimsRemoved, searched, gap: r.gapTopic, failed: r.failed, costUsd: r.usage.costUsd.toFixed(5) }));
    }
  }
  console.log(`TOTAL costUsd ${total.toFixed(4)}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
}
