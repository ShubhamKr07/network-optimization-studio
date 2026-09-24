#!/usr/bin/env node
// M3.3 — open-loop load driver for the isolated measurement env.
//
// Submits solves on a FIXED TIMER WHEEL, independent of response time (open-loop,
// M-R3): all arrival offsets are scheduled up front via setTimeout; a submission
// NEVER awaits before the next. Draws a cache class per event from the declared
// 20/60/20 mix (seeded), maps it to the submitting user's class-scenario, records
// per-submission timing, and computes intended-vs-achieved rate. 429 = rejected
// (recorded, NOT retried, counted in offered load but not success — M3.3 Step 4).
//
// Profiles: representative_sustained (open-loop). ui_faithful / cold_identical_burst
// / all_jade are separate profiles (ui_faithful is closed-loop; all_jade is locked-
// chapter-blocked). This build implements representative_sustained + a short
// exploratory (authoritative=false) shakedown; the authoritative 3h run is gated
// on MP-1 (M3.3b) and must not start before the ratified SLO commit exists.
//
// Env: MEASURE_BASE_URL, RUN_SECONDS (default 60), RATE (default 0.694),
//      RUN_USERS (default all in sessions), SEED (default 42), AUTHORITATIVE (default 0),
//      WARMUP_SECONDS (default 0)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const OUT = path.join(REPO, ".measurement");
const SESSIONS = path.join(OUT, "sessions.json");

const BASE = process.env.MEASURE_BASE_URL || "https://nos-measure-api.onrender.com";
const RUN_SECONDS = Number(process.env.RUN_SECONDS || 60);
const RATE = Number(process.env.RATE || 0.694);
const SEED = Number(process.env.SEED || 42);
const WARMUP_SECONDS = Number(process.env.WARMUP_SECONDS || 0);
const AUTHORITATIVE = process.env.AUTHORITATIVE === "1";
const CACHE_MIX = { hit: 0.2, near: 0.6, cold: 0.2 };
const MODEL = "p-median-us";
const BANDS = [200, 400, 800, 1600];
const POLL_MS = 800;
const FETCH_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// deterministic PRNG (mulberry32) — reproducible arrival schedule + class draws
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchT(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}
async function post(p, body, cookie) {
  const h = { "content-type": "application/json" }; if (cookie) h.cookie = cookie;
  return fetchT(BASE + p, { method: "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
function classInputs(cls, userIdx) {
  const base = { p: 4, capacityMode: "none", distanceBands: BANDS, gap: 0, timeLimitSec: 60 };
  if (cls === "hit") return { ...base, p: 4 }; // == a warmed hit hash → cache hit
  if (cls === "near") return { ...base, capacityMode: "uniform", uniformCapacity: 100000 }; // capacity family → miss
  return { ...base, p: 30 + (userIdx % 15) }; // cold: distinct valid p (<=50), not a warmed hit → miss
}

async function ensureClassScenarios(u) {
  // create hit/near/cold p-median-us scenarios for this user; return {hit,near,cold}->id
  const ids = {};
  for (const cls of ["hit", "near", "cold"]) {
    const r = await post("/api/scenarios", { name: `run-${cls}-${u.idx}`, modelId: MODEL, inputs: classInputs(cls, Number(u.idx)) }, u.cookie);
    if (!r.ok) throw new Error(`setup ${cls} for ${u.idx} failed ${r.status}`);
    ids[cls] = (await r.json()).id;
  }
  return ids;
}

function drawClass(rng) {
  const x = rng();
  if (x < CACHE_MIX.hit) return "hit";
  if (x < CACHE_MIX.hit + CACHE_MIX.near) return "near";
  return "cold";
}

async function pollTerminal(cookie, sid, jobId, deadlineMs = 180000) {
  const start = now();
  while (now() - start < deadlineMs) {
    const r = await fetchT(`${BASE}/api/scenarios/${sid}/solve-jobs/${jobId}`, { headers: { cookie } });
    if (r.ok) { const j = await r.json(); if (j.status === "succeeded" || j.status === "failed") return j; }
    await sleep(POLL_MS);
  }
  return { status: "timeout" };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const sessions = JSON.parse(readFileSync(SESSIONS, "utf8")).filter((s) => s.cookie);
  const runUsers = Number(process.env.RUN_USERS || sessions.length);
  const users = sessions.slice(0, runUsers);
  if (!users.length) throw new Error("no cohort sessions — run seed-cohort.mjs first");
  console.log(`[driver] BASE=${BASE} users=${users.length} rate=${RATE}/s duration=${RUN_SECONDS}s authoritative=${AUTHORITATIVE}`);

  // ---- setup: per-user class scenarios ----
  for (const u of users) u.scen = await ensureClassScenarios(u);
  console.log(`[driver] setup: ${users.length} users x {hit,near,cold} scenarios created`);

  // ---- seeded open-loop arrival schedule (Poisson inter-arrivals) ----
  const rng = mulberry32(SEED);
  const arrivals = []; // {offsetMs, userIdx, class}
  let t = 0, i = 0;
  while (t < RUN_SECONDS * 1000) {
    const gap = -Math.log(1 - rng()) / RATE; // exponential inter-arrival (sec)
    t += gap * 1000;
    if (t >= RUN_SECONDS * 1000) break;
    arrivals.push({ offsetMs: Math.round(t), userIdx: i % users.length, class: drawClass(rng) });
    i++;
  }
  const intendedRate = arrivals.length / RUN_SECONDS;
  console.log(`[driver] scheduled ${arrivals.length} arrivals (intended ${intendedRate.toFixed(3)}/s)`);

  // ---- run manifest ----
  const runId = `run-${SEED}-${RUN_SECONDS}s-${users.length}u`;
  const manifest = {
    run_id: runId, profile_id: "representative_sustained", schema_version: 1, seed: SEED,
    app_sha: "9291eae", base_url: BASE, arrival_rate_per_sec: RATE, duration_sec: RUN_SECONDS,
    warmup_window_sec: WARMUP_SECONDS, measurement_window_sec: RUN_SECONDS - WARMUP_SECONDS,
    outstanding_job_policy: "open_loop", repetition_number: 1, authoritative: AUTHORITATIVE,
    cache_mix: CACHE_MIX, case_assignment_rule: "round-robin user; cache_class drawn from cache_mix with SEED",
    users: users.map((u) => ({ idx: u.idx, email: u.email, scenarios: u.scen })),
  };
  writeFileSync(path.join(OUT, `run-manifest-${runId}.json`), JSON.stringify(manifest, null, 2));

  // ---- fire on the timer wheel (OPEN-LOOP: schedule all up front, never await) ----
  const records = [];
  const inflight = [];
  const t0 = now();
  for (const a of arrivals) {
    setTimeout(() => {
      const fireT = now();
      const rec = { intendedOffsetMs: a.offsetMs, actualOffsetMs: fireT - t0, class: a.class, userIdx: a.userIdx };
      const u = users[a.userIdx];
      const sid = u.scen[a.class];
      const p = post(`/api/scenarios/${sid}/solve`, {}, u.cookie).then(async (r) => {
        rec.enqueueMs = now() - fireT;
        rec.http = r.status;
        if (r.status === 429) { rec.rejected = true; rec.status = "rejected"; records.push(rec); return; }
        if (!r.ok) { rec.status = "enqueue_error"; records.push(rec); return; }
        const { jobId } = await r.json();
        const j = await pollTerminal(u.cookie, sid, jobId);
        rec.status = j.status;
        rec.endToEndMs = now() - fireT;
        if (j.queuedAt && j.startedAt) rec.queueWaitMs = new Date(j.startedAt) - new Date(j.queuedAt);
        records.push(rec);
      }).catch((e) => { rec.status = "fetch_error"; rec.err = String(e?.cause?.code || e?.message || e); records.push(rec); });
      inflight.push(p);
    }, a.offsetMs);
  }

  // wait for the schedule to drain + all in-flight to settle
  await sleep(RUN_SECONDS * 1000 + 1000);
  await Promise.all(inflight);
  const wallSec = (now() - t0) / 1000;

  // ---- report ----
  const achievedRate = records.length / RUN_SECONDS;
  const byStatus = records.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const byClass = records.reduce((m, r) => ((m[r.class] = (m[r.class] || 0) + 1), m), {});
  const pct = (arr, p) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
  const enq = records.map((r) => r.enqueueMs);
  const e2e = records.filter((r) => r.status === "succeeded").map((r) => r.endToEndMs);
  const qw = records.map((r) => r.queueWaitMs);
  const hitE2e = records.filter((r) => r.class === "hit" && r.status === "succeeded").map((r) => r.endToEndMs);

  // results CSV
  const header = "run_id,intended_offset_ms,actual_offset_ms,class,user_idx,http,enqueue_ms,queue_wait_ms,end_to_end_ms,status\n";
  const csv = records.map((r) => [runId, r.intendedOffsetMs, r.actualOffsetMs, r.class, r.userIdx, r.http ?? "", r.enqueueMs ?? "", r.queueWaitMs ?? "", r.endToEndMs ?? "", r.status].join(",")).join("\n");
  writeFileSync(path.join(OUT, `load-run-${runId}.csv`), header + csv + "\n");

  console.log(`========== M3.3 LOAD RUN (${manifest.profile_id}, authoritative=${AUTHORITATIVE}) ==========`);
  console.log(`intended_rate=${intendedRate.toFixed(3)}/s  achieved_rate=${achievedRate.toFixed(3)}/s  (achieved/intended=${(achievedRate/intendedRate*100).toFixed(1)}%)`);
  console.log(`submissions=${records.length} status=${JSON.stringify(byStatus)} class=${JSON.stringify(byClass)}`);
  console.log(`enqueue ms:    p50=${pct(enq,50)} p95=${pct(enq,95)} max=${pct(enq,100)}`);
  console.log(`queue-wait ms: p50=${pct(qw,50)} p95=${pct(qw,95)}`);
  console.log(`end-to-end ms (succeeded): p50=${pct(e2e,50)} p95=${pct(e2e,95)}`);
  console.log(`hit-class e2e ms (should be low = cache hit): p50=${pct(hitE2e,50)} p95=${pct(hitE2e,95)}`);
  console.log(`wall=${wallSec.toFixed(1)}s | manifest+csv in .measurement/`);

  const achievedPct = achievedRate / intendedRate;
  if (AUTHORITATIVE && manifest.outstanding_job_policy === "open_loop" && achievedPct < 0.99) {
    console.error(`[driver] RUN INVALID: achieved ${(achievedPct*100).toFixed(1)}% < 99% of intended (open-loop shortfall)`);
    process.exit(2);
  }
}
main().catch((e) => { console.error("[driver] FATAL", e?.message || e); process.exit(1); });
