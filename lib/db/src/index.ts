import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
// pg emits idle-client failures (e.g. a Postgres restart: "terminating connection
// due to administrator command") on the pool; with no listener Node raises them as
// an uncaught exception and the process dies. pg already discards the dead client,
// so log and keep serving. In-flight queries still reject to their callers.
pool.on("error", (err) => console.error("[db] idle pool client error", err));
// A CHECKED-OUT client (pool.connect(), e.g. drizzle's db.transaction()) has no
// pool idle listener, yet pg's Client still emits "error" when its socket dies,
// after rejecting the in-flight query. The caller already gets that rejection,
// so the event itself only needs a listener to stay non-fatal.
pool.on("connect", (client) => client.on("error", () => {}));
export const db = drizzle(pool, { schema });

export * from "./schema";
