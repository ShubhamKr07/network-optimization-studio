# GLM subagent delegation is disabled for this project

**Decision (harness OBS-8):** work in this repository is not delegated to GLM. This overrides the
global preference (in `~/.claude/CLAUDE.md`) that otherwise routes cheap subtasks to GLM.

## Why two surfaces

Claude Code hooks are **additive** — a project settings file cannot un-register a user-level hook.
So the decision is recorded here (repo), and enforced separately outside the repo:

- **Surface A — repo (this file + `.claude/settings.json`):** documentation only. `settings.json`
  carries a self-documenting `env.NOS_GLM_DELEGATION="disabled"` marker; neither file functionally
  controls the user-level router.
- **Surface B — user-level (`~/.claude/hooks/glm_subagent_router.mjs`):** the functional change — an
  early-return when the invocation's `cwd` is under this repo, so no `[GLM router]` advisory is
  injected here. That edit lives outside the repo and is intentionally **not** committed to it (it
  was backed up to `glm_subagent_router.mjs.bak` before editing).

The standing rule remains: **never delegate to GLM** for work in this repository.
