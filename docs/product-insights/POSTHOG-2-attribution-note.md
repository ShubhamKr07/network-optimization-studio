# Commit-attribution note — POSTHOG-2 test

**Date:** 2026-09-12

## What happened

Task **POSTHOG-2** ("capture `scenario solve rejected` on the 429 backpressure path") was implemented by a background agent working in the **shared main checkout** at the same time an unrelated **`[OBS-4]`** commit (`f2a9882`) was being made in the same checkout.

A git-index race resulted: the POSTHOG-2 test edit to `artifacts/api-server/src/__tests__/routes.test.ts` was still staged/uncommitted when the `[OBS-4]` commit ran, so `git add` swept that test into `f2a9882` alongside its unrelated healthz/smoke-check changes.

## Net effect

- **Content is correct and complete at HEAD.** The `scenario solve rejected` capture (`scenarios.ts`) and its test (`routes.test.ts`) are both present and passing.
- **Only blame attribution is split:**
  - `artifacts/api-server/src/routes/scenarios.ts` → commit `810d12a` `[POSTHOG-2]` (correct).
  - `artifacts/api-server/src/__tests__/routes.test.ts` (the 429 test + `posthog` mock) → commit `f2a9882` `[OBS-4]` (misattributed).

## Decision

Left **as-is by design.** No rebase/amend of shared `main` was performed — that history was already being built on by concurrent work, and rewriting it is a destructive operation with wider blast radius than the cosmetic benefit of correcting one file's blame. This note is the record instead.

## Root cause / prevention

This is the exact bug class in the repo's own Bundle-3 retrospective: **agents committing to a shared checkout must use an explicit pathspec** (`git commit -- <paths>`) and re-check `git status` immediately before committing, so a teammate's staged-but-uncommitted files can't be swept into the wrong commit. The safer pattern (used for the other PostHog tasks 3–9) is **one isolated git worktree per concurrent agent**. POSTHOG-2 ran in the shared checkout because it was a single small backend change dispatched alongside a disjoint devops task; the collision was with the user's own parallel `[OBS-4]` work, not another PostHog agent.
