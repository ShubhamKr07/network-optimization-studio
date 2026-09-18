/**
 * `pnpm harness:permissions:capture` — permission-review-loop plan, Task 9.
 *
 * Reads the local, gitignored inputs (the two-hook ledger, the session transcript, the tracked +
 * local project allowlists, and the managed-rule sidecar), builds this week's candidate list via
 * T8's `buildCandidates`, and writes:
 *   - `docs/superpowers/metrics/permissions-review/<week>.json` (TRACKED, authoritative)
 *   - `docs/superpowers/metrics/permissions-review/<week>.md`   (TRACKED, generated view)
 *   - `.harness/permissions/<week>.local.json`                  (gitignored, full commands)
 *
 * Reads only — never edits any settings file. `--weeks-ago N` shifts the 7-day capture window
 * back N weeks; `--dry-run` computes everything but writes nothing.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot, metricsDir } from "./lib/derive.js";
import { isoWeek } from "./lib/stats.js";
import { transcriptDirFor } from "./audit-permissions.js";
import {
  buildCandidates,
  parseStandingPermissions,
  parseDenials,
  sha256Hex,
  escapeCell,
  type Candidate,
  type Window,
  type BuildCandidatesInput,
} from "./lib/permissions.js";
import { parseLedger, correlate, promotableCommands } from "./lib/permissionLedger.js";
import { refreshUsage, type ManagedMap, type ExecutedCommand } from "./lib/permissionManaged.js";

export const CAPTURE_SCHEMA_VERSION = 1;

// --- args --------------------------------------------------------------

export interface CaptureFlags {
  weeksAgo: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CaptureFlags {
  const f: CaptureFlags = { weeksAgo: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--weeks-ago":
        f.weeksAgo = Number(argv[++i]);
        break;
      case "--dry-run":
        f.dryRun = true;
        break;
    }
  }
  return f;
}

// --- window / canonical serialization -----------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A 7-day window ending `weeksAgo` weeks before `now` (weeksAgo=0 -> the most recent 7 days). */
export function computeWindow(weeksAgo: number, now: Date): Window {
  const end = new Date(now.getTime() - weeksAgo * WEEK_MS);
  const start = new Date(end.getTime() - WEEK_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Recursively sort object keys so the same logical object always serializes identically (CI-reproducible). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

// --- pure core -----------------------------------------------------------

export interface CaptureInputs {
  ledgerText: string;
  transcriptText: string;
  trackedSettings: unknown;
  localSettings: unknown;
  managed: ManagedMap;
  now: Date;
  weeksAgo: number;
  sourceCommit: string;
  staleWeeks?: number;
}

export interface CaptureArtifact {
  schemaVersion: number;
  sourceCommit: string;
  trackedSettingsDigest: string;
  window: Window;
  generatedAt: string;
  candidates: Candidate[];
}

export interface CaptureLocalSidecar {
  schemaVersion: number;
  week: string;
  localAllowDigest: string;
  /** candidate id -> full raw command (local-only; never in the tracked artifact). */
  commands: Record<string, string>;
}

export interface CaptureResult {
  week: string;
  artifact: CaptureArtifact;
  markdown: string;
  local: CaptureLocalSidecar;
}

/** Extract every Bash tool_use's full command from a transcript, regardless of provenance -- the
 * only place usage of an already-allowed (never-prompted) managed rule is still observable, since
 * the ledger's own "executed" events deliberately carry no command (see permissionLedger.ts). */
function extractExecutedBashCommands(jsonlText: string): ExecutedCommand[] {
  const out: ExecutedCommand[] = [];
  for (const line of jsonlText.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at = typeof o.timestamp === "string" ? o.timestamp : "";
    const msg = o.message as { content?: unknown } | undefined;
    const blocks = Array.isArray(msg?.content) ? (msg!.content as Record<string, unknown>[]) : [];
    for (const b of blocks) {
      if (b?.type === "tool_use" && b.name === "Bash") {
        const bi = b.input as { command?: unknown } | undefined;
        if (bi && typeof bi.command === "string") out.push({ command: bi.command, at });
      }
    }
  }
  return out;
}

function candidateRow(c: Candidate): string {
  const rule = c.proposedRule ? escapeCell(c.proposedRule) : "—";
  return `| \`${c.id}\` | ${c.level} | ${c.count} | ${c.firstSeen || "unknown"} | ${c.lastSeen || "unknown"} | ${rule} | ${c.redactedPreview} |`;
}

const TABLE_HEADER = "| id | level | count | first seen | last seen | proposed rule | preview |";
const TABLE_SEP = "|---|---|---|---|---|---|---|";

function renderSection(title: string, cands: Candidate[]): string[] {
  const L: string[] = [`## ${title}`, ""];
  if (cands.length === 0) {
    L.push("_(none)_", "");
    return L;
  }
  L.push(TABLE_HEADER, TABLE_SEP, ...cands.map(candidateRow), "");
  return L;
}

/** Generated markdown view of the artifact. Every rendered field is escaped (redactedPreview is
 * already escaped by buildCandidates; proposedRule is raw in the JSON on purpose -- for apply --
 * so it's escaped HERE, at render time, not baked into the stored candidate. */
export function buildMarkdown(
  week: string,
  meta: { generatedAt: string; window: Window; sourceCommit: string },
  candidates: Candidate[],
): string {
  const grants = candidates.filter((c) => c.kind === "grant");
  const denies = candidates.filter((c) => c.kind === "deny");
  const revokes = candidates.filter((c) => c.kind === "revoke");
  const destructive = candidates.filter((c) => c.level === "destructive");

  const L: string[] = [];
  L.push(`# Permission review — week ${week}`, "");
  L.push(
    `Generated: ${meta.generatedAt}. Window: ${meta.window.start ?? "unknown"} – ${meta.window.end ?? "unknown"}. Source commit: ${meta.sourceCommit}.`,
    "",
  );
  L.push("## Decision legend", "");
  L.push("- `@claude allow <id>` — promote an `ok`/`broad` candidate");
  L.push("- `@claude allow-risky <id>` — promote a `risky` candidate");
  L.push("- `@claude allow-destructive <id>` — promote a `destructive` candidate, exact byte-for-byte only");
  L.push("- `@claude deny <id>` — record a standing deny");
  L.push("- `@claude revoke <id>` — remove a managed rule");
  L.push("- `@claude defer <id>` — decide later (still counts toward the freeze)");
  L.push("- `@claude allow <id> as Bash(<rule>)` — override the proposed rule (re-classified before acceptance)");
  L.push("");

  L.push(...renderSection("Grant candidates", grants));
  L.push(...renderSection("Deny candidates", denies));
  L.push(...renderSection("Revoke proposals", revokes));

  L.push("## ⚠ Destructive — review in full", "");
  if (destructive.length === 0) {
    L.push("_(none)_", "");
  } else {
    for (const c of destructive) L.push(`- \`${c.id}\` (${c.kind}) — ${c.redactedPreview}`);
    L.push("");
  }

  return L.join("\n");
}

/** Pure core: given already-loaded inputs, build everything capture would write. No I/O. */
export function runCapture(inputs: CaptureInputs): CaptureResult {
  const window = computeWindow(inputs.weeksAgo, inputs.now);
  const week = isoWeek(new Date(window.end as string));
  const generatedAt = inputs.now.toISOString();

  const trackedAllow = parseStandingPermissions(inputs.trackedSettings).allow;
  const localAllow = parseStandingPermissions(inputs.localSettings).allow;
  const projectAllow = [...new Set([...trackedAllow, ...localAllow])];

  // Usage of an already-managed/allowed rule never shows up as a "prompted" ledger event (no
  // PermissionRequest fires for an already-allowed command) -- the transcript is the only place
  // that traffic is still observable. Refresh in-memory only; T9 does not persist this back to
  // permissions-managed.json (that's the weekly wrapper's job, T10, out of this task's scope).
  const executed = extractExecutedBashCommands(inputs.transcriptText);
  const managedRefreshed = refreshUsage(inputs.managed, executed);

  const buildInput: BuildCandidatesInput = {
    ledger: inputs.ledgerText,
    transcript: inputs.transcriptText,
    projectAllow,
    managed: managedRefreshed,
    window,
    now: generatedAt,
    staleWeeks: inputs.staleWeeks,
  };
  const candidates = buildCandidates(buildInput);

  const trackedPermissions = ((inputs.trackedSettings as { permissions?: unknown })?.permissions ?? {}) as object;
  const trackedSettingsDigest = sha256Hex(canonicalJson(trackedPermissions));
  const localAllowDigest = sha256Hex(canonicalJson({ allow: projectAllow }));

  const artifact: CaptureArtifact = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    sourceCommit: inputs.sourceCommit,
    trackedSettingsDigest,
    window,
    generatedAt,
    candidates,
  };

  const markdown = buildMarkdown(week, { generatedAt, window, sourceCommit: inputs.sourceCommit }, candidates);

  // Recover the full raw command per (non-revoke) candidate id, for the local-only sidecar. This
  // intentionally re-derives from the same inputs rather than threading a second return value
  // through buildCandidates -- keeps T8's public surface exactly `Candidate[]`.
  const commands: Record<string, string> = {};
  for (const c of candidates) {
    if (c.kind === "revoke") continue;
    const found = findRawCommandForCandidate(c, buildInput);
    if (found) commands[c.id] = found;
  }

  const local: CaptureLocalSidecar = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    week,
    localAllowDigest,
    commands,
  };

  return { week, artifact, markdown, local };
}

/**
 * Re-derive the raw command a candidate id was built from, for the local-only sidecar.
 * `candidate.commandDigest` always equals `sha256Hex()` of exactly one real raw command
 * buildCandidates saw (the last-seen one in its group, for a deduped/templated grant/deny; the
 * only one, for a sensitive candidate) — so a plain digest match against the same raw-command
 * pool buildCandidates itself walked is always sufficient. Only the *lookup* is re-walked here;
 * no redaction/classification logic is duplicated (that stays exclusively in permissions.ts).
 */
function findRawCommandForCandidate(candidate: Candidate, input: BuildCandidatesInput): string | undefined {
  const pool =
    candidate.kind === "grant"
      ? promotableCommands(correlate(parseLedger(input.ledger, input.window))).map((r) => r.command)
      : parseDenials(input.transcript, input.window)
          .filter((d) => d.tool === "Bash" && d.input)
          .map((d) => d.input);

  return pool.find((command) => sha256Hex(command) === candidate.commandDigest);
}

// --- writers ---------------------------------------------------------------

export interface WriteOpts {
  root: string;
  dryRun: boolean;
}

export interface WrittenPaths {
  jsonPath: string;
  mdPath: string;
  localPath: string;
}

export function writeCaptureResult(result: CaptureResult, opts: WriteOpts): WrittenPaths {
  const reviewDir = join(opts.root, "docs", "superpowers", "metrics", "permissions-review");
  const jsonPath = join(reviewDir, `${result.week}.json`);
  const mdPath = join(reviewDir, `${result.week}.md`);
  const localDir = join(opts.root, ".harness", "permissions");
  const localPath = join(localDir, `${result.week}.local.json`);

  if (!opts.dryRun) {
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(result.artifact, null, 2) + "\n");
    writeFileSync(mdPath, result.markdown + "\n");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(localPath, JSON.stringify(result.local, null, 2) + "\n");
  }

  return { jsonPath, mdPath, localPath };
}

// --- CLI ---------------------------------------------------------------

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readAllTranscripts(dir: string): string {
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

function gitHeadSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main(): void {
  const root = repoRoot();
  const flags = parseArgs(process.argv.slice(2));

  const ledgerPath = join(root, ".harness", "permissions", "ledger.jsonl");
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
  const transcriptText = readAllTranscripts(transcriptDirFor(root));
  const trackedSettings = readJsonFile(join(root, ".claude", "settings.json"), {});
  const localSettings = readJsonFile(join(root, ".claude", "settings.local.json"), {});
  const managed = readJsonFile<ManagedMap>(join(metricsDir(), "permissions-managed.json"), {});

  const result = runCapture({
    ledgerText,
    transcriptText,
    trackedSettings,
    localSettings,
    managed,
    now: new Date(),
    weeksAgo: flags.weeksAgo,
    sourceCommit: gitHeadSha(root),
  });

  const paths = writeCaptureResult(result, { root, dryRun: flags.dryRun });
  const verb = flags.dryRun ? "would write" : "wrote";
  process.stdout.write(
    `permissions-capture (week ${result.week}): ${result.artifact.candidates.length} candidates — ${verb} ${paths.jsonPath}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
