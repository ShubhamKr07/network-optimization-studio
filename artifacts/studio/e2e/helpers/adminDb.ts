/**
 * ADM-T6 — admin-dashboard e2e fixtures through psql, every value bound by psql
 * itself (`:'name'` variables on stdin), same pattern as termsDb.ts. Needs
 * DATABASE_URL (local e2e gate only).
 */
import { execFileSync } from "node:child_process";

function psql(sql: string, vars: Record<string, string>): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (local e2e gate only)");
  const args = [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { input: sql, encoding: "utf8", timeout: 15_000 }).trim().split("\n")[0] ?? "";
}

export function setRole(email: string, role: "student" | "instructor" | "admin"): void {
  const id = psql("UPDATE users SET role = :'role' WHERE email = :'email' RETURNING id;\n", { email, role });
  if (!id) throw new Error(`no users row for ${email}`);
}

// One flagged (rated not-helped) exchange for a student, dated now() so every preset includes it.
export function seedAdminFixture(studentEmail: string, tag: string, modelId = "p-median-us"): void {
  const inserted = psql(
    `WITH u AS (SELECT id FROM users WHERE email = :'email'),
c AS (INSERT INTO watbot_conversations (user_id, model_id, title) SELECT id, :'model', :'tag' FROM u RETURNING id, user_id),
s AS (INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, message_type, status)
      SELECT c.id, c.user_id, 'student', jsonb_build_array(jsonb_build_object('text', :'tag' || ' why is the far warehouse open?', 'citations', '[]'::jsonb)), 'concept_question', 'answered' FROM c RETURNING id),
t AS (INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, usage, latency_ms)
      SELECT c.id, c.user_id, 'tutor', jsonb_build_array(jsonb_build_object('text', 'Capacity limits can fill the nearest site.', 'citations', jsonb_build_array(jsonb_build_object('passageId', 1, 'label', 'Ch 3 · p.71', 'citedText', 'x')))),
             '{"inputTokens":100,"outputTokens":50,"cacheReadTokens":0,"cacheWriteTokens":0,"costUsd":0.01}'::jsonb, 2500
      FROM c, s RETURNING id, conversation_id, user_id)
INSERT INTO watbot_feedback (conversation_id, message_id, user_id, helped, reason) SELECT conversation_id, id, user_id, false, 'still_stuck' FROM t RETURNING id;
`,
    { email: studentEmail, tag, model: modelId },
  );
  if (!inserted) throw new Error(`seedAdminFixture inserted nothing for ${studentEmail} (no users row?)`);
}

export function clearAdminFixture(tag: string): void {
  psql("DELETE FROM watbot_conversations WHERE title = :'tag';\n", { tag }); // messages and feedback cascade
}

/** Remove a test user (conversations, messages, feedback cascade from users). */
export function deleteUser(email: string): void {
  psql("DELETE FROM users WHERE email = :'email';\n", { email });
}
