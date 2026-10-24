/**
 * DU-1.5 — captures one real solved `result` per model into
 * e2e/fixtures/solved/<modelId>.json. Run BY HAND against a LOCAL api-server;
 * it is not part of any gate.
 *
 *   pnpm exec tsx e2e/scripts/capture-solved-results.ts http://localhost:<api-port>
 *
 * Refuses any host other than localhost / 127.0.0.1 (it registers throwaway
 * accounts and creates scenarios, which must never happen against a deployed
 * service).
 *
 * The per-model inputs live in helpers/solvedModelInputs.ts (shared with the
 * spec; read its header for the deliberate deviations from the UI defaults).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOLVED_MODEL_INPUTS as INPUTS, SUPER_SAMPLE_PATH } from "../helpers/solvedModelInputs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "../fixtures/solved");

const base = process.argv[2];
if (!base) throw new Error("usage: capture-solved-results.ts http://localhost:<api-port>");
const host = new URL(base).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`refusing non-local host "${host}" — this script only runs against a local api-server`);
}

let cookie = "";
async function api(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const email = `e2e-capture-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const reg = await api("POST", "/auth/register", { email, password: "correcthorse1" });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);

  for (const modelId of Object.keys(INPUTS)) {
    let inputs = INPUTS[modelId];
    if (modelId === "super-model") {
      const c = await api("POST", "/scenarios", { name: `capture ${modelId}`, modelId, inputs });
      if (c.status !== 201) throw new Error(`${modelId}: create ${c.status} ${JSON.stringify(c.json)}`);
      const imp = await api("POST", `/scenarios/${c.json.id}/network/import?mode=replace`, JSON.parse(fs.readFileSync(SUPER_SAMPLE_PATH, "utf8")));
      if (imp.status !== 200) throw new Error(`${modelId}: import ${imp.status} ${JSON.stringify(imp.json)}`);
      await solveAndWrite(modelId, c.json.id);
      continue;
    }
    const c = await api("POST", "/scenarios", { name: `capture ${modelId}`, modelId, inputs });
    if (c.status !== 201) throw new Error(`${modelId}: create ${c.status} ${JSON.stringify(c.json)}`);
    await solveAndWrite(modelId, c.json.id);
  }
  console.log(`wrote ${fs.readdirSync(OUT_DIR).length} fixtures to ${OUT_DIR}`);
}

async function solveAndWrite(modelId: string, id: number) {
  const s = await api("POST", `/scenarios/${id}/solve`);
  if (s.status !== 202) throw new Error(`${modelId}: solve ${s.status} ${JSON.stringify(s.json)}`);
  const jobId = s.json.jobId;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const j = await api("GET", `/scenarios/${id}/solve-jobs/${jobId}`);
    if (j.json?.status === "succeeded") break;
    if (j.json?.status === "failed" || j.json?.status === "cancelled") throw new Error(`${modelId}: job ${j.json.status} ${JSON.stringify(j.json)}`);
    if (Date.now() > deadline) throw new Error(`${modelId}: solve timed out after 120s`);
    await new Promise(r => setTimeout(r, 1000));
  }
  const g = await api("GET", `/scenarios/${id}`);
  if (!g.json?.result) throw new Error(`${modelId}: scenario has no result after succeeded job`);
  fs.writeFileSync(path.join(OUT_DIR, `${modelId}.json`), JSON.stringify(g.json.result, null, 2) + "\n");
  console.log(`captured ${modelId} (scenario ${id})`);
}

main().catch(e => { console.error(e); process.exit(1); });
