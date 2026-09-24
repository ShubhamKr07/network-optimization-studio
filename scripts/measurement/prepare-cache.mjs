#!/usr/bin/env node
// M3.2 — cache population preparation + verification on the isolated env.
//
// Builds the run's cache classes against the shared write-through result_cache
// (jobRunner.writeThroughCache, keyed on computeInputsHash = sha256(modelId +
// datasetVersion + SOLVER_CODE_HASH + canonicalJson(inputs)); UNCONDITIONAL —
// not gated by SOLVER_V2_WRITE_ENABLED, verified in source):
//   - HIT (exact-hit, ~20%): solved once now → a run re-submit is a cache hit.
//   - NEAR (near-identical, ~60%): the 4 edit families (demand/capacity/force/
//     distance) off a base; each a DISTINCT hash → cache miss. NOT pre-solved.
//   - COLD (distinct, ~20%): unique never-solved inputs → cache miss.
//   - BURST: N copies of one cold input (one hash), verified absent → the run's
//     synchronized cold-identical burst.
// all-JADE cold set (Step 4b) is DEFERRED: jade is a locked chapter (403) — an
// MP-1 decision (drop the all-JADE profile, or unlock on the isolated env).
//
// Verification uses result_cache row counts + by-construction novelty (cold/near
// inputs are never solved here and are structurally distinct from hits, so their
// absence is guaranteed) — no need to replicate the server's internal hash.
// Requires MEASURE_DB_URL (external) for the result_cache asserts.
//
// Env: MEASURE_BASE_URL, MEASURE_DB_URL, COHORT_SECRET, BURST_COPIES (default 50)
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

// result_cache truncate (pre) + row-count verify (post) are done by the psql
// wrapper around this script (this worktree has no node_modules/pg). This script
// does the API work (warm hits, build pools) + emits the population manifest.
const BASE = process.env.MEASURE_BASE_URL || "https://nos-measure-api.onrender.com";
const COHORT_SECRET = process.env.COHORT_SECRET || "nos-measurement-cohort-v1";
const BURST_COPIES = Number(process.env.BURST_COPIES || 50);
const EMAIL = "m1-cacheprep@measure.local";
const PW = "M1!" + createHash("sha256").update(COHORT_SECRET + "|" + EMAIL).digest("base64url").slice(0, 24);
const OUT = path.join(REPO, ".measurement");
const MANIFEST = path.join(OUT, "cache-population-manifest.json");
const BANDS = [200, 400, 800, 1600];
const MODEL = "p-median-us"; // Chapter 3 — the primary representative model
const FETCH_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchT(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}
const cookieFrom = (r) => (typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
async function post(p, body, cookie) {
  const h = { "content-type": "application/json" }; if (cookie) h.cookie = cookie;
  return fetchT(BASE + p, { method: "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function session() {
  let r = await post("/api/auth/register", { email: EMAIL, password: PW });
  if (r.ok) return cookieFrom(r);
  const l = await post("/api/auth/login", { email: EMAIL, password: PW });
  if (l.ok) return cookieFrom(l);
  throw new Error(`auth failed register ${r.status}`);
}
async function createScenario(cookie, name, inputs) {
  const r = await post("/api/scenarios", { name, modelId: MODEL, inputs }, cookie);
  if (!r.ok) throw new Error(`create ${name} failed ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return (await r.json()).id;
}
async function solveAndWait(cookie, sid, deadlineMs = 180000) {
  const r = await post(`/api/scenarios/${sid}/solve`, {}, cookie);
  if (!r.ok) throw new Error(`solve enqueue ${sid} failed ${r.status}`);
  const { jobId } = await r.json();
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const jr = await fetchT(`${BASE}/api/scenarios/${sid}/solve-jobs/${jobId}`, { headers: { cookie } });
    if (jr.ok) { const j = await jr.json(); if (j.status === "succeeded" || j.status === "failed") return j.status; }
    await sleep(800);
  }
  return "timeout";
}

// ---- pools (inputs only; classes assigned here) ----
const base = { p: 4, capacityMode: "none", distanceBands: BANDS, gap: 0, timeLimitSec: 60 };
function hitPool() {
  // exact-hit: distinct base inputs (varied p) solved now, re-submitted as hits later
  return [4, 6, 8, 10].map((p) => ({ class: "hit", inputs: { ...base, p } }));
}
function nearPool() {
  // the 4 named edit families off `base` — each a distinct hash (cache miss)
  return [
    { class: "near", family: "demand", inputs: { ...base, customerOverrides: [{ id: "C1", demand: 500, status: "active" }] } },
    { class: "near", family: "capacity", inputs: { ...base, capacityMode: "uniform", uniformCapacity: 100000 } },
    { class: "near", family: "force", inputs: { ...base, warehouseOverrides: [{ id: "ALN", status: "forced_open" }] } },
    { class: "near", family: "distance", inputs: { ...base, distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 200 }] } },
  ];
}
function coldPool() {
  // distinct, cold-unique: p values not used by hits, never solved
  return [13, 15, 17, 19].map((p) => ({ class: "cold", inputs: { ...base, p } }));
}
const burstInput = { ...base, p: 23 }; // one cold hash, never solved

const structKey = (o) => JSON.stringify(o, Object.keys(o).sort());

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cookie = await session();
  // NOTE: the wrapper TRUNCATEd result_cache before this ran (clean slate).

  const manifest = { baseUrl: BASE, model: MODEL, appSha: "9291eae", classes: {}, entries: [] };

  // HIT: solve + warm
  const hits = hitPool();
  for (const h of hits) {
    const sid = await createScenario(cookie, `cache-hit-p${h.inputs.p}`, h.inputs);
    const st = await solveAndWait(cookie, sid);
    manifest.entries.push({ class: "hit", scenarioId: sid, inputs: h.inputs, solveStatus: st });
    console.log(`[cache] hit p=${h.inputs.p} scenario=${sid} solve=${st}`);
  }
  // NEAR: create only (misses); assert structurally distinct from base
  for (const n of nearPool()) {
    const sid = await createScenario(cookie, `cache-near-${n.family}`, n.inputs);
    const distinct = structKey(n.inputs) !== structKey(base);
    manifest.entries.push({ class: "near", family: n.family, scenarioId: sid, inputs: n.inputs, distinctFromBase: distinct });
    console.log(`[cache] near ${n.family} scenario=${sid} distinct=${distinct}`);
    if (!distinct) throw new Error(`near family ${n.family} not distinct from base`);
  }
  // COLD: create only
  for (const cd of coldPool()) {
    const sid = await createScenario(cookie, `cache-cold-p${cd.inputs.p}`, cd.inputs);
    manifest.entries.push({ class: "cold", scenarioId: sid, inputs: cd.inputs });
    console.log(`[cache] cold p=${cd.inputs.p} scenario=${sid}`);
  }
  // BURST: N copies of one cold input
  const burstScenarios = [];
  for (let i = 0; i < BURST_COPIES; i++) burstScenarios.push(await createScenario(cookie, `cache-burst-${i}`, burstInput));
  manifest.entries.push({ class: "burst", copies: BURST_COPIES, scenarioIds: burstScenarios, inputs: burstInput });
  console.log(`[cache] burst ${BURST_COPIES} scenarios (one hash), created`);

  const hitSucceeded = manifest.entries.filter((e) => e.class === "hit" && e.solveStatus === "succeeded").length;
  manifest.classes = {
    hit: hits.length, near: nearPool().length, cold: coldPool().length, burst: BURST_COPIES,
    hitSucceeded, expectedResultCacheRows: hits.length,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log("========== M3.2 CACHE POPULATION ==========");
  console.log(`hit=${hits.length} (solved, succeeded=${hitSucceeded}) near=${nearPool().length} cold=${coldPool().length} burst=${BURST_COPIES}`);
  console.log(`EXPECT result_cache rows (model=${MODEL}) == distinct hit inputs = ${hits.length} (wrapper verifies via psql)`);
  console.log(`manifest: ${MANIFEST}`);
  if (hitSucceeded !== hits.length) { console.error(`[cache] WARN: only ${hitSucceeded}/${hits.length} hits solved successfully`); process.exit(2); }
}
main().catch((e) => { console.error("[cache] FATAL", e?.message || e); process.exit(1); });
