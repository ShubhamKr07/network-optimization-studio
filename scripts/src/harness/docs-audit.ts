import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { repoRoot } from "./lib/derive.js";
import { matchesAnyGlob } from "./lib/glob.js";
import { buildInventory, serializeInventory, isExemptByMarker, type InventoryRecord } from "./lib/inventory.js";
import type { AuditConfig, Candidate, Detector } from "./lib/detectors/types.js";
import { staleReference } from "./lib/detectors/staleReference.js";
import { superseded } from "./lib/detectors/superseded.js";
import { redundantPassage } from "./lib/detectors/redundantPassage.js";
import { conflictingInstruction } from "./lib/detectors/conflictingInstruction.js";
import { orphan } from "./lib/detectors/orphan.js";
import { memoryContradiction } from "./lib/detectors/memoryContradiction.js";
import { factContradiction } from "./lib/detectors/factContradiction.js";

const DETECTORS: Detector[] = [staleReference, superseded, redundantPassage, conflictingInstruction, orphan, memoryContradiction, factContradiction];

export function loadConfig(root: string): AuditConfig {
  return JSON.parse(readFileSync(join(root, "docs/superpowers/docs-audit.config.json"), "utf8"));
}

/** A repo doc is in scope iff tracked, matches no exclude glob, and has no ignore marker. */
export function isExcluded(path: string, cfg: AuditConfig, text: string): boolean {
  if (matchesAnyGlob(path, cfg.exclude)) return true;
  if (isExemptByMarker(text)) return true;
  return false;
}

function trackedMarkdown(root: string): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

export interface SelectedFile {
  path: string;
  origin: "repo" | "memory";
  abs: string;
}

export function selectFiles(root: string, cfg: AuditConfig): SelectedFile[] {
  const out: SelectedFile[] = [];
  for (const p of trackedMarkdown(root)) {
    if (matchesAnyGlob(p, cfg.exclude)) continue;
    const abs = join(root, p);
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (isExemptByMarker(text)) continue;
    out.push({ path: p, origin: "repo", abs });
  }
  // memory dir (read-only, origin memory)
  if (cfg.memoryDir && existsSync(cfg.memoryDir)) {
    for (const name of readdirSync(cfg.memoryDir)) {
      if (!name.endsWith(".md")) continue;
      out.push({ path: name, origin: "memory", abs: join(cfg.memoryDir, name) });
    }
  }
  return out;
}

/** Files changed since <ref>, plus files whose references intersect the paths changed since <ref>. */
function sinceFilter(root: string, ref: string, selected: SelectedFile[], records: InventoryRecord[]): Set<string> {
  let changed: string[] = [];
  try {
    changed = execFileSync("git", ["diff", "--name-only", ref], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return new Set(selected.map((s) => s.path)); // ref unknown → treat as full
  }
  const keep = new Set<string>();
  const changedSet = new Set(changed);
  for (const r of records) {
    if (changedSet.has(r.path)) {
      keep.add(r.path);
      continue;
    }
    const refs = [...r.references.paths, ...r.references.files];
    if (refs.some((ref2) => changedSet.has(ref2))) keep.add(r.path);
  }
  return keep;
}

interface Args {
  mode: "full" | "since";
  since?: string;
  mechanicalOnly: boolean;
  out: string;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { mode: "full", mechanicalOnly: false, out: ".harness/docs-audit/candidates.json" };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--full": a.mode = "full"; break;
      case "--since": a.mode = "since"; a.since = argv[++i]; break;
      case "--mechanical-only": a.mechanicalOnly = true; break;
      case "--out": a.out = argv[++i]; break;
    }
  }
  return a;
}

export function runAudit(root: string, args: Args): Candidate[] {
  const cfg = loadConfig(root);
  let files = selectFiles(root, cfg);
  const records = buildInventory(files, root);
  let active = records;
  if (args.mode === "since" && args.since) {
    const keep = sinceFilter(root, args.since, files, records);
    active = records.filter((r) => keep.has(r.path));
  }
  const candidates: Candidate[] = [];
  for (const d of DETECTORS) candidates.push(...d(active, cfg, root));
  // dedupe by id
  const byId = new Map<string, Candidate>();
  for (const c of candidates) if (!byId.has(c.id)) byId.set(c.id, c);
  const result = [...byId.values()];

  if (!args.mechanicalOnly) {
    const invPath = join(root, "docs/superpowers/docs-audit/inventory.json");
    mkdirSync(dirname(invPath), { recursive: true });
    writeFileSync(invPath, JSON.stringify(serializeInventory(records), null, 2));
  }
  const outPath = join(root, args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return result;
}

function summarize(cands: Candidate[]): string {
  const by = new Map<string, number>();
  for (const c of cands) by.set(c.type, (by.get(c.type) ?? 0) + 1);
  return [...by.entries()].map(([t, n]) => `${t}=${n}`).join(" ");
}

function main() {
  const root = repoRoot();
  const args = parseArgs(process.argv.slice(2));
  const cands = runAudit(root, args);
  if (args.mechanicalOnly) {
    process.stdout.write(`docs-audit (mechanical-only): ${cands.length} candidates — ${summarize(cands)}\n`);
    for (const c of cands.filter((x) => x.type === "stale_reference")) {
      process.stdout.write(`  ${c.file}:${c.lines[0]}  ${c.evidence}\n`);
    }
  } else {
    process.stdout.write(`docs-audit (${args.mode}): ${cands.length} candidates — ${summarize(cands)} → ${args.out}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
