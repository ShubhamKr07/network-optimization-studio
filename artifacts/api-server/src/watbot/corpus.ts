import type { Tutor } from "@workspace/dataset-schema";

export const BUNDLE_TOKEN_LIMIT = 100_000; // Haiku 5.5 input price rises 5x beyond 100K prompt tokens
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type CorpusPassage = {
  sourceKind: "book" | "notebook"; chapter: number; locator: string;
  ordinal: number; label: string; body: string;
};

export class CorpusError extends Error {}

export function parseCorpusFile(json: unknown): CorpusPassage[] {
  const file = json as { version?: unknown; passages?: unknown };
  if (file?.version !== 1) throw new CorpusError("Unsupported corpus version (expected 1)");
  if (!Array.isArray(file.passages)) throw new CorpusError("passages must be an array");
  const seen = new Set<string>();
  return file.passages.map((raw, i) => {
    const p = raw as Partial<CorpusPassage>;
    if (p.sourceKind !== "book" && p.sourceKind !== "notebook") throw new CorpusError(`passages[${i}].sourceKind invalid`);
    if (!Number.isInteger(p.chapter) || p.chapter! < 1) throw new CorpusError(`passages[${i}].chapter invalid`);
    if (typeof p.locator !== "string" || !p.locator) throw new CorpusError(`passages[${i}].locator invalid`);
    if (!Number.isInteger(p.ordinal)) throw new CorpusError(`passages[${i}].ordinal invalid`);
    if (typeof p.label !== "string" || !p.label) throw new CorpusError(`passages[${i}].label invalid`);
    if (typeof p.body !== "string" || !p.body.trim()) throw new CorpusError(`passages[${i}].body empty`);
    const key = `${p.sourceKind}/${p.chapter}/${p.locator}`;
    if (seen.has(key)) throw new CorpusError(`duplicate passage ${key}`);
    seen.add(key);
    return p as CorpusPassage;
  });
}

// ponytail: chars/4 token estimate; switch to messages.countTokens if a bundle lands near the limit.
export function bundleTokenReport(passages: CorpusPassage[], models: { id: string; tutor?: Tutor }[]) {
  const chars = new Map<string, number>();
  for (const p of passages) {
    const k = `${p.sourceKind}/${p.chapter}`;
    chars.set(k, (chars.get(k) ?? 0) + p.body.length);
  }
  return models.filter((m) => m.tutor).map((m) => ({
    modelId: m.id,
    tokens: Math.round(m.tutor!.readingList.reduce((sum, r) => sum + (chars.get(`${r.kind}/${r.chapter}`) ?? 0), 0) / 4),
  }));
}

export function assertHostConfirmed(databaseUrl: string, confirmHost: string | undefined): void {
  const host = new URL(databaseUrl).hostname;
  if (LOCAL_HOSTS.has(host)) return;
  if (confirmHost !== host) {
    throw new CorpusError(`Refusing to write to ${host}: pass --confirm-host ${host} to confirm the target database.`);
  }
}
