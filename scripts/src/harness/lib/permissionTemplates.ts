/**
 * A SHORT, human-reviewed registry of safe rule generalizations for `suggestRule()`.
 *
 * Deliberately narrow — see `docs/superpowers/specs/2026-09-18-permission-review-loop-design.md`
 * ("Pattern suggestion — exact by default") and the plan's Review comment 5: a free "executable +
 * first subcommand" heuristic produced dangerous families like `Bash(pnpm exec *)`,
 * `Bash(docker run *)`, `Bash(git config *)`, `Bash(git push *)` — each of those can run arbitrary
 * repository-controlled code, mutate configuration, launch arbitrary containers, or push with a
 * hidden force flag. Nothing in this file generalizes any of those.
 *
 * Every entry here is a specific, individually-reviewed generalization, not a general heuristic.
 * Adding a new entry is a deliberate, reviewed change — do not add a broad catch-all.
 */

export interface PermissionTemplate {
  id: string;
  /** The exact `Bash(<pattern>)` rule this template proposes when its `test` matches. */
  rule: string;
  /** Matches against the trimmed raw command (not yet wrapped in `Bash(...)`). */
  test: (command: string) => boolean;
}

// Git read-only subcommands. `git branch` is deliberately restricted to the literal `--list` flag
// — bare `git branch <name>` CREATES a branch and `git branch -D` deletes one, neither read-only.
export const PERMISSION_TEMPLATES: PermissionTemplate[] = [
  { id: "git_log", rule: "Bash(git log *)", test: (c) => /^git\s+log(\s|$)/.test(c) },
  { id: "git_status", rule: "Bash(git status *)", test: (c) => /^git\s+status(\s|$)/.test(c) },
  { id: "git_diff", rule: "Bash(git diff *)", test: (c) => /^git\s+diff(\s|$)/.test(c) },
  { id: "git_show", rule: "Bash(git show *)", test: (c) => /^git\s+show(\s|$)/.test(c) },
  {
    id: "git_branch_list",
    rule: "Bash(git branch --list *)",
    test: (c) => /^git\s+branch\s+--list(\s|$)/.test(c),
  },
  { id: "pnpm_version", rule: "Bash(pnpm -v)", test: (c) => c === "pnpm -v" },
  {
    id: "pnpm_filter_test",
    rule: "Bash(pnpm --filter * test)",
    test: (c) => /^pnpm\s+--filter\s+\S+\s+test(\s|$)/.test(c),
  },
  {
    id: "pnpm_filter_typecheck",
    rule: "Bash(pnpm --filter * typecheck)",
    test: (c) => /^pnpm\s+--filter\s+\S+\s+typecheck(\s|$)/.test(c),
  },
];

// `pnpm run <script>` is deliberately NOT wildcarded over the script name (unlike `--filter`
// above): an arbitrary "pnpm run <script>" can invoke a repository-controlled lifecycle script
// (the exact class of risk Review 5 called out for `pnpm exec *`/`docker run *`). Instead, only a
// small, reviewed set of known script names produce an exact per-script rule.
export const KNOWN_PNPM_RUN_SCRIPTS = ["dev", "build", "start", "test", "typecheck", "lint"];

/**
 * Returns the exact `Bash(pnpm run <script>)` rule if `command` is `pnpm run <script>` for a
 * script in the reviewed `KNOWN_PNPM_RUN_SCRIPTS` set, else `null` (caller falls back to
 * exact-by-default — same output either way, since this never wildcards the script name).
 */
export function pnpmRunTemplateRule(command: string): string | null {
  const m = command.match(/^pnpm\s+run\s+(\S+)$/);
  if (!m) return null;
  const script = m[1];
  if (!KNOWN_PNPM_RUN_SCRIPTS.includes(script)) return null;
  return `Bash(pnpm run ${script})`;
}
