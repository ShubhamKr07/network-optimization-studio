/**
 * `pnpm harness:permissions:apply` — permission-review-loop plan, Task 14.
 *
 * The apply CLI. Two modes:
 *
 *  - `--mode remote`: reads the fetched-and-validated weekly artifact JSON + a PR-comments JSON
 *    file (both produced by the calling workflow — Task 15/16, out of this task's scope), the
 *    tracked `.claude/settings.json`, and `permissions-managed.json`; validates
 *    `schemaVersion`/`sourceCommit`/`trackedSettingsDigest`/freshness BEFORE calling
 *    `applyDecisions` (any validation failure exits non-zero, writes nothing); on success, writes
 *    both files atomically. This mode is the only thing a CI workflow may invoke.
 *  - `--mode local`: reads the gitignored `.harness/permissions/<week>.local.json` sidecar to
 *    promote a `reviewLocalOnly`/sensitive candidate into the LOCAL, gitignored
 *    `.claude/settings.local.json` (never the tracked file) — a human sitting at their own
 *    machine, never CI (hard-refuses if `CI`/`GITHUB_ACTIONS` env vars are set).
 *
 * This file and `lib/permissionApply.ts` are the ONLY code allowed to mutate either settings file.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, metricsDir } from "./lib/derive.js";
import { CAPTURE_SCHEMA_VERSION, canonicalJson } from "./permissions-capture.js";
import { sha256Hex } from "./lib/permissions.js";
import {
  parseDecisions,
  isFrozen,
  allDecidedOrDeferred,
  applyDecisions,
  type Artifact,
  type Decision,
  type DecisionComment,
  type IsAuthorized,
  type SettingsJson,
  type AppliedRecord,
  type RefusedRecord,
} from "./lib/permissionApply.js";
import type { ManagedMap } from "./lib/permissionManaged.js";

// --- authorization ------------------------------------------------------

/**
 * Build an `IsAuthorized` predicate from an allowlist of author associations (e.g. GitHub's
 * `author_association`: OWNER/MEMBER/COLLABORATOR) and/or an explicit author allowlist. Never
 * hardcoded inside `permissionApply.ts` itself — this is the one place a caller supplies real
 * policy, driven entirely by CLI flags (or test input), never a baked-in constant.
 */
export function createAuthorizer(opts: { allowedAssociations?: string[]; allowedAuthors?: string[] }): IsAuthorized {
  const associations = new Set((opts.allowedAssociations ?? []).map((a) => a.toUpperCase()));
  const authors = new Set(opts.allowedAuthors ?? []);
  return (author, association) => associations.has(association.toUpperCase()) || authors.has(author);
}

// --- remote-mode validation (schemaVersion / sourceCommit / trackedSettingsDigest / freshness) --

const SUPPORTED_ARTIFACT_SCHEMA_VERSIONS = [CAPTURE_SCHEMA_VERSION];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ValidateArtifactOptions {
  /** The commit sha the calling workflow already fetched-and-validated this artifact from. */
  expectedSourceCommit: string;
  /** Parsed tracked `.claude/settings.json` content, to recompute `trackedSettingsDigest`. */
  trackedSettings: unknown;
  now: Date;
  maxAgeDays: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate the artifact's `schemaVersion`/`sourceCommit`/`trackedSettingsDigest`/freshness BEFORE
 * any decision is ever applied (Task 14's own stated scope — the `sourceBlobMatches` byte-tamper
 * check is a separate, caller-supplied boolean forwarded straight into `applyDecisions`, since
 * proving it requires the actual fetch/git machinery that belongs to the calling workflow, not
 * this CLI). Reuses `permissions-capture.ts`'s own `canonicalJson` so the recomputed digest is
 * guaranteed byte-identical to how capture computed it (Important 1).
 */
export function validateArtifact(artifact: Artifact, opts: ValidateArtifactOptions): ValidationResult {
  if (!SUPPORTED_ARTIFACT_SCHEMA_VERSIONS.includes(artifact.schemaVersion)) {
    return { ok: false, reason: `unsupported artifact schemaVersion ${artifact.schemaVersion}` };
  }
  if (artifact.sourceCommit !== opts.expectedSourceCommit) {
    return {
      ok: false,
      reason: `artifact sourceCommit "${artifact.sourceCommit}" does not match the expected fetched commit "${opts.expectedSourceCommit}"`,
    };
  }
  const trackedPermissions = ((opts.trackedSettings as { permissions?: unknown })?.permissions ?? {}) as object;
  const recomputedDigest = sha256Hex(canonicalJson(trackedPermissions));
  if (artifact.trackedSettingsDigest !== recomputedDigest) {
    return {
      ok: false,
      reason: "trackedSettingsDigest mismatch -- the tracked .claude/settings.json has drifted since capture",
    };
  }
  const generatedMs = Date.parse(artifact.generatedAt);
  if (!Number.isFinite(generatedMs)) {
    return { ok: false, reason: `artifact.generatedAt is not a valid timestamp: "${artifact.generatedAt}"` };
  }
  const ageMs = opts.now.getTime() - generatedMs;
  const maxAgeMs = opts.maxAgeDays * DAY_MS;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    return {
      ok: false,
      reason: `artifact is stale (generatedAt ${artifact.generatedAt}, age ${(ageMs / DAY_MS).toFixed(2)}d exceeds max ${opts.maxAgeDays}d)`,
    };
  }
  return { ok: true };
}

// --- remote-mode pure core ------------------------------------------------

export interface RemoteApplyInputs {
  artifact: Artifact;
  comments: DecisionComment[];
  trackedSettings: SettingsJson;
  managed: ManagedMap;
  now: Date;
  maxAgeDays: number;
  sourceCommit: string;
  sourceBlobMatches: boolean;
  isAuthorized: IsAuthorized;
}

export interface RemoteApplyOutcome {
  ok: boolean;
  reason?: string;
  settings?: SettingsJson;
  managed?: ManagedMap;
  applied?: AppliedRecord[];
  refused?: RefusedRecord[];
}

/**
 * The full remote-apply pipeline, pure (no I/O): validate the artifact, require an authorized
 * freeze comment, parse+authorize every decision, require every candidate decided-or-deferred,
 * then run `applyDecisions`. Any failure short-circuits with `ok: false` and no settings/managed
 * output — the CLI's `main()` is responsible for exiting non-zero and writing nothing in that case.
 */
export function runRemoteApply(input: RemoteApplyInputs): RemoteApplyOutcome {
  const validation = validateArtifact(input.artifact, {
    expectedSourceCommit: input.sourceCommit,
    trackedSettings: input.trackedSettings,
    now: input.now,
    maxAgeDays: input.maxAgeDays,
  });
  if (!validation.ok) return { ok: false, reason: validation.reason };

  if (!isFrozen(input.comments, { isAuthorized: input.isAuthorized })) {
    return { ok: false, reason: 'no authorized freeze comment ("@claude apply permission review") found' };
  }

  const decisions: Decision[] = parseDecisions(input.comments, {
    isAuthorized: input.isAuthorized,
    candidateKind: (id) => input.artifact.candidates.find((c) => c.id === id)?.kind,
  });

  if (!allDecidedOrDeferred(input.artifact, decisions)) {
    return { ok: false, reason: "not every candidate has been decided or deferred" };
  }

  const result = applyDecisions({
    artifact: input.artifact,
    decisions,
    settings: input.trackedSettings,
    managed: input.managed,
    now: input.now.toISOString(),
    sourceBlobMatches: input.sourceBlobMatches,
  });

  return {
    ok: true,
    settings: result.settings,
    managed: result.managed,
    applied: result.applied,
    refused: result.refused,
  };
}

// --- local-mode pure core -------------------------------------------------

/** True in any recognized CI environment (GitHub Actions or the generic `CI` env var). */
export function isRunningInCI(env: NodeJS.ProcessEnv): boolean {
  return env.CI === "true" || env.CI === "1" || env.GITHUB_ACTIONS === "true";
}

export interface LocalSidecar {
  schemaVersion: number;
  week: string;
  localAllowDigest: string;
  /** candidate id -> full raw command, local-only (never in the tracked artifact). */
  commands: Record<string, string>;
}

export interface PromoteLocalInput {
  localSettings: SettingsJson;
  sidecar: LocalSidecar;
  candidateId: string;
  /** Defaults to the exact `Bash(<full command>)` recovered from the sidecar. */
  rule?: string;
}

export interface PromoteLocalResult {
  ok: boolean;
  reason?: string;
  settings?: SettingsJson;
  rule?: string;
}

/**
 * Promote one candidate (by id) from the local sidecar into `localSettings.permissions.allow`,
 * deduped, never reordering existing entries. Pure — never touches disk itself.
 */
export function promoteLocalCandidate(input: PromoteLocalInput): PromoteLocalResult {
  const command = input.sidecar.commands[input.candidateId];
  if (command === undefined) {
    return { ok: false, reason: `candidate id "${input.candidateId}" not found in the local sidecar` };
  }
  const rule = input.rule ?? `Bash(${command.trim()})`;
  const allow = [...(input.localSettings.permissions?.allow ?? [])];
  if (!allow.includes(rule)) allow.push(rule);
  const settings: SettingsJson = {
    ...input.localSettings,
    permissions: {
      allow,
      deny: [...(input.localSettings.permissions?.deny ?? [])],
      ask: [...(input.localSettings.permissions?.ask ?? [])],
    },
  };
  return { ok: true, settings, rule };
}

// --- CLI --------------------------------------------------------------

export interface RemoteApplyFlags {
  mode: "remote";
  artifactPath: string;
  commentsPath: string;
  settingsPath: string;
  managedPath: string;
  sourceCommit: string;
  sourceBlobMatches: boolean;
  maxAgeDays: number;
  authorizedAssociations: string[];
  authorizedAuthors: string[];
  /** ISO override, testing only. */
  now?: string;
  dryRun: boolean;
}

export interface LocalApplyFlags {
  mode: "local";
  sidecarPath: string;
  settingsLocalPath: string;
  candidateId: string;
  rule?: string;
  dryRun: boolean;
}

export type ApplyFlags = RemoteApplyFlags | LocalApplyFlags;

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse CLI argv into flags for one of the two modes. Defaults to `remote` if `--mode` is omitted. */
export function parseArgs(argv: string[], root: string): ApplyFlags {
  let mode: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") mode = argv[i + 1];
  }

  if (mode === "local") {
    const f: LocalApplyFlags = {
      mode: "local",
      sidecarPath: "",
      settingsLocalPath: join(root, ".claude", "settings.local.json"),
      candidateId: "",
      dryRun: false,
    };
    for (let i = 0; i < argv.length; i++) {
      switch (argv[i]) {
        case "--sidecar":
          f.sidecarPath = argv[++i] ?? "";
          break;
        case "--settings-local":
          f.settingsLocalPath = argv[++i] ?? f.settingsLocalPath;
          break;
        case "--id":
          f.candidateId = argv[++i] ?? "";
          break;
        case "--rule":
          f.rule = argv[++i];
          break;
        case "--dry-run":
          f.dryRun = true;
          break;
      }
    }
    return f;
  }

  const f: RemoteApplyFlags = {
    mode: "remote",
    artifactPath: "",
    commentsPath: "",
    settingsPath: join(root, ".claude", "settings.json"),
    managedPath: join(metricsDir(), "permissions-managed.json"),
    sourceCommit: "",
    sourceBlobMatches: false,
    maxAgeDays: 8,
    authorizedAssociations: ["OWNER", "MEMBER", "COLLABORATOR"],
    authorizedAuthors: [],
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--artifact":
        f.artifactPath = argv[++i] ?? "";
        break;
      case "--comments":
        f.commentsPath = argv[++i] ?? "";
        break;
      case "--settings":
        f.settingsPath = argv[++i] ?? f.settingsPath;
        break;
      case "--managed":
        f.managedPath = argv[++i] ?? f.managedPath;
        break;
      case "--source-commit":
        f.sourceCommit = argv[++i] ?? "";
        break;
      case "--source-blob-matches":
        f.sourceBlobMatches = true;
        break;
      case "--max-age-days":
        f.maxAgeDays = Number(argv[++i]);
        break;
      case "--authorized-associations":
        f.authorizedAssociations = splitCsv(argv[++i] ?? "");
        break;
      case "--authorized-authors":
        f.authorizedAuthors = splitCsv(argv[++i] ?? "");
        break;
      case "--now":
        f.now = argv[++i];
        break;
      case "--dry-run":
        f.dryRun = true;
        break;
      case "--mode":
        i++; // already consumed above
        break;
    }
  }
  return f;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonOrDefault<T>(path: string, fallback: T): T {
  return existsSync(path) ? readJson<T>(path) : fallback;
}

/** Write atomically: write to a sibling temp file, then rename over the target. */
function atomicWriteFileSync(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function runRemoteMain(flags: RemoteApplyFlags): void {
  if (!flags.artifactPath || !flags.commentsPath || !flags.sourceCommit) {
    process.stderr.write(
      "permissions-apply --mode remote requires --artifact, --comments, and --source-commit\n",
    );
    process.exit(1);
  }

  const artifact = readJson<Artifact>(flags.artifactPath);
  const comments = readJson<DecisionComment[]>(flags.commentsPath);
  const trackedSettings = readJsonOrDefault<SettingsJson>(flags.settingsPath, {});
  const managed = readJsonOrDefault<ManagedMap>(flags.managedPath, {});
  const now = flags.now ? new Date(flags.now) : new Date();

  const isAuthorized = createAuthorizer({
    allowedAssociations: flags.authorizedAssociations,
    allowedAuthors: flags.authorizedAuthors,
  });

  const outcome = runRemoteApply({
    artifact,
    comments,
    trackedSettings,
    managed,
    now,
    maxAgeDays: flags.maxAgeDays,
    sourceCommit: flags.sourceCommit,
    sourceBlobMatches: flags.sourceBlobMatches,
    isAuthorized,
  });

  if (!outcome.ok) {
    process.stderr.write(`permissions-apply: refused -- ${outcome.reason}\n`);
    process.exit(1);
  }

  const appliedCount = outcome.applied?.length ?? 0;
  const refusedCount = outcome.refused?.length ?? 0;

  if (flags.dryRun) {
    process.stdout.write(`permissions-apply (dry-run): would apply ${appliedCount}, refuse ${refusedCount}\n`);
    return;
  }

  atomicWriteFileSync(flags.settingsPath, JSON.stringify(outcome.settings, null, 2) + "\n");
  atomicWriteFileSync(flags.managedPath, JSON.stringify(outcome.managed, null, 2) + "\n");

  process.stdout.write(`permissions-apply: applied ${appliedCount}, refused ${refusedCount}\n`);
  for (const a of outcome.applied ?? []) process.stdout.write(`  applied ${a.id} ${a.keyword} ${a.rule ?? ""}\n`);
  for (const r of outcome.refused ?? []) process.stdout.write(`  refused ${r.id}: ${r.reason}\n`);
}

function runLocalMain(flags: LocalApplyFlags): void {
  if (isRunningInCI(process.env)) {
    process.stderr.write("permissions-apply --mode local must never run in CI\n");
    process.exit(1);
  }
  if (!flags.sidecarPath || !flags.candidateId) {
    process.stderr.write("permissions-apply --mode local requires --sidecar and --id\n");
    process.exit(1);
  }

  const sidecar = readJson<LocalSidecar>(flags.sidecarPath);
  const localSettings = readJsonOrDefault<SettingsJson>(flags.settingsLocalPath, {});

  const result = promoteLocalCandidate({
    localSettings,
    sidecar,
    candidateId: flags.candidateId,
    rule: flags.rule,
  });

  if (!result.ok) {
    process.stderr.write(`permissions-apply --mode local: refused -- ${result.reason}\n`);
    process.exit(1);
  }

  if (flags.dryRun) {
    process.stdout.write(`permissions-apply --mode local (dry-run): would add ${result.rule}\n`);
    return;
  }

  atomicWriteFileSync(flags.settingsLocalPath, JSON.stringify(result.settings, null, 2) + "\n");
  process.stdout.write(`permissions-apply --mode local: added ${result.rule} to ${flags.settingsLocalPath}\n`);
}

function main(): void {
  const root = repoRoot();
  const flags = parseArgs(process.argv.slice(2), root);
  if (flags.mode === "local") runLocalMain(flags);
  else runRemoteMain(flags);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
