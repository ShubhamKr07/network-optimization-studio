# PostHog Analytics Integration — Design Spec

**Date:** 2026-09-11
**Status:** Approved (brainstorming), pending spec review → implementation plan
**Topic:** Product-usage tracking (PostHog) across the studio frontend and api-server backend, plus a weekly LLM-generated product-recommendations report.

## Goal

Instrument Network Optimization Studio so we can see how students actually use the tool — where they succeed, stall, or abandon — and turn that signal into concrete product recommendations. Two outcomes:

1. **Metrics** — curated product-usage events flowing to PostHog from both the React studio and the Express api-server, stitched per student.
2. **Recommendations** — a weekly automated report that reads the week's PostHog aggregates, has Claude synthesize prioritized product recommendations, and commits them to the repo.

Non-goals: no A/B experiments now (feature flags come free later, out of scope); no session replay at launch; no schema/API-contract change.

## Locked Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | **PostHog Cloud (US region)** | Free tier (~1M events/mo) covers pilot scale; no infra to run; US matches Render US infra. |
| Identification | **`identify(user_id)`, never email** | Stitches a student's frontend+backend journey without putting email PII in a 3rd party. |
| Input privacy | **Masked** | Autocapture masks all text; `ph-no-capture` on data/auth fields; event props carry shape/counts, never scenario values. |
| Surfaces | **Both frontend + backend, curated events** | Backend holds solver truth (runtime, cache hits, 429s) the frontend can't see. |
| Rec delivery | **PostHog dashboards + weekly LLM cron → markdown in repo** | Dashboards for interactive/free analysis; cron for recurring synthesized recs, versioned in git. |
| Cron host | **GitHub Actions scheduled workflow** | Native repo write via `GITHUB_TOKEN`; no push creds to manage; secrets in repo secrets. |
| Session replay | **Off at launch** | Education data + replay needs a privacy review first; flippable later. |

## Architecture

Three loosely-coupled parts:

```
[studio React] --posthog-js--> PostHog Cloud <--posthog-node-- [api-server jobRunner/routes]
                                     ^
                                     | HogQL query API (weekly, personal key)
                          [GitHub Actions cron] --Claude (Anthropic API)-->
                          commit docs/product-insights/YYYY-MM-DD.md
```

- Frontend and backend send to the **same PostHog project**; `distinctId = user_id` unifies a student's frontend + backend events into one person timeline.
- Capture is **fire-and-forget**: PostHog being down, slow, or misconfigured must never break a solve, a request, or a render. Every capture path swallows its own errors — same "never throw" invariant `jobRunner.ts` already holds.
- The weekly recommendations job reads **PostHog**, not the app DB, so the recs loop is fully decoupled from app runtime and deploys.

### Isolation boundaries

- **`studio/src/lib/analytics.ts`** — thin wrapper (`initAnalytics`, `track(event, props)`, `identifyUser(id)`, `resetUser()`). Components never touch the `posthog` global directly. No-op when `VITE_POSTHOG_KEY` is unset. Trivially mockable in RTL.
- **`api-server/src/services/analytics.ts`** — singleton (`capture(distinctId, event, props)`, `shutdownAnalytics()`). No-op when `POSTHOG_KEY` is unset.
- **`scripts/product-insights/`** — standalone TS: query PostHog → synthesize with Claude → emit markdown. The GitHub workflow only invokes it. Logic is testable, not buried in YAML.

## Event Catalog

Custom events, `snake_case`, minimal props. Source: **f** = frontend (posthog-js), **b** = backend (posthog-node). Autocapture stays ON underneath as a safety net; these named events are what funnels and recommendations actually consume.

**Solve lifecycle**
- `solve_triggered { modelId }` — f
- `solve_enqueued { modelId }` — b
- `solve_succeeded { modelId, runTimeSec, cacheHit, objective }` — b
- `solve_failed { modelId, reason }` — b
- `queue_429 { modelId }` — b
- `stale_resolve { modelId }` — f (re-solve after a stale badge)

**Editing**
- `scenario_created { modelId }` — f
- `override_edited { modelId, entity, field }` — f
- `map_entity_added { modelId, entity }` — f
- `distance_override_set { modelId }` — f

**Import / export**
- `import_applied { modelId, entity, rows }` — f
- `export_clicked { modelId, entity, format }` — f

**Navigation**
- `$pageview` on wouter route change — f (manual; SPA client-nav is invisible to autocapture)
- `tab_viewed { modelId, tab }` — f

Property rule: props carry **shape and counts only** (`rows`, `entity`, `field` name, `format`, `modelId`, numeric `objective`/`runTimeSec`) — **never** scenario input values, city names, or any free text.

## Privacy & Masking

- `identifyUser(user.id)` in the `useGetCurrentAuthUser` success path; `resetUser()` in the logout handler. DB `user_id` only — **never email**.
- posthog-js config: `mask_all_text: true`, `mask_all_element_attributes: true`, `autocapture: true`.
- `ph-no-capture` class applied to any input rendering scenario values (demands, capacities, city/state, distances, BOM ratio) and to auth email/password fields — belt-and-suspenders over autocapture masking.
- Backend event props never include raw `inputs`; only counts/shape as above.
- Session replay: **disabled** (`disable_session_recording: true`) at launch.
- Region: PostHog **US** cloud.

## SDK Wiring

### Frontend (`artifacts/studio`)
- Add dependency `posthog-js`.
- `lib/analytics.ts` wrapper as above; `initAnalytics()` called from `main.tsx` **after** `setBaseUrl(...)`, guarded by `import.meta.env.VITE_POSTHOG_KEY` (unset locally ⇒ no-op, same pattern as `VITE_API_BASE_URL`).
- `identifyUser` / `resetUser` wired at auth success / logout.
- `track(...)` calls at each frontend event site in the catalog. `$pageview` fired on wouter location change.

### Backend (`artifacts/api-server`)
- Add dependency `posthog-node`.
- `services/analytics.ts` singleton; no-op when `POSTHOG_KEY` unset.
- `capture(...)` calls in `jobRunner.ts` (solve lifecycle: enqueued/succeeded/failed) and `routes/scenarios.ts` (`queue_429`).
- `shutdownAnalytics()` (flushes buffered events) added to the existing SIGTERM path (introduced in `9251d4a`) so a redeploy doesn't drop in-flight events.

## Recommendations Loop (GitHub Actions)

- New `.github/workflows/product-insights.yml`: `schedule` (weekly cron) + `workflow_dispatch` (manual trigger).
- Steps:
  1. Query PostHog **HogQL query API** for the week's aggregates:
     - per-model funnel: `scenario_created` → `solve_triggered` → `solve_succeeded` → `export_clicked`, with drop-off at each step;
     - stale-without-resolve rate (`stale_resolve` vs. staleness occurrences);
     - `solve_failed` / `queue_429` counts by model and reason;
     - solve-runtime distribution (`runTimeSec`) and `cacheHit` rate.
  2. Pass **aggregates only** (never raw PII) to Claude via the Anthropic API.
  3. Claude writes a prioritized product-recommendations report.
  4. Commit `docs/product-insights/YYYY-MM-DD.md` using the default `GITHUB_TOKEN`.
- Repo secrets: `POSTHOG_PROJECT_KEY`, `POSTHOG_PERSONAL_API_KEY` (query API requires a personal API key, distinct from the ingest key), `ANTHROPIC_API_KEY`.
- The query + synthesis live in `scripts/product-insights/` (TS); the workflow only runs the script.

## Config & Deploy

- `render.yaml`: add `POSTHOG_KEY` and `POSTHOG_HOST` to **both** `nos-api` and `nos-studio`, `sync: false`.
- No OpenAPI, no DB schema, no Drizzle change. `inputs` contract untouched.
- **posthog-cli** (per standing user preference): a CI step uploads studio build sourcemaps to PostHog so future error/replay stack traces deminify. **Optional** — cut if error/replay tracking isn't wanted at launch.

## Testing

- `analytics.ts` wrappers (both): unit-test that they no-op when the key is unset and emit the correct `{event, props, distinctId}` when set.
- Frontend event sites: RTL asserts the mocked wrapper was called with the right event + props on the right interaction. Real PostHog never hit in tests.
- Backend event sites: existing route/jobRunner tests assert `capture(...)` called with the right args (wrapper mocked).
- Insights script: tested against a **fixture** PostHog query response (no live PostHog in any gate).
- No test in the verification gate depends on network access to PostHog or Anthropic.
- Verification gate unchanged in shape: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (+ solver pytest — Python untouched here, no re-run needed).

## Deferred / Cut (YAGNI)

- Session replay — deferred (privacy review); config flag already off.
- posthog-cli sourcemap upload — optional at launch.
- Feature flags / experiments — not scoped now; available free once the SDK is in.

## Execution Note

Per standing preference, the implementation plan will be executed via **agent-team dispatch** (frontend-engineer / backend-engineer / devops-engineer / qa-sdet), not subagent-driven-development. The plan will include a real-browser / qa-sdet QA task by default. Spec/plan docs merge to local `main` on creation and re-merge after review rounds.
