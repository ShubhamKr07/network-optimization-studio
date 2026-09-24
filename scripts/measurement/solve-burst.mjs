#!/usr/bin/env node
// Exploratory SHAKEDOWN (non-authoritative, excluded from any decision dataset):
// a 50-request solve burst against Chapter 3 (p-median-us) on the isolated
// measurement env. Exercises A's async solve queue + worker pool under a
// synchronized burst. Reports enqueue latency, end-to-end time, and terminal
// status spread. NOT an MP-1-gated authoritative run.
//
// Env: MEASURE_BASE_URL, BURST_N (default 50)
import { createHash } from "node:crypto";

const BASE = process.env.MEASURE_BASE_URL || "https://nos-measure-api.onrender.com";
const N = Number(process.env.BURST_N || 50);
const MODEL = "p-median-us";
const COHORT_SECRET = process.env.COHORT_SECRET || "nos-measurement-cohort-v1";
const EMAIL = "m1-burst@measure.local";
const PW = "M1!" + createHash("sha256").update(COHORT_SECRET + "|" + EMAIL).digest("base64url").slice(0, 24);
const BANDS = [200, 400, 800, 1600];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

async function post(p, body, cookie) {
  const h = { "content-type": "application/json" };
  if (cookie) h.cookie = cookie;
  return fetch(BASE + p, { method: "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
function cookieFrom(res) {
  const s = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return s.map((c) => c.split(";")[0]).join("; ");
}

async function session() {
  let r = await post("/api/auth/register", { email: EMAIL, password: PW });
  if (r.ok) return cookieFrom(r);
  const l = await post("/api/auth/login", { email: EMAIL, password: PW });
  if (l.ok) return cookieFrom(l);
  throw new Error(`auth failed: register ${r.status} / login ${l.status}`);
}

async function pollTerminal(cookie, scenarioId, jobId, deadlineMs = 180000) {
  const start = now();
  while (now() - start < deadlineMs) {
    const r = await fetch(`${BASE}/api/scenarios/${scenarioId}/solve-jobs/${jobId}`, { headers: { cookie } });
    if (r.ok) {
      const j = await r.json();
      if (j.status === "succeeded" || j.status === "failed") return j.status;
    }
    await sleep(800); // real client poll cadence
  }
  return "timeout";
}

async function main() {
  console.log(`[burst] BASE=${BASE} model=${MODEL} N=${N}`);
  const cookie = await session();

  // Create N distinct p-median-us scenarios (varied p → distinct solves).
  const IDENTICAL = process.env.BURST_IDENTICAL === "1"; // cold-identical: 50 copies of one hash
  const scen = [];
  for (let i = 0; i < N; i++) {
    const p = IDENTICAL ? 24 : 2 + (i % 20); // p=24: not a warmed hit → cold; identical across all 50
    const r = await post("/api/scenarios", { name: `burst-ch3-${i}`, modelId: MODEL, inputs: { p, capacityMode: "none", distanceBands: BANDS, gap: 0, timeLimitSec: 60 } }, cookie);
    if (r.ok) scen.push((await r.json()).id);
    else console.error(`[burst] create ${i} failed ${r.status}`);
  }
  console.log(`[burst] created ${scen.length}/${N} scenarios; firing synchronized solve burst...`);

  // Synchronized burst: fire all solves at once, record enqueue latency + jobId.
  const t0 = now();
  const fired = await Promise.all(scen.map(async (sid) => {
    const s = now();
    const r = await post(`/api/scenarios/${sid}/solve`, {}, cookie);
    const enqueueMs = now() - s;
    if (r.ok) { const j = await r.json(); return { sid, jobId: j.jobId, enqueueMs, http: 200 }; }
    return { sid, jobId: null, enqueueMs, http: r.status };
  }));
  const enqueued = fired.filter((f) => f.jobId != null);
  const rejected = fired.filter((f) => f.jobId == null);
  console.log(`[burst] enqueued ${enqueued.length}/${N} (rejected/429 ${rejected.length}); polling to terminal...`);

  // Poll each to terminal, record end-to-end (from burst start).
  const results = await Promise.all(enqueued.map(async (f) => {
    const st = await pollTerminal(cookie, f.sid, f.jobId);
    return { ...f, status: st, endToEndMs: now() - t0 };
  }));

  const by = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const enqLat = enqueued.map((f) => f.enqueueMs).sort((a, b) => a - b);
  const e2e = results.map((r) => r.endToEndMs).sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : NaN);
  console.log("========== 50-HIT BURST (Chapter 3 / p-median-us) — shakedown ==========");
  console.log(`requests=${N} enqueued=${enqueued.length} rejected=${rejected.length}`);
  console.log(`terminal status: ${JSON.stringify(by)}`);
  console.log(`enqueue latency ms: p50=${pct(enqLat,50)} p95=${pct(enqLat,95)} max=${enqLat.at(-1)}`);
  console.log(`end-to-end ms:     p50=${pct(e2e,50)} p95=${pct(e2e,95)} max=${e2e.at(-1)}`);
  const ok = results.filter((r) => r.status === "succeeded").length;
  console.log(`succeeded=${ok}/${enqueued.length}  (wall=${((now()-t0)/1000).toFixed(1)}s)`);
}
main().catch((e) => { console.error("[burst] FATAL", e); process.exit(1); });
