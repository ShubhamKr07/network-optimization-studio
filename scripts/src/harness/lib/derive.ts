import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this file to the repo root (the dir containing pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found");
}

export const metricsDir = (): string => join(repoRoot(), "docs", "superpowers", "metrics");

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot(), encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export interface DerivedTaskTiming {
  started_at: string;
  finished_at: string;
  merged_sha: string;
}

/**
 * Derive a task's timestamps + merged sha.
 * Priority: `.superpowers/sdd/task-<id>-{brief,report}.md` mtimes; else git commits whose subject
 * carries the tag `[<taskId>` (e.g. `[bundle6.1-T1]`, `[OBS-2]`). Anything unrecoverable = "unknown".
 */
export function deriveTaskTimestamps(taskId: string): DerivedTaskTiming {
  const root = repoRoot();
  const brief = join(root, ".superpowers", "sdd", `task-${taskId}-brief.md`);
  const report = join(root, ".superpowers", "sdd", `task-${taskId}-report.md`);

  let started_at = "unknown";
  let finished_at = "unknown";
  let merged_sha = "unknown";

  if (existsSync(brief)) started_at = new Date(statSync(brief).mtime).toISOString();
  if (existsSync(report)) finished_at = new Date(statSync(report).mtime).toISOString();

  // Git fallback: commits tagged [<taskId>] or [<taskId>-...]. The trailing [\]-] enforces a tag
  // boundary so "bundle6" does not also match "[bundle6.1-...]".
  const log = git(["log", "--reverse", `--grep=\\[${taskId}[]-]`, "--format=%cI|%H"]);
  if (log) {
    const lines = log.split("\n").filter(Boolean);
    if (lines.length) {
      const first = lines[0].split("|");
      const last = lines[lines.length - 1].split("|");
      if (started_at === "unknown") started_at = first[0] ?? "unknown";
      finished_at = last[0] ?? finished_at;
      merged_sha = last[1] ?? merged_sha;
    }
  }
  return { started_at, finished_at, merged_sha };
}

/** finished−started in whole minutes, or "unknown" if either bound is unknown. */
export function wallclockMin(started_at: string, finished_at: string): string {
  if (started_at === "unknown" || finished_at === "unknown") return "unknown";
  const a = Date.parse(started_at);
  const b = Date.parse(finished_at);
  if (Number.isNaN(a) || Number.isNaN(b)) return "unknown";
  return String(Math.max(0, Math.round((b - a) / 60000)));
}
