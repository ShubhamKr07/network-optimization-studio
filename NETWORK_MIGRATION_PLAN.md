# Network Optimization Studio — Render Migration Plan

**Audience:** Claude Code (autonomous execution) and human reviewers.
**Relationship to other planning docs:** this is **Phase 0** relative to `IMPLEMENTATION_PLAN.md` v0.2. It is infrastructure-only — no product behavior changes, no schema changes beyond what Phase 1+ already plans — and is written so it lands exactly once and needs no rework when Phase 3.5 (model registry, async solve, `solve_jobs`) ships later. Requirement/task IDs below (`R0.x`) are new; they don't map to PRD IDs.
**Recommended sequencing:** run before or in parallel with Phase 1. It doesn't block Phase 1–6 and isn't blocked by them, but landing it first means every later phase gets a real deployed environment for e2e verification instead of only local/Replit.
**Hard rule inherited from `CLAUDE.md`:** don't touch `attached_assets/`, `.replit`, `replit.md`, or `push-to-github.mjs`. Nothing in this plan requires it — Replit stays intact as a fallback deploy target. This plan only **adds** new files (`Dockerfile`, `.dockerignore`, `render.yaml`, the solver's `requirements.txt`, `.node-version`) and makes narrowly-scoped edits to existing source files, each listed under its task below.

---

## 0. Target architecture

Three Render resources, mapped 1:1 to the app's three real technical concerns:

| Resource | Render type | What it runs | Why |
|---|---|---|---|
| `nos-api` | Web Service, **Docker** runtime | `artifacts/api-server` (Express) + `artifacts/api-server/src/solver/solve.py` (Python/PuLP/CBC), invoked via `spawnSync` | Node and Python must share one process/filesystem — Render's native Node buildpack has no Python, so this has to be a custom Docker image. |
| `nos-studio` | Static Site | built `artifacts/studio` (Vite/React) | It's just files behind a CDN; no server needed, and Render's static hosting is free and doesn't sleep. |
| `nos-postgres` | Managed Postgres | `scenarios`, `users`, etc. | Managed, backed up, one connection string. |

No separate worker/queue service is created in Phase 0. Phase 3.5's async dispatcher (per `IMPLEMENTATION_PLAN.md` §0.5a) is a simple poller against `solve_jobs` running inside the same `nos-api` process — no Redis, no broker. If Phase 6 ever promotes it to a standalone process, that becomes a second Render **Background Worker** service built from the *same* Dockerfile with a different start command — nothing here needs to change to support that later.

---

## 1. Why this isn't a lift-and-shift

Seven things in the current codebase assume same-origin, single-process, Replit-hosted deployment. Each fails **silently** on Render if not fixed explicitly — as a product bug (login doesn't stick, solves time out), not a deploy error. Read all seven before starting; they're the reason this is a plan and not just "connect the repo."

**G1 — Cross-origin cookies.** Render's default hostnames are `<service>.onrender.com`. `onrender.com` is on the Public Suffix List, so `nos-api.onrender.com` and `nos-studio.onrender.com` are different **sites** for cookie purposes even though they share a domain suffix. The current cookie is `sameSite: "lax"` (`artifacts/api-server/src/routes/auth.ts`) — a lax cookie is not sent on cross-site fetch/XHR, only top-level navigation. Auth will appear to silently fail. Fix in R0.3.

**G2 — Fetch credentials mode.** The frontend currently only ever calls relative paths (`setBaseUrl` from `lib/api-client-react` is never called), so requests are same-origin and the browser's default `credentials: "same-origin"` mode already sends the cookie — it "just works" without anyone deciding it should. Once `setBaseUrl` points at `nos-api`'s own host, requests become genuinely cross-origin and that default stops sending the cookie. Fix in R0.4.

**G3 — CORS wildcard + credentials.** `app.ts` has `cors({ credentials: true, origin: true })`, which reflects any request's `Origin` back as allowed. That's low-risk today because nothing else can reach the same-origin API. Once the API has a real public hostname, it becomes an open credentialed CORS policy — any site can make cookie-authenticated requests on a logged-in user's behalf. Fix in R0.2.

**G4 — Python + Node in one runtime.** `pmedian.ts` calls `spawnSync("python3", [SOLVER_PY], ...)`, assuming a `python3` binary with `pulp` importable on `PATH` in the same container as the Node process. Fix in R0.5 (Docker).

**G5 — TLS to Postgres.** `lib/db/src/index.ts` does `new Pool({ connectionString: process.env.DATABASE_URL })` with no `ssl` option. Render's managed Postgres requires TLS; connecting without it fails outright, not silently — but it'll fail on the very first request after cutover if missed. Fix in R0.1.

**G6 — Build-time env requirements in the frontend.** `artifacts/studio/vite.config.ts` throws if `PORT` or `BASE_PATH` are unset, and that check runs at config-load time — during `vite build`, not just `dev`/`preview`. Render's static-site build environment needs both set even though the static output never listens on a port. Handled in R0.6 (`render.yaml`).

**G7 — Free-tier realities.** A solve can legitimately run up to 120s (`timeLimitSec` default) + a 15s buffer (`pmedian.ts`). Render's free web services spin down after inactivity and cold-start the next request; Render's free/expiring Postgres is deleted after 90 days. Neither is acceptable for a course running a full term. Budget the paid **Starter** plan for `nos-api` and `nos-postgres`; `nos-studio` can stay on free static hosting — it's genuinely free with no sleep or expiry.

---

## 2. Tasks

### Task R0.1 — Postgres TLS
**Files:** `lib/db/src/index.ts`.
Add conditional SSL so local dev (no-TLS local Postgres) is unaffected:
```ts
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
```
**DoD:** typecheck green; local `pnpm --filter @workspace/db push` against a local/dev DB still works unchanged (NODE_ENV≠production there).

### Task R0.2 — CORS allowlist
**Files:** `artifacts/api-server/src/app.ts`.
Replace the reflect-all origin with an explicit allowlist read from a new env var, keeping today's permissive behavior for local dev only:
```ts
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin:
      process.env.NODE_ENV === "production"
        ? allowedOrigins
        : true,
  }),
);
```
**Tests:** request with an `Origin` not in the allowlist gets no `Access-Control-Allow-Origin` header in production mode; an allowed origin gets one.
**DoD:** gate green; `CORS_ALLOWED_ORIGIN` documented in R0.8's env table.

### Task R0.3 — Cross-origin cookie flags
**Files:** wherever the session cookie is set — currently `artifacts/api-server/src/routes/auth.ts` (`res.cookie(USER_COOKIE, uid, {...})`; will become `nos_session` once Task A1.3 lands, this task doesn't depend on that rename).
Make `sameSite`/`secure` environment-driven instead of hardcoded `"lax"`:
```ts
const crossOrigin = process.env.NODE_ENV === "production";
res.cookie(USER_COOKIE, uid, {
  httpOnly: true,
  signed: true,
  sameSite: crossOrigin ? "none" : "lax",
  secure: crossOrigin,
  path: "/",
  maxAge: COOKIE_TTL,
});
```
`sameSite: "none"` requires `secure: true`, which requires HTTPS — Render terminates TLS by default on every service, so this is safe as soon as it's deployed there.
**DoD:** gate green. Apply the same `sameSite`/`secure` logic anywhere else the cookie is cleared (logout) so the clearing cookie's attributes match, or browsers won't clear it.

### Task R0.4 — Cross-origin frontend wiring
**Files:** `lib/api-client-react/src/custom-fetch.ts`, `artifacts/studio/src/main.tsx`.
1. In `customFetch`, default credentials to `"include"` so cookies are sent once the API is a different origin, without forcing every call site to remember it:
   ```ts
   const response = await fetch(input, { ...init, method, headers, credentials: init.credentials ?? "include" });
   ```
2. In `main.tsx`, before the first render, wire the base URL from a Vite env var — `undefined`/`null` (local dev, no env var set) preserves today's relative-path behavior exactly:
   ```ts
   import { setBaseUrl } from "@workspace/api-client-react";
   setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);
   ```
**Tests:** existing frontend test suite unaffected (no base URL set in test env → relative paths, unchanged). Manual check post-deploy: network tab shows requests going to `nos-api`'s host, and `Set-Cookie`/cookie-sent behavior confirmed in R0.9.
**DoD:** gate green; `VITE_API_BASE_URL` documented in R0.8.

### Task R0.5 — Dockerfile for `nos-api`
**Files (new):** `Dockerfile`, `.dockerignore`, `artifacts/api-server/src/solver/requirements.txt`.

`requirements.txt` — production-only; `pytest` stays a local/CI dev dependency, not part of the deployed image:
```
pulp==3.3.2
```
Verified in a clean environment: `pip install pulp` alone provides a working bundled CBC binary on a Debian/Ubuntu base — **no** `apt-get install coinor-cbc` is needed.

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim

# Python for the solver (artifacts/api-server/src/solver/solve.py).
# build-essential is for native Node modules (argon2, if Task A1.3 picks it
# over bcryptjs — harmless to keep either way; drop it if the fallback wins).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, pinned to match pnpm-lock.yaml's lockfileVersion (9.0 ->
# pnpm 9.x). Bump the major here if the lockfile version ever changes.
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# Build only api-server and the workspace packages it depends on. This
# deliberately skips `studio` (which needs PORT/BASE_PATH at build time and
# is deployed separately as a static site — see render.yaml) and avoids a
# monorepo-wide build inside the API image.
RUN pnpm --filter api-server... --if-present run build

RUN pip install --break-system-packages --no-cache-dir \
      -r artifacts/api-server/src/solver/requirements.txt

ENV NODE_ENV=production
# Render injects PORT at runtime and routes to it — do not hardcode it here.
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

`.dockerignore`:
```
.git
.github
node_modules
**/node_modules
**/dist
**/.turbo
attached_assets
*.log
```

**DoD:** `docker build .` succeeds and `docker run -e PORT=10000 -e DATABASE_URL=... -e SESSION_SECRET=... <image>` serves `GET /api/healthz` with `{"status":"ok"}`. (Build this in an environment with Docker + registry access — verify locally or let Render's own build do it; this sandbox's network policy blocks pulling `node:24-slim`, so the image itself isn't buildable from here. The Python/CBC step *was* verified directly against `pulp==3.3.2`.)
**Note — copy-everything trade-off:** `COPY . .` before `pnpm install` skips Docker layer-cache optimization (every source change invalidates the install layer too) in exchange for never going stale as new workspace packages appear — e.g., Phase 2's `solvers/<model-id>/` packages. Revisit only if Docker build time becomes an actual bottleneck (P2, not needed for a pilot).

### Task R0.6 — `render.yaml` blueprint
**Files (new):** `render.yaml`, `.node-version`.

`.node-version` (repo root — pins Node for `nos-studio`'s static-site build environment, which isn't Docker-based):
```
24
```

`render.yaml`:
```yaml
services:
  - type: web
    name: nos-api
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerContext: .
    plan: starter
    healthCheckPath: /api/healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: nos-postgres
          property: connectionString
      - key: SESSION_SECRET
        generateValue: true
      - key: CORS_ALLOWED_ORIGIN
        value: https://nos-studio.onrender.com
      - key: LOG_LEVEL
        value: info

  - type: web
    name: nos-studio
    runtime: static
    buildCommand: >-
      corepack enable && corepack prepare pnpm@9 --activate &&
      pnpm install --frozen-lockfile &&
      pnpm --filter studio... --if-present run build
    staticPublishPath: artifacts/studio/dist/public
    envVars:
      - key: BASE_PATH
        value: /
      - key: PORT
        value: "10000"          # unused at runtime for a static site; vite.config.ts
                                  # just needs it present and numeric at build time
      - key: VITE_API_BASE_URL
        value: https://nos-api.onrender.com
      - key: NODE_VERSION
        value: "24"

databases:
  - name: nos-postgres
    plan: starter
    postgresMajorVersion: 16
```
`https://nos-api.onrender.com` / `https://nos-studio.onrender.com` are placeholders — Render assigns the real subdomain from each service's `name`; update both cross-references (`CORS_ALLOWED_ORIGIN` and `VITE_API_BASE_URL`) once the services exist, or set them manually in the dashboard after first deploy (chicken-and-egg on first apply — see R0.8).
**DoD:** `render.yaml` validates via Render's Blueprint preview (Dashboard → New → Blueprint, point at the repo) without manual edits beyond the two hostname placeholders.

### Task R0.7 — README deploy section (P1, optional)
**Files:** `README.md` (not excluded by `CLAUDE.md` — only `.replit`/`replit.md`/`push-to-github.mjs` are).
Add a short "Deploying" section: Render Blueprint from `render.yaml`, link to this plan for the "why," and the one manual step from R0.8 (secrets). Keep it to a few lines — this file is the source of truth, README just points at it.
**DoD:** doesn't restate task detail, just orients a new reader.

---

## 3. Env vars — full inventory

| Var | Service | Set by | Notes |
|---|---|---|---|
| `PORT` | nos-api | Render (automatic) | Already read correctly in `index.ts`; no change needed. |
| `DATABASE_URL` | nos-api | `render.yaml` → `fromDatabase` | Wired automatically once `nos-postgres` exists. |
| `SESSION_SECRET` | nos-api | `render.yaml` → `generateValue: true` | Render generates and stores it; never hardcode. |
| `CORS_ALLOWED_ORIGIN` | nos-api | manual (R0.8) | `nos-studio`'s real URL; new in R0.2. |
| `NODE_ENV` | nos-api | `render.yaml` | `production` — drives R0.1/R0.2/R0.3's conditionals. |
| `LOG_LEVEL` | nos-api | `render.yaml` | Already read by `lib/logger`; optional, defaults fine if omitted. |
| `BASE_PATH` | nos-studio | `render.yaml` | `/` — root-served static site. |
| `PORT` | nos-studio | `render.yaml` | Placeholder only (G6) — unused at runtime. |
| `VITE_API_BASE_URL` | nos-studio | manual (R0.8) | `nos-api`'s real URL; new in R0.4. |
| `NODE_VERSION` | nos-studio | `render.yaml` / `.node-version` | Pins Node 24 for the static build environment. |

### R0.8 — STOP AND ASK (human step)

Claude Code cannot click through Render's dashboard. Once `render.yaml` is committed, a human needs to:
1. Create the Blueprint in Render's dashboard pointing at this repo.
2. After first deploy, copy the two real `*.onrender.com` URLs Render assigns and set `CORS_ALLOWED_ORIGIN` (on `nos-api`) and `VITE_API_BASE_URL` (on `nos-studio`) to each other's real URL — this is a manual dashboard edit or a `render.yaml` update + redeploy, since the URLs don't exist until the services are first created.
3. Confirm the `nos-api` and `nos-postgres` plans are **Starter**, not Free (G7).
4. If a custom domain is added later, revisit R0.3 — `sameSite: "lax"` becomes usable again once both services share an apex domain, which is marginally more robust than `"none"`.

---

## 4. Verification gate

Run before considering Phase 0 closed:
```bash
pnpm run typecheck \
  && pnpm --filter api-server test \
  && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
This is unchanged from `IMPLEMENTATION_PLAN.md` §0.4 — Phase 0 doesn't touch product logic, so the existing gate is sufficient to catch regressions from R0.1–R0.4's edits.

Then, against the deployed environment (R0.9, manual/e2e):
- [ ] `GET https://nos-api.onrender.com/api/healthz` → `{"status":"ok"}`.
- [ ] From `nos-studio`, register → login → refresh the page → still logged in (confirms the cookie survives a cross-origin round trip — the real test of G1–G3 together).
- [ ] Browser devtools → Application → Cookies: cookie shows `SameSite=None; Secure` on the `nos-api` host.
- [ ] A scenario solve completes within the deployed environment's request timeout (confirms R0.5's Python/CBC install and that the Starter plan, not Free, is active — a cold-started free instance would likely time out mid-solve).
- [ ] `pnpm --filter studio run build` locally with `VITE_API_BASE_URL` unset still produces a working relative-path build (local-dev regression check for R0.4).

---

## 5. Risk table

| Risk | Mitigation |
|---|---|
| `argon2` (Task A1.3, if it lands before/alongside this) fails to compile in the Docker image | `build-essential` is already in the Dockerfile; if it still fails, fall back to `bcryptjs` per the existing plan's own risk note, then drop `build-essential` as a later cleanup. |
| `sameSite: "none"` cookies rejected by an unusually strict browser/extension setup | Rare in practice given `secure: true` is satisfied by Render's default TLS; the custom-domain path in R0.8 step 4 is the long-term fix if it becomes a real issue. |
| Docker build time grows as Phase 2 adds model packages | Accepted trade-off, see R0.5's note; revisit layer-caching only if it becomes a measured bottleneck. |
| Free-tier temptation during a low-budget pilot | G7 makes the cost explicit up front — Starter plans on `nos-api`/`nos-postgres` are the affordability floor here, not a nice-to-have; `nos-studio` is genuinely free with no trade-off. |
| Phase 3.5's async dispatcher, once built, needs a second process | No Phase 0 change required — same Dockerfile, new Render Background Worker service with a different start command, sharing `nos-postgres`. |

---

## 6. Explicitly out of scope for Phase 0

Recorded so it isn't relitigated:
- **A separate worker/queue service now** — rejected; Phase 3.5's polling dispatcher runs in-process, no infra to add until Phase 6 (if ever).
- **Redis/BullMQ** — never needed; the existing plan's async design polls `solve_jobs` directly.
- **Custom domain / apex-shared subdomains** — deferred; `sameSite: "none"` solves cross-origin cookies without owning a domain first (R0.8 step 4 revisits this later).
- **Database migration tooling beyond `drizzle-kit push`** — out of scope; matches the existing plan's own convention (`IMPLEMENTATION_PLAN.md` Task A1.2), not something this migration should change.
- **Autoscaling / multi-instance tuning** — premature for a pilot cohort; single Starter instance per service is the right starting point per the original cloud-services evaluation.
