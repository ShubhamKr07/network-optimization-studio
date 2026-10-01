// HND-B — real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/__tests__/timestampClock.test.ts
//
// Guards the fix for the solve clock reading "Solving 25200s". The bug was NOT
// in useElapsed or in any arithmetic — it was the column type. As a naked
// `timestamp`, drizzle writes and reads values as UTC wall-clock, but
// `defaultNow()`/`sql`now()`` store the DATABASE SESSION's local wall-clock, so
// every DB-side-written value read back offset by the database's UTC offset
// (measured: 131 of 160 local solve_jobs rows had `finished_at - started_at`
// exactly 25200, i.e. 7h, the America/Los_Angeles offset this server reports).
//
// Two independent checks, because either alone can pass while the bug is live:
//
//   1. A SCHEMA assertion. The round-trip check below passes on a naked
//      `timestamp` column whenever the database happens to be running in UTC —
//      which is the likeliest CI configuration, and would make this file a
//      green test that proves nothing on the machine that actually broke.
//      Asserting the column type catches `withTimezone` being dropped
//      regardless of where the suite runs.
//   2. A ROUND-TRIP assertion. The schema check alone cannot catch a writer
//      that reintroduces skew some other way, so one row is written through
//      the real `now()` path and compared against the test process's own clock.
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../app.js";

const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

// Every column converted by docs/ops/timestamptz-migration.md. `session.expire`
// is deliberately absent: connect-pg-simple owns and writes that table.
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

  it("queued_at <= started_at <= finished_at for a row written through the now() path", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "hnd-b ordering fixture",
      modelId: "p-median-us",
      inputs: pMedianInputs,
    });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));

    // queued_at via the column default; started_at/finished_at through the same
    // `sql`now()`` form every real writer in jobRunner.ts uses. This is the
    // combination that produced the 25200s rows: a default-written column and
    // an explicitly-written one landing on two different clocks.
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId: created.body.id,
      userId: owner!.userId,
      status: "succeeded",
      inputsHash: `hnd-b-${Date.now()}`,
      modelId: "p-median-us",
      startedAt: sql`now()`,
      finishedAt: sql`now()`,
    }).returning();

    expect(job!.queuedAt.getTime()).toBeLessThanOrEqual(job!.startedAt!.getTime());
    expect(job!.startedAt!.getTime()).toBeLessThanOrEqual(job!.finishedAt!.getTime());

    // The displayed solve duration. 25200 was the observed bad value; anything
    // beyond a couple of minutes for an insert with no solver involved at all
    // means the two columns are on different clocks again.
    const solveSec = (job!.finishedAt!.getTime() - job!.startedAt!.getTime()) / 1000;
    expect(solveSec).toBeLessThan(120);
  });
});
