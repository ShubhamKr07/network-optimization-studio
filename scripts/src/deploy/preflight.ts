import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Report-only deploy preflight (gate: docs/superpowers/gates/deploy_config.md). Reads git and
// greps; no Render API, no credentials, no state, never deploys. Paste the output into the
// deploy approval request. Usage: pnpm deploy:preflight -- <base>..<head> [--verify-studio <url>]

export type Service = "nos-api" | "nos-studio";
export type Mapped =
  | { kind: "deploy"; services: Service[] }
  | { kind: "config-sync" } // render.yaml
  | { kind: "no-deploy" }
  | { kind: "unmapped" };

// ponytail: fixed root-input list, not derived from Dockerfile/render.yaml buildCommand; a new root
// build input must be added here (preflight.test.ts asserts every entry still exists, so the
// list can't rot silently, but it cannot notice a missing entry).
export const ROOT_BOTH = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "tsconfig.base.json"];
export const ROOT_API_ONLY = ["Dockerfile"];

const NO_DEPLOY = [/^docs\//, /^\.claude\//, /^\.github\//, /^\.harness\//, /^scripts\//, /^[^/]+\.md$/, /^\.gitattributes$/, /^\.gitignore$/];

/** lib dirs the studio consumes, from its direct @workspace/* deps (names match lib/ dirs).
 * ponytail: direct deps only; add a transitive walk if a studio lib ever depends on another lib. */
export function studioLibs(root: string): string[] {
  const pkg = JSON.parse(readFileSync(join(root, "artifacts/studio/package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  return Object.keys(deps)
    .filter((n) => n.startsWith("@workspace/") && deps[n]!.startsWith("workspace:"))
    .map((n) => n.slice("@workspace/".length));
}

export function mapPath(p: string, libsForStudio: string[]): Mapped {
  if (ROOT_BOTH.includes(p)) return { kind: "deploy", services: ["nos-api", "nos-studio"] };
  if (ROOT_API_ONLY.includes(p)) return { kind: "deploy", services: ["nos-api"] };
  if (p === "render.yaml") return { kind: "config-sync" };
  if (p.startsWith("artifacts/api-server/") || p.startsWith("solvers/")) return { kind: "deploy", services: ["nos-api"] };
  if (p.startsWith("artifacts/studio/")) return { kind: "deploy", services: ["nos-studio"] };
  const lib = /^lib\/([^/]+)\//.exec(p);
  if (lib) {
    return { kind: "deploy", services: libsForStudio.includes(lib[1]!) ? ["nos-api", "nos-studio"] : ["nos-api"] };
  }
  if (NO_DEPLOY.some((r) => r.test(p))) return { kind: "no-deploy" };
  return { kind: "unmapped" };
}

/** True when every added/removed line of a unified diff (-U0) is blank or a comment line. */
export function isCommentOnlyDiff(diff: string): boolean {
  return diff
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .every((l) => /^[+-]\s*(\/\/|\/\*|\*|$)/.test(l));
}

const ENV_RE = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])|import\.meta\.env\.(VITE_[A-Z0-9_]+)|os\.(?:environ\.get\(|environ\[|getenv\()\s*["']([A-Z][A-Z0-9_]*)["']/g;
export function envVars(line: string): string[] {
  return [...line.matchAll(ENV_RE)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}

/** Per file, env vars read on added lines and not on removed lines of the same file. */
export function newEnvVars(fullDiff: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const chunk of fullDiff.split(/^diff --git /m).slice(1)) {
    const file = /^a\/.* b\/(.*)$/m.exec(chunk.split("\n")[0]!)?.[1];
    if (!file || /\.(md|csv)$/.test(file) || /(__tests__|\.test\.|\/e2e\/)/.test(file)) continue;
    const lines = chunk.split("\n");
    const removed = new Set(lines.filter((l) => /^-[^-]/.test(l)).flatMap(envVars));
    const added = lines.filter((l) => /^\+[^+]/.test(l)).flatMap(envVars).filter((v) => !removed.has(v));
    if (added.length) out.set(file, new Set(added));
  }
  return out;
}

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

export async function verifyStudio(url: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(url);
  const body = await res.text();
  if (res.status !== 200) return `GET ${url} -> ${res.status}, expected 200 (SPA fallback rewrite missing?)`;
  if (!body.includes('id="root"')) return `GET ${url} -> 200 but body has no id="root"`;
  return null;
}

export async function main(argv: string[]) {
  const vi = argv.indexOf("--verify-studio");
  if (vi >= 0) {
    const url = argv[vi + 1];
    if (!url) { console.error("--verify-studio needs a URL, e.g. https://nos-studio.onrender.com/compare"); return 2; }
    const err = await verifyStudio(url).catch((e) => `GET ${url} failed: ${e}`);
    console.log(err ? `FAIL: ${err}` : `OK: ${url} -> 200 with id="root"`);
    return err ? 1 : 0;
  }
  const range = argv.find((a) => /^[^.\s]+\.\.[^.\s]+$/.test(a));
  if (!range) { console.error("usage: pnpm deploy:preflight -- <base>..<head> | --verify-studio <url>"); return 2; }
  const [base, head] = range.split("..") as [string, string];
  const root = git("rev-parse", "--show-toplevel").trim();
  const headSha = git("rev-parse", head).trim();
  const files = git("diff", "--name-only", range).split("\n").filter(Boolean);
  const added = git("diff", "--name-only", "--diff-filter=A", range).split("\n").filter(Boolean);
  const libs = studioLibs(root);

  const svc: Record<Service, string[]> = { "nos-api": [], "nos-studio": [] };
  const sync: string[] = [], unmapped: string[] = [];
  let noDeploy = 0;
  for (const f of files) {
    const m = mapPath(f, libs);
    if (m.kind === "deploy") m.services.forEach((s) => svc[s].push(f));
    else if (m.kind === "config-sync") sync.push(f);
    else if (m.kind === "unmapped") unmapped.push(f);
    else noDeploy++;
  }

  const o: string[] = [];
  o.push(`## Deploy preflight ${base}..${head} (head ${headSha})`, `${files.length} files changed.`, "");
  o.push("### 1. Deploy surface (full diff, no pathspec)");
  for (const s of ["nos-api", "nos-studio"] as Service[]) {
    o.push(svc[s].length ? `- ${s}: DEPLOY (${svc[s].length} files, e.g. ${svc[s].slice(0, 3).join(", ")})` : `- ${s}: no change`);
  }
  if (svc["nos-api"].length && svc["nos-studio"].length) {
    o.push("- ORDER: deploy nos-api first; confirm it is live at " + headSha.slice(0, 7) + " (list_deploys/get_deploy), only then deploy nos-studio. [operator confirms]");
  }
  if (sync.length) o.push("- CONFIG SYNC (render.yaml changed, not a code deploy): apply the Blueprint for nos-api; nos-studio is Dashboard-managed, so repeat the change by hand in the Dashboard.");
  if (unmapped.length) o.push(`- UNMAPPED paths (decide by hand):`, ...unmapped.map((f) => `    ${f}`));
  o.push(`- ${noDeploy} docs/tooling paths map to no deploy.`, "");

  o.push("### 1a. Schema");
  const schemaDiff = git("diff", "-U0", range, "--", "lib/db/src/schema/");
  if (!schemaDiff) o.push("- lib/db/src/schema unchanged: no drizzle-kit push needed.");
  else {
    o.push(isCommentOnlyDiff(schemaDiff)
      ? "- schema diff is comment/whitespace-only: no drizzle-kit push needed."
      : "- SCHEMA CHANGED (substantive): run drizzle-kit push against PRODUCTION FIRST, before the nos-api deploy (docs/ops/schema-push-before-deploy.md).");
    o.push(...schemaDiff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).map((l) => `    ${l}`));
  }
  o.push("");

  o.push("### 2. Data migrations");
  const mig = added.filter((f) => f.startsWith("artifacts/api-server/src/migrations/") && !f.includes("__tests__"));
  if (!mig.length) o.push("- no migration files added.");
  else o.push(...mig.map((f) => `- ADDED ${f}: read its runbook in docs/ops/ end to end, take the backup it requires, and run it per its steps. [operator confirms]`));
  o.push("");

  o.push("### 5. Environment variables read by new code (confirm each is set on its service)");
  const envs = newEnvVars(git("diff", "-U0", range));
  if (!envs.size) o.push("- none found.");
  for (const [f, vars] of envs) {
    const m = mapPath(f, libs);
    const who = m.kind === "deploy" ? m.services.join("+") : "unmapped";
    for (const v of vars) o.push(`- ${v} (${who}, ${f}) [operator confirms set]`);
  }
  o.push("");

  o.push("### 4. Post-deploy (nos-studio): SPA route check",
    "- run: pnpm deploy:preflight -- --verify-studio https://nos-studio.onrender.com/compare   (must be 200 with id=\"root\")");
  console.log(o.join("\n"));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2).filter((a) => a !== "--")).then((c) => process.exit(c), (e) => { console.error(String(e)); process.exit(2); });
}
