# Task 0 — Permission Provenance Observability Spike (findings)

**Date:** 2026-09-18 · **Claude Code version probed:** 2.1.216 · **Result: PASS — viable, no redesign.**

## Question

Can the harness observe, from Claude Code hooks/transcript, that a human was *prompted for and
approved* a specific Bash command once (the promotable signal) — distinct from auto-approval
(allowlist/builtin/bypass/acceptEdits)?

## Evidence

Probed the installed binary (`/Users/shubhamkr/.local/share/claude/versions/2.1.216`) + the official
[hooks reference](https://code.claude.com/docs/en/hooks).

- **`PermissionRequest` hook exists** (present in the 2.1.216 bundle; 139 refs) and, per the docs,
  **"fires when a tool call needs a permission decision"** — i.e. only when the command is NOT already
  covered by an allow rule (auto-approved commands raise no prompt, so no `PermissionRequest`).
  Input fields: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`,
  `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`.
- **`PostToolUse`** fires **after a tool call succeeds**; same correlatable keys (`tool_use_id`,
  `session_id`, `permission_mode`).
- **Neither hook reports the human's chosen option** (allow-once vs allow-always vs deny).
  `PermissionRequest` fires *before* the decision; `PostToolUse` fires *after* success.

## Conclusion — the promotable signal is `prompted_and_executed`

Correlating the two hooks by `tool_use_id` yields an observable, evidence-backed provenance model:

| provenance | evidence | promotable? |
|-----------|----------|-------------|
| `prompted_and_executed` | `PermissionRequest` + matching `PostToolUse` success, `permission_mode` ∉ {bypassPermissions} | **yes** (grant candidate) |
| `prompted_and_denied` | `PermissionRequest`, no `PostToolUse`, transcript denial marker (OBS-12 `parseDenials`) | no (deny candidate) |
| `auto_no_prompt` | `PostToolUse` with no `PermissionRequest` (allowlisted / builtin read-only) | no (observation) |
| `bypass` | `permission_mode == bypassPermissions` | no (observation) |
| `unknown` | anything uncorrelatable | no (observation) |

Not distinguishing allow-once vs allow-always is immaterial: if the human chose allow-always, Claude
Code already wrote the rule into `settings.local.json`, and capture dedupes candidates against the
current allowlist — so it never re-surfaces. Promoting a `prompted_and_executed` command to the
tracked standing allowlist is exactly the intent.

## Plan impact

- The ledger is **two hook registrations** — `PermissionRequest` (records `prompted`, full command
  from `tool_input`, `tool_use_id`, `permission_mode`) and `PostToolUse` (records `executed`,
  `tool_use_id`) — correlated at capture time by `tool_use_id`. Replaces the single-PreToolUse design.
- The `explicit_once` term is replaced by `prompted_and_executed` throughout.
- The "fallback to unknown / opt-in recorder / possible redesign" caveat is **resolved** — dropped.
- Gate **passed**: proceed to T1+.
