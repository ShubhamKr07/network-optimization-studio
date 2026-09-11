import { type Check, timed } from "./types.js";

/**
 * /api/healthz must report db:"ok" — a real SELECT 1 against the pool succeeded through Render's
 * managed-Postgres TLS (R0.1). Guards the "prod DB unreachable / schema never pushed" class that
 * 500'd every request on the first deploy.
 */
export const postgresTls: Check = async (env, ctx) => {
  const name = "postgres_tls";
  const { value: res, ms } = await timed(() => ctx.fetch(`${env.apiBase}/api/healthz`));
  let db = "unknown";
  try {
    const body = (await res.json()) as { db?: string };
    db = body.db ?? "missing";
  } catch {
    db = "unparseable";
  }
  const pass = res.ok && db === "ok";
  return {
    name,
    pass,
    ms,
    detail: pass ? "healthz reports db:ok" : `healthz status=${res.status}, db=${db}`,
  };
};
