# PostHog Analytics Integration — Design Spec

**Date:** 2026-09-11
**Status:** Revised after Review 1 (repo-alignment). Pending re-review → implementation plan.
**Topic:** Extend the **existing** PostHog integration to the studio frontend, close one backend gap (429), and add a weekly LLM-generated product-recommendations report.

## Correction from the first draft

The first draft of this spec assumed a greenfield integration. That was wrong. An audit of the repo (Review 1) found the **backend is already fully instrumented**. This spec is rewritten to **extend** the existing integration, not duplicate or replace it. See "Existing State (audited)" below — it is the ground truth this design builds on.

## Goal

See how students actually use the tool — where they succeed, stall, or abandon — and turn that into product recommendations. Two outcomes:

1. **Metrics** — the frontend (currently uninstrumented) starts emitting curated product-usage events to the **same** PostHog project the backend already uses, stitched per student by `user_id`.
2. **Recommendations** — a weekly GitHub Actions job reads the week's PostHog aggregates, has Claude synthesize prioritized recommendations, and commits them to the repo.

Non-goals: no A/B experiments now (feature flags free later, out of scope); no session replay at launch; no schema/API-contract change; **no rename or removal of any existing event**; no change to the existing backend PostHog client, its env names, or its config.

## Existing State (audited 2026-09-11)

| Area | Current state | File |
|---|---|---|
| Backend client | `posthog-node` singleton, null when key unset (no-op), `enableExceptionAutocapture: true` | `artifacts/api-server/src/lib/posthog.ts` |
| Env names | `POSTHOG_API_KEY`, `POSTHOG_HOST` (default `https://us.i.posthog.com`) | `lib/posthog.ts` |
| Session/identity linking | `setupExpressRequestContext` reads `X-POSTHOG-DISTINCT-ID` / `X-POSTHOG-SESSION-ID`; `setupExpressErrorHandler` for exceptions | `artifacts/api-server/src/app.ts:63,83` |
| Shutdown flush | `posthog?.shutdown()` already wired into SIGTERM | `artifacts/api-server/src/index.ts:39,44` |
| Deploy env | `POSTHOG_API_KEY` (sync:false) + `POSTHOG_HOST` already on `nos-api` | `render.yaml:22-27` |
| Existing events (26 captures) | `user registered/logged in/logged out`; `scenario created/updated/deleted/solve enqueued/solve completed/solve failed/data exported/data imported/cloned` | `auth.ts`, `scenarios.ts`, `jobRunner.ts` |
| Event convention | Event names = space-separated `"noun verbed"`; **property keys = `snake_case`** (`scenario_id`, `model_id`, `job_id`); `distinctId: req.userId` | all captures |
| Frontend | **No PostHog at all** | `artifacts/studio` |

**The only real gaps:** (1) frontend is uninstrumented; (2) the `429` backpressure path (`scenarios.ts:292`) emits no event; (3) no recommendations loop.

## Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Client | **Extend existing** | Reuse `lib/posthog.ts`, `POSTHOG_API_KEY`/`POSTHOG_HOST`. No new backend client, no second config surface. |
| Hosting | PostHog Cloud (US) | Already the configured host (`us.i.posthog.com`). |
| Identification | `distinctId = user_id`, never email | Backend already does this; frontend matches. |
| Event convention | **Adopt existing** — space-separated names, `snake_case` props | Consistency with the 26 live events; new events additive. |
| Existing events | **Unchanged** — no rename, no migration, no alias window | Renaming orphans history and breaks live dashboards. |
| Rec delivery | PostHog dashboards + weekly GitHub Actions LLM cron → markdown in repo | Dashboards free/interactive; cron for recurring synthesized recs, versioned. |
| Session replay | Off at launch | Education data needs a privacy review first. |

## Architecture

```
[studio React]  --posthog-js-->  PostHog Cloud (existing project)  <--posthog-node (existing)--  [api-server]
   NEW                                     ^                                                       (unchanged + 429 event)
                                           | HogQL query API (weekly, personal key)
                                [GitHub Actions cron] --Claude (Anthropic API)--> commit docs/product-insights/YYYY-MM-DD.md
```

- Frontend joins the **same** project. `distinctId` must be the **same `user_id` string** the backend already uses, so Web + API events land in one person profile.
- Fire-and-forget both sides. Frontend mirrors the backend's existing null-guard no-op pattern — PostHog unavailable never breaks render, request, or solve.
- Weekly job reads PostHog, not the app DB — decoupled from runtime and deploys.

### Isolation boundaries

- **`studio/src/lib/analytics.ts`** (NEW) — thin wrapper: `initAnalytics()`, `track(event, props)`, `identifyUser(id)`, `resetUser()`. Components never touch the `posthog` global directly. No-op when `VITE_POSTHOG_KEY` unset (mirrors backend's null-guard). Mockable in RTL.
- **Backend** — no new module. Add exactly one `posthog?.capture(...)` at the 429 site using the existing singleton, matching the existing event/prop convention.
- **`scripts/product-insights/`** (NEW) — standalone TS: query PostHog → synthesize with Claude → emit markdown. The GitHub workflow only invokes it.

## Identity / DistinctId Flow (Review 3)

1. Backend: every capture already uses `distinctId: req.userId` (auth-derived, no PII). **Unchanged.**
2. Frontend: on auth success (`useGetCurrentAuthUser` data present), call `identifyUser(user.id)`. `resetUser()` on logout.
3. **Field-equality invariant (to verify in the audit task):** the `user.id` returned by `useGetCurrentAuthUser` is the same DB `users.id` that `req.userId` resolves to. If the API returns a different key name/shape, the frontend must identify with whatever field equals `req.userId`. This equality is the single load-bearing assumption for profile stitching — the plan's Task 1 confirms it against the real auth response before any `identify` call is written.
4. posthog-js, once initialized, auto-sends `X-POSTHOG-DISTINCT-ID` / `X-POSTHOG-SESSION-ID` on same-origin/allowed requests; the existing `setupExpressRequestContext` already consumes them for session linking. No backend change needed for this to work.
5. Result: same `user_id` on both sides ⇒ one person profile, no duplicate/conflicting identity records.

## Event Catalog

Convention: event names space-separated `"noun verbed"`; property keys `snake_case`. Source: **f** = frontend (new), **b** = backend.

### Existing — DO NOT TOUCH (kept for reference / dashboard continuity)
`user registered` (b), `user logged in` (b), `user logged out` (b), `scenario created` (b), `scenario updated` (b), `scenario deleted` (b), `scenario solve enqueued` (b), `scenario solve completed` (b), `scenario solve failed` (b), `scenario data exported` (b), `scenario data imported` (b), `scenario cloned` (b).

### New — backend (one event)
- `scenario solve rejected` (b) — at `scenarios.ts:292` when `getQueueDepth() >= QUEUE_DEPTH_LIMIT`. Props: `{ scenario_id, model_id, queue_depth }`.

### New — frontend
- `solve triggered` — f — `{ scenario_id, model_id }` (the click, distinct from the backend's `enqueued`/`completed`)
- `scenario stale resolved` — f — `{ scenario_id, model_id }` (re-solve after a stale badge)
- `override edited` — f — `{ scenario_id, model_id, entity, field }`
- `map entity added` — f — `{ scenario_id, model_id, entity }`
- `distance override set` — f — `{ scenario_id, model_id }`
- `scenario tab viewed` — f — `{ model_id, tab }`
- `$pageview` — f — fired on wouter location change (SPA client-nav is invisible to autocapture)

Autocapture stays ON as a safety net; named events drive funnels/recs.

## Privacy Boundary (Review 4)

**Allowed event props (allowlist — nothing else ships):** `scenario_id` (integer), `model_id` (enum string), `job_id`, `queue_depth` (int), `entity` (enum: `warehouses|customers|mines|stations|refineries|distances`), `field` (enum column name, never a value), `format` (`csv|json`), `tab` (enum tab id), `rows` (int count), `run_time_sec` (number), `cache_hit` (bool), `objective` (number). No other keys permitted on any event.

**Forbidden — never a prop, never captured:** email, name, any scenario `inputs` value (demand, capacity, distance, BOM ratio, lat/lng), city/state strings, free text, cookies/session tokens.

**Frontend redaction:**
- posthog-js config: `mask_all_text: true`, `mask_all_element_attributes: true`, `autocapture: true`, `disable_session_recording: true`.
- `ph-no-capture` class on: warehouse/customer/mine/station/refinery table value inputs (capacity, demand, city, state, lat, lng), distance/lane-cost override inputs, BOM-ratio slider, import file picker, and auth email/password fields.

**Backend redaction:** existing captures already send counts/ids only — the audit task re-confirms each of the 26 captures' props against the allowlist. The new 429 event uses only allowlisted props.

## No-Op / Fire-and-Forget (Review 5)

- Backend keeps its exact pattern (`posthog?.capture`, null when `POSTHOG_API_KEY` unset). **No change to the client or its config surface.**
- Frontend `initAnalytics()` no-ops when `VITE_POSTHOG_KEY` unset (same as the existing `VITE_API_BASE_URL` optional pattern). `track/identify/reset` are safe no-ops when uninitialized.
- Neither side ever throws into render/request/solve.

## SDK Wiring

### Frontend (`artifacts/studio`) — the bulk of the work
- Add dependency `posthog-js`.
- `lib/analytics.ts` wrapper; `initAnalytics()` in `main.tsx` **after** `setBaseUrl(...)`, guarded by `import.meta.env.VITE_POSTHOG_KEY`.
- `identifyUser(user.id)` / `resetUser()` at auth success / logout.
- `track(...)` at each frontend event site; `$pageview` on wouter location change.

### Backend (`artifacts/api-server`) — minimal
- Add one `posthog?.capture({ distinctId: req.userId!, event: "scenario solve rejected", properties: {...} })` at `scenarios.ts:292`.
- **Nothing else.** No new module, no env change, no client change, no SIGTERM change (already wired).

## Recommendations Loop (GitHub Actions)

- New `.github/workflows/product-insights.yml`: weekly `schedule` + `workflow_dispatch`.
- Steps: query PostHog **HogQL API** for the week's aggregates → pass **aggregates only** (never raw PII) to Claude (Anthropic API) → Claude writes prioritized recs → commit `docs/product-insights/YYYY-MM-DD.md` with `GITHUB_TOKEN`.
- Aggregates: per-model funnel (`scenario created` → `solve triggered` → `scenario solve completed` → `scenario data exported`) with drop-off; stale-without-resolve rate; `scenario solve failed` / `scenario solve rejected` counts by model; solve-runtime distribution + `cache_hit` rate.
- Repo secrets: `POSTHOG_PROJECT_KEY`, `POSTHOG_PERSONAL_API_KEY` (query API needs a personal key, distinct from ingest key), `ANTHROPIC_API_KEY`.
- Query + synthesis in `scripts/product-insights/` (TS); workflow only runs it.

## Config & Deploy

- `render.yaml`: `nos-api` already has `POSTHOG_API_KEY`/`POSTHOG_HOST` — **unchanged**. Add `VITE_POSTHOG_KEY` (+ optional `VITE_POSTHOG_HOST`) to **`nos-studio`** (`sync: false`) — this is the only render.yaml change.
- No OpenAPI, no DB schema, no Drizzle change.
- **posthog-cli** (standing preference): optional CI step to upload studio sourcemaps so error/replay stacks deminify. Cut if error/replay tracking not wanted at launch.

## Testing & Acceptance (Reviews 6 & 7)

**No-regression (must pass):**
- All 26 existing events unchanged in name and props; existing captures compile and fire exactly as before.
- Env names unchanged (`POSTHOG_API_KEY`/`POSTHOG_HOST` still read); no new backend env var.
- Backend no-op still holds when key unset; SIGTERM flush still present.
- Existing api-server tests still green (no event-name churn).

**New coverage:**
- `lib/analytics.ts` (frontend): unit-tests no-op when key unset; correct `{event, props}` when set.
- Frontend event sites: RTL asserts the mocked wrapper called with right event + allowlisted props on the right interaction. Real PostHog never hit.
- 429 event: api-server test asserts `capture(...)` called with `"scenario solve rejected"` + allowlisted props when at queue limit.
- Prop-allowlist guard: a test (or lint) that fails if any tracked prop key is outside the allowlist.
- Insights script: tested against a **fixture** PostHog response (no live PostHog/Anthropic in any gate).

**Verification gate (unchanged shape):** `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (+ solver pytest — Python untouched, no re-run).

## Deferred / Cut (YAGNI)

- Session replay — deferred (privacy review); flag off.
- posthog-cli sourcemaps — optional at launch.
- Feature flags / experiments — not scoped; free once posthog-js is in.
- Any change to existing backend events — explicitly out of scope.

## Execution Note

Implementation plan executed via **agent-team dispatch** (frontend-engineer / backend-engineer / devops-engineer / qa-sdet), not subagent-driven-development. **Plan Task 1 = existing-PostHog inventory** (Review 6): confirm env names, the 26 event names/props, the `user.id === req.userId` identity equality, and the SIGTERM flush, before any new analytics path is written. Plan includes a real-browser / qa-sdet QA task by default. Spec/plan docs merge to local `main` on creation and re-merge after review rounds.

---

## Review comments (Review 1 — repo-alignment)

*Retained verbatim as the review record. Each is resolved in the rewritten body above.*

| # | Comment | Resolution |
|---|---|---|
| R1 | Existing PostHog impl already exists; extend or replace? | **Extend.** Reuse `lib/posthog.ts` + `POSTHOG_API_KEY`/`POSTHOG_HOST`. Invented `services/analytics.ts`/`POSTHOG_KEY` removed. See "Existing State" + "Locked Decisions". |
| R2 | Existing event names must be reconciled | Adopt existing space-separated + `snake_case`-props convention; **no rename** of the 26 events; only additive new events. See "Event Catalog". |
| R3 | Specify actual distinctId flow | Backend already `distinctId: req.userId` + header linking; frontend `identify(user.id)` with a pinned field-equality invariant. See "Identity / DistinctId Flow". |
| R4 | Concrete privacy boundary | Explicit allowlist + forbidden list + exact `ph-no-capture` surfaces. See "Privacy Boundary". |
| R5 | Reuse the no-op convention | Backend client/config untouched; frontend mirrors null-guard no-op. See "No-Op / Fire-and-Forget". |
| R6 | Start from existing code, audit first | Audit performed (this rewrite); baked in as plan Task 1. See "Execution Note". |
| R7 | Acceptance must include no-regression | Added no-regression acceptance block. See "Testing & Acceptance". |
