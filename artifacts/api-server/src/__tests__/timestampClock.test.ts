// HND-B — real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/__tests__/timestampClock.test.ts
//
// Guards the fix for the solve clock reading "Solving 25200s". The bug was NOT
// in useElapsed or in any arithmetic — it was the column type. As a naked
// `timestamp`, drizzle writes and reads values as UTC wall-clock, but
// `defaultNow()`/`sql`now()`` store the DATABASE SESSION's local wall-clock, so
// every DB-side-written value read back offset by the database's UTC offset
// (measured: of 160 local solve_jobs rows, 131 had `finished_at - started_at`
// rounding to 25200 s and 155 were within a minute of it — 7h, the
// America/Los_Angeles offset this server reports).
//
// Four checks, none of which is redundant:
//
//   1. A SCHEMA assertion. The round-trip checks pass on a naked `timestamp`
//      column whenever the database happens to be running in UTC — which is
//      the likeliest CI configuration, and would make this file a green test
//      that proves nothing on the machine that actually broke. Asserting the
//      column type catches `withTimezone` being dropped wherever it runs.
//   2. A ROUND-TRIP against the client clock. The schema check alone cannot
//      catch a writer that reintroduces skew some other way.
//   3. A TWO-CLOCK agreement check — one value written DB-side, one app-side,
//      in separate statements. This is the axis the original bug sat on.
//   4. The `isStale()` invariant the writer changes exist to protect.
//
// All four were falsified before being trusted: (1)+(2) by reverting
// `scenarios.created_at` to naked `timestamp` in a live DB, (3) by reverting
// `solve_jobs.started_at`/`finished_at` (it then failed on an impossible
// ordering, `started_at` after `finished_at`), and (4) by writing `solved_at`
// one second behind `now()` to simulate an app host whose clock trails the
// database's. Each failed only for its own reason.
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../app.js";

const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

// Every column converted by docs/ops/timestamptz-migration.md.
// `sessions.expire` is deliberately absent because that table is DEAD
// (`auth.ts:4` marks it unused, zero writers, zero readers, 0 rows) — not
// because anything depends on its type. `connect-pg-simple`/`express-session`
// are not dependencies of this repo; auth is a stateless signed cookie.
const EXPECTED_TIMESTAMPTZ: Array<[table: string, column: string]> = [
  ["solve_jobs", "queued_at"],
  ["solve_jobs", "started_at"],
  ["solve_jobs", "finished_at"],
  ["solve_jobs", "claimed_at"],
  ["solve_jobs", "owner_heartbeat_at"],
  ["scenarios", "solved_at"],
  ["scenarios", "inputs_updated_at"],
  ["scenarios", "created_at"],
  ["scenarios", "updated_at"],
  ["result_cache", "created_at"],
];

// Minimal valid p-median-us inputs. The model is irrelevant to what this file
// tests (no solve is ever run) — it just has to pass validation so the scenario
// row, and therefore its `created_at`, actually exists.
const pMedianInputs = {
  p: 3,
  capacityMode: "none",
  gap: 0,
  timeLimitSec: 120,
  distanceBands: [100, 500, 1000, 2000],
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

async function registerAndGetCookie(): Promise<string> {
  const email = `hnd-b-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  if (registeredUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
});

describe("HND-B — timestamp columns are timestamptz", () => {
  it("every converted column is 'timestamp with time zone'", async () => {
    const rows = await db.execute(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('solve_jobs', 'scenarios', 'result_cache')
        AND data_type LIKE 'timestamp%'
    `);

    const actual = new Map(
      (rows.rows as Array<{ table_name: string; column_name: string; data_type: string }>)
        .map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]),
    );

    // Guard against the assertion going vacuous: if a future rename makes none
    // of these columns resolve, the per-column loop below would pass on an
    // empty set. Require that we actually found every column we name.
    expect(actual.size).toBeGreaterThanOrEqual(EXPECTED_TIMESTAMPTZ.length);

    const wrong = EXPECTED_TIMESTAMPTZ
      .map(([t, c]) => [`${t}.${c}`, actual.get(`${t}.${c}`)] as const)
      .filter(([, type]) => type !== "timestamp with time zone");

    // Named in the failure so the message says which column regressed, not
    // just that one did.
    expect(wrong).toEqual([]);
  });
});

describe("HND-B — DB-written timestamps round-trip to the right instant", () => {
  it("a now()-written timestamp reads back within seconds of the client clock", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "hnd-b clock fixture",
      modelId: "p-median-us",
      inputs: pMedianInputs,
    });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    // created_at came from the scenario INSERT's `defaultNow()` — the exact
    // writer that was wrong, and the one with no app-side `new Date()` to mask
    // it. Before the conversion this read back offset by the database's UTC
    // offset (25200s on this server), so the tolerance below is thousands of
    // times smaller than the bug it detects.
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    const skewSec = Math.abs(Date.now() - row!.createdAt.getTime()) / 1000;
    expect(skewSec).toBeLessThan(120);
  });

  it("a now()-written and a new Date()-written value in the same column agree", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "hnd-b ordering fixture",
      modelId: "p-median-us",
      inputs: pMedianInputs,
    });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));

    // THE axis the real bug sat on: `started_at` was written DB-side
    // (`sql`now()``) while `finished_at` was written app-side (`new Date()`, in
    // markFailed/markSucceeded), so the two disagreed by the database's UTC
    // offset and the displayed solve duration was that offset — 25200s here.
    //
    // Note what this test deliberately does NOT do: write both columns with
    // `sql`now()`` in one INSERT. An earlier version of this test did, and it
    // was vacuous — a single INSERT gives every `now()` the same
    // `transaction_timestamp()`, so all the columns are byte-identical, the
    // difference is exactly 0, and it passes on naked `timestamp` columns in
    // any time zone whatsoever. It has to be one value per clock, in separate
    // statements, or it proves nothing.
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId: created.body.id,
      userId: owner!.userId,
      status: "running",
      inputsHash: `hnd-b-${Date.now()}`,
      modelId: "p-median-us",
      startedAt: sql`now()`,
    }).returning();

    const [done] = await db.update(solveJobsTable)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(solveJobsTable.id, job!.id))
      .returning();

    expect(done!.queuedAt.getTime()).toBeLessThanOrEqual(done!.startedAt!.getTime());
    expect(done!.startedAt!.getTime()).toBeLessThanOrEqual(done!.finishedAt!.getTime());

    // The displayed solve duration. 25200 was the observed bad value; this is
    // an insert plus an update with no solver involved, so anything beyond a
    // couple of minutes means the two clocks disagree again.
    const solveSec = (done!.finishedAt!.getTime() - done!.startedAt!.getTime()) / 1000;
    expect(solveSec).toBeLessThan(120);
  });

  // The invariant the writer changes exist to protect, which otherwise had no
  // coverage at all. `isStale()` (routes/scenarios.ts:116) is a bare
  // `inputsUpdatedAt > solvedAt` with NO tolerance. `inputs_updated_at` can
  // still be the scenario INSERT's `defaultNow()` at the moment of a first
  // solve (nothing in the solve path writes it), so if `solved_at` is written
  // from the application host instead of the database, any clock skew between
  // the two hosts marks a scenario stale the instant it finishes solving.
  //
  // The mocked stale tests in routes.test.ts cannot catch this: they
  // hand-author BOTH timestamps, so they assert the comparison's arithmetic
  // rather than which clock each side came from.
  it("a scenario solved without an inputs edit is not stale (same clock both sides)", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "hnd-b stale fixture",
      modelId: "p-median-us",
      inputs: pMedianInputs,
    });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    // inputs_updated_at is the INSERT default here — deliberately NOT edited,
    // because an edit would overwrite it and hide the very case under test.
    // solved_at is written the way jobRunner's publication update writes it.
    await db.update(scenariosTable)
      .set({ result: { status: "optimal" }, solvedAt: sql`now()` })
      .where(eq(scenariosTable.id, created.body.id));

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect(row!.inputsUpdatedAt.getTime()).toBeLessThanOrEqual(row!.solvedAt!.getTime());

    // And the derived flag the student actually sees.
    const fetched = await request(app).get(`/api/scenarios/${created.body.id}`).set("Cookie", cookie);
    expect(fetched.status).toBe(200);
    expect(fetched.body.stale).toBe(false);
  });
});
