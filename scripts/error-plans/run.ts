// Entry point for the weekly Sentry fix-plan job (SENTRY-6's GitHub Actions
// workflow invokes this directly via `npx tsx`). Queries Sentry for
// persisting (recurring, count>=5 over the last 14d) unresolved issues and
// writes them to docs/error-plans/aggregates.json as pretty JSON. This
// script is query-only — no LLM call happens here. The workflow's own
// `anthropics/claude-code-action@v1` step reads this file and writes the
// final markdown fix-plan (mirrors scripts/product-insights/run.ts's split
// for the identical reason: authenticating that step via a Claude Max
// subscription OAuth token instead of an Anthropic API key requires the
// synthesis step to live in the workflow YAML, not in this script).

import { writeFileSync } from "node:fs";
import { queryPersistingIssues } from "./querySentry";

async function main() {
  const report = await queryPersistingIssues({
    authToken: process.env.SENTRY_AUTH_TOKEN!,
    org: process.env.SENTRY_ORG!,
    project: process.env.SENTRY_PROJECT!,
    generatedFor: process.env.REPORT_DATE!,
  });
  writeFileSync("docs/error-plans/aggregates.json", JSON.stringify(report, null, 2));
  console.log(`Wrote docs/error-plans/aggregates.json (${report.issues.length} issues)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
