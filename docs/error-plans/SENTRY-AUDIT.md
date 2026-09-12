# Sentry Integration Audit (2026-09-12)

Task SENTRY-1. Read-only confirmation of repo state before any Sentry code lands.

## Confirmed

| Check | Result | Evidence |
|---|---|---|
| No Sentry anywhere | ✅ none | `grep "@sentry" artifacts/*/package.json package.json` → none; no `SENTRY_DSN`/`VITE_SENTRY` in real source |
| Frontend has no error boundary | ✅ none | `grep "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" artifacts/studio/src` → none |
| Backend error-middleware ordering | ✅ mapped | `app.ts:84` PostHog `setupExpressErrorHandler(posthog, app)`; `app.ts:87-96` the 4-arg catch-all returning `res.status(500).json({error:...})`. Sentry's `setupExpressErrorHandler(app)` goes **after the PostHog handler, before the catch-all** (so it sees the error before the JSON responder swallows it). |
| SIGTERM/SIGINT flush points | ✅ mapped | `index.ts:39` SIGTERM + `:43` SIGINT, each `await posthog?.shutdown()` (40/44). Add `await Sentry.close(2000)` alongside. |
| Node init-order requirement | ✅ noted | `index.ts:1` imports `app` (pulls all modules) → `@sentry/node` must init in a first-line `import "./instrument"` side-effect module, before `import app`. |
| Identity field | ✅ `user.id` ≡ `req.userId` | `AuthUser.id` (required string, `openapi.yaml`) is what `useGetCurrentAuthUser` returns as `user.id`; backend `req.userId` is the same DB user id from the signed cookie (`middlewares/auth.ts`). Confirmed equal in the PostHog audit. **Never email.** |

## Consequences for later tasks

- SENTRY-2: create `instrument.ts` (first import), place `Sentry.setupExpressErrorHandler(app)` between `app.ts:85` and `:87`, add `Sentry.close(2000)` to both signal handlers.
- SENTRY-3: add a `<SentryErrorBoundary>` (none exists to conflict with); identify with `user.id`.
- No generated code, OpenAPI, DB, or Drizzle touched by this integration.
