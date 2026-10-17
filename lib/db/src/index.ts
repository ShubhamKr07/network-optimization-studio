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
export const db = drizzle(pool, { schema });

export * from "./schema";
