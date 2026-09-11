import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readRows } from "./lib/csv.js";
import { metricsDir, repoRoot } from "./lib/derive.js";
import { medianOf, rateOf, countBy, isoWeek } from "./lib/stats.js";
import { TASKS_HEADER } from "./record-task.js";
import { FLAKE_HEADER } from "./lib/flakeAggregate.js";
import { DEPLOYS_HEADER } from "../deploy/smoke.js";

const FAILURES_HEADER = ["date", "task_id", "phase", "cause", "test_or_check", "notes", "gate_proposed", "gate_accepted"];
const DOCS_AUDIT_HEADER = ["audited_at", "run_id", "files_scanned", "stale", "redundant", "conflicting", "orphan", "memory_findings", "new", "carried_over", "pr_url", "pr_state", "applied", "kept", "resolved_at"];

function col(rows: Record<string, string>[], c: string): string[] {
  return rows.map((r) => r[c]);
}

function currentWeek(): string {
  // Determinism: derive from the latest commit date, not Date.now (which is fine here but keeps
  // reports reproducible from the repo state). Overridable via --week.
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: repoRoot(), encoding: "utf8" }).trim();
    return isoWeek(new Date(iso));
  } catch {
    return isoWeek(new Date());
  }
}

function buildReport(week: string): string {
  const dir = metricsDir();
  const tasks = readRows(join(dir, "tasks.csv"), TASKS_HEADER);
  const failures = readRows(join(dir, "failures.csv"), FAILURES_HEADER);
  const flake = readRows(join(dir, "flake.csv"), FLAKE_HEADER);
  const deploys = readRows(join(dir, "deploys.csv"), DEPLOYS_HEADER);
  const docsAudit = readRows(join(dir, "docs-audit.csv"), DOCS_AUDIT_HEADER);

  const L: string[] = [];
  L.push(`# Harness report — week ${week}`, "");

  // Tasks
  L.push("## Tasks", "");
  L.push(`- Recorded tasks: **${tasks.length}**`);
  L.push(`- Median dispatch cycles: ${medianOf(col(tasks, "dispatch_cycles"))}`);
  L.push(`- Median wall-clock (min): ${medianOf(col(tasks, "wallclock_min"))}`);
  L.push(`- Median e2e runs to green: ${medianOf(col(tasks, "e2e_runs_to_green"))}`);
  L.push(`- First-gate-pass rate: ${rateOf(tasks, "first_gate_pass", "yes")}`);
  L.push(`- Cherry-pick conflict rate: ${rateOf(tasks, "cherrypick_conflict", "yes")}`);
  L.push(`- Reverts within 7d: ${rateOf(tasks, "reverted_within_7d", "yes")}`);
  const escaped = col(tasks, "escaped_defects").filter((v) => v !== "" && v !== "unknown" && v !== "0");
  L.push(`- Tasks with escaped defects: ${escaped.length}`);
  L.push("");

  // Flake
  L.push("## Flake", "");
  const flakeByTest = flake.filter((r) => Number(r.flake_rate) > 0);
  const top5 = [...flakeByTest].sort((a, b) => Number(b.flake_rate) - Number(a.flake_rate)).slice(0, 5);
  const quarantined = flake.filter((r) => r.quarantined === "yes").length;
  L.push(`- Quarantined tests: **${quarantined}**`);
  L.push(`- Top flaky/broken (rate>0):`);
  if (top5.length === 0) L.push("  - (none)");
  for (const r of top5) L.push(`  - ${r.flake_rate} — ${r.test_file} › ${r.test_title}`);
  L.push("");

  // Deploys / smoke
  L.push("## Deploys & smoke", "");
  L.push(`- Smoke rows: ${deploys.length}`);
  const failedByCheck = new Map<string, number>();
  for (const d of deploys) for (const c of (d.failed_checks || "").split(";").filter(Boolean)) failedByCheck.set(c, (failedByCheck.get(c) ?? 0) + 1);
  if (failedByCheck.size === 0) L.push("- Smoke failures by check: (none)");
  else for (const [c, n] of failedByCheck) L.push(`- Smoke failure: ${c} ×${n}`);
  L.push("");

  // Failure causes + second-occurrence + gate status
  L.push("## Failure causes", "");
  const byCause = countBy(failures, "cause");
  if (byCause.size === 0) L.push("- (no failures logged)");
  for (const [cause, n] of [...byCause.entries()].sort((a, b) => b[1] - a[1])) {
    const rows = failures.filter((f) => f.cause === cause);
    const anyGate = rows.some((f) => f.gate_proposed);
    const accepted = rows.some((f) => f.gate_accepted === "yes");
    const secondOccUngated = n >= 2 && !anyGate;
    const flags = [
      secondOccUngated ? "**2nd-occurrence, NO gate → propose one**" : "",
      anyGate ? `gate_proposed${accepted ? " (accepted)" : " (pending)"}` : "",
    ].filter(Boolean).join("; ");
    L.push(`- \`${cause}\` ×${n}${flags ? ` — ${flags}` : ""}`);
  }
  L.push("");

  // Documentation
  L.push("## Documentation", "");
  const lastSweep = docsAudit[docsAudit.length - 1];
  if (!lastSweep) {
    L.push("- No documentation sweep has run yet.");
  } else {
    L.push(`- Last sweep (${lastSweep.audited_at}): ${lastSweep.files_scanned} files scanned — stale ${lastSweep.stale}, redundant ${lastSweep.redundant}, conflicting ${lastSweep.conflicting}, orphan ${lastSweep.orphan}, memory ${lastSweep.memory_findings}`);
    L.push(`- Findings: new ${lastSweep.new}, carried over ${lastSweep.carried_over}`);
    const open = docsAudit.filter((r) => r.pr_state === "open").slice(-1)[0];
    if (open) L.push(`- Open docs-audit PR: ${open.pr_url || "(no url)"} — unreviewed findings pending`);
    const mergedThisWeek = docsAudit.filter((r) => r.pr_state === "merged");
    if (mergedThisWeek.length) {
      const last = mergedThisWeek[mergedThisWeek.length - 1];
      L.push(`- Last merged PR: applied ${last.applied}, kept ${last.kept} (${last.resolved_at})`);
    }
  }
  L.push("");

  // What changed since last week
  L.push("## What changed since last week", "");
  const prev = previousReport(week);
  if (prev) {
    const prevTasks = (prev.match(/Recorded tasks: \*\*(\d+)\*\*/) || [])[1];
    L.push(`- Tasks this week vs last: ${tasks.length} vs ${prevTasks ?? "?"}.`);
  } else {
    L.push("- First report — no prior week to compare.");
  }
  L.push("");

  return L.join("\n");
}

function previousReport(week: string): string | null {
  const dir = join(metricsDir(), "reports");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== `${week}.md`).sort();
  if (files.length === 0) return null;
  return readFileSync(join(dir, files[files.length - 1]), "utf8");
}

function main() {
  const argv = process.argv.slice(2);
  let week = "";
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--week") week = argv[++i];
  if (!week) week = currentWeek();
  const reportsDir = join(metricsDir(), "reports");
  mkdirSync(reportsDir, { recursive: true });
  const out = join(reportsDir, `${week}.md`);
  writeFileSync(out, buildReport(week));
  process.stdout.write(`wrote ${out}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { buildReport };
