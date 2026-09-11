import { join } from "node:path";
import { appendRow } from "./lib/csv.js";
import { deriveTaskTimestamps, wallclockMin, metricsDir } from "./lib/derive.js";

export const TASKS_HEADER = [
  "task_id",
  "branch",
  "started_at",
  "finished_at",
  "dispatch_cycles",
  "first_gate_pass",
  "cherrypick_conflict",
  "e2e_runs_to_green",
  "wallclock_min",
  "tokens",
  "merged_sha",
  "reverted_within_7d",
  "escaped_defects",
];

interface Flags {
  task?: string;
  branch?: string;
  cycles?: string;
  firstGate?: string;
  conflict?: string;
  e2eRuns?: string;
  force?: boolean;
}

export function parseArgs(argv: string[]): Flags {
  const f: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--task": f.task = next(); break;
      case "--branch": f.branch = next(); break;
      case "--cycles": f.cycles = next(); break;
      case "--first-gate": f.firstGate = next(); break;
      case "--conflict": f.conflict = next(); break;
      case "--e2e-runs": f.e2eRuns = next(); break;
      case "--force": f.force = true; break;
    }
  }
  return f;
}

/** Build the full 13-column row for a task. Pure — no I/O. */
export function buildTaskRow(f: Flags): Record<string, string> {
  if (!f.task) throw new Error("--task is required");
  const t = deriveTaskTimestamps(f.task);
  return {
    task_id: f.task,
    branch: f.branch ?? f.task,
    started_at: t.started_at,
    finished_at: t.finished_at,
    dispatch_cycles: f.cycles ?? "unknown",
    first_gate_pass: f.firstGate ?? "unknown",
    cherrypick_conflict: f.conflict ?? "unknown",
    e2e_runs_to_green: f.e2eRuns ?? "unknown",
    wallclock_min: wallclockMin(t.started_at, t.finished_at),
    tokens: "unknown", // ~/.claude/jobs/* records no token usage (Phase 0)
    merged_sha: t.merged_sha,
    reverted_within_7d: "unknown",
    escaped_defects: "unknown",
  };
}

function main() {
  const f = parseArgs(process.argv.slice(2));
  const row = buildTaskRow(f);
  const file = join(metricsDir(), "tasks.csv");
  appendRow(file, TASKS_HEADER, row, { dedupeKey: "task_id", force: f.force });
  process.stdout.write(`recorded ${row.task_id} (${row.started_at} → ${row.finished_at}, sha ${row.merged_sha})\n`);
}

// Run only when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
