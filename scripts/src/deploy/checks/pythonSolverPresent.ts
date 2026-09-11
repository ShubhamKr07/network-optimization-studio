import { type Check } from "./types.js";

// A minimal valid p-median-us inputs fixture (matches a real nos_dev row). p=3, uncapacitated.
const FIXTURE_INPUTS = {
  p: 3,
  gap: 0,
  capacityMode: "none" as const,
  timeLimitSec: 120,
  distanceBands: [200, 400, 800, 1600],
  uniformCapacity: null,
  customerOverrides: [],
  warehouseOverrides: [],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * End-to-end proof that the Python/CBC solver is present and runs inside the deployed container:
 * create a p-median-us scenario, solve it via the async job API, poll to completion (<=30s), and
 * assert the envelope is `optimal` with a positive finite objective and non-empty edges. Exact
 * numeric accuracy is e2e_accuracy.py's job, not a smoke's — this proves "solver present + solves",
 * not the textbook value.
 */
export const pythonSolverPresent: Check = async (env, ctx) => {
  const name = "python_solver_present";
  const start = Date.now();
  const cookie = ctx.cookieJar.value;
  if (!cookie) return { name, pass: false, ms: 0, detail: "no session cookie (cookie_attributes must run first)" };
  const headers = { "Content-Type": "application/json", Cookie: cookie, Origin: env.studioBase };

  let scenarioId: string | null = null;
  try {
    // Create
    const createRes = await ctx.fetch(`${env.apiBase}/api/scenarios`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: `smoke-${process.pid}`, modelId: "p-median-us", inputs: FIXTURE_INPUTS }),
    });
    if (!createRes.ok) return { name, pass: false, ms: Date.now() - start, detail: `create scenario failed: ${createRes.status}` };
    const created = (await createRes.json()) as { id?: string };
    scenarioId = created.id ?? null;
    if (!scenarioId) return { name, pass: false, ms: Date.now() - start, detail: "create returned no id" };

    // Solve (async → 202 {jobId})
    const solveRes = await ctx.fetch(`${env.apiBase}/api/scenarios/${scenarioId}/solve`, { method: "POST", headers });
    if (solveRes.status !== 202) return { name, pass: false, ms: Date.now() - start, detail: `solve expected 202, got ${solveRes.status}` };
    const { jobId } = (await solveRes.json()) as { jobId?: string };
    if (!jobId) return { name, pass: false, ms: Date.now() - start, detail: "solve returned no jobId" };

    // Poll <=30s. The poll response carries resultSummary:{status,objective,runTimeSec} (the full
    // envelope with edges lives on the scenario row, not the job summary).
    const deadline = Date.now() + 30_000;
    let job: { status?: string; resultSummary?: { status?: string; objective?: number; runTimeSec?: number } | null } = {};
    while (Date.now() < deadline) {
      const pollRes = await ctx.fetch(`${env.apiBase}/api/scenarios/${scenarioId}/solve-jobs/${jobId}`, { headers: { Cookie: cookie, Origin: env.studioBase } });
      job = (await pollRes.json()) as typeof job;
      if (job.status === "succeeded" || job.status === "failed") break;
      await sleep(1000);
    }
    const summary = job.resultSummary;
    const objective = summary?.objective;
    const pass =
      job.status === "succeeded" &&
      summary?.status === "optimal" &&
      typeof objective === "number" &&
      Number.isFinite(objective) &&
      objective > 0;
    return {
      name,
      pass,
      ms: Date.now() - start,
      detail: pass
        ? `solve optimal, objective=${objective}, runtime=${summary?.runTimeSec}s`
        : `job.status=${job.status}, result.status=${summary?.status}, objective=${objective}`,
    };
  } finally {
    if (scenarioId) {
      // Best-effort cleanup (never affects the check outcome).
      try {
        await ctx.fetch(`${env.apiBase}/api/scenarios/${scenarioId}`, { method: "DELETE", headers: { Cookie: cookie, Origin: env.studioBase } });
      } catch {
        /* ignore */
      }
    }
  }
};
