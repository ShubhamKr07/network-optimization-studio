// WATBOT — load the course corpus prepared in nos-ops-private into course_passages.
// Dry run by default. Writes only with --execute; a non-local DATABASE_URL also
// needs --confirm-host <host>. Runbook: docs/ops/watbot-corpus.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pool, coursePassagesTable } from "@workspace/db";
import { listModels } from "../registry/modelRegistry.js";
import { parseCorpusFile, bundleTokenReport, assertHostConfirmed, BUNDLE_TOKEN_LIMIT } from "../watbot/corpus.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const file = arg("--file");
  if (!file) { console.error("usage: watbot-ingest-corpus --file <corpus.json> [--execute] [--confirm-host <host>]"); return 2; }
  const passages = parseCorpusFile(JSON.parse(readFileSync(file, "utf8")));
  const report = bundleTokenReport(passages, listModels());
  console.log(JSON.stringify({ passages: passages.length, bundles: report }, null, 2));
  const over = report.filter((r) => r.tokens >= BUNDLE_TOKEN_LIMIT);
  if (over.length) { console.error(`Refusing: bundles over ${BUNDLE_TOKEN_LIMIT} tokens: ${over.map((o) => o.modelId).join(", ")}`); return 1; }
  if (!process.argv.includes("--execute")) { console.log("Dry run — pass --execute to write."); return 0; }
  assertHostConfirmed(process.env.DATABASE_URL!, arg("--confirm-host"));
  // ponytail: upsert only, passages removed from the file stay in the table; add a prune flag if a page is ever withdrawn.
  await db.transaction(async (tx) => {
    for (const p of passages) {
      await tx.insert(coursePassagesTable).values(p).onConflictDoUpdate({
        target: [coursePassagesTable.sourceKind, coursePassagesTable.chapter, coursePassagesTable.locator],
        set: { ordinal: p.ordinal, label: p.label, body: p.body, updatedAt: sql`now()` },
      });
    }
  });
  console.log(`Upserted ${passages.length} passages.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => pool.end());
}
