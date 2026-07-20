import { randomUUID } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { db, usersTable, scenariosTable, pool } from "@workspace/db";

const SEED_EMAIL = "seed@local";

async function main() {
  let [seedUser] = await db.select().from(usersTable).where(eq(usersTable.email, SEED_EMAIL));

  if (!seedUser) {
    [seedUser] = await db.insert(usersTable).values({
      email: SEED_EMAIL,
      // Random, unusable hash — this account is never meant to log in.
      passwordHash: randomUUID(),
      role: "student",
    }).returning();
    console.log(`Created seed user ${seedUser.id} (${SEED_EMAIL})`);
  } else {
    console.log(`Found existing seed user ${seedUser.id} (${SEED_EMAIL})`);
  }

  const orphaned = await db.update(scenariosTable)
    .set({ userId: seedUser.id })
    .where(isNull(scenariosTable.userId))
    .returning({ id: scenariosTable.id });

  console.log(`Assigned ${orphaned.length} orphaned scenario(s) to ${SEED_EMAIL}: [${orphaned.map(r => r.id).join(", ")}]`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
