import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendRow } from "./csv.js";
import { metricsDir } from "./derive.js";

export const FLAKE_HEADER = [
  "audited_at",
  "sha",
  "test_file",
  "test_title",
  "runs",
  "failures",
  "flake_rate",
  "quarantined",
];

/** Minimal shape of a Playwright JSON report we care about. */
interface PwSpec {
  title: string;
  file?: string;
  ok?: boolean;
  tests?: { results?: { status?: string }[] }[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
}

interface SpecOutcome {
  file: string;
  title: string;
  ok: boolean;
}

/** Recursively collect one pass/fail outcome per spec in a single run's report. */
function collectSpecs(report: PwReport): SpecOutcome[] {
  const out: SpecOutcome[] = [];
  const walk = (suite: PwSuite, inheritedFile: string) => {
    const file = suite.file ?? inheritedFile;
    for (const spec of suite.specs ?? []) {
      const specFile = spec.file ?? file;
      // A spec is "ok" if the report marks it ok, else if every test result passed.
      let ok = spec.ok;
      if (ok === undefined) {
        const statuses = (spec.tests ?? []).flatMap((t) => t.results ?? []).map((r) => r.status);
        ok = statuses.length > 0 && statuses.every((s) => s === "passed" || s === "expected");
      }
      out.push({ file: specFile, title: spec.title, ok: Boolean(ok) });
    }
    for (const child of suite.suites ?? []) walk(child, file);
  };
  for (const s of report.suites ?? []) walk(s, "");
  return out;
}

export interface FlakeRow {
  file: string;
  title: string;
  runs: number;
  failures: number;
  flakeRate: number;
}

/** Aggregate N run reports into per-test run/failure counts. */
export function aggregate(reports: PwReport[]): FlakeRow[] {
  const byKey = new Map<string, { file: string; title: string; runs: number; failures: number }>();
  for (const report of reports) {
    for (const spec of collectSpecs(report)) {
      const key = `${spec.file}::${spec.title}`;
      const entry = byKey.get(key) ?? { file: spec.file, title: spec.title, runs: 0, failures: 0 };
      entry.runs += 1;
      if (!spec.ok) entry.failures += 1;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].map((e) => ({
    ...e,
    flakeRate: e.runs === 0 ? 0 : e.failures / e.runs,
  }));
}

function readReport(path: string): PwReport {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as PwReport;
  } catch {
    // Tolerate trailing non-JSON noise (a pnpm/node banner appended after the object) by
    // parsing just the outermost {...}.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as PwReport;
    }
    throw new Error(`unparseable Playwright JSON in ${path}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let sha = "unknown";
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sha") sha = argv[++i] ?? "unknown";
    else if (argv[i] !== "--") files.push(argv[i]);
  }
  if (files.length === 0) {
    process.stderr.write("flakeAggregate: no run report files given\n");
    process.exit(2);
  }
  const rows = aggregate(files.map(readReport));
  const auditedAt = new Date().toISOString();
  const flakeFile = join(metricsDir(), "flake.csv");
  for (const r of rows) {
    appendRow(flakeFile, FLAKE_HEADER, {
      audited_at: auditedAt,
      sha,
      test_file: r.file,
      test_title: r.title,
      runs: String(r.runs),
      failures: String(r.failures),
      flake_rate: r.flakeRate.toFixed(3),
      quarantined: "no",
    });
  }
  const flaky = rows.filter((r) => r.flakeRate > 0 && r.flakeRate < 1);
  const broken = rows.filter((r) => r.flakeRate === 1);
  const fmt = (r: FlakeRow) => `  ${r.failures}/${r.runs}  ${r.file} › ${r.title}`;
  process.stdout.write(`\nFLAKY (0 < rate < 1) — ${flaky.length}:\n${flaky.map(fmt).join("\n") || "  (none)"}\n`);
  process.stdout.write(`\nBROKEN (rate = 1) — ${broken.length}:\n${broken.map(fmt).join("\n") || "  (none)"}\n`);
  process.stdout.write(`\nStable: ${rows.length - flaky.length - broken.length} / ${rows.length}\n`);
  process.exit(flaky.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
