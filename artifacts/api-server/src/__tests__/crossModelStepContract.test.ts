// e2e-decided (Test 4) — cross-model contract test for the two-step
// workflow. `routes.test.ts` and `registry/__tests__/registration.test.ts`
// prove max-coverage-us is REGISTERED like the other five models; neither
// contains a single "step" reference, so nothing proves it BEHAVES
// differently now that Chapter 4 is the only two-step model.
//
// Two assertions:
//   1. `GET /scenarios/:id` — `steps` is present for max-coverage-us and
//      ABSENT (not null, not empty — `undefined`, i.e. the key never
//      appears) for the other five models.
//   2. A route-boundary solve-target assertion, against
//      `POST /scenarios/:id/solve`'s OWN observable HTTP response (status +
//      body), not the `enqueueScenarioSolve()` function called directly:
//      the other five models never 409 on a back-to-back second solve, and
//      their success response never carries a step-derived field (i.e. the
//      body is exactly `{ jobId }`, nothing else).
//
// This deliberately does NOT restate maxCoverageStepWorkflow.test.ts's
// "leaves non-Chapter-4 enqueue semantics untouched" case: that test seeds
// `solveJobsTable` rows directly and calls `enqueueScenarioSolve()` in-
// process — it never goes through Express (no queue-depth check, no
// ownership/lock middleware, no posthog capture path, no real HTTP
// response-shape assertion). Firing real `POST /scenarios/:id/solve`
// requests twice in a row through `supertest` + the real app exercises that
// whole boundary, and — unlike the seeded-row test — it is deterministic
// for a different, verifiable reason: `UQ_solve_jobs_active_per_scenario`
// (lib/db/src/schema/solve_jobs.ts) and its in-transaction twin in
// jobRunner.ts's enqueueScenarioSolve are BOTH scoped to
// `model_id = 'max-coverage-us'`, so the conflict path is structurally
// unreachable for the other five regardless of timing — this test is not
// racing a background solve, it is asserting a guard never engages.
//
// Real, unmocked Postgres — matches maxCoverageStepWorkflow.test.ts's own
// convention. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/__tests__/crossModelStepContract.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

async function registerAndGetCookie(slug: string): Promise<string> {
  const email = `e2e-decided-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

async function createScenario(cookie: string, modelId: string, inputs: Record<string, unknown>) {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: `cross-model contract — ${modelId}`, modelId, inputs });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body.id as number;
}

// Valid per-model inputs — same fixtures already proven valid in this
// package's own real-HTTP tests (scenarioSolveAtomicity.test.ts's
// validPmedianInputs; importMultiModelRoundTrip.test.ts's transportInputs/
// twoEchelonInputs/jadeInputs), not hand-guessed shapes.
const PMEDIAN_INPUTS = {
  p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
  warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};
const TRANSPORT_COAL_INPUTS = {
  distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
  capacityFactor: 1.0, singleSource: false, capacityInactive: false,
};
const TWO_ECHELON_GOLD_INPUTS = {
  bomRatio: 1.1, refineryOverrides: [], customerOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
};
const JADE_INPUTS = {
  p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120,
  warehouseOverrides: [], customerOverrides: [], plantProductCapability: [],
  addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};
const MAX_COVERAGE_INPUTS = {
  objective: "coverage", p: 3, highServiceDistKm: 700, maxDistKm: 5500,
  avgServiceDistCapKm: 1000, gap: 0, timeLimitSec: 120, capacityMode: "none",
  distanceBands: [700, 1400, 2800, 5500], warehouseOverrides: [], customerOverrides: [],
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};
// Registration point 18 (Chapter 5, delivery-teaching-us) — this file
// arrived with the Chapter 4 two-step merge, before this 7th model existed.
// It has no step workflow and no one-active-job index (that guard is scoped
// to max-coverage-us alone — see NON_STEP_MODELS' own comment), so it
// belongs in the negative half of both assertions below, same as the other
// five. Shape matches deliveryContract.test.ts's own baseInputs().
const DELIVERY_INPUTS = {
  p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
  costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1,
  costPerMileOver: 10, laneCostOverrides: [],
};

// The six models with NO step concept — the negative half of assertion 1
// and the whole of assertion 2. The `setLockedModelsForTests([])` below is
// now belt-and-braces: as of ch9-unlock (2026-09-30) NO model carries
// `capabilities.locked`, so nothing here would 403 even without it. It is
// kept anyway — this file's whole point is that a model cannot silently drop
// out of the negative half, and a future migration quiesce (ch4-lock's Stage
// A is the pattern) locking one of these six would do exactly that, turning
// real coverage into a 403 nobody reads. `lockedChapterDrift.test.ts` is
// what pins the "nothing is locked today" claim; this line makes that claim
// irrelevant to this file either way.
const NON_STEP_MODELS: Array<{ modelId: string; inputs: Record<string, unknown> }> = [
  { modelId: "p-median-us", inputs: PMEDIAN_INPUTS },
  { modelId: "p-median-brazil", inputs: PMEDIAN_INPUTS },
  { modelId: "transport-coal", inputs: TRANSPORT_COAL_INPUTS },
  { modelId: "two-echelon-gold-au", inputs: TWO_ECHELON_GOLD_INPUTS },
  { modelId: "two-echelon-jade-us", inputs: JADE_INPUTS },
  { modelId: "delivery-teaching-us", inputs: DELIVERY_INPUTS },
];

beforeEach(() => {
  // ch4-lock posture (routes.test.ts's own comment): unlock every model for
  // this file's real scenario-scoped HTTP calls so a locked JADE doesn't
  // silently turn "never 409s" into "always 403s, so of course it's never
  // 409" — a passing-for-the-wrong-reason result.
  setLockedModelsForTests([]);
});

afterAll(async () => {
  setLockedModelsForTests(null); // restore the real manifest-derived lock set
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  if (registeredUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
});

describe("cross-model contract — `steps` presence on GET /scenarios/:id", () => {
  it("is present (step1 + step2) for max-coverage-us", async () => {
    const cookie = await registerAndGetCookie("steps-ch4");
    const id = await createScenario(cookie, "max-coverage-us", MAX_COVERAGE_INPUTS);

    const res = await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps).toBeDefined();
    expect(res.body.steps).not.toBeNull();
    expect(res.body.steps.step1).toBeDefined();
    expect(res.body.steps.step2).toBeDefined();
  });

  for (const { modelId, inputs } of NON_STEP_MODELS) {
    it(`is ABSENT (key never appears, not null/empty) for ${modelId}`, async () => {
      const cookie = await registerAndGetCookie(`steps-${modelId}`);
      const id = await createScenario(cookie, modelId, inputs);

      const res = await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie).expect(200);
      // `"steps" in res.body` (not `toBeUndefined()`) — proves the KEY is
      // absent from the response, not merely present-with-value-undefined
      // (JSON.stringify would already drop an undefined value, but this
      // asserts the intent directly rather than relying on that incidental
      // serialization behavior).
      expect("steps" in res.body).toBe(false);
      expect(res.body.steps).toBeUndefined();
    });
  }
});

// cmp-1 — the compare-list step-awareness gap. Same contract as the
// single-scenario GET above (`steps` present only for max-coverage-us),
// extended to the LIST route, which the Compare feature actually reads.
describe("cross-model contract — `steps` presence on GET /scenarios (list)", () => {
  it("is present (step1 + step2) on the max-coverage-us row", async () => {
    const cookie = await registerAndGetCookie("list-steps-ch4");
    const id = await createScenario(cookie, "max-coverage-us", MAX_COVERAGE_INPUTS);

    const res = await request(app).get("/api/scenarios").set("Cookie", cookie).expect(200);
    const row = res.body.find((s: { id: number }) => s.id === id);
    expect(row).toBeDefined();
    expect(row.steps).toBeDefined();
    expect(row.steps).not.toBeNull();
    expect(row.steps.step1).toBeDefined();
    expect(row.steps.step2).toBeDefined();
  });

  for (const { modelId, inputs } of NON_STEP_MODELS) {
    it(`is ABSENT (key never appears, not null/empty) on the ${modelId} row`, async () => {
      const cookie = await registerAndGetCookie(`list-steps-${modelId}`);
      const id = await createScenario(cookie, modelId, inputs);

      const res = await request(app).get("/api/scenarios").set("Cookie", cookie).expect(200);
      const row = res.body.find((s: { id: number }) => s.id === id);
      expect(row).toBeDefined();
      expect("steps" in row).toBe(false);
      expect(row.steps).toBeUndefined();
    });
  }

  it("a mixed list carries steps only on the max-coverage-us row, absent on the rest", async () => {
    const cookie = await registerAndGetCookie("list-steps-mixed");
    const ch4Id = await createScenario(cookie, "max-coverage-us", MAX_COVERAGE_INPUTS);
    const otherIds = await Promise.all(
      NON_STEP_MODELS.map(({ modelId, inputs }) => createScenario(cookie, modelId, inputs)),
    );

    const res = await request(app).get("/api/scenarios").set("Cookie", cookie).expect(200);
    const byId = new Map<number, Record<string, unknown>>(res.body.map((s: { id: number }) => [s.id, s]));

    expect("steps" in byId.get(ch4Id)!).toBe(true);
    for (const id of otherIds) {
      expect("steps" in byId.get(id)!).toBe(false);
    }
  });
});

describe("cross-model contract — POST /scenarios/:id/solve route-boundary solve-target", () => {
  for (const { modelId, inputs } of NON_STEP_MODELS) {
    it(`${modelId}: two back-to-back solves never 409, and the success body is exactly { jobId }`, async () => {
      const cookie = await registerAndGetCookie(`solve-${modelId}`);
      const id = await createScenario(cookie, modelId, inputs);

      const first = await request(app).post(`/api/scenarios/${id}/solve`).set("Cookie", cookie);
      expect(first.status).toBe(202);
      expect(typeof first.body.jobId).toBe("number");
      // The response never carries a step-derived field — no `stepEpoch`,
      // no `stepTarget`, no `steps` key of any kind. For a model with no
      // step concept, the enqueue response is exactly `{ jobId }`.
      expect(Object.keys(first.body).sort()).toEqual(["jobId"]);

      // Fired immediately after the first, not awaiting its completion —
      // deterministic per the file-header comment: the conflict guard is
      // scoped to max-coverage-us at both the in-transaction check
      // (jobRunner.ts) and the partial unique index
      // (UQ_solve_jobs_active_per_scenario), so it cannot engage for these
      // five models regardless of whether the first job has finished.
      const second = await request(app).post(`/api/scenarios/${id}/solve`).set("Cookie", cookie);
      expect(second.status).not.toBe(409);
      expect(second.status).toBe(202);
      expect(typeof second.body.jobId).toBe("number");
      expect(Object.keys(second.body).sort()).toEqual(["jobId"]);
    });
  }
});
