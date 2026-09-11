# PostHog Analytics Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the studio frontend with PostHog (currently uninstrumented), close the one backend gap (the 429 backpressure path emits no event), and add a weekly GitHub Actions job that turns PostHog aggregates into a committed product-recommendations report.

**Architecture:** Extend the **existing** PostHog integration — do not duplicate or replace it. The backend already has a `posthog-node` singleton, header-based session linking, SIGTERM flush, and 26 live events; it stays untouched except for one added capture. The frontend gets a new thin `lib/analytics.ts` wrapper (null-guard no-op mirroring the backend) that joins the **same** PostHog project, stitched per student by `user_id`. A standalone TS script + scheduled workflow produce the weekly report from PostHog's HogQL query API.

**Tech Stack:** `posthog-js` (new, frontend), `posthog-node` (existing, backend), React + Vite + wouter + TanStack Query (studio), Express 5 (api-server), GitHub Actions, Anthropic API (Claude) for synthesis, PostHog HogQL query API.

## Global Constraints

- **Extend, never replace:** reuse `artifacts/api-server/src/lib/posthog.ts`, env names `POSTHOG_API_KEY` / `POSTHOG_HOST`. No new backend client, no second backend config surface.
- **No existing event is renamed, removed, or re-propped.** All 26 live events stay byte-identical. New events are additive only.
- **Event convention (copy exactly):** event names are space-separated `"noun verbed"`; property keys are `snake_case`; `distinctId` is always the DB `user_id` (backend: `req.userId`; frontend: the identified user id).
- **Allowed event props (allowlist — nothing else ships on any event):** `scenario_id`, `model_id`, `job_id`, `queue_depth`, `entity`, `field`, `format`, `tab`, `rows`, `run_time_sec`, `cache_hit`, `objective`.
- **Forbidden — never captured:** email, name, any scenario `inputs` value (demand, capacity, distance, BOM ratio, lat/lng), city/state strings, free text, cookies/session tokens.
- **Fire-and-forget both sides:** PostHog unavailable/misconfigured must never break render, request, or solve. Frontend no-ops when `VITE_POSTHOG_KEY` is unset (same pattern as `VITE_API_BASE_URL`).
- **Never edit generated code** under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. This plan touches no OpenAPI, DB, or Drizzle.
- **Session replay OFF at launch:** posthog-js `disable_session_recording: true`.
- **Verification gate:** `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (Python untouched — no solver/pytest re-run).
- **One task = one commit.** Message format `[POSTHOG-N] <imperative summary>`.

---

### Task 1: Existing-PostHog inventory + identity-equality confirmation

Read-only audit that de-risks every later task. Produces a committed inventory doc and pins the single load-bearing assumption (frontend `user.id` === backend `req.userId`) before any `identify` call is written.

**Files:**
- Create: `docs/product-insights/POSTHOG-AUDIT.md`
- Read (no edit): `artifacts/api-server/src/lib/posthog.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/routes/scenarios.ts`, `artifacts/api-server/src/solver/jobRunner.ts`, `lib/api-spec/openapi.yaml` (the `User` schema), `artifacts/studio/src/App.tsx`

**Interfaces:**
- Produces: a confirmed answer to "what field on the `useGetCurrentAuthUser` response equals `req.userId`?" — used verbatim by Task 4's `identifyUser(...)` call.

- [ ] **Step 1: Inventory the 26 existing events**

Grep and record every existing capture's exact event name + prop keys:

```bash
grep -n "event:" artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/solver/jobRunner.ts
```

Write each `"event name"` and its `properties` keys into `POSTHOG-AUDIT.md` under a table. Confirm every prop key already falls inside the Global Constraints allowlist; flag any that don't (do NOT change them — record only).

- [ ] **Step 2: Confirm the identity field**

Inspect the `User` schema in `lib/api-spec/openapi.yaml` and the `data?.user` usage in `artifacts/studio/src/App.tsx:36`. Confirm the response object has an `id` field carrying the same DB `users.id` that the backend resolves to `req.userId` (see `middlewares/auth.ts`). Record the exact accessor (expected: `user.id`) in `POSTHOG-AUDIT.md`. If the field is absent or named differently, record the real name — Task 4 uses whatever this step confirms.

- [ ] **Step 3: Confirm backend invariants are already in place**

Record in the audit doc, with file:line: the null-guard no-op (`lib/posthog.ts:18`), header session linking (`app.ts:63`), error autocapture (`app.ts:83`), SIGTERM flush (`index.ts:39,44`), and the 429 site that currently has NO capture (`routes/scenarios.ts:292`). This confirms Tasks 2/4/7 don't re-add anything already present.

- [ ] **Step 4: Commit**

```bash
git add docs/product-insights/POSTHOG-AUDIT.md
git commit -m "[POSTHOG-1] inventory existing PostHog wiring + confirm identity field"
```

---

### Task 2: Backend — `scenario solve rejected` event on the 429 path

The only backend code change. Adds one capture at the backpressure site, matching the existing convention exactly.

**Files:**
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (the 429 block at ~line 292)
- Test: `artifacts/api-server/src/__tests__/routes.test.ts` (or the existing scenarios route test file — match where the other 429 tests live)

**Interfaces:**
- Consumes: existing `posthog` singleton (`import { posthog } from "../lib/posthog.js"`, already imported at `scenarios.ts:4`); existing `getQueueDepth`, `QUEUE_DEPTH_LIMIT`.
- Produces: event `"scenario solve rejected"`, props `{ scenario_id, model_id, queue_depth }`.

- [ ] **Step 1: Write the failing test**

Mock the `posthog` singleton and force the queue to the limit. Follow the existing 429 test's setup for stubbing `getQueueDepth`.

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
// ... existing imports and the existing 429 test's mocking of jobRunner ...

it("captures 'scenario solve rejected' when the queue is at capacity", async () => {
  // Arrange: getQueueDepth() mocked to return >= QUEUE_DEPTH_LIMIT (reuse the
  // existing 429 test's arrangement), posthog.capture spied.
  const captureSpy = vi.spyOn(posthog!, "capture");

  const res = await request(app)
    .post(`/api/scenarios/${scenarioId}/solve`)
    .set("Cookie", authCookie);

  expect(res.status).toBe(429);
  expect(captureSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      distinctId: expect.any(String),
      event: "scenario solve rejected",
      properties: expect.objectContaining({
        scenario_id: scenarioId,
        model_id: expect.any(String),
        queue_depth: expect.any(Number),
      }),
    }),
  );
});
```

Note: if `posthog` is `null` in the test env (no `POSTHOG_API_KEY`), instead assert on a spy injected via the existing test's posthog mock. Match whatever mocking style the file already uses for the other capture assertions — do not introduce a new mocking approach.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api-server test -- routes.test.ts -t "scenario solve rejected"`
Expected: FAIL — no such capture.

- [ ] **Step 3: Add the capture at the 429 block**

At `scenarios.ts:292`, before/after sending the 429 response (must run even though the request is rejected — it does not enqueue). The scenario row has not been loaded at this point (the queue check is fail-fast before DB work), so `model_id` must come from the already-loaded scenario if available, else omit it. Confirm ordering against the real handler: if the scenario lookup happens AFTER the queue check, capture only `{ scenario_id, queue_depth }` (still allowlisted). Use `req.params` for `scenario_id`:

```ts
if (getQueueDepth() >= QUEUE_DEPTH_LIMIT) {
  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario solve rejected",
    properties: {
      scenario_id: Number(req.params.id),
      queue_depth: getQueueDepth(),
    },
  });
  res.status(429)
    .set("Retry-After", String(SOLVE_RETRY_AFTER_SECONDS))
    .json({ error: "Solve queue is full. Retry shortly." });
  return;
}
```

(Keep the exact existing response body/message — do not change it. Only add the `posthog?.capture` call above it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api-server test -- routes.test.ts -t "scenario solve rejected"`
Expected: PASS.

- [ ] **Step 5: Run the full api-server suite (no-regression)**

Run: `pnpm --filter api-server test`
Expected: all green; existing capture tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[POSTHOG-2] capture 'scenario solve rejected' on the 429 backpressure path"
```

---

### Task 3: Frontend analytics wrapper + `posthog-js` dependency

The single seam the whole frontend uses. Null-guard no-op, prop-allowlist sanitization, mockable.

**Files:**
- Modify: `artifacts/studio/package.json` (add `posthog-js`)
- Create: `artifacts/studio/src/lib/analytics.ts`
- Test: `artifacts/studio/src/lib/analytics.test.ts`

**Interfaces:**
- Produces:
  - `initAnalytics(): void` — idempotent; no-op if `VITE_POSTHOG_KEY` unset or already initialized.
  - `track(event: string, props?: Record<string, unknown>): void` — no-op if uninitialized; strips any prop key outside the allowlist.
  - `identifyUser(id: string): void`
  - `resetUser(): void`
  - `ALLOWED_PROP_KEYS: ReadonlySet<string>` — exported for the guard test.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter studio add posthog-js
```

Expected: `posthog-js` appears in `artifacts/studio/package.json` dependencies; `pnpm-lock.yaml` updated. Commit the lockfile in this task's commit.

- [ ] **Step 2: Write the failing tests**

```ts
// artifacts/studio/src/lib/analytics.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const init = vi.fn();

vi.mock("posthog-js", () => ({
  default: { init, capture, identify, reset,
    __loaded: false },
}));

describe("analytics wrapper", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("no-ops track() when VITE_POSTHOG_KEY is unset", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("solve triggered", { scenario_id: 1, model_id: "p-median-us" });
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("initializes and captures when the key is set", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("solve triggered", { scenario_id: 1, model_id: "p-median-us" });
    expect(init).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith("solve triggered", {
      scenario_id: 1, model_id: "p-median-us",
    });
  });

  it("strips props outside the allowlist", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("override edited", {
      model_id: "p-median-us", field: "demand",
      email: "leak@example.com", city: "Atlanta", demand: 500,
    });
    expect(capture).toHaveBeenCalledWith("override edited", {
      model_id: "p-median-us", field: "demand",
    });
  });

  it("identify/reset forward the id", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.identifyUser("user-123");
    a.resetUser();
    expect(identify).toHaveBeenCalledWith("user-123");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("every allowlist key is snake_case", () => {
    // guards against camelCase drift
    return import("./analytics").then(a => {
      for (const k of a.ALLOWED_PROP_KEYS) {
        expect(k).toMatch(/^[a-z]+(_[a-z]+)*$/);
      }
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter studio test -- analytics.test.ts`
Expected: FAIL — `./analytics` not found.

- [ ] **Step 4: Implement the wrapper**

```ts
// artifacts/studio/src/lib/analytics.ts
import posthog from "posthog-js";

// Allowlist — mirrors the plan's Global Constraints. Any prop key not in this
// set is stripped before an event leaves the browser, so scenario values,
// emails, and free text can never be captured even if a caller passes them.
export const ALLOWED_PROP_KEYS: ReadonlySet<string> = new Set([
  "scenario_id", "model_id", "job_id", "queue_depth", "entity", "field",
  "format", "tab", "rows", "run_time_sec", "cache_hit", "objective",
]);

let initialized = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || initialized) return; // no-op mirrors the backend null-guard
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    autocapture: true,
    capture_pageview: false, // we fire $pageview manually on wouter nav
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
  });
  initialized = true;
}

function sanitize(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (ALLOWED_PROP_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    posthog.capture(event, sanitize(props));
  } catch {
    // fire-and-forget: analytics must never break the app
  }
}

export function identifyUser(id: string): void {
  if (!initialized) return;
  try { posthog.identify(id); } catch { /* no-op */ }
}

export function resetUser(): void {
  if (!initialized) return;
  try { posthog.reset(); } catch { /* no-op */ }
}
```

Note: in the "no-ops when unset" test, `initialized` stays false so `track` returns before touching the mock — that satisfies `capture not called`. The test mock's `capture` object shape doesn't need `__loaded`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter studio test -- analytics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/package.json pnpm-lock.yaml artifacts/studio/src/lib/analytics.ts artifacts/studio/src/lib/analytics.test.ts
git commit -m "[POSTHOG-3] add posthog-js + analytics wrapper with prop allowlist"
```

---

### Task 4: Init + identify/reset + `$pageview`

Wire the wrapper's lifecycle: initialize at boot, identify on auth, reset on logout, fire `$pageview` on client-side navigation.

**Files:**
- Modify: `artifacts/studio/src/main.tsx` (init after `setBaseUrl`)
- Modify: `artifacts/studio/src/App.tsx` (identify in `Gate` when `user` present; `$pageview` on location change)
- Modify: `artifacts/studio/src/components/AppShell.tsx` (reset in `handleLogout`, ~line 22)
- Test: `artifacts/studio/src/App.test.tsx` (extend existing — uses real wouter via `wouter/memory-location`)

**Interfaces:**
- Consumes: `initAnalytics`, `identifyUser`, `resetUser` from `lib/analytics`; `useLocation` from wouter; the identity accessor confirmed in Task 1 (expected `user.id`).

- [ ] **Step 1: Write the failing test**

```ts
// in App.test.tsx
import * as analytics from "@/lib/analytics";

it("identifies the user by id when authenticated", async () => {
  vi.spyOn(analytics, "identifyUser");
  // render Gate with useGetCurrentAuthUser mocked to return { user: { id: "u1", email: "a@b.c", role: "student" } }
  // ... existing App.test harness ...
  await waitFor(() => expect(analytics.identifyUser).toHaveBeenCalledWith("u1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- App.test.tsx -t "identifies the user"`
Expected: FAIL — `identifyUser` not called.

- [ ] **Step 3: Init at boot**

`main.tsx` — add after the `setBaseUrl` line:

```ts
import { setBaseUrl } from "@workspace/api-client-react";
import { initAnalytics } from "./lib/analytics";
// ...
setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
initAnalytics();
```

- [ ] **Step 4: Identify + pageview in `Gate`**

`App.tsx` — inside `Gate()`, after `const user = data?.user;`:

```ts
import { useEffect } from "react";
import { useLocation } from "wouter";
import { identifyUser, track } from "@/lib/analytics";
// ...
const [location] = useLocation();
useEffect(() => {
  if (user?.id) identifyUser(user.id);
}, [user?.id]);
useEffect(() => {
  track("$pageview");
}, [location]);
```

(Use the exact identity accessor confirmed in Task 1. `$pageview` is a special PostHog event and is intentionally NOT in the allowlist gate — it carries no custom props, so `sanitize({})` returns `{}`; that is correct.)

- [ ] **Step 5: Reset on logout**

`AppShell.tsx` — inside `handleLogout` (~line 22), after the logout mutation resolves and before/with the query-cache clear:

```ts
import { resetUser } from "@/lib/analytics";
// inside handleLogout, after logout success:
resetUser();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter studio test -- App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/main.tsx artifacts/studio/src/App.tsx artifacts/studio/src/components/AppShell.tsx artifacts/studio/src/App.test.tsx
git commit -m "[POSTHOG-4] init analytics, identify on auth, reset on logout, $pageview on nav"
```

---

### Task 5: Frontend funnel events (solve, stale-resolve, map-add, tab-view)

Wire the high-signal funnel events into their confirmed single chokepoints in `Workspace.tsx`.

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`handleSolve` ~1634; `handleAddedArrayChange` ~1305; tab activation handler passed to `TabBar`)
- Test: `artifacts/studio/src/pages/Workspace.<events>.test.tsx` (new file, or extend an existing Workspace test file — match the repo's Workspace test naming)

**Interfaces:**
- Consumes: `track` from `lib/analytics`; `modelId` prop; `currentScenario` (has `.id`, `.stale`); `handleAddedArrayChange(kind, fieldKey, current, next)` (kind ∈ `warehouses|refineries|customers|mines|stations`).
- Produces events: `"solve triggered"`, `"scenario stale resolved"`, `"map entity added"`, `"scenario tab viewed"`.

- [ ] **Step 1: Write the failing tests**

```tsx
import * as analytics from "@/lib/analytics";
// mock analytics.track; render Workspace with a solved scenario mock

it("tracks 'solve triggered' on solve", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... render + click Run Optimizer / confirm SolveDialog ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("solve triggered",
    expect.objectContaining({ scenario_id: expect.any(Number), model_id: "p-median-us" })));
});

it("also tracks 'scenario stale resolved' when the scenario was stale", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... render with currentScenario.stale === true, then solve ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("scenario stale resolved",
    expect.objectContaining({ model_id: "p-median-us" })));
});

it("tracks 'map entity added' when an added-entity array grows", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... trigger handleAddedArrayChange via adding a warehouse ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("map entity added",
    expect.objectContaining({ entity: "warehouses", model_id: "p-median-us" })));
});

it("tracks 'scenario tab viewed' on tab activation", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... activate a different tab ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("scenario tab viewed",
    expect.objectContaining({ tab: expect.any(String), model_id: "p-median-us" })));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter studio test -- Workspace`
Expected: FAIL — `track` not called with those events.

- [ ] **Step 3: Wire `handleSolve`**

In `handleSolve` (Workspace.tsx ~1634), at the top of the function (before the save-then-solve branch):

```ts
track("solve triggered", { scenario_id: currentScenario?.id, model_id: modelId });
if (currentScenario?.stale) {
  track("scenario stale resolved", { scenario_id: currentScenario.id, model_id: modelId });
}
```

- [ ] **Step 4: Wire `handleAddedArrayChange`**

In `handleAddedArrayChange(kind, fieldKey, current, next)` (~1305), only when the array GREW (an add, not an edit/delete):

```ts
if (next.length > current.length) {
  track("map entity added", { entity: kind, model_id: modelId, scenario_id: currentScenario?.id });
}
```

(`entity` receives `kind` — one of the allowlisted entity enum values. This one chokepoint covers warehouses/refineries/customers/mines/stations.)

- [ ] **Step 5: Wire tab activation**

Find the handler passed to `<TabBar onActivate={...}>` (Workspace.tsx renders the body by `activeTabId`). In that handler, after setting the active tab:

```ts
track("scenario tab viewed", { tab: tabId, model_id: modelId });
```

(If activation is a direct `setActiveTabId` with no wrapper, wrap it in a small `handleActivateTab(tabId)` that both sets state and tracks.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter studio test -- Workspace`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/pages/Workspace.*.test.tsx
git commit -m "[POSTHOG-5] track solve/stale-resolve/map-add/tab-view funnel events"
```

---

### Task 6: Frontend edit events (override edited, distance override set)

Lower-signal but in-scope granular edits, wired at the base-row override and distance-override update paths.

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (the handlers that update `warehouseOverrides`/`customerOverrides` and `distanceOverrides` in `localInputs`)
- Test: extend the Task 5 Workspace events test file

**Interfaces:**
- Consumes: `track`; the existing local-inputs override update handlers (identify them by grepping `warehouseOverrides`/`customerOverrides`/`distanceOverrides` setters inside `Workspace.tsx`).
- Produces events: `"override edited"` `{ scenario_id, model_id, entity, field }`, `"distance override set"` `{ scenario_id, model_id }`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("tracks 'override edited' when a base-row status/value changes", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... change a warehouse status or a customer demand in a base-row table ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("override edited",
    expect.objectContaining({ entity: "warehouses", field: expect.any(String), model_id: "p-median-us" })));
});

it("tracks 'distance override set' when a distance override is entered", async () => {
  const track = vi.spyOn(analytics, "track");
  // ... set a distance override in the Distances tab ...
  await waitFor(() => expect(track).toHaveBeenCalledWith("distance override set",
    expect.objectContaining({ model_id: "p-median-us" })));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter studio test -- Workspace`
Expected: FAIL.

- [ ] **Step 3: Wire the override-edit handler**

In the handler that writes `warehouseOverrides`/`customerOverrides` onto `localInputs` (grep `warehouseOverrides` setter in `Workspace.tsx`), emit at the point a single override field changes:

```ts
track("override edited", { scenario_id: currentScenario?.id, model_id: modelId, entity, field });
```

Where `entity` is the table's entity (`"warehouses"` or `"customers"`) and `field` is the column key being edited (`"status"`, `"capacity"`, `"demand"`) — never the value.

- [ ] **Step 4: Wire the distance-override handler**

In the handler that writes `distanceOverrides` (Distances/LegDistances tab save path):

```ts
track("distance override set", { scenario_id: currentScenario?.id, model_id: modelId });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter studio test -- Workspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/pages/Workspace.*.test.tsx
git commit -m "[POSTHOG-6] track override-edited and distance-override-set events"
```

---

### Task 7: Deploy config — `VITE_POSTHOG_KEY` on `nos-studio`

The only infra change. `nos-api` already has `POSTHOG_API_KEY`/`POSTHOG_HOST` — untouched.

**Files:**
- Modify: `render.yaml` (the `nos-studio` static-site service block)

**Interfaces:**
- Produces: build-time `VITE_POSTHOG_KEY` (+ optional `VITE_POSTHOG_HOST`) available to the studio Vite build on Render.

- [ ] **Step 1: Add the env vars to `nos-studio`**

Under the `nos-studio` service's `envVars:` in `render.yaml`:

```yaml
      # Frontend PostHog (public project key — safe to expose, it's an ingest
      # key, not the personal API key). Unset ⇒ analytics no-ops (see
      # studio/src/lib/analytics.ts). nos-api keeps its own POSTHOG_API_KEY.
      - key: VITE_POSTHOG_KEY
        sync: false
      - key: VITE_POSTHOG_HOST
        value: https://us.i.posthog.com
```

- [ ] **Step 2: Validate the Blueprint**

Run: `render blueprints validate` (or the repo's existing validation step). Expected: valid, no immutable-field errors.

- [ ] **Step 3: Confirm no `nos-api` change**

Run: `git diff render.yaml` — confirm the diff touches ONLY the `nos-studio` block; `nos-api`'s `POSTHOG_API_KEY`/`POSTHOG_HOST` lines are unchanged.

- [ ] **Step 4: Commit**

```bash
git add render.yaml
git commit -m "[POSTHOG-7] add VITE_POSTHOG_KEY to nos-studio static site"
```

---

### Task 8: Recommendations script — query PostHog + synthesize with Claude

Standalone TS: pull the week's aggregates via HogQL, hand aggregates (never raw PII) to Claude, emit a markdown report string. Pure logic, tested against a fixture.

**Files:**
- Create: `scripts/product-insights/queryPosthog.ts` (HogQL query calls)
- Create: `scripts/product-insights/buildReport.ts` (aggregate → Claude → markdown)
- Create: `scripts/product-insights/run.ts` (entry point: query → build → write file)
- Test: `scripts/product-insights/buildReport.test.ts`
- Create (fixture): `scripts/product-insights/__fixtures__/posthog-response.json`

**Interfaces:**
- Produces:
  - `queryWeeklyAggregates(opts: { projectKey: string; personalApiKey: string; host: string }): Promise<WeeklyAggregates>`
  - `type WeeklyAggregates = { funnelsByModel: Record<string, { created: number; solveTriggered: number; solveCompleted: number; exported: number }>; staleResolveRate: number; failuresByModel: Record<string, number>; rejectionsByModel: Record<string, number>; runtimeP50: number; runtimeP95: number; cacheHitRate: number }`
  - `synthesizeReport(agg: WeeklyAggregates, opts: { anthropicApiKey: string; weekEnding: string }): Promise<string>` — returns markdown.

- [ ] **Step 1: Write the failing test for `synthesizeReport` shape**

```ts
// scripts/product-insights/buildReport.test.ts
import { describe, it, expect, vi } from "vitest";
import fixture from "./__fixtures__/posthog-response.json";
import { toAggregates } from "./queryPosthog";
import { synthesizeReport } from "./buildReport";

describe("buildReport", () => {
  it("turns a fixture PostHog response into typed aggregates", () => {
    const agg = toAggregates(fixture);
    expect(agg.funnelsByModel["p-median-us"].created).toBeGreaterThan(0);
    expect(agg.cacheHitRate).toBeGreaterThanOrEqual(0);
  });

  it("produces markdown with a heading and never leaks a forbidden key", async () => {
    // mock the Anthropic SDK to echo a fixed markdown string
    vi.mock("@anthropic-ai/sdk", () => ({
      default: class { messages = { create: async () => ({ content: [{ type: "text", text: "# Product Insights\n- rec 1" }] }) }; },
    }));
    const agg = toAggregates(fixture);
    const md = await synthesizeReport(agg, { anthropicApiKey: "sk-test", weekEnding: "2026-09-11" });
    expect(md).toMatch(/^# /m);
    expect(md).not.toMatch(/@|email|demand|capacity/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/product-insights/buildReport.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the fixture**

`__fixtures__/posthog-response.json`: a minimal but realistic HogQL result set — rows of `{ event, properties.model_id, count }` for `scenario created`, `solve triggered`, `scenario solve completed`, `scenario data exported`, `scenario solve failed`, `scenario solve rejected`, plus runtime/cache-hit rows — enough for `toAggregates` to compute every field. Hand-author ~15 rows covering `p-median-us` and `transport-coal`.

- [ ] **Step 4: Implement `queryPosthog.ts`**

```ts
// scripts/product-insights/queryPosthog.ts
export type WeeklyAggregates = {
  funnelsByModel: Record<string, { created: number; solveTriggered: number; solveCompleted: number; exported: number }>;
  staleResolveRate: number;
  failuresByModel: Record<string, number>;
  rejectionsByModel: Record<string, number>;
  runtimeP50: number;
  runtimeP95: number;
  cacheHitRate: number;
};

// HogQL query strings, one per aggregate. Kept as constants so buildReport
// tests can run without the network (toAggregates parses a fixture).
export const FUNNEL_HOGQL = `/* per-model event counts, last 7 days */
SELECT event, properties.model_id AS model_id, count() AS c
FROM events
WHERE timestamp >= now() - INTERVAL 7 DAY
  AND event IN ('scenario created','solve triggered','scenario solve completed',
                'scenario data exported','scenario solve failed','scenario solve rejected')
GROUP BY event, model_id`;

export async function queryHogQL(query: string, opts: { projectKey: string; personalApiKey: string; host: string }): Promise<{ results: unknown[][]; columns: string[] }> {
  const res = await fetch(`${opts.host}/api/projects/@current/query/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.personalApiKey}` },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) throw new Error(`PostHog query failed: ${res.status}`);
  return res.json() as Promise<{ results: unknown[][]; columns: string[] }>;
}

// Pure — parses a raw HogQL response (or the test fixture) into typed aggregates.
export function toAggregates(raw: { results: unknown[][]; columns: string[] }): WeeklyAggregates {
  // Implement the reduction from rows → WeeklyAggregates. (Rows are
  // [event, model_id, count]; runtime/cache rows carry their own columns.)
  // ... concrete reduction over raw.results ...
}

export async function queryWeeklyAggregates(opts: { projectKey: string; personalApiKey: string; host: string }): Promise<WeeklyAggregates> {
  const funnel = await queryHogQL(FUNNEL_HOGQL, opts);
  // (query the runtime/cache HogQL similarly and merge)
  return toAggregates(funnel);
}
```

Implement `toAggregates`'s reduction fully against the fixture's row shape until Step 6 passes — no placeholder logic in the shipped file.

- [ ] **Step 5: Implement `buildReport.ts`**

```ts
// scripts/product-insights/buildReport.ts
import Anthropic from "@anthropic-ai/sdk";
import type { WeeklyAggregates } from "./queryPosthog";

export async function synthesizeReport(agg: WeeklyAggregates, opts: { anthropicApiKey: string; weekEnding: string }): Promise<string> {
  const client = new Anthropic({ apiKey: opts.anthropicApiKey });
  const prompt = [
    "You are a product analyst for an educational supply-chain optimization tool.",
    "Given these weekly usage aggregates (no PII), write a prioritized, concrete",
    "product-recommendations report in markdown. Focus on funnel drop-offs,",
    "solve failures/rejections, and stale-without-resolve behavior.",
    "",
    "```json",
    JSON.stringify(agg, null, 2),
    "```",
  ].join("\n");
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : "")).join("");
  return `# Product Insights — week ending ${opts.weekEnding}\n\n${text}\n`;
}
```

- [ ] **Step 6: Implement `run.ts` entry point**

```ts
// scripts/product-insights/run.ts
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
  // eslint-disable-next-line no-console
  console.log(`Wrote docs/product-insights/${weekEnding}.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Add `@anthropic-ai/sdk` where the script runs**

The script runs in CI, not in a shipped package. Add it as a root devDependency:

```bash
pnpm add -Dw @anthropic-ai/sdk
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run scripts/product-insights/buildReport.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add scripts/product-insights package.json pnpm-lock.yaml
git commit -m "[POSTHOG-8] weekly insights script: HogQL query + Claude synthesis"
```

---

### Task 9: GitHub Actions weekly workflow

Schedule the script, wire secrets, commit the report.

**Files:**
- Create: `.github/workflows/product-insights.yml`

**Interfaces:**
- Consumes: `scripts/product-insights/run.ts`; repo secrets `POSTHOG_PROJECT_KEY`, `POSTHOG_PERSONAL_API_KEY`, `ANTHROPIC_API_KEY`.

- [ ] **Step 1: Write the workflow**

```yaml
name: Product Insights
on:
  schedule:
    - cron: "0 13 * * 1" # Mondays 13:00 UTC
  workflow_dispatch: {}

permissions:
  contents: write # commit the report with the default GITHUB_TOKEN

jobs:
  insights:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Generate report
        env:
          POSTHOG_PROJECT_KEY: ${{ secrets.POSTHOG_PROJECT_KEY }}
          POSTHOG_PERSONAL_API_KEY: ${{ secrets.POSTHOG_PERSONAL_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          REPORT_DATE: ${{ github.event.repository.updated_at }} # replaced below
        run: |
          REPORT_DATE=$(date -u +%Y-%m-%d)
          echo "REPORT_DATE=$REPORT_DATE" >> "$GITHUB_ENV"
          mkdir -p docs/product-insights
          REPORT_DATE=$REPORT_DATE npx tsx scripts/product-insights/run.ts
      - name: Commit report
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/product-insights/*.md
          if git diff --staged --quiet; then
            echo "No new report to commit."
          else
            git commit -m "docs: weekly product insights ${{ env.REPORT_DATE }}"
            git push
          fi
```

(Confirm `tsx` is available — add `-Dw tsx` in Task 8's install if not already present. `date -u` runs in the shell, not the script, so the in-script `Date.now` restriction is irrelevant here.)

- [ ] **Step 2: Lint the workflow locally**

Run: `npx --yes @action-validator/cli .github/workflows/product-insights.yml` (or manual YAML check). Expected: valid.

- [ ] **Step 3: Document the required secrets**

Add a short note to `docs/product-insights/POSTHOG-AUDIT.md` (or a new `README.md` in that dir): the three repo secrets must be set in GitHub → Settings → Secrets before the first scheduled run; the personal API key is distinct from the ingest key.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/product-insights.yml docs/product-insights/
git commit -m "[POSTHOG-9] weekly product-insights GitHub Actions workflow"
```

---

### Task 10: QA — real-browser verification + no-regression sweep

Independent QA pass (qa-sdet). Verifies events actually fire, PII never leaves, and the existing backend telemetry is intact.

**Files:**
- Create: `artifacts/studio/e2e/posthog-analytics.spec.ts`

**Interfaces:**
- Consumes: the running local dev stack (api-server + studio via `API_PROXY_TARGET`, per CLAUDE.md's e2e run instructions).

- [ ] **Step 1: Write the Playwright spec**

Run the studio against local dev servers with `VITE_POSTHOG_KEY` set to a test key, intercept requests to the PostHog host, and assert:

```ts
import { test, expect } from "@playwright/test";

test("fires identify + $pageview + solve triggered, and never leaks PII", async ({ page }) => {
  const captured: any[] = [];
  await page.route("**/i.posthog.com/**", (route) => {
    const body = route.request().postData();
    if (body) captured.push(body);
    route.fulfill({ status: 200, body: "1" }); // stub ingest
  });
  // register/login a disposable account, open a chapter, run a solve
  // ... existing e2e auth+solve helpers ...
  // Assert an event batch contains "solve triggered"
  expect(captured.join("")).toContain("solve triggered");
  // Assert NO forbidden token ever appears in any captured payload
  const blob = captured.join("");
  for (const bad of ["@", "demand", "capacity", "password"]) {
    expect(blob.toLowerCase()).not.toContain(bad.toLowerCase());
  }
});
```

(Adjust the ingest URL glob to the configured host. Clean up the disposable account after — confirm the DELETE via server-log grep, per the repo's e2e convention.)

- [ ] **Step 2: Run the spec against local dev servers**

Per CLAUDE.md: start api-server (`DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`), then studio (`PORT=<p> BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 VITE_POSTHOG_KEY=phc_test pnpm --filter studio run dev`), then `E2E_BASE_URL=http://localhost:<p> npx playwright test posthog-analytics.spec.ts` from `artifacts/studio`.
Expected: PASS.

- [ ] **Step 3: No-regression sweep**

Run the full gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`. Confirm all existing api-server capture tests are green and no existing event name changed (grep the 12 backend event strings are still present verbatim).

- [ ] **Step 4: Commit**

```bash
git add artifacts/studio/e2e/posthog-analytics.spec.ts
git commit -m "[POSTHOG-10] e2e: verify analytics events fire and no PII leaks"
```

---

## Self-Review

**Spec coverage:**
- R1 extend-not-replace → Tasks 2/3/4/7 all reuse existing client/env; ✅
- R2 event taxonomy → Global Constraints + Task 5/6 use space-separated names, snake_case props; ✅
- R3 identity flow → Task 1 confirms field, Task 4 wires `identifyUser(user.id)`; ✅
- R4 privacy boundary → allowlist in Task 3 wrapper + `mask_all_text` config + Task 10 PII assertion; ✅
- R5 no-op reuse → Task 3 null-guard; ✅
- R6 audit-first → Task 1; ✅
- R7 no-regression acceptance → Task 2 Step 5, Task 7 Step 3, Task 10 Step 3; ✅
- Recs loop → Tasks 8/9; ✅
- render.yaml only `nos-studio` → Task 7; ✅

**Placeholder scan:** `toAggregates` reduction is described as "implement fully against the fixture" — the implementer has the fixture shape and the target type; this is a real (not placeholder) instruction because the exact row reduction depends on the hand-authored fixture written in the same task. Tab-activation and override-update handler exact line numbers are left to a grep in-task because `Workspace.tsx` is 2400+ lines and the anchors (`handleSolve` 1634, `handleAddedArrayChange` 1305) are pinned; the remaining two are named by the state they mutate.

**Type consistency:** `WeeklyAggregates` defined in `queryPosthog.ts`, consumed by `buildReport.ts` and `run.ts` — same import. `ALLOWED_PROP_KEYS` defined once, used by wrapper + test. Event names identical between plan catalog and Task 5/6 code.

## Execution Handoff

Per standing preference, this plan is executed via **agent-team dispatch** (frontend-engineer for Tasks 3–6, backend-engineer for Task 2, devops-engineer for Tasks 7 & 9, general/backend for Task 8, qa-sdet for Task 10; Task 1 is a shared audit done first). Two-lane concurrency: Task 2 (backend) ⊥ Task 3 (frontend) after Task 1; Tasks 5/6 depend on 3/4; Task 8 ⊥ frontend work; Task 9 depends on 8; Task 10 last.
