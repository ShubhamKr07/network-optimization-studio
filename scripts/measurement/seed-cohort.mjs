#!/usr/bin/env node
// M3.1 Steps 4-5 — seed a synthetic cohort on the ISOLATED measurement env.
//
// Registers N distinct users through the real POST /api/auth/register (never one
// shared account — auth/session cost is part of the load), then creates and
// PERSISTS real solvable scenarios per user through POST /api/scenarios (a cohort
// with no scenarios cannot submit anything — MP-R5). Records scenario IDs in a
// run manifest and session cookies to a gitignored, permission-restricted dir.
// NEVER commits credentials.
//
// Env:
//   MEASURE_BASE_URL  (default https://nos-measure-api.onrender.com)
//   COHORT_USERS      (default 50)
//   SCEN_PER_USER     (default 3)
//   MEASURE_OUT       (default <repo>/.measurement)
//   REGISTER_SPACING_MS (default 1500 — pace under the login/register rate limiter)
//
// Run: node scripts/measurement/seed-cohort.mjs
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const BASE = process.env.MEASURE_BASE_URL || "https://nos-measure-api.onrender.com";
const N_USERS = Number(process.env.COHORT_USERS || 50);
const SCEN_PER_USER = Number(process.env.SCEN_PER_USER || 3);
const OUT_DIR = process.env.MEASURE_OUT || path.join(REPO, ".measurement");
const SPACING_MS = Number(process.env.REGISTER_SPACING_MS || 1500);
const MANIFEST_PATH = path.join(OUT_DIR, "cohort-manifest.json");
const SESSIONS_PATH = path.join(OUT_DIR, "sessions.json"); // gitignored; cookies only

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BANDS = [200, 400, 800, 1600];
// API-shaped (ScenarioInput) valid inputs per model — NOT the solver-side corpus
// shape (which the benchmark translates). One canonical, solvable base per model;
// M3.2/M3.3 vary these into the 20/60/20 cache classes. Fields verified against
// artifacts/api-server/src/validation/inputs/*.ts.
function loadFixtures() {
  // 4 of the 7 models. The original rationale was that two-echelon-jade-us (Ch9)
  // and chens-cosmetics-cn (Ch4) were LOCKED chapters (capabilities.locked → 403
  // on every scenario route), so they were correctly out of a student-facing HTTP
  // load cohort.
  //
  // THAT PREMISE IS NO LONGER TRUE. Ch4 reopened as max-coverage-us (ch4-unlock,
  // 2026-09-26) and Ch9 reopened (ch9-unlock, 2026-09-30); no model is locked
  // today. This list was deliberately left UNCHANGED at ch9-unlock — editing the
  // cohort silently would change what the capacity model is measuring, and that
  // is the MP-1 run-setup decision the plan already reserves ("Locked-model
  // measurement" step in 2026-09-22-scnd-measurement-plan.md), not a mechanical
  // follow-on from an unlock.
  //
  // So the standing caveat now has a DIFFERENT cause and must not be read as
  // prod-parity any more: jade (the heaviest, ~13s p95) is still excluded, so
  // this load still under-weights the tail vs the full-corpus (Phase 1/2)
  // capacity model — but students CAN now submit it. Re-decide at MP-1 before
  // quoting any tail number from a run using this cohort.
  return [
    { modelId: "p-median-us", inputs: { p: 4, capacityMode: "none", distanceBands: BANDS, gap: 0, timeLimitSec: 60 } },
    { modelId: "p-median-brazil", inputs: { p: 4, capacityMode: "none", distanceBands: BANDS, gap: 0, timeLimitSec: 60 } },
    { modelId: "transport-coal", inputs: { capacityFactor: 1.0, singleSource: false, capacityInactive: false, distanceBands: BANDS, gap: 0, timeLimitSec: 60 } },
    { modelId: "two-echelon-gold-au", inputs: { bomRatio: 2, distanceBands: BANDS, gap: 0, timeLimitSec: 60 } },
  ];
}

// Deterministic per-account password so re-runs can log back in (register 409 →
// login) without persisting the original random secret. Synthetic, disposable,
// isolated-env accounts only. COHORT_SECRET overridable; never committed.
const COHORT_SECRET = process.env.COHORT_SECRET || "nos-measurement-cohort-v1";
function password(email) {
  return "M1!" + createHash("sha256").update(COHORT_SECRET + "|" + email).digest("base64url").slice(0, 24);
}

// Capture the session cookie(s) from a register/login response and format for replay.
function cookieHeaderFrom(res) {
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 30000);
async function fetchT(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function post(pathname, body, cookie) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetchT(BASE + pathname, { method: "POST", headers, body: JSON.stringify(body) });
  return res;
}

// Register (or, if the email already exists on a re-run, log in) and return a cookie.
async function ensureSession(email, pw) {
  let res = await post("/api/auth/register", { email, password: pw });
  if (res.status === 429) return { retry: true };
  if (res.ok) return { cookie: cookieHeaderFrom(res), created: true };
  if (res.status === 409) {
    // already exists (re-run) — log in instead
    const lr = await post("/api/auth/login", { email, password: pw });
    if (lr.ok) return { cookie: cookieHeaderFrom(lr), created: false };
    return { error: `login ${lr.status}` };
  }
  return { error: `register ${res.status}: ${(await res.text()).slice(0, 160)}` };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = loadFixtures();
  console.log(`[seed] BASE=${BASE} users=${N_USERS} scen/user=${SCEN_PER_USER} fixtures=${fixtures.length}`);

  const users = [];
  const sessions = [];
  let fxCursor = 0;

  for (let i = 0; i < N_USERS; i++) {
    const idx = String(i + 1).padStart(3, "0");
    const email = `m1-u${idx}@measure.local`;
    const pw = password(email);

    // Per-user work is isolated: a thrown fetch (timeout/abort/network) skips this
    // user and continues, never aborts the whole run.
    try {
      // register with bounded retry on rate-limit
      let sess = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await ensureSession(email, pw);
        if (r.retry) { await sleep(6000); continue; }
        if (r.error) { console.error(`[seed] user ${idx} FAILED: ${r.error}`); break; }
        sess = r; break;
      }
      if (!sess?.cookie) { await sleep(SPACING_MS); continue; }

      // create SCEN_PER_USER scenarios from rotating fixtures
      const scenarioIds = [];
      for (let k = 0; k < SCEN_PER_USER; k++) {
        const fx = fixtures[fxCursor % fixtures.length];
        fxCursor++;
        const name = `u${idx}-${fx.modelId}-${k}`;
        const cr = await post("/api/scenarios", { name, modelId: fx.modelId, inputs: fx.inputs }, sess.cookie);
        if (cr.ok) {
          const scen = await cr.json();
          scenarioIds.push({ id: scen.id, modelId: fx.modelId });
        } else {
          console.error(`[seed] user ${idx} scenario ${k} (${fx.modelId}) FAILED: ${cr.status} ${(await cr.text()).slice(0,120)}`);
        }
      }

      users.push({ idx, email, created: sess.created, scenarioIds });
      sessions.push({ idx, email, password: pw, cookie: sess.cookie }); // gitignored file only
      console.log(`[seed] ${idx} ${email} scenarios=${scenarioIds.length}`);
    } catch (e) {
      console.error(`[seed] user ${idx} ERROR (skipped): ${e?.cause?.code || e?.message || e}`);
    }
    await sleep(SPACING_MS);
  }

  const okUsers = users.filter((u) => u.scenarioIds.length > 0).length;
  const totalScen = users.reduce((n, u) => n + u.scenarioIds.length, 0);

  writeFileSync(MANIFEST_PATH, JSON.stringify({
    baseUrl: BASE, appSha: "9291eae", createdCount: okUsers, userCount: users.length,
    scenarioCount: totalScen, scenPerUser: SCEN_PER_USER, users,
  }, null, 2));
  writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
  try { chmodSync(SESSIONS_PATH, 0o600); } catch {}

  console.log(`[seed] DONE users_with_scenarios=${okUsers}/${users.length} scenarios=${totalScen}`);
  console.log(`[seed] manifest: ${MANIFEST_PATH}`);
  console.log(`[seed] sessions (gitignored, 0600): ${SESSIONS_PATH}`);
  if (okUsers < N_USERS) { console.error(`[seed] WARN: only ${okUsers}/${N_USERS} users fully seeded`); process.exit(2); }
}

main().catch((e) => { console.error("[seed] FATAL", e); process.exit(1); });
