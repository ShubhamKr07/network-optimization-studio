# Weekly Sentry error fix plans

`.github/workflows/error-plans.yml` runs every Monday 14:00 UTC (and on-demand via
`workflow_dispatch`). It queries Sentry's Issues API for persisting issues (metadata
only — no raw event payloads, request bodies, cookies, headers, or unredacted event
data ever leave the query stage), writes `docs/error-plans/aggregates.json`, then uses
`anthropics/claude-code-action` to synthesize a prioritized fix plan to
`docs/error-plans/<date>.md` and open a PR. Older open `error-plans/*` PRs are
automatically closed (with branch deletion) once a newer one lands, so the review
queue never accumulates stale reports. A zero-issue week still gets a PR — the report
plainly states "No actionable issues this week" rather than being silently skipped.

## Required GitHub configuration

**Secret** (Settings → Secrets and variables → Actions → Secrets):
- `SENTRY_AUTH_TOKEN` — a Sentry auth token scoped to read Issues API access (org/project
  read scope) for the target Sentry organization/project.

**Repository variables** (Settings → Secrets and variables → Actions → Variables):
- `SENTRY_ORG` — the Sentry organization slug.
- `SENTRY_PROJECT` — the Sentry project slug.

**Reused, not new:**
- `CLAUDE_CODE_OAUTH_TOKEN` — the same secret `product-insights.yml` already uses to run
  `anthropics/claude-code-action@v1`.
