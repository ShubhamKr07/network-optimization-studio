# Sentry Error Tracking Integration — Design Spec

**Date:** 2026-09-12
**Status:** Approved (brainstorming), pending spec review → implementation plan
**Topic:** Real-time error tracking (Sentry) across the studio frontend and api-server backend, plus a periodic GitHub Actions job that turns persisting Sentry issues into a committed, reviewable fix plan.

## Goal

Catch and triage runtime errors in Network Optimization Studio — client-side React crashes and server-side exceptions — with enough context to fix them, without shipping student PII to a third party. Two outcomes:

1. **Capture** — real-time error reporting from both the React studio and the Express api-server to Sentry, scrubbed of PII, tagged by `user_id`/`model_id`/`scenario_id`.
2. **Fix plans** — a periodic automated job that queries Sentry for persisting (unresolved + recurring) issues, has Claude synthesize a prioritized fix plan, and opens a reviewable PR that auto-supersedes the prior one.

Non-goals: no performance/tracing spans at launch (errors only); no session replay; no solver (Python) instrumentation; no schema/API-contract change; no auto-implementation of fixes (the plan is an intake queue for humans/`@claude`/local superpowers).

## Locked Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | **Sentry SaaS (sentry.io), US region** | Free tier (~5k errors/mo) covers a pilot; no infra; parallels the PostHog Cloud choice. |
| Surfaces | **Frontend (`@sentry/react`) + backend (`@sentry/node`)** | Covers user-facing React crashes + API exceptions. Solver excluded — it's contract-bound to never throw (degrades to `{status:error}` envelopes), so there's nothing for Sentry to catch there. |
| PII | **Scrub aggressively** | `sendDefaultPii: false` + a `beforeSend` allowlist. Keep the error + `user_id`/`model_id`/`scenario_id`; strip bodies, inputs, emails, cookies, auth headers. Mirrors the PostHog prop-allowlist stance. |
| Fix-plan loop | **Reuse the PostHog weekly-PR + auto-supersede machinery** | Same validated infra: GitHub Actions (weekly + dispatch) → query → `claude-code-action` synthesis → PR, unique per-run branch, auto-supersede, always-write, subscription OAuth auth. |
| Persisting = | **Unresolved + recurring** (events ≥ threshold in the lookback window), ranked by frequency × users affected | Filters one-off blips; targets what actually persists. |
| Tracing | **Off at launch** (`tracesSampleRate: 0`) | Errors-only keeps within the free tier; perf tracing is a later, separate decision. |

## Existing State (audited 2026-09-12)

Sentry is **not present anywhere** in the repo (confirmed: no deps, no config, no DSN, no imports — apparent "sentry" grep hits are substrings like `warehouseStatusEntry`). This is a greenfield integration, unlike PostHog (which was pre-wired on the backend).

Relevant existing hooks to build on:
- `artifacts/api-server/src/app.ts` — a 4-arg catch-all error middleware already returns `{error: "Internal server error"}` for unhandled route exceptions. Sentry's Express error handler must run **before** it (same ordering pattern PostHog's `setupExpressErrorHandler` used).
- `artifacts/api-server/src/index.ts` — already has a SIGTERM handler (`posthog?.shutdown()`); Sentry's flush hooks here too.
- `artifacts/api-server/src/lib/logger.ts` — pino logger; Sentry complements it, does not replace it.
- Frontend has **no error boundary** today — one gets added.

## Architecture

```
[studio @sentry/react] --DSN--> Sentry SaaS <--@sentry/node-- [api-server]
   NEW (frontend)                     ^                          NEW (backend)
                                      | Issues API (weekly, SENTRY_AUTH_TOKEN)
                          [GitHub Actions error-plans.yml]
                             --claude-code-action@v1--> PR: docs/error-plans/<date>.md
                             (unique per-run branch, auto-supersede, always-write)
```

- Both SDKs point at the **same Sentry project**; events tagged with `user_id` unify a user's client + server errors.
- Capture is **fire-and-forget**: Sentry down/misconfigured must never break render, request, or solve. No-op when the DSN env var is unset (same guard as the analytics wrapper). Errors only — `tracesSampleRate: 0`.
- The fix-plan loop reads **Sentry**, not the app DB — fully decoupled from runtime.

### Isolation boundaries

- **`studio/src/lib/errorTracking.ts`** (NEW) — thin wrapper: `initErrorTracking()`, `setErrorUser(id)`, `clearErrorUser()`, and the shared `scrubEvent(event)`. Components never touch the `Sentry` global directly. No-op when `VITE_SENTRY_DSN` unset. Mockable in RTL.
- **`api-server/src/lib/sentry.ts`** (NEW) — backend init + `scrubEvent`; no-op when `SENTRY_DSN` unset. Wired in `index.ts` (init + flush) and `app.ts` (error handler ordering).
- **`scripts/error-plans/`** (NEW) — `querySentry.ts` (Issues API + `toIssuesSummary`), `run.ts` (writes `aggregates.json`). Standalone, tested against a fixture; the workflow invokes it.

## PII / Scrubbing Boundary

One shared-shape `scrubEvent(event)` applied via `beforeSend` on both SDKs.

**Allowed on an event:** the exception (type, message, stack), `tags`: `user_id`, `model_id`, `scenario_id`, `route`, `method`, `status_code`; runtime/browser/OS metadata Sentry collects by default (non-PII).

**Forbidden — stripped in `beforeSend`, never sent:** `sendDefaultPii: false`; request/response bodies; scenario `inputs` values (demand, capacity, distance, lat/lng, BOM ratio); query-string values; cookies; `Authorization`/session headers; email; user IP; any free text or city/state strings.

**Tag sources (pinned — Review 1):** `user_id` = `user.id` from `useGetCurrentAuthUser` (frontend) and `req.userId` (backend) — the **same value**, confirmed equal in the PostHog audit (`AuthUser.id` ≡ `req.userId`); **never email**. `model_id`/`scenario_id` = derived from the active route / currently-loaded scenario context, **never** user-entered or free-form values. `route`/`method`/`status_code` = from the Express request, **path only** (no query-string values). No tag ever sourced from a request body or header.

**Query-stage boundary (Review 3):** the fix-plan loop reads **only issue-level metadata** — title, culprit/code location, event count, users-affected count, first/last seen, permalink. It does **not** query, fetch, or persist raw event payloads, request/response bodies, cookies, auth headers, or any free-text request data. The generated markdown contains **only aggregated issue-level reasoning** — never student data or unredacted exception payloads. This is a hard boundary to prevent the automation drifting into over-collection; the query side is lower-risk than the capture side but is not unbounded.

## SDK Wiring

### Frontend (`artifacts/studio`)
- Add `@sentry/react`.
- `lib/errorTracking.ts`: `initErrorTracking()` in `main.tsx` **before** first render, guarded by `import.meta.env.VITE_SENTRY_DSN`. Config: `sendDefaultPii: false`, `tracesSampleRate: 0`, `beforeSend: scrubEvent`, `environment` from `import.meta.env.MODE`.
- Wrap the app in Sentry's `<ErrorBoundary>` (fallback UI) — the React render-crash net.
- `setErrorUser(user.id)` in the `useGetCurrentAuthUser` success path; `clearErrorUser()` on logout. **`user.id` only, never email.**

### Backend (`artifacts/api-server`)
- Add `@sentry/node`.
- `lib/sentry.ts`: `initSentry()` called **first thing** in `index.ts` (before app import per Sentry's requirement), guarded by `SENTRY_DSN`. Config: `sendDefaultPii: false`, `tracesSampleRate: 0`, `beforeSend: scrubEvent`.
- `app.ts`: Sentry's Express error handler (`Sentry.setupExpressErrorHandler(app)`) wired **before** the existing 4-arg catch-all JSON middleware, so Sentry sees the original error before it's swallowed into the generic JSON response (exact ordering pattern of the pre-existing PostHog error handler).
- Flush (`Sentry.close(timeout)`) added to the existing SIGTERM handler in `index.ts`.

## Fix-Plan Loop (GitHub Actions)

Cloned from `product-insights.yml`, adapted to Sentry:
- New `.github/workflows/error-plans.yml`: weekly `schedule` + `workflow_dispatch`, `permissions: contents/id-token/pull-requests: write`.
- **Query step** (`scripts/error-plans/run.ts` via `npx tsx`, env `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`): call the Sentry Issues API (`GET /api/0/projects/{org}/{project}/issues/?query=is:unresolved&statsPeriod=<window>&sort=freq`), filter to events ≥ threshold, keep the PII-safe fields, write `docs/error-plans/aggregates.json`.
- **Synthesize + PR step** (`anthropics/claude-code-action@v1`, `claude_code_oauth_token`, `GH_TOKEN` env, `--allowedTools "Read,Write,Edit,Bash"`): read `aggregates.json`, write a prioritized fix plan to `docs/error-plans/${REPORT_DATE}.md` (per issue: title, frequency × users, root-cause hypothesis, suggested fix, affected model/route; always write, even on zero issues), then branch `error-plans/${REPORT_DATE}-${run_number}`, commit, push, `gh pr create`.
- **Zero-issue behavior (first-class — Review 2):** when the query returns no qualifying issues, the run still does the full path — branch, write a report whose body clearly states "no actionable issues this week", commit, open the PR, and supersede older `error-plans/*` PRs. A quiet week produces a normal (superseding) PR with an explicit no-issues note, never a silent no-op.
- **Supersede step**: close every older open `error-plans/*` PR + delete its branch, keeping only the newest.
- Secrets: `SENTRY_AUTH_TOKEN` (Issues API, read scope) + `SENTRY_ORG`/`SENTRY_PROJECT` (repo variables); reuse `CLAUDE_CODE_OAUTH_TOKEN`.

## Config & Deploy

- `render.yaml`: `SENTRY_DSN` on **nos-api** (runtime); `VITE_SENTRY_DSN` on **nos-studio** (build-time). The DSN is public/safe to expose (like the PostHog `phc_` key). `sync: false`.
- **Sourcemap upload** (CI, high-value, flagged optional): `@sentry/vite-plugin` in the studio build (or `sentry-cli`) uploads sourcemaps so minified React stack traces deminify. Needs `SENTRY_AUTH_TOKEN` + org/project at build time.
- No OpenAPI, DB, or Drizzle change.

## Testing & Acceptance

- `errorTracking.ts` / `sentry.ts`: unit-test no-op when DSN unset; correct init + `beforeSend` wired when set.
- `scrubEvent()`: unit test asserting every forbidden field (body, inputs, email, cookies, auth header) is removed and only allowlisted tags survive — the load-bearing PII test, both sides.
- Frontend: RTL test that a throwing child renders the `<ErrorBoundary>` fallback and calls the capture path (Sentry mocked).
- Backend: a route that throws is captured with a scrubbed payload (Sentry mocked; assert no body/inputs in the sent event).
- `toIssuesSummary`: tested against a fixture Sentry Issues API response (no live Sentry in any gate).
- No-regression: existing api-server + studio suites green; the catch-all JSON error middleware still returns `{error:...}` (Sentry handler runs before it, doesn't replace it); no gate depends on network to Sentry.
- Verification gate unchanged in shape: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (Python untouched).

## Deferred / Cut (YAGNI)

- Performance tracing / spans — deferred (`tracesSampleRate: 0`).
- Session replay — not scoped.
- Solver (`@sentry/python`) — excluded (never-throw contract).
- Sourcemap upload — high-value but flagged optional at launch.
- Auto-implementing fixes — out of scope; the plan is a human/`@claude`/local-superpowers intake queue.

## Review Comments Added (2026-09-12)

These notes capture the spec review before implementation planning begins.

### Review 1 — specify the exact identity mapping
The spec should explicitly define the exact `user_id` / `model_id` / `scenario_id` tag sources on both runtime surfaces.

- Frontend: the user identifier should come from the auth response object (`user.id` from the current auth query), not from email or any other profile field.
- Backend: the server-side tag should come from `req.userId`, not from the body or headers.
- Model/scenario tags should come from the active route/context or the currently loaded scenario, not from free-form or user-entered values.

This is an implementation detail that matters for cross-surface correlation and should be pinned down in the plan before the code lands.

### Review 2 — define the zero-issue weekly PR behavior explicitly
The “always write the report, even on zero issues” rule is good, but the workflow should also specify the success path when there are no issues to fix.

Required behavior:
- still create the branch and commit
- still write the markdown report
- still open a PR, with a clear “no actionable issues this week” note
- still supersede older error-plans PRs

This should be a first-class workflow requirement, not just an implied outcome.

### Review 3 — harden the PII-safety rule for the query/report stage
The design is correct to say the Sentry issue query stage is fundamentally lower risk than the runtime event stage, but the spec should state a strict boundary:

- the fix-plan loop reads only issue metadata (frequency, users affected, first/last seen, title, code location, permalink)
- it does not query or persist raw event payloads, request/response bodies, cookies, auth headers, or any free-text request data
- the generated markdown should contain only aggregated issue-level reasoning, not student data or unredacted exception payloads

The design should explicitly call this out to prevent the automation from drifting into over-collection.

### Review 4 — keep the sourcemap upload step optional at launch
The sourcemap upload idea is valuable, but it should remain a high-value optional enhancement rather than a launch requirement. The initial launch should focus on captured errors + scrubbed context + issue-to-plan automation, with sourcemap deminification as a follow-on optimization if needed.

### Review 5 — this deserves a short implementation-task checklist
The plan should contain a short Task 1 that confirms the existing repo state before code lands:
- no Sentry is present
- the backend error middleware ordering is correct
- the frontend currently has no error boundary
- the auth identity field is `user.id` on the frontend and `req.userId` on the backend

This is exactly the sort of repo-state confirmation that keeps the integration disciplined and avoids re-inventing patterns that are already settled.

## Execution Note

Implementation plan executed via **agent-team dispatch** (frontend-engineer, backend-engineer, devops-engineer, qa-sdet). Plan Task 1 is a short existing-state confirmation (no Sentry present; error-middleware ordering; auth `user.id` field). Includes a real-browser / qa-sdet QA task by default. Spec/plan docs merge to local `main` on creation and re-merge after review rounds. The fix-plan workflow deliberately reuses the just-validated `product-insights.yml` patterns (unique per-run branch, auto-supersede, always-write, atomic claude-code-action write+PR) — those are settled, not to be re-litigated.
