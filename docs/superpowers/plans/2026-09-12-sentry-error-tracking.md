# Sentry Error Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time error tracking (Sentry SaaS) to the studio frontend and api-server backend with aggressive PII scrubbing, plus a weekly GitHub Actions job that turns persisting Sentry issues into a reviewable, auto-superseding fix-plan PR.

**Architecture:** Two loosely-coupled halves. **Capture:** `@sentry/react` (frontend) + `@sentry/node` (backend), both no-op when their DSN env var is unset, both scrubbed via one shared-shape `scrubEvent`, errors-only (`tracesSampleRate: 0`). **Fix-plan loop:** clones the already-validated `product-insights.yml` machinery (query → `claude-code-action@v1` synthesis → PR with unique per-run branch + auto-supersede + always-write), pointed at the Sentry Issues API.

**Tech Stack:** `@sentry/react`, `@sentry/node` (v8+), React + Vite + wouter (studio), Express 5 (api-server), GitHub Actions, Sentry Issues API, `claude-code-action@v1` (subscription OAuth).

## Global Constraints

- **Fire-and-forget, no-op when unset:** Sentry down/misconfigured must never break render, request, or solve. Frontend no-ops when `VITE_SENTRY_DSN` unset; backend when `SENTRY_DSN` unset (same guard pattern as `lib/analytics.ts` / `lib/posthog.ts`).
- **Errors only:** `tracesSampleRate: 0`, `sendDefaultPii: false`. No perf tracing, no session replay, no solver instrumentation.
- **PII scrubbing (`scrubEvent`, both SDKs) — allowed:** exception (type/message/stack); tags `user_id`, `model_id`, `scenario_id`, `route`, `method`, `status_code`; default runtime/browser/OS metadata. **Forbidden — stripped, never sent:** request/response bodies, scenario `inputs`, query-string values, cookies, `Authorization`/session headers, email, user IP, free text, city/state.
- **Tag sources (pinned):** `user_id` = `user.id` (`useGetCurrentAuthUser`, frontend) / `req.userId` (backend) — the same value, never email. `model_id`/`scenario_id` from route/loaded-scenario context, never user-entered. `route`/`method`/`status_code` from the Express request, path only.
- **Query-stage boundary:** the fix-plan loop reads ONLY issue metadata (title, culprit, counts, first/last seen, permalink); never raw event payloads/bodies/cookies/headers/free text; the markdown carries only aggregated reasoning.
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). No OpenAPI/DB/Drizzle change.
- **Recurring threshold + window (pinned):** unresolved issues with `count >= 5` events over a `14d` lookback (`statsPeriod=14d`), ranked by `count × userCount`.
- **Verification gate:** `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (Python untouched).
- **One task = one commit.** Message format `[SENTRY-N] <imperative summary>`.

---

### Task 1: Repo-state confirmation

Read-only audit (Review 5) that pins the assumptions before code lands.

**Files:**
- Create: `docs/error-plans/SENTRY-AUDIT.md`
- Read: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/studio/src/main.tsx`, `artifacts/studio/src/App.tsx`, `lib/api-spec/openapi.yaml` (AuthUser)

- [ ] **Step 1: Confirm + record**

Record in `SENTRY-AUDIT.md`, each with file:line evidence:
- No Sentry present anywhere (`grep -rn "@sentry\|SENTRY_DSN\|VITE_SENTRY" artifacts lib render.yaml .github` → nothing in real source).
- `app.ts` catch-all 4-arg error middleware location (Sentry's handler must precede it).
- `index.ts` SIGTERM/SIGINT handlers (Sentry flush hooks here).
- Frontend has no error boundary (`grep -rn "ErrorBoundary\|componentDidCatch" artifacts/studio/src` → nothing).
- Identity fields: `AuthUser.id` (frontend `user.id`) ≡ `req.userId` (backend) — never email.

- [ ] **Step 2: Commit**

```bash
git add docs/error-plans/SENTRY-AUDIT.md
git commit -m "[SENTRY-1] confirm repo state before Sentry integration"
```

---

### Task 2: Backend Sentry — init, scrub, error handler, flush

**Files:**
- Modify: `artifacts/api-server/package.json` (add `@sentry/node`)
- Create: `artifacts/api-server/src/instrument.ts` (init — must load first)
- Create: `artifacts/api-server/src/lib/sentry.ts` (`scrubEvent`)
- Modify: `artifacts/api-server/src/index.ts` (first-line import + SIGTERM flush)
- Modify: `artifacts/api-server/src/app.ts` (error handler before the catch-all)
- Test: `artifacts/api-server/src/lib/sentry.test.ts`

**Interfaces:**
- Produces: `scrubEvent(event)` — returns the event with forbidden fields removed, or `null` to drop; `SENTRY_ENABLED` boolean.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter api-server add @sentry/node
```

- [ ] **Step 2: Write the failing `scrubEvent` test**

```ts
// artifacts/api-server/src/lib/sentry.test.ts
import { describe, it, expect } from "vitest";
import { scrubEvent } from "./sentry";

describe("scrubEvent", () => {
  it("strips request body, cookies, auth headers, query, email, ip", () => {
    const scrubbed = scrubEvent({
      request: {
        data: { inputs: { demand: 500 }, email: "a@b.c" },
        cookies: "nos_session=secret",
        headers: { authorization: "Bearer x", cookie: "nos_session=secret", "user-agent": "UA" },
        query_string: "scenario=1&token=abc",
        url: "https://api.example.com/scenarios/1/solve?token=abc&scenario=1",
        method: "POST",
      },
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      tags: { user_id: "u1", model_id: "p-median-us" },
      exception: { values: [{ type: "Error", value: "boom" }] },
    } as any);
    expect(scrubbed).toBeTruthy();
    expect(scrubbed!.request?.data).toBeUndefined();
    expect(scrubbed!.request?.cookies).toBeUndefined();
    expect(scrubbed!.request?.query_string).toBeUndefined();
    expect(scrubbed!.request?.url).toBe("/scenarios/1/solve"); // path-only, query stripped (Review 5)
    expect(scrubbed!.request?.headers).toEqual({ "user-agent": "UA" }); // auth/cookie removed
    expect(scrubbed!.user).toEqual({ id: "u1" }); // email + ip removed
    expect(scrubbed!.tags).toEqual({ user_id: "u1", model_id: "p-median-us" });
    expect(scrubbed!.exception).toBeTruthy(); // error preserved
  });
});
```

- [ ] **Step 3: Run test — verify fail**

Run: `pnpm --filter api-server test -- sentry.test.ts`
Expected: FAIL — `./sentry` not found.

- [ ] **Step 4: Implement `lib/sentry.ts`**

> Review note: sanitize the request URL itself, not just `request.query_string`, because raw Sentry request objects often still include a URL with query params. The production contract should be path-only (`/api/...`), never full URLs with student input embedded.

```ts
// artifacts/api-server/src/lib/sentry.ts
import type { ErrorEvent } from "@sentry/node";

const ALLOWED_HEADERS = new Set(["user-agent", "accept", "content-type", "referer"]);

// Shared PII scrub applied via beforeSend. Removes bodies, cookies, auth
// headers, query values, email, and IP; keeps the error + allowlisted tags.
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        event.request.url = `${url.pathname}${url.hash ? url.hash : ""}`;
      } catch {
        event.request.url = event.request.url.split("?")[0];
      }
    }
    if (event.request.headers) {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (ALLOWED_HEADERS.has(k.toLowerCase())) kept[k] = v as string;
      }
      event.request.headers = kept;
    }
  }
  if (event.user) {
    const id = event.user.id;
    event.user = id ? { id } : {};
  }
  return event;
}

export const SENTRY_ENABLED = Boolean(process.env.SENTRY_DSN);
```

- [ ] **Step 5: Implement `instrument.ts` (loads first)**

```ts
// artifacts/api-server/src/instrument.ts
// MUST be imported before any other module so Sentry can instrument them.
import * as Sentry from "@sentry/node";
import { scrubEvent } from "./lib/sentry";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}
```

- [ ] **Step 6: Wire `index.ts` — first-line import + flush**

Make `import "./instrument";` the VERY FIRST line (before `import app`). Add Sentry flush to both signal handlers:

```ts
import "./instrument"; // MUST be first — instruments modules imported below
import * as Sentry from "@sentry/node";
import app from "./app";
// ... existing imports ...

// in BOTH the SIGTERM and SIGINT handlers, before process.exit:
await posthog?.shutdown();
await Sentry.close(2000);
process.exit(0);
```

- [ ] **Step 7: Wire `app.ts` — error handler before the catch-all**

Add after the routes / PostHog error handler and BEFORE the 4-arg `{error:...}` middleware:

```ts
import * as Sentry from "@sentry/node";
// ... after app.use("/api", router); and after any posthog error handler,
// immediately before the existing 4-arg catch-all middleware:
Sentry.setupExpressErrorHandler(app);
// (existing) app.use((err, _req, res, next) => { ... res.status(500).json({error:...}) });
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter api-server test -- sentry.test.ts` (PASS), then `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test` (no-regression) and `pnpm run typecheck`.
Expected: green; the catch-all JSON handler still returns `{error:...}`.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/instrument.ts artifacts/api-server/src/lib/sentry.ts artifacts/api-server/src/lib/sentry.test.ts artifacts/api-server/src/index.ts artifacts/api-server/src/app.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "[SENTRY-2] backend Sentry init, scrub, express error handler, SIGTERM flush"
```

---

### Task 3: Frontend Sentry — wrapper, scrub, ErrorBoundary, init, user

**Files:**
- Modify: `artifacts/studio/package.json` (add `@sentry/react`)
- Create: `artifacts/studio/src/lib/errorTracking.ts`
- Modify: `artifacts/studio/src/main.tsx` (init + ErrorBoundary wrap)
- Modify: `artifacts/studio/src/App.tsx` (`setErrorUser`/`clearErrorUser`)
- Modify: `artifacts/studio/src/components/AppShell.tsx` (`clearErrorUser` on logout)
- Test: `artifacts/studio/src/lib/errorTracking.test.ts`

**Interfaces:**
- Produces: `initErrorTracking()`, `setErrorUser(id: string)`, `clearErrorUser()`, `scrubEvent(event)`, `SentryErrorBoundary` (re-export of `Sentry.ErrorBoundary`). No-op when `VITE_SENTRY_DSN` unset.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter studio add @sentry/react
```

- [ ] **Step 2: Write the failing tests**

```ts
// artifacts/studio/src/lib/errorTracking.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const init = vi.fn();
const setUser = vi.fn();
vi.mock("@sentry/react", () => ({ init, setUser, ErrorBoundary: () => null }));

describe("errorTracking", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("no-ops init when VITE_SENTRY_DSN unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const m = await import("./errorTracking");
    m.initErrorTracking();
    expect(init).not.toHaveBeenCalled();
  });

  it("inits + sets user when DSN set", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://x@o.ingest.sentry.io/1");
    const m = await import("./errorTracking");
    m.initErrorTracking();
    m.setErrorUser("u1");
    expect(init).toHaveBeenCalledOnce();
    expect(setUser).toHaveBeenCalledWith({ id: "u1" }); // id only, never email
  });

  it("scrubEvent strips body/email/cookies and reduces url to path-only", async () => {
    const m = await import("./errorTracking");
    const out = m.scrubEvent({
      request: {
        data: { inputs: { demand: 5 } },
        cookies: "x",
        headers: { authorization: "b", "user-agent": "UA" },
        url: "https://nos-studio.onrender.com/chapter-3?scenario=1&token=abc",
      },
      user: { id: "u1", email: "a@b.c" },
    } as any);
    expect(out!.request?.data).toBeUndefined();
    expect(out!.request?.cookies).toBeUndefined();
    expect(out!.request?.headers).toEqual({ "user-agent": "UA" });
    expect(out!.request?.url).toBe("/chapter-3"); // path-only, query stripped (Review 5)
    expect(out!.user).toEqual({ id: "u1" });
  });
});
```

- [ ] **Step 3: Run — verify fail**

Run: `pnpm --filter studio test -- errorTracking.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/errorTracking.ts`**

> Review note: sanitize the request URL on the browser side too, and keep the path-only rule consistent with the backend. The browser request object may still carry a full URL with query params or embedded identifiers.

```ts
// artifacts/studio/src/lib/errorTracking.ts
import * as Sentry from "@sentry/react";
import type { ErrorEvent } from "@sentry/react";

const ALLOWED_HEADERS = new Set(["user-agent", "accept", "content-type", "referer"]);

export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        event.request.url = `${url.pathname}${url.hash ? url.hash : ""}`;
      } catch {
        event.request.url = event.request.url.split("?")[0];
      }
    }
    if (event.request.headers) {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (ALLOWED_HEADERS.has(k.toLowerCase())) kept[k] = v as string;
      }
      event.request.headers = kept;
    }
  }
  if (event.user) {
    const id = event.user.id;
    event.user = id ? { id } : {};
  }
  return event;
}

let initialized = false;

export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  initialized = true;
}

export function setErrorUser(id: string): void {
  if (!initialized) return;
  Sentry.setUser({ id });
}

export function clearErrorUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
```

- [ ] **Step 5: Wire `main.tsx` — init + ErrorBoundary**

```tsx
import { initErrorTracking, SentryErrorBoundary } from "./lib/errorTracking";
// ...
setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
initAnalytics();
initErrorTracking();

createRoot(document.getElementById("root")!).render(
  <SentryErrorBoundary fallback={<div className="p-8 text-center">Something went wrong. Please reload.</div>}>
    <App />
  </SentryErrorBoundary>,
);
```

- [ ] **Step 6: Wire user identity**

In `App.tsx`'s `Gate()`, alongside the existing `identifyUser(user.id)` effect:

```ts
import { setErrorUser } from "@/lib/errorTracking";
// in the same useEffect keyed on user?.id:
if (user?.id) { identifyUser(user.id); setErrorUser(user.id); }
```

In `AppShell.tsx`'s `handleLogout`, next to the existing `resetUser()`:

```ts
import { clearErrorUser } from "@/lib/errorTracking";
// after logout success, beside resetUser():
clearErrorUser();
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter studio test -- errorTracking.test.ts` (PASS), `pnpm --filter studio test` (no-regression), `pnpm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/package.json pnpm-lock.yaml artifacts/studio/src/lib/errorTracking.ts artifacts/studio/src/lib/errorTracking.test.ts artifacts/studio/src/main.tsx artifacts/studio/src/App.tsx artifacts/studio/src/components/AppShell.tsx
git commit -m "[SENTRY-3] frontend Sentry wrapper, ErrorBoundary, scrub, user identity"
```

---

### Task 4: Deploy config — DSN env vars

**Files:**
- Modify: `render.yaml`

- [ ] **Step 1: Add env vars**

Under `nos-api` `envVars:`:
```yaml
      - key: SENTRY_DSN
        sync: false
```
Under `nos-studio` `envVars:`:
```yaml
      # Public DSN — safe to expose in the browser bundle (like the PostHog phc_ key).
      - key: VITE_SENTRY_DSN
        sync: false
```

- [ ] **Step 2: Validate + confirm scope**

Run `render blueprints validate` (or manual check). `git diff render.yaml` touches only the two service `envVars` blocks. (Sourcemap upload is a deferred optional per the spec — NOT added here.)

- [ ] **Step 3: Commit**

```bash
git add render.yaml
git commit -m "[SENTRY-4] add SENTRY_DSN (nos-api) + VITE_SENTRY_DSN (nos-studio)"
```

---

### Task 5: Fix-plan query script

**Files:**
- Create: `scripts/error-plans/querySentry.ts`, `scripts/error-plans/run.ts`, `scripts/error-plans/__fixtures__/issues-response.json`
- Test: `scripts/error-plans/querySentry.test.ts`

**Interfaces:**
- Produces:
  - `type IssueSummary = { id: string; title: string; culprit: string; count: number; userCount: number; firstSeen: string; lastSeen: string; permalink: string }`
  - `type IssuesReport = { generatedFor: string; issues: IssueSummary[] }`
  - `toIssuesSummary(raw: unknown[]): IssuesReport` — pure; filters `count >= MIN_EVENTS` (5), sorts by `count × userCount` desc, keeps ONLY the allowlisted fields.
  - `queryPersistingIssues(opts): Promise<IssuesReport>`

- [ ] **Step 1: Failing test**

```ts
// scripts/error-plans/querySentry.test.ts
import { describe, it, expect } from "vitest";
import fixture from "./__fixtures__/issues-response.json";
import { toIssuesSummary } from "./querySentry";

describe("toIssuesSummary", () => {
  it("keeps only recurring (count>=5) issues, only allowlisted fields, ranked", () => {
    const r = toIssuesSummary(fixture as unknown[]);
    expect(r.issues.every(i => i.count >= 5)).toBe(true);
    // ranked by count*userCount desc
    expect(r.issues[0].count * r.issues[0].userCount)
      .toBeGreaterThanOrEqual(r.issues[1].count * r.issues[1].userCount);
    // never leaks a raw payload / body / email
    expect(JSON.stringify(r)).not.toMatch(/@|password|inputs|cookie/i);
    // exact field set
    expect(Object.keys(r.issues[0]).sort()).toEqual(
      ["count","culprit","firstSeen","id","lastSeen","permalink","title","userCount"]);
  });
});
```

- [ ] **Step 2: Run — verify fail** (`npx vitest run scripts/error-plans/querySentry.test.ts` via `pnpm --filter @workspace/scripts exec vitest run ...`).

- [ ] **Step 3: Fixture** — hand-author ~6 Sentry Issues API objects (fields `id`,`title`,`culprit`,`count`,`userCount`,`firstSeen`,`lastSeen`,`permalink`, some with `count<5` to be filtered), all metadata only (no event payloads).

- [ ] **Step 4: Implement `querySentry.ts`**

```ts
// scripts/error-plans/querySentry.ts
export const MIN_EVENTS = 5;
export type IssueSummary = { id: string; title: string; culprit: string; count: number; userCount: number; firstSeen: string; lastSeen: string; permalink: string };
export type IssuesReport = { generatedFor: string; issues: IssueSummary[] };

export interface SentryOpts { authToken: string; org: string; project: string; statsPeriod?: string; generatedFor: string }

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
  const url = `https://sentry.io/api/0/projects/${opts.org}/${opts.project}/issues/`
    + `?query=is:unresolved&statsPeriod=${period}&sort=freq&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.authToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sentry query failed: ${res.status} ${body.slice(0, 500)}`);
  }
  return toIssuesSummary(await res.json() as unknown[], opts.generatedFor);
}
```

- [ ] **Step 5: Implement `run.ts`**

```ts
// scripts/error-plans/run.ts
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
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: `.gitignore`** — add `docs/error-plans/aggregates.json` (transient build artifact).

- [ ] **Step 7: Run tests + typecheck.** Commit:

```bash
git add scripts/error-plans .gitignore
git commit -m "[SENTRY-5] Sentry issues query script (recurring-issue filter, metadata only)"
```

---

### Task 6: Fix-plan workflow

> Review note: the workflow must explicitly define the empty-issue path. If there are no persisted issues, the job still writes the markdown report, still creates the branch and PR, and still closes older error-plan PRs. It should not silently skip the branch or fail the workflow.

> Review note: the implementation should be strict about the metadata-only boundary for the query stage. The Sentry Issues API may be queried only for issue metadata; raw event payloads, request bodies, cookies, headers, or any unredacted event data may never be included in the generated markdown or stored in the repo.

Clone `.github/workflows/product-insights.yml` verbatim, swap the query + prompt + paths. Reuse its proven shape (unique per-run branch `error-plans/<date>-<run#>`, atomic claude-code-action write+PR, auto-supersede, always-write).

**Empty-issue path (first-class — Review 3a):** a zero-issue run is NOT a no-op. It is guaranteed by three unconditional mechanisms, none of which branch on issue count: (a) the prompt's ALWAYS-write rule (writes a "No actionable issues this week" report), (b) the branch/`git add`/commit/push/`gh pr create` commands run unconditionally after the write, (c) the Supersede step runs unconditionally and closes older `error-plans/*` PRs. Task 7 validates this with a dispatch run against a project that returns zero qualifying issues → assert a PR is still opened with the no-issues note. The job must never silently skip the branch or fail on an empty query.

**Metadata-only boundary (Review 3b):** the query stage (`scripts/error-plans/`) only ever hits the Issues API and keeps the allowlisted `IssueSummary` fields (enforced by `toIssuesSummary` + its test). No step fetches per-event detail, request bodies, cookies, headers, or unredacted payloads; none reach the markdown or the repo. If a future change adds an event-detail fetch, it must re-scrub — but this plan adds none.

**Files:**
- Create: `.github/workflows/error-plans.yml`
- Create/append: `docs/error-plans/README.md` (required secrets)

**Interfaces:**
- Consumes: `scripts/error-plans/run.ts`; secrets `SENTRY_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`; repo vars `SENTRY_ORG`, `SENTRY_PROJECT`.

- [ ] **Step 1: Write the workflow** (identical structure to `product-insights.yml`, adapted):

```yaml
name: Error Plans
on:
  schedule:
    - cron: "0 14 * * 1"   # Mondays 14:00 UTC (offset from product-insights' 13:00)
  workflow_dispatch: {}
permissions:
  contents: write
  id-token: write
  pull-requests: write
jobs:
  error-plans:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 1 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Query Sentry issues
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}
        run: |
          REPORT_DATE=$(date -u +%Y-%m-%d)
          echo "REPORT_DATE=$REPORT_DATE" >> "$GITHUB_ENV"
          mkdir -p docs/error-plans
          REPORT_DATE=$REPORT_DATE npx tsx scripts/error-plans/run.ts
      - name: Synthesize fix plan and open PR
        uses: anthropics/claude-code-action@v1
        env:
          GH_TOKEN: ${{ github.token }}
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: '--max-turns 25 --allowedTools "Read,Write,Edit,Bash"'
          prompt: |
            Read docs/error-plans/aggregates.json (persisting Sentry issues —
            metadata only, no PII).

            Step 1 — Write a prioritized fix plan in markdown to
            docs/error-plans/${{ env.REPORT_DATE }}.md. For each issue: title,
            frequency (count × users affected), a root-cause hypothesis, a
            concrete suggested fix, and the affected model/route if inferable
            from the culprit. Base everything ONLY on the provided metadata;
            never invent data. ALWAYS write the file — if there are no issues,
            write a report that plainly states "No actionable issues this week".

            Step 2 — Open a pull request. Run with the Bash tool, in order:
              git config user.name "github-actions[bot]"
              git config user.email "github-actions[bot]@users.noreply.github.com"
              git checkout -b error-plans/${{ env.REPORT_DATE }}-${{ github.run_number }}
              git add docs/error-plans/${{ env.REPORT_DATE }}.md
              git commit -m "docs: weekly error fix plan ${{ env.REPORT_DATE }}"
              git push -u origin error-plans/${{ env.REPORT_DATE }}-${{ github.run_number }}
              gh pr create --base main --head error-plans/${{ env.REPORT_DATE }}-${{ github.run_number }} --title "Weekly error fix plan ${{ env.REPORT_DATE }}" --body "Automated Sentry persisting-issues fix plan (issue metadata only, no PII). Review before acting."
            Report the PR URL when done.
      - name: Supersede older error-plan PRs
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          OLD=$(gh pr list --state open --json number,headRefName,createdAt \
            --jq '[.[] | select(.headRefName | startswith("error-plans/"))]
                  | sort_by(.createdAt) | reverse | .[1:] | .[].number')
          for n in $OLD; do
            gh pr close "$n" --comment "Superseded by a newer weekly error fix plan." --delete-branch
          done
```

- [ ] **Step 2: Validate YAML** (`action-validator`).

- [ ] **Step 3: README secrets note** — `docs/error-plans/README.md`: needs `SENTRY_AUTH_TOKEN` (org/project read scope) secret + `SENTRY_ORG`/`SENTRY_PROJECT` repo variables + reuses `CLAUDE_CODE_OAUTH_TOKEN`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/error-plans.yml docs/error-plans/README.md
git commit -m "[SENTRY-6] weekly Sentry fix-plan workflow (PR + auto-supersede)"
```

---

### Task 7: QA — real-browser capture + no-regression

**Files:**
- Create: `artifacts/studio/e2e/sentry-capture.spec.ts`

- [ ] **Step 1: Playwright spec** — run studio with `VITE_SENTRY_DSN` set to a test DSN, intercept `**/*.ingest.sentry.io/**` (and `**/*.sentry.io/**`), stub 200, capture payloads. Force a client error (a route/test hook that throws) and assert:
  - the `<ErrorBoundary>` fallback renders;
  - a Sentry envelope was sent;
  - NO forbidden token in any captured payload — `@`, `password`, `demand`, `capacity`, a real city string, `nos_session`.

- [ ] **Step 2: Run against local dev servers** (per CLAUDE.md recipe, with `VITE_SENTRY_DSN=https://test@o0.ingest.sentry.io/0`). Clean up any disposable account.

- [ ] **Step 3: No-regression sweep** — `pnpm run typecheck`; `DATABASE_URL=... pnpm --filter api-server test`; `pnpm --filter studio test`. Confirm the catch-all JSON error middleware still returns `{error:...}` (Sentry handler runs before, doesn't replace). Known env flake (`cors`/`resultEnvelope-brazil` under load) → re-run isolated to confirm environmental.

- [ ] **Step 4: Empty-issue workflow validation** (post-secrets; deferred until `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are set — mirrors the PostHog live-validation we did). `gh workflow run error-plans.yml`; watch to green; confirm a `error-plans/<date>-<run#>` PR **is opened even with zero qualifying issues**, its report body states "No actionable issues this week", and a second dispatch supersedes (closes) the first. If secrets aren't set yet at build time, record this as an explicit post-deploy checklist item rather than skipping silently.

- [ ] **Step 5: Commit**

```bash
git add artifacts/studio/e2e/sentry-capture.spec.ts
git commit -m "[SENTRY-7] e2e: ErrorBoundary + Sentry capture, no PII in payloads"
```

---

## Self-Review

> Review note: add a short explicit assertion in the test suite that `request.url` is path-only and stripped of query parameters, not just `request.query_string`. This is the key privacy edge case that should be covered by both backend and frontend tests.


**Spec coverage:** Capture frontend (T3) + backend (T2); scrub both (T2/T3 `scrubEvent` + tests); tag sources pinned (Global Constraints + T2/T3); fix-plan loop (T5 query + T6 workflow); zero-issue PR (T6 prompt); query-stage PII boundary (T5 metadata-only + test asserting no leak); DSN config (T4); sourcemap deferred (not built — matches spec); repo-state Task 1 (T1, Review 5); QA (T7). ✅

**Placeholder scan:** fixture author + Playwright spec bodies are described with exact assertions, not stubbed. No "TBD".

**Type consistency:** `scrubEvent(event)→event|null` identical shape both SDKs; `IssueSummary`/`IssuesReport` defined in `querySentry.ts`, consumed by `run.ts` + test; `toIssuesSummary` filter `MIN_EVENTS=5` matches the Global Constraints threshold.

## Execution Handoff

Agent-team dispatch: backend-engineer (T2), frontend-engineer (T3), devops-engineer (T4, T6), backend/general (T5), qa-sdet (T7); T1 shared audit first. Two-lane concurrency (api-server ⊥ studio); T2 ⊥ T3 after T1; T5 ⊥ frontend; T6 after T5; T7 last. Serialize lockfile-touching installs (T2, T3, T5) as in the PostHog run.
