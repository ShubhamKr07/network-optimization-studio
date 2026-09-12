import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export interface DocReferences {
  paths: string[];
  scripts: string[];
  envVars: string[];
  symbols: string[];
  routes: string[];
  services: string[];
  files: string[];
}

export interface InventoryRecord {
  path: string; // repo-relative for repo docs; absolute for memory files
  origin: "repo" | "memory";
  title: string;
  headings: { text: string; line: number }[];
  lastChange: string; // ISO date or "unknown"
  inboundLinks: string[];
  references: DocReferences;
  text: string; // raw content (used by detectors; not serialized to inventory.json)
}

const KNOWN_EXT = /\.(ts|tsx|js|mjs|cjs|py|json|ya?ml|md|sql|css|html)$/;
const uniq = (a: string[]) => [...new Set(a)];

/** Extract all backticked tokens from a line/text. */
function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

// Only treat a backticked token as a repo path when it is rooted at a real top-level dir — this
// avoids flagging home paths (~/…), absolute system paths, bare filenames, and prose.
const REPO_ROOTED = /^(artifacts|lib|scripts|solvers|docs|attached_assets|\.github|e2e)\//;

export function extractReferences(text: string): DocReferences {
  const ticks = backticked(text).map((t) => t.trim());
  // Repo-rooted path/file references (with or without an extension), single-token only.
  const repoPaths = ticks.filter((t) => !t.includes(" ") && REPO_ROOTED.test(t));
  const paths = repoPaths.filter((t) => !KNOWN_EXT.test(t));
  const files = repoPaths.filter((t) => KNOWN_EXT.test(t));
  // Scripts: ONLY from a backticked span that literally invokes pnpm (drops prose like "pnpm monorepo").
  const scripts = uniq(
    ticks
      .map((t) => t.match(/^pnpm\s+(?:run\s+|--filter\s+\S+\s+(?:run\s+)?|exec\s+)?([a-z][\w:-]*(?::[\w-]+)?)/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => m[1])
      .filter((s) => !["run", "install", "exec", "test", "build", "typecheck", "dev", "start", "-r"].includes(s)),
  );
  const envVars = uniq([
    ...[...text.matchAll(/\b(VITE_[A-Z0-9_]+)\b/g)].map((m) => m[1]),
    ...ticks.filter((t) => /^[A-Z][A-Z0-9_]{2,}$/.test(t)),
  ]);
  const symbols = uniq(ticks.filter((t) => /^[A-Z][a-zA-Z0-9]{3,}$/.test(t) || /^[A-Z][A-Z0-9_]{3,}$/.test(t)));
  const routes = uniq([...text.matchAll(/\b(GET|POST|PATCH|PUT|DELETE)\s+(\/[\w:/{}.-]*)/g)].map((m) => `${m[1]} ${m[2]}`));
  const services = uniq([...text.matchAll(/\b(nos-api|nos-studio|nos-postgres)\b/g)].map((m) => m[1]));
  return { paths: uniq(paths), scripts, envVars, symbols, routes, services, files: uniq(files) };
}

function gitLastChange(repoRoot: string, relPath: string): string {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", relPath], { cwd: repoRoot, encoding: "utf8" }).trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

function headingsOf(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (m) out.push({ text: m[1].trim(), line: i + 1 });
  }
  return out;
}

/** A file is exempt if its first 10 lines contain the ignore marker. */
export function isExemptByMarker(text: string): boolean {
  return text.split("\n").slice(0, 10).join("\n").includes("<!-- docs-audit: ignore -->");
}

export function buildInventory(
  files: { path: string; origin: "repo" | "memory"; abs: string }[],
  repoRoot: string,
): InventoryRecord[] {
  const records: InventoryRecord[] = files.map((f) => {
    const text = readFileSync(f.abs, "utf8");
    const headings = headingsOf(text);
    const titleH = headings.find((h) => true);
    return {
      path: f.path,
      origin: f.origin,
      title: titleH ? titleH.text : f.path.split("/").pop() || f.path,
      headings,
      lastChange: f.origin === "memory" ? new Date(statSync(f.abs).mtime).toISOString().slice(0, 10) : gitLastChange(repoRoot, f.path),
      inboundLinks: [],
      references: extractReferences(text),
      text,
    };
  });
  // inbound links: for each record, which OTHER in-scope docs link to it (markdown link or backticked path).
  for (const r of records) {
    for (const other of records) {
      if (other.path === r.path) continue;
      const base = r.path.split("/").pop() || r.path;
      if (other.text.includes(r.path) || other.text.includes(`](${base})`) || other.text.includes(`\`${r.path}\``)) {
        r.inboundLinks.push(other.path);
      }
    }
  }
  return records;
}

/** Serializable form (drops raw text). */
export function serializeInventory(records: InventoryRecord[]) {
  return records.map(({ text, ...rest }) => rest);
}

export const memoryFilePath = (memoryDir: string, name: string) => join(memoryDir, name);
