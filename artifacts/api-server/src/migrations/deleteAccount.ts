// WQF-B11 — operator script: delete ONE account by email (GDPR erasure requests
// that arrive by email). Run via `pnpm delete-account --email <addr>` (preview
// only) and add `--confirm <same addr>` to delete. Runbook: docs/ops/account-deletion-requests.md.
// The deletion itself is services/deleteAccount.ts (the in-app path) — not re-implemented.
// Exit codes: 0 deleted, 10 preview only, 20 busy (solve running), 30 not found, 2 usage/config.
import { count, eq, sql } from "drizzle-orm";
import {
  db, pool, usersTable, scenariosTable, solveJobsTable,
  watbotConversationsTable, watbotMessagesTable, watbotFeedbackTable, watbotReportsTable,
} from "@workspace/db";
import { deleteAccountData } from "../services/deleteAccount.js";

export type DeleteByEmailResult =
  | { status: "not_found" }
  | { status: "preview" | "deleted" | "busy"; userId: string; email: string; counts: Record<string, number> };

const norm = (s: string) => s.trim().toLowerCase();

/** Same case-insensitive match log-in uses (routes/auth.ts findUserByEmail). */
export async function deleteAccountByEmail(emailArg: string, confirm?: string): Promise<DeleteByEmailResult> {
  const email = norm(emailArg);
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`);
  if (!user) return { status: "not_found" };

  const n = async (table: typeof scenariosTable | typeof solveJobsTable | typeof watbotConversationsTable
    | typeof watbotMessagesTable | typeof watbotFeedbackTable | typeof watbotReportsTable) => {
    const [r] = await db.select({ c: count() }).from(table as typeof scenariosTable).where(eq(table.userId, user.id));
    return r!.c;
  };
  const counts = {
    scenarios: await n(scenariosTable), solveJobs: await n(solveJobsTable),
    conversations: await n(watbotConversationsTable), messages: await n(watbotMessagesTable),
    feedback: await n(watbotFeedbackTable), reports: await n(watbotReportsTable),
  };
  const base = { userId: user.id, email: user.email ?? email, counts };
  if (confirm === undefined || norm(confirm) !== email) return { status: "preview", ...base };
  return { status: await deleteAccountData(user.id), ...base };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const email = arg("--email");
  if (!process.env.DATABASE_URL || !email) {
    console.error("usage: DATABASE_URL=... pnpm delete-account --email <address> [--confirm <same address>]");
    process.exit(2);
  }
  console.log(`database host: ${new URL(process.env.DATABASE_URL).host.split("@").pop()}`);
  const confirm = arg("--confirm");
  const r = await deleteAccountByEmail(email, confirm);
  let code = 30;
  if (r.status === "not_found") console.log("NOT FOUND: no account with that email. Nothing deleted.");
  else {
    console.log(`account ${r.email} (id ${r.userId})`, r.counts);
    if (r.status === "preview") {
      code = 10;
      console.log(confirm === undefined ? "PREVIEW ONLY. Nothing deleted. Re-run with --confirm <same email> to delete."
        : "PREVIEW ONLY: --confirm did not match --email. Nothing deleted.");
    } else if (r.status === "busy") { code = 20; console.log("BUSY: a solve is queued or running. Nothing deleted. Try again later."); }
    else { code = 0; console.log("DELETED: account and all its data removed."); }
  }
  await pool.end();
  process.exit(code);
}
