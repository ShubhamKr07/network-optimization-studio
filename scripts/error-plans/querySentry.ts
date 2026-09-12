// Standalone script (see run.ts) — not part of any shipped app package.
// Talks to Sentry's Issues API to pull persisting (recurring) unresolved
// issues for the weekly fix-plan report (SENTRY-5/6).
//
// `toIssuesSummary` is kept pure and dependency-free so it can be exercised
// against a fixture with zero network access (see querySentry.test.ts) —
// `queryPersistingIssues` is the only impure boundary in this file.
//
// Query-stage boundary (pinned, see the Sentry plan's Global Constraints):
// this file reads ONLY issue metadata (title, culprit, counts, first/last
// seen, permalink) — never raw event payloads, bodies, cookies, headers, or
// free text. `toIssuesSummary` enforces this by construction: it maps each
// raw issue into an object literal containing ONLY the allowlisted fields,
// so anything else present on the raw Sentry response (e.g. `metadata.value`
// with an interpolated stack argument, or per-event `tags`) is simply never
// read, let alone forwarded into the report.

export const MIN_EVENTS = 5;

export type IssueSummary = {
  id: string;
  title: string;
  culprit: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
};

export type IssuesReport = {
  generatedFor: string;
  issues: IssueSummary[];
};

export interface SentryOpts {
  authToken: string;
  org: string;
  project: string;
  statsPeriod?: string;
  generatedFor: string;
}

// Pure — keeps ONLY issue metadata (no event payloads ever), filters + ranks.
export function toIssuesSummary(raw: unknown[], generatedFor = ""): IssuesReport {
  const issues = (raw as any[])
    .map((i) => ({
      id: String(i.id),
      title: String(i.title ?? i.metadata?.type ?? "Unknown"),
      culprit: String(i.culprit ?? ""),
      count: Number(i.count ?? 0),
      userCount: Number(i.userCount ?? 0),
      firstSeen: String(i.firstSeen ?? ""),
      lastSeen: String(i.lastSeen ?? ""),
      permalink: String(i.permalink ?? ""),
    }))
    .filter((i) => i.count >= MIN_EVENTS)
    .sort((a, b) => b.count * b.userCount - a.count * a.userCount);
  return { generatedFor, issues };
}

export async function queryPersistingIssues(opts: SentryOpts): Promise<IssuesReport> {
  const period = opts.statsPeriod ?? "14d";
  const url =
    `https://sentry.io/api/0/projects/${opts.org}/${opts.project}/issues/` +
    `?query=is:unresolved&statsPeriod=${period}&sort=freq&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.authToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sentry query failed: ${res.status} ${body.slice(0, 500)}`);
  }
  return toIssuesSummary((await res.json()) as unknown[], opts.generatedFor);
}
