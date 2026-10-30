import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// SEC-2 — the per-request session lookup, in its own module so suites that queue
// mocked `db.select` results in call order can stub it in one line instead of
// prepending a users row to every authenticated request.
export async function findUserById(id: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return user;
}
