/**
 * WQF-B8 / D13 — the few Part B browser tests that must age or read a users
 * row reach the local database through psql, with every value bound by psql
 * itself (`:'name'` variables on stdin), never string-built. The studio
 * package gains no DB driver (same reasoning as global.teardown.ts).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

function psql(sql: string, vars: Record<string, string>): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (local e2e gate only)");
  const args = [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { input: sql, encoding: "utf8", timeout: 15_000 }).trim().split("\n")[0] ?? "";
}

export function makeTermsStale(email: string): void {
  const id = psql("UPDATE users SET terms_version = '2000-01-01', terms_accepted_at = NULL WHERE email = :'email' RETURNING id;\n", { email });
  if (!id) throw new Error(`no users row for ${email}`);
}

export function readTerms(email: string): { version: string; acceptedAt: string } {
  const [version = "", acceptedAt = ""] = psql("SELECT terms_version, terms_accepted_at FROM users WHERE email = :'email';\n", { email }).split("|");
  return { version, acceptedAt };
}

export function plantResetToken(email: string, token: string): void {
  const hash = createHash("sha256").update(token).digest("hex"); // = lib/resetTokens.ts hashResetToken
  const id = psql(
    "UPDATE users SET reset_token_hash = :'hash', reset_token_expires_at = now() + interval '1 hour' WHERE email = :'email' RETURNING id;\n",
    { email, hash },
  );
  if (!id) throw new Error(`no users row for ${email}`);
}

export function userExists(email: string): boolean {
  return psql("SELECT count(*) FROM users WHERE email = :'email';\n", { email }) === "1";
}
