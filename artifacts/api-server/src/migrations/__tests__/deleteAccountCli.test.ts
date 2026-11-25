/**
 * WQF-B11 — the owner's delete-account script core, against a real database
 * (local nos_dev only, no db mock). Fixture users are inserted directly and
 * every destructive call carries a fixture email, so a plain test run can
 * never delete anyone else.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db, usersTable, scenariosTable, solveJobsTable,
  watbotConversationsTable, watbotMessagesTable, watbotReportsTable, watbotFeedbackTable,
} from "@workspace/db";
import { deleteAccountByEmail } from "../deleteAccount.js";

const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ids: string[] = [];

afterAll(async () => {
  await db.delete(solveJobsTable).where(inArray(solveJobsTable.userId, ids));
  await db.delete(scenariosTable).where(inArray(scenariosTable.userId, ids));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
});

async function seed(name: string, jobStatus = "succeeded") {
  const id = `wqfb11-${name}-${tag}`;
  const email = `Wqfb11-${name}-${tag}@Example.test`; // mixed case on purpose
  ids.push(id);
  await db.insert(usersTable).values({ id, email });
  const [s] = await db.insert(scenariosTable).values({ name: "x", userId: id, modelId: "p-median-us", inputs: {} }).returning();
  await db.insert(solveJobsTable).values({ scenarioId: s!.id, userId: id, status: jobStatus, inputsHash: `wqfb11-${id}` });
  const [c] = await db.insert(watbotConversationsTable).values({ userId: id, modelId: "p-median-us", title: "t" }).returning();
  const [m] = await db.insert(watbotMessagesTable).values({ conversationId: c!.id, userId: id, role: "tutor", blocks: [] }).returning();
  await db.insert(watbotReportsTable).values({ userId: id, messageId: m!.id, reason: "other" });
  await db.insert(watbotFeedbackTable).values({ userId: id, conversationId: c!.id, messageId: m!.id, helped: true });
  return { id, email };
}
const exists = async (id: string) => (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id))).length === 1;
const scenarioCount = async (id: string) => (await db.select({ id: scenariosTable.id }).from(scenariosTable).where(eq(scenariosTable.userId, id))).length;

describe("deleteAccountByEmail", () => {
  it("previews with counts (case-insensitive lookup) and deletes nothing without --confirm", async () => {
    const a = await seed("preview");
    const r = await deleteAccountByEmail(`  ${a.email.toUpperCase()} `);
    expect(r).toMatchObject({
      status: "preview", userId: a.id,
      counts: { scenarios: 1, solveJobs: 1, conversations: 1, messages: 1, feedback: 1, reports: 1 },
    });
    expect(await exists(a.id)).toBe(true);
    expect(await scenarioCount(a.id)).toBe(1);
  });

  it("a confirm that does not match the email deletes nothing", async () => {
    const a = await seed("mismatch");
    const b = await seed("mismatch-other");
    const r = await deleteAccountByEmail(a.email, b.email);
    expect(r.status).toBe("preview");
    expect(await exists(a.id)).toBe(true);
    expect(await exists(b.id)).toBe(true);
  });

  it("with a matching confirm deletes exactly that user and not the bystander", async () => {
    const a = await seed("victim");
    const b = await seed("bystander");
    const r = await deleteAccountByEmail(a.email, a.email.toLowerCase());
    expect(r).toMatchObject({ status: "deleted", userId: a.id });
    expect(await exists(a.id)).toBe(false);
    expect(await scenarioCount(a.id)).toBe(0);
    const left = await deleteAccountByEmail(b.email);
    expect(left).toMatchObject({ status: "preview", counts: { scenarios: 1, messages: 1 } });
  });

  it("refuses busy while a solve is active and deletes nothing", async () => {
    const a = await seed("busy", "running");
    const r = await deleteAccountByEmail(a.email, a.email);
    expect(r.status).toBe("busy");
    expect(await exists(a.id)).toBe(true);
    expect(await scenarioCount(a.id)).toBe(1);
  });

  it("an unknown email is not_found", async () => {
    expect((await deleteAccountByEmail(`nobody-${tag}@example.test`, `nobody-${tag}@example.test`)).status).toBe("not_found");
  });
});
