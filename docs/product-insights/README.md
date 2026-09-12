# Product Insights — weekly report

`.github/workflows/product-insights.yml` runs `scripts/product-insights/run.ts`
every Monday (and on manual `workflow_dispatch`), which queries PostHog for the
past week's aggregates and asks Claude to synthesize a markdown
recommendations report, committed to `docs/product-insights/<date>.md`.

## Required GitHub secrets

Set these in GitHub → Settings → Secrets and variables → Actions → Repository
secrets **before the first scheduled run** (Monday 13:00 UTC) or before
triggering the workflow manually:

- `POSTHOG_PROJECT_KEY`
- `POSTHOG_PERSONAL_API_KEY` — **distinct from the ingest key** (`VITE_POSTHOG_KEY`
  / `POSTHOG_API_KEY`). The HogQL query API used by this script requires a
  *personal* API key, not the public/project ingest key used for capturing
  events.
- `ANTHROPIC_API_KEY`

If any of these is missing, the workflow's "Generate report" step fails and no
report is committed — it does not silently no-op.
