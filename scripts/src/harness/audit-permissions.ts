import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendRow, readRows } from "./lib/csv.js";
import { repoRoot, metricsDir, deriveTaskTimestamps } from "./lib/derive.js";
import {
  parseStandingPermissions,
  classifyAll,
  diffAllow,
  parseDenials,
  topDeniedTool,
  type GrantClass,
  type Denial,
  type Window,
} from "./lib/permissions.js";

export const PERMISSIONS_HEADER = [
  "recorded_at",
  "task_id",
  "allow_total",
  "allow_new",
  "deny_total",
  "denials_in_window",
  "top_denied_tool",
  "broad_grants",
  "risky_grants",
  "notes",
];

interface Flags {
  task?: string;
  force?: boolean;
  settings?: string;
  transcriptDir?: string;
  at?: string;
}

export function parseArgs(argv: string[]): Flags {
  const f: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--task": f.task = next(); break;
      case "--force": f.force = true; break;
      case "--settings": f.settings = next(); break;
      case "--transcript-dir": f.transcriptDir = next(); break;
      case "--at": f.at = next(); break;
    }
  }
  return f;
}

/** Default transcript dir: ~/.claude/projects/<repo-root-with-slashes-as-dashes>. */
export function transcriptDirFor(root: string): string {
  return join(homedir(), ".claude", "projects", root.replace(/\//g, "-"));
}

function readAllTranscripts(dir: string): string {
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

export interface AuditResult {
  row: Record<string, string>;
  risky: GrantClass[];
  broad: GrantClass[];
  addedAllow: string[];
  denials: Denial[];
  gateReasons: string[];
}

/** Pure-ish core: given already-loaded inputs, build the row + evaluate the gate. */
export function evaluateAudit(
  task: string,
  recordedAt: string,
  allow: string[],
  denyTotal: number,
  baseline: string[],
  denials: Denial[],
  priorTopDenied: string[],
): AuditResult {
  const classes = classifyAll(allow);
  const risky = classes.filter((c) => c.level === "risky");
  const broad = classes.filter((c) => c.level === "broad");
  const { added } = diffAllow(allow, baseline);
  const top = topDeniedTool(denials);

  const gateReasons: string[] = [];
  if (risky.length > 0) {
    gateReasons.push(`${risky.length} risky grant(s) — human review required`);
  }
  // 2nd-occurrence rule: a tool denied this window that was already the top-denied tool of a prior
  // audit is a recurring refusal — mirrors the failures.csv "cause twice → gate" philosophy.
  if (top && priorTopDenied.includes(top)) {
    gateReasons.push(`recurring denial: "${top}" denied again (also flagged in a prior audit)`);
  }

  const row: Record<string, string> = {
    recorded_at: recordedAt,
    task_id: task,
    allow_total: String(allow.length),
    allow_new: String(added.length),
    deny_total: String(denyTotal),
    denials_in_window: String(denials.length),
    top_denied_tool: top,
    broad_grants: String(broad.length),
    risky_grants: String(risky.length),
    notes: gateReasons.length ? "gate: " + gateReasons.join("; ") : "",
  };
  return { row, risky, broad, addedAllow: added, denials, gateReasons };
}

function main() {
  const f = parseArgs(process.argv.slice(2));
  if (!f.task) throw new Error("--task is required");
  const root = repoRoot();

  const settingsPath = f.settings ?? join(root, ".claude", "settings.local.json");
  let allow: string[] = [];
  let deny: string[] = [];
  if (existsSync(settingsPath)) {
    const perms = parseStandingPermissions(JSON.parse(readFileSync(settingsPath, "utf8")));
    allow = perms.allow;
    deny = perms.deny;
  } else {
    process.stdout.write(`warn: no settings file at ${settingsPath} — allow/deny treated as empty\n`);
  }

  // Baseline diff (scratch, gitignored). Read prior, then rewrite to current.
  const baselineDir = join(root, ".harness", "permissions");
  const baselineFile = join(baselineDir, "allow-baseline.json");
  const baseline: string[] = existsSync(baselineFile)
    ? JSON.parse(readFileSync(baselineFile, "utf8"))
    : [];

  // Denials in the task's time window.
  const timing = deriveTaskTimestamps(f.task);
  const window: Window = {
    start: timing.started_at,
    end: timing.finished_at !== "unknown" ? timing.finished_at : new Date().toISOString(),
  };
  const transcriptDir = f.transcriptDir ?? transcriptDirFor(root);
  const denials = parseDenials(readAllTranscripts(transcriptDir), window);

  // Prior top-denied tools (for the 2nd-occurrence gate).
  const file = join(metricsDir(), "permissions.csv");
  const priorTopDenied = existsSync(file)
    ? readRows(file, PERMISSIONS_HEADER).map((r) => r.top_denied_tool).filter(Boolean)
    : [];

  const recordedAt = f.at ?? new Date().toISOString();
  const res = evaluateAudit(f.task, recordedAt, allow, deny.length, baseline, denials, priorTopDenied);

  // Persist the row + refresh the baseline.
  appendRow(file, PERMISSIONS_HEADER, res.row, { dedupeKey: "task_id", force: f.force });
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(baselineFile, JSON.stringify(allow, null, 2));

  // Report.
  const { row } = res;
  process.stdout.write(
    `permissions audit — ${f.task}\n` +
      `  allow ${row.allow_total} (+${row.allow_new} new)  deny ${row.deny_total}  ` +
      `broad ${row.broad_grants}  risky ${row.risky_grants}\n` +
      `  denials in window: ${row.denials_in_window}` +
      (row.top_denied_tool ? ` (top: ${row.top_denied_tool})` : "") + "\n",
  );
  if (res.risky.length) {
    process.stdout.write("  RISKY grants:\n");
    for (const g of res.risky) process.stdout.write(`    - ${g.entry}  [${g.ruleId}: ${g.reason}]\n`);
  }
  if (res.addedAllow.length) {
    process.stdout.write("  new allow entries this window:\n");
    for (const e of res.addedAllow) process.stdout.write(`    + ${e}\n`);
  }
  if (res.denials.length) {
    process.stdout.write("  denied calls:\n");
    for (const d of res.denials) process.stdout.write(`    ✗ ${d.tool}: ${d.input}\n`);
  }

  if (res.gateReasons.length) {
    process.stdout.write("\nPERMISSION GATE — STOP and ask the human:\n");
    for (const r of res.gateReasons) process.stdout.write(`  • ${r}\n`);
    process.exit(3);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
