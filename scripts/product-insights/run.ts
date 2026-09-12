// Entry point for the weekly product-insights job (POSTHOG-9's GitHub
// Actions workflow invokes this directly via `npx tsx`). Queries PostHog for
// the past week's aggregates and writes them to
// docs/product-insights/aggregates.json as pretty JSON. This script is
// query-only — no LLM call happens here. The workflow's own
// `anthropics/claude-code-action@v1` step reads this file and writes the
// final markdown report (see .github/workflows/product-insights.yml);
// authenticating that step via a Claude Max subscription OAuth token instead
// of an Anthropic API key is the whole reason the synthesis step lives in
// the workflow YAML now, not in this script.

import { writeFileSync } from "node:fs";
import { queryWeeklyAggregates } from "./queryPosthog";

async function main() {
  const projectKey = process.env.POSTHOG_PROJECT_KEY!;
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY!;
  // The HogQL query API lives on the PostHog APP host (us.posthog.com), NOT
  // the ingest host (us.i.posthog.com) used for event capture. Defaulting to
  // the ingest host makes /api/projects/@current/query/ return 400.
  const host = process.env.POSTHOG_HOST ?? "https://us.posthog.com";
  const weekEnding = process.env.REPORT_DATE!; // injected by the workflow (no Date.now in-script needed)

  const aggregates = await queryWeeklyAggregates({ projectKey, personalApiKey, host });
  writeFileSync(
    "docs/product-insights/aggregates.json",
    JSON.stringify({ weekEnding, aggregates }, null, 2),
  );
  console.log("Wrote docs/product-insights/aggregates.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
