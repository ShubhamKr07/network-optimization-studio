import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";

const ARCADIA_RE = /\b(arcadia|gamif\w*|quests?|leaderboard|\bXP\b|badges?)\b/i;

function findLine(text: string, needle: string): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  return 1;
}

/** All pnpm script names across every package.json in the repo. */
function allScripts(repoRoot: string): Set<string> {
  const names = new Set<string>();
  let files: string[] = [];
  try {
    files = execFileSync("git", ["ls-files", "package.json", "**/package.json"], { cwd: repoRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    files = ["package.json"];
  }
  for (const f of files) {
    try {
      const pkg = JSON.parse(readFileSync(join(repoRoot, f), "utf8"));
      for (const k of Object.keys(pkg.scripts || {})) names.add(k);
    } catch {
      /* skip */
    }
  }
  return names;
}

/** git grep a literal token in tracked source (excluding docs); true if it appears anywhere. */
function grepSource(repoRoot: string, token: string): boolean {
  try {
    execFileSync("git", ["grep", "-lF", "--", token, "--", "*.ts", "*.tsx", "*.js", "*.mjs", "*.py", "*.json", "*.yaml", "*.yml"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return true; // exit 0 → at least one match
  } catch {
    return false; // exit 1 → no match
  }
}

export const staleReference: Detector = (records, _cfg, repoRoot) => {
  const out: Candidate[] = [];
  const scripts = allScripts(repoRoot);
  let openapi = "";
  try {
    openapi = readFileSync(join(repoRoot, "lib/api-spec/openapi.yaml"), "utf8");
  } catch {
    /* absent */
  }
  // Normalize a route path to a template: drop a leading /api, collapse :param and {param} to "*".
  const normRoute = (p: string) => p.replace(/^\/api/, "").replace(/\{[^}]+\}/g, "*").replace(/:[A-Za-z][\w]*/g, "*").replace(/\/+$/, "") || "/";
  const openapiRoutes = new Set(
    [...openapi.matchAll(/^\s{2}(\/[\w{}/.:-]*):\s*$/gm)].map((m) => normRoute(m[1])),
  );
  const push = (rec: (typeof records)[number], line: number, evidence: string, passage: string) =>
    out.push({ id: candidateId("stale_reference", rec.path, passage), type: "stale_reference", origin: rec.origin, file: rec.path, lines: [line, line], evidence, related: [] });

  for (const rec of records) {
    const lines = rec.text.split("\n");

    // Arcadia / gamification described as existing → removed in Phase 1.
    for (let i = 0; i < lines.length; i++) {
      if (ARCADIA_RE.test(lines[i])) {
        push(rec, i + 1, "no matching source (Arcadia/gamification removed in Phase 1/A3)", lines[i]);
      }
    }

    // Referenced repo paths/files that don't exist on disk.
    for (const p of [...rec.references.paths, ...rec.references.files]) {
      // only check repo-relative-looking references (skip URLs and bare names without a dir)
      if (p.startsWith("http") || p.includes(" ")) continue;
      if (!existsSync(join(repoRoot, p))) {
        push(rec, findLine(rec.text, p), `referenced path does not exist: ${p}`, p);
      }
    }

    // pnpm scripts not defined anywhere.
    for (const s of rec.references.scripts) {
      if (!scripts.has(s)) push(rec, findLine(rec.text, s), `pnpm script not found in any package.json: ${s}`, `pnpm ${s}`);
    }

    // Routes not present in openapi.yaml (compare normalized templates, both sides).
    for (const r of rec.references.routes) {
      const path = r.split(" ")[1];
      if (openapiRoutes.size && path && !openapiRoutes.has(normRoute(path))) {
        push(rec, findLine(rec.text, path), `route not in openapi.yaml: ${r}`, r);
      }
    }

    // Backticked symbols with zero hits in source.
    for (const sym of rec.references.symbols) {
      if (sym.length < 4) continue; // avoid noise
      if (!grepSource(repoRoot, sym)) push(rec, findLine(rec.text, sym), `symbol not found in source: ${sym}`, sym);
    }
  }
  return out;
};

// helper kept for the CLI's --since ref-intersection use
export function repoHasDir(repoRoot: string, dir: string): boolean {
  try {
    return readdirSync(join(repoRoot, dir)).length >= 0;
  } catch {
    return false;
  }
}
