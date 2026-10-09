// HND-A — the predicate behind an UNATTENDED DELETE needs a test.
//
// `purge-test-users.ts` runs after every e2e suite with nobody watching, and
// its blast radius is whatever `TEST_LOCAL_PREFIXES` × `TEST_DOMAINS` minus
// `PROTECTED_EMAILS` happens to mean on the day someone edits one of those
// three lists. The original falsification was manual and one-off, which is
// exactly the coverage that evaporates on the next edit.
//
// Needs a real Postgres (it inserts rows and deletes them):
//   DATABASE_URL=postgresql://... pnpm --filter @workspace/scripts exec \
//     vitest run src/__tests__/purgeTestUsers.test.ts
//
// Every row it creates is id-prefixed `pt-` and removed in afterEach, so a
// failed assertion cannot leave residue for the very script under test to
// collect on the next run.
import { describe, it, expect, afterEach } from "vitest";
import { inArray, like } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import {
  ALLOWED_HOSTS,
  PROTECTED_EMAILS,
  assertPurgeableDatabase,
  countTestUsers,
} from "../purge-test-users.js";

async function insertUsers(rows: Array<{ id: string; email: string }>): Promise<void> {
  await db.insert(usersTable).values(
    rows.map((r) => ({ ...r, passwordHash: "x", role: "student" as const })),
  );
}

afterEach(async () => {
  await db.delete(usersTable).where(like(usersTable.id, "pt-%"));
});

describe("assertPurgeableDatabase — the guard that replaced a provider denylist", () => {
  it("refuses production's INTERNAL Render connection string", () => {
    // The whole reason this is an allowlist. Render's internal host is the bare
    // instance id with no domain, so a /render\.com/ denylist sails past it —
    // and render.yaml records that production's DATABASE_URL is exactly this
    // form. This assertion is the regression guard for that Critical.
    expect(() =>
      assertPurgeableDatabase("postgresql://u:pw@dpg-d9hg4bmpbkes73a0j6l0-a/nos_postgres"),
    ).toThrow(/not in the allowlist/);
  });

  it("refuses the external Render host, Supabase's pooler and Neon's .build host", () => {
    for (const url of [
      "postgresql://u:pw@dpg-x.oregon-postgres.render.com/db",
      "postgres://u:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      "postgresql://u:pw@host.eu-central-1.aws.neon.build/db",
    ]) {
      expect(() => assertPurgeableDatabase(url)).toThrow(/not in the allowlist/);
    }
  });

  it("allows localhost and refuses an unset or unparseable URL", () => {
    expect(() => assertPurgeableDatabase("postgresql://me@localhost:5432/nos_dev")).not.toThrow();
    expect(() => assertPurgeableDatabase(undefined)).toThrow(/not set/);
    expect(() => assertPurgeableDatabase("not a url")).toThrow(/not a parseable URL/);
  });

  it("keeps localhost in the allowlist (deleting it would disable every local run)", () => {
    expect(ALLOWED_HOSTS).toContain("localhost");
  });
});

describe("countTestUsers — both halves of the conjunction are load-bearing", () => {
  it("matches a test prefix on a test domain", async () => {
    await insertUsers([
      { id: "pt-1", email: "e2e-fake-1@test.com" },
      { id: "pt-2", email: "journey_test_1@example.test" },
      { id: "pt-3", email: "diag1@example.com" },
    ]);
    const { userIds } = await countTestUsers();
    // Subset, not an exact set. `countTestUsers()` reads the WHOLE database,
    // and the dev database is shared — leftover matching rows from earlier
    // e2e runs predate this test and are themselves legitimate purge targets.
    // An exact-set assertion made this test fail on the state of the machine
    // rather than on the predicate, and widening the expected set would only
    // re-break on the next leftover. The contract this case owns is that each
    // of these three shapes IS matched; the complementary "and nothing else"
    // half is the three `not.toContain` cases below, which are equally
    // indifferent to pre-existing rows.
    expect(userIds).toContain("pt-1");
    expect(userIds).toContain("pt-2");
    expect(userIds).toContain("pt-3");
  });

  it("does NOT match a human prefix on a test domain", async () => {
    await insertUsers([{ id: "pt-4", email: "alice@test.com" }]);
    expect((await countTestUsers()).userIds).not.toContain("pt-4");
  });

  it("does NOT match a test-ish prefix on a real domain", async () => {
    // `diagnostics@` starts with `diag`, so the prefix half alone would claim
    // it. The domain half is what saves a real account.
    await insertUsers([{ id: "pt-5", email: "diagnostics@realcompany.com" }]);
    expect((await countTestUsers()).userIds).not.toContain("pt-5");
  });

  it("never matches a protected address, regardless of case", async () => {
    // seed@local is protected and on no test domain, so it is excluded twice
    // over; the case-folding is what protects a future protected entry whose
    // case differs from the stored row.
    const matched = (await countTestUsers()).userIds;
    const protectedRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.email, PROTECTED_EMAILS));
    for (const row of protectedRows) expect(matched).not.toContain(row.id);
  });

  it("matches an UPPERCASE test address (case-folded on both sides)", async () => {
    // Postgres LIKE is case-sensitive, so without lower() on both sides this
    // residue would accumulate forever while the script reported success.
    await insertUsers([{ id: "pt-6", email: "E2E-Upper-1@TEST.COM" }]);
    expect((await countTestUsers()).userIds).toContain("pt-6");
  });

  it("does NOT treat `_` in `journey_test_` as a wildcard", async () => {
    // Unescaped, `journey_test_%` also matches `journeyXtestY…`. Confined to
    // test domains so it was never dangerous, but the predicate should mean
    // what it says.
    await insertUsers([{ id: "pt-7", email: "journeyXtestY-1@test.com" }]);
    expect((await countTestUsers()).userIds).not.toContain("pt-7");
  });
});
