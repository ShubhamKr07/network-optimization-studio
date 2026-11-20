import { and, asc, eq, not, or, sql, type SQL } from "drizzle-orm";
import { db as defaultDb, coursePassagesTable } from "@workspace/db";
import type { Tutor } from "@workspace/dataset-schema";

type Db = typeof defaultDb;
type ReadingList = Tutor["readingList"];
export type BundleDoc = { title: string; passages: { id: number; label: string; body: string }[] };

const cols = { id: coursePassagesTable.id, label: coursePassagesTable.label, body: coursePassagesTable.body };
const isEntry = (r: ReadingList[number]) =>
  and(eq(coursePassagesTable.sourceKind, r.kind), eq(coursePassagesTable.chapter, r.chapter))!;

export async function loadBundle(readingList: ReadingList, database: Db = defaultDb): Promise<BundleDoc[]> {
  const docs: BundleDoc[] = [];
  for (const r of readingList) {
    const passages = await database.select(cols).from(coursePassagesTable)
      .where(isEntry(r)).orderBy(asc(coursePassagesTable.ordinal));
    if (passages.length) docs.push({ title: `${r.kind === "book" ? "Chapter" : "Notebook"} ${r.chapter}`, passages });
  }
  return docs;
}

export async function searchBook(query: string, exclude: ReadingList, limit = 5, database: Db = defaultDb) {
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const conditions: SQL[] = [sql`${coursePassagesTable.tsv} @@ ${tsq}`];
  if (exclude.length) conditions.push(not(or(...exclude.map(isEntry))!));
  return database.select(cols).from(coursePassagesTable)
    .where(and(...conditions))
    .orderBy(sql`ts_rank(${coursePassagesTable.tsv}, ${tsq}) desc`)
    .limit(limit);
}

export async function getPassage(id: number, database: Db = defaultDb) {
  const [row] = await database.select(cols).from(coursePassagesTable).where(eq(coursePassagesTable.id, id));
  return row;
}
