// Entry point for the weekly product-insights job (POSTHOG-9's GitHub
// Actions workflow invokes this directly via `npx tsx`). Queries PostHog,
// synthesizes a markdown report with Claude, and writes it to
// docs/product-insights/${REPORT_DATE}.md.

import { writeFileSync } from "node:fs";
import { queryWeeklyAggregates } from "./queryPosthog";
import { synthesizeReport } from "./buildReport";

async function main() {
  const projectKey = process.env.POSTHOG_PROJECT_KEY!;
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY!;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY!;
  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  const weekEnding = process.env.REPORT_DATE!; // injected by the workflow (no Date.now in-script needed)

  const agg = await queryWeeklyAggregates({ projectKey, personalApiKey, host });
  const md = await synthesizeReport(agg, { anthropicApiKey, weekEnding });
  writeFileSync(`docs/product-insights/${weekEnding}.md`, md);
  console.log(`Wrote docs/product-insights/${weekEnding}.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
