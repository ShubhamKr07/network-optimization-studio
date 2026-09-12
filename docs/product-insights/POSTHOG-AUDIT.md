# PostHog Integration Audit (2026-09-12)

Task POSTHOG-1. Read-only inventory of the **existing** PostHog wiring, done before any new analytics path is written. Ground truth for the rest of the plan.

## Existing events (backend, 26 captures)

| Event name | Source file | Property keys | In allowlist? |
|---|---|---|---|
| `user registered` | `routes/auth.ts:84` | (verify at impl) | — |
| `user logged in` | `routes/auth.ts:122` | — | — |
| `user logged out` | `routes/auth.ts:144` | — | — |
| `scenario created` | `routes/scenarios.ts:122` | `scenario_id`, `model_id` | yes |
| `scenario updated` | `routes/scenarios.ts:174` | `scenario_id`, `model_id` | yes |
| `scenario deleted` | `routes/scenarios.ts:210` | `scenario_id`, `model_id` | yes |
| `scenario solve enqueued` | `routes/scenarios.ts:327` | `scenario_id`, `model_id`, `job_id` | yes |
| `scenario data exported` | `routes/scenarios.ts` (×12) | `scenario_id`, `model_id`, `entity`, `format` | yes |
| `scenario data imported` | `routes/scenarios.ts:1135` | `scenario_id`, `model_id`, `rows` | yes |
| `scenario cloned` | `routes/scenarios.ts:1165` | `scenario_id`, `model_id` | yes |
| `scenario solve completed` | `solver/jobRunner.ts:313,391` | `scenario_id`, `model_id`, `run_time_sec`, `cache_hit`, `objective` | yes |
| `scenario solve failed` | `solver/jobRunner.ts:336,354,370,381` | `scenario_id`, `model_id` | yes |

**Convention confirmed:** event names are space-separated `"noun verbed"`; property keys are `snake_case`; `distinctId` is always `req.userId`. New events must match. **No existing event is renamed or re-propped** by this plan. (Exact prop keys per capture to be re-confirmed line-by-line by the implementer of any task that touches these files; the inventory above is the shape, not a contract to modify.)

## Identity equality (load-bearing for POSTHOG-4)

- Backend: every capture uses `distinctId: req.userId`. `req.userId` is set from the signed session cookie in `middlewares/auth.ts:15-20` — it **is** the DB `users.id` string.
- API contract: the auth response envelope is `AuthUserEnvelope { user: AuthUser | null }`; `AuthUser` has a **required `id: string`** field (`lib/api-spec/openapi.yaml:573-584`). Note the schema is named `AuthUser`, not `User`.
- Frontend: `data?.user` in `App.tsx:36` is that `AuthUser`.
- **Conclusion:** `data.user.id` (frontend) === `req.userId` (backend). POSTHOG-4 calls `identifyUser(user.id)`. Same string both sides ⇒ one person profile, no PII.

## Backend invariants already present (do NOT re-add)

| Invariant | Location |
|---|---|
| Null-guard no-op client (`posthog` is `null` when `POSTHOG_API_KEY` unset) | `lib/posthog.ts:18` |
| Env names `POSTHOG_API_KEY` / `POSTHOG_HOST` (default `https://us.i.posthog.com`) | `lib/posthog.ts:3-4` |
| Header session linking (`setupExpressRequestContext`) | `app.ts:63-65` |
| Exception autocapture (`setupExpressErrorHandler` + `enableExceptionAutocapture`) | `app.ts:83-85`, `lib/posthog.ts:21` |
| SIGTERM flush (`posthog?.shutdown()`) | `index.ts:39,44` |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` on `nos-api` | `render.yaml:22-27` |
| **429 site with NO capture (the one backend gap)** | `routes/scenarios.ts:291` |

429 ordering confirmed: the queue check (`scenarios.ts:291`) returns **before** the scenario lookup (`db.select` at `scenarios.ts:300`), so the `scenario solve rejected` event (POSTHOG-2) carries only `{ scenario_id, queue_depth }` — `model_id` is not yet known.

## Required GitHub secrets (for POSTHOG-9)

Set in GitHub → Settings → Secrets before the first scheduled run:
- `POSTHOG_PROJECT_KEY`
- `POSTHOG_PERSONAL_API_KEY` — **distinct** from the ingest key; the HogQL query API requires a personal API key.
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Max subscription OAuth token (`claude setup-token`), consumed by the workflow's `anthropics/claude-code-action@v1` synthesis step. Not `ANTHROPIC_API_KEY` — this job does not use API billing.
