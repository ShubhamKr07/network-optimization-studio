# Application audit & remediation plan

Full-stack review of `network-optimization-studio` (backend + frontend), independent of any single
model integration. Findings are grounded in source read from `main`, not inferred from the README.

**Headline:** the model-integration risks documented previously are real but secondary. This audit
found a **critical authentication weakness** and a **substantial gap between the README and the
codebase** that invalidates planning done against the documentation — including a task in this
repo's own prior integration plan.

Severity: **C0** exploitable/data-loss · **C1** breaks in production · **C2** degrades or misleads ·
**C3** hygiene

---

## A. Security

### A1 — Session secret falls back to a public constant `[C0]`

`artifacts/api-server/src/app.ts`:

```ts
const COOKIE_SECRET = process.env.SESSION_SECRET || "arcadia-dev-secret";
```

`artifacts/api-server/src/middlewares/auth.ts` treats the signed cookie's value as the user id
directly:

```ts
const userId = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
if (!userId) { res.status(401)...; return; }
req.userId = userId;
```

If `SESSION_SECRET` is unset in production, cookies are signed with a string that is **published in
a public repository**. Anyone can mint a valid `nos_session` cookie for an arbitrary user id and
authenticate as any user — including reading and modifying their scenarios.

Compounding it: **`README.md` lists only `DATABASE_URL` under "Required env."** `SESSION_SECRET` is
never mentioned, so an operator following the documentation deploys vulnerable by default.

The rest of the auth implementation is sound — argon2 hashing, no user enumeration on login,
`httpOnly` + `secure` + `sameSite` cookies. This single fallback undermines all of it.

**Fix (P0):**
```ts
const COOKIE_SECRET = process.env.SESSION_SECRET;
if (!COOKIE_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET is required in production");
}
```
Fail to boot rather than boot insecurely. Add `SESSION_SECRET` to the README's required env, and
document rotation (rotation invalidates all sessions — acceptable, and currently the *only*
revocation mechanism available; see A2).

### A2 — No server-side session store `[C1]`

The session *is* the cookie. There is no session table, so:

- **Logout cannot revoke.** Clearing the client cookie leaves the signed value valid for its full
  7-day TTL. A stolen cookie works until expiry.
- No "sign out everywhere," no per-session audit, no forced invalidation on password change.
- `SESSION_TTL_MS` is enforced only by the browser's cookie expiry, not server-side.

**Fix (P1):** add a `sessions` table (id, userId, createdAt, expiresAt, revokedAt); store an opaque
session id in the cookie; validate against the table in `requireAuth`. Also rotates naturally on
password change.

### A3 — No security headers `[C2]`

No `helmet` or equivalent. Missing CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`. The app renders user-supplied scenario names, so a CSP is meaningful defence in
depth.

**Fix (P1):** `app.use(helmet())` before the router; tune CSP for Leaflet tile origins.

### A4 — Rate limiting is per-process, per-IP, and login-only `[C2]`

`routes/auth.ts` uses a module-level `Map` — 10 attempts/min/IP. Its own comment acknowledges the
limits. Three concrete gaps:

- **Resets on restart**, and is per-instance — two instances give 2× the budget.
- **`/auth/register` is not rate limited at all** → unbounded account creation.
- `req.ip` behind a proxy requires `app.set("trust proxy", ...)`, which is not set. Without it every
  request appears to come from the proxy's IP, so the limiter throttles *all users collectively*
  after 10 attempts/min — a fail-closed denial of service rather than a security control.

**Fix (P1):** set `trust proxy` correctly for the deploy topology; extend limiting to `/register`;
move to a shared store (Postgres or Redis) when a second instance appears.

### A5 — CORS misconfiguration fails silently in production `[C2]`

```ts
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGIN ?? "").split(",")...filter(Boolean);
origin: process.env.NODE_ENV === "production" ? allowedOrigins : true,
```

Unset in production → empty allowlist → every cross-origin request blocked → the frontend cannot
reach the API at all. Correctly fail-closed, but presents as a total outage with no server-side
error. Not in the README's required env either.

**Fix (P1):** boot-time assertion; add to required env documentation.

### A6 — CSV formula injection `[C2, verify]`

`services/templates.ts` applies `csvEscape()` to `city` (quoting/comma handling). Standard
quote-escaping does **not** neutralise leading `=`, `+`, `-`, or `@`, which Excel and Sheets execute
on open. Values originate from user-editable overrides and are re-exported as templates.

**Fix (P2):** prefix any cell beginning with `= + - @` with `'` in the export path. Verify
`csvEscape`'s current behaviour first — it may already handle this.

---

## B. Documentation drift

### B1 — The README describes a subsystem that does not exist `[C1 for planning]`

`README.md` documents an "Arcadia" gamification layer in detail: quests tied to problem type, a
quest map, XP/badges/leaderboard, session-persistent per-user progress in Postgres. It lists
concrete paths: `src/pages/arcadia/ LoginPage, Dashboard, QuestMap, Leaderboard, Badges`,
`src/context/GamificationContext`, a `progress` route, and `user_progress` in the Drizzle schema.

Verified against the repository tree:

| README claim | Reality |
|---|---|
| `src/pages/arcadia/*` | **0 files** matching `arcadia` anywhere in the repo |
| `src/context/GamificationContext` | No `context/` directory in `studio/src` |
| `routes/ ... progress` | `routes/` = auth, dataset, health, index, models, scenarios, solveHistory |
| `user_progress` table | `schema/index.ts` exports scenarios, auth, solve_jobs, result_cache only |
| Leaderboard / badges / XP | No matching files |

None of it exists. (The e2e claim *is* accurate — `artifacts/studio/e2e/` contains
`global.setup.ts`, `import.spec.ts`, `labs.spec.ts`.)

**This has already caused a concrete error.** The prior Chapter 10 integration plan in this repo
included a task "M5 — Arcadia quest," written in good faith against the README. That task cannot be
executed as written: it depends on a quest system, XP model, and progress table that do not exist.
Building it is not a small task appended to a model integration — it is a separate feature
requiring a new DB table, new routes, and a new frontend section.

**Fix (P0 — documentation):** rewrite `README.md` to describe the code as it is. Move Arcadia to a
clearly-labelled "Planned / not implemented" section. Cost: under an hour. Value: every future plan
written against this repo stops inheriting phantom scope.

**Process fix (P2):** a CI check asserting README-referenced paths exist.

### B2 — Three model ids are accepted but unimplementable `[C2]`

`VALID_MODEL_IDS` in `routes/scenarios.ts` and the OpenAPI `modelId` enum both contain
`max_coverage`, `p_center`, and `set_cover`. None has a manifest, dataset, solver, or Zod schema.

A client can therefore create a scenario for `p_center` successfully, then get `Unknown model_id`
on solve — a dead end with an error that points at the wrong layer.

It also means the allowlist and the registry are **already out of sync on `main`**, so nothing in CI
currently checks agreement between the eight registration points.

**Fix (P1):** remove unimplemented ids, or mark them explicitly and reject at creation with a clear
"not yet available" message.

---

## C. Reliability & operations

### C1 — `/healthz` is a stub `[C1]`

```ts
router.get("/healthz", (_req, res) => res.json({ status: "ok" }));
```

Returns `ok` unconditionally. It does not check database connectivity, `python3` availability, or
PuLP/CBC presence. A deployment with a broken `DATABASE_URL`, a missing Python runtime, or an
unbuilt solver environment passes its healthcheck and receives production traffic — failing on the
first real request instead of during rollout.

**Fix (P0):** split liveness from readiness.
- `/healthz` — process alive (current behaviour is correct for this)
- `/readyz` — `SELECT 1` against Postgres, `python3 -c "import pulp"` (cached, with a short TTL),
  and solver dataset load status. Point the platform's healthcheck at `/readyz`.

### C2 — Solve jobs orphaned on restart `[C1]`

`jobRunner.ts` maintains an in-process array queue with fixed concurrency. Jobs live in
`solve_jobs`. On restart or crash:

- Queued jobs are lost from memory but their rows persist — invisible to the queue, never run.
- Jobs marked `running` when the process died stay `running` forever.

The frontend polls job status, so an affected user polls indefinitely against a job nothing will
ever advance.

**Fix (P1):**
- Boot-time reaper: mark `running` jobs older than the max timeout as `failed` with an explanatory
  message.
- Requeue orphaned `queued` rows at boot, or fail them with a retry prompt.
- Client-side: cap polling duration and surface a terminal state.

### C3 — Cache failures are invisible `[C2]`

Both the cache read and the cache write in `jobRunner.ts` are wrapped in bare `catch {}`. If the
cache table is missing, misconfigured, or erroring, every solve silently recomputes. No log, no
metric — the only symptom is latency.

**Fix (P2):** log at `warn` with the error; add a counter. `pino` is already wired.

### C4 — No production migration path `[C1]`

README documents `pnpm --filter @workspace/db run push` as **dev only**. There is no migrations
directory and no documented production schema-change process. Any schema change (including the
`sessions` table from A2) currently has no safe deployment route.

**Fix (P0 before any schema change):** adopt `drizzle-kit generate` migrations, commit them, and run
them as a deploy step.

### C5 — Single-process assumptions block horizontal scaling `[C2]`

Three components assume exactly one process: the login rate limiter (A4), the solve worker pool, and
the queue-depth backpressure counter. Running two instances silently doubles the effective rate
limit and the effective solver concurrency — the latter can exhaust host CPU with no signal.

**Fix (P2):** document as a hard constraint now (`maxInstances: 1`); externalize state if scaling
is ever needed.

### C6 — Python runtime unverified at boot `[C2]`

`spawn("python3", [SOLVER_PY])` is the first point where a missing interpreter or missing PuLP is
discovered — per request, at solve time, surfacing as a generic job failure.

**Fix (P1):** verify at boot; fold into `/readyz` (C1).

### C7 — Solver stderr discarded `[C2]`

`runSolverProcess` attaches a handler to `child.stdout` only. Python tracebacks go to stderr and are
dropped. Every solver crash presents as an opaque failure.

**Fix (P0 — highest value per line changed):** capture stderr and include it in the failure message.
This is a prerequisite for efficiently debugging anything in the solver layer.

---

## D. Frontend

### D1 — No error boundary `[C1]`

`App.tsx` wraps the tree in `QueryClientProvider` with no React error boundary anywhere. Any render
throw — a metric field arriving `undefined`, a malformed edge, a Leaflet failure — unmounts the
entire application to a blank page.

Optimization results are model-specific and partially optional by design, making this exactly the
kind of app where a render throw is likely.

**Fix (P0):** top-level error boundary with a reload affordance, plus a boundary around the map and
results panels so a visualization failure degrades locally instead of globally.

### D2 — Query client has no defaults `[C2]`

`const queryClient = new QueryClient();` — no `staleTime`, no `retry` policy, no global error
handler. TanStack Query defaults to 3 retries with backoff, so a 401 or a 422 is retried three
times before surfacing, delaying the error and tripling load during an outage.

**Fix (P2):** `retry: (count, err) => !isClientError(err) && count < 2`, explicit `staleTime`, and a
global `onError` that surfaces a toast.

### D3 — Job polling has no terminal bound `[C2]`

Combined with C2 (orphaned jobs), a poll loop with no cap means an abandoned tab polls a
never-advancing job indefinitely.

**Fix (P2):** cap total polling duration; show a terminal "solve did not complete" state.

### D4 — Map bounds already generalized `[no action]`

`artifacts/studio/src/lib/mapBounds.ts` exists with tests. Earlier concern about proliferating
country-specific map components is **partially unfounded** — the bounds logic is already shared,
though `NetworkMap.tsx` and `BrazilMap.tsx` remain separate components. Prefer extending
`NetworkMap` over adding a third.

---

## E. Remediation plan

### Phase R0 — Security & safety (do first, ship alone)

| Task | Finding | Effort |
|---|---|---|
| R0.1 Fail boot if `SESSION_SECRET` unset in production | A1 | XS |
| R0.2 Add `SESSION_SECRET`, `CORS_ALLOWED_ORIGIN` to required env docs | A1, A5 | XS |
| R0.3 Capture solver stderr into failure messages | C7 | S |
| R0.4 Top-level React error boundary | D1 | S |
| R0.5 Rewrite README to match reality; move Arcadia to "Planned" | B1 | S |
| R0.6 Adopt drizzle migrations before any schema change | C4 | M |

**Gate:** existing test suites green; manual verify boot fails without `SESSION_SECRET`.

### Phase R1 — Operational correctness

| Task | Finding | Effort |
|---|---|---|
| R1.1 `/readyz` with DB + Python + dataset checks | C1, C6 | M |
| R1.2 Boot-time orphaned-job reaper | C2 | M |
| R1.3 Server-side session table with revocation | A2 | M |
| R1.4 `helmet` + CSP tuned for Leaflet | A3 | S |
| R1.5 `trust proxy`; rate-limit `/register` | A4 | S |
| R1.6 Boot assertion on `CORS_ALLOWED_ORIGIN` | A5 | XS |
| R1.7 Remove or gate unimplemented model ids | B2 | S |

### Phase R2 — Hardening & hygiene

| Task | Finding | Effort |
|---|---|---|
| R2.1 Registration consistency test (8 points) | B2, precheck Gate 1 | S |
| R2.2 Solver-code hash in cache key | *(prior audit)* | S |
| R2.3 Log cache failures instead of swallowing | C3 | XS |
| R2.4 Per-model dataset/manifest load isolation | *(prior audit)* | M |
| R2.5 CI guard: no stray `print()` / `writeLP()` in `solve.py` | *(prior audit)* | XS |
| R2.6 QueryClient defaults + global error handling | D2 | S |
| R2.7 Bound job polling; terminal state | D3 | S |
| R2.8 CSV formula-injection escaping | A6 | S |
| R2.9 CI check that README-referenced paths exist | B1 | S |
| R2.10 Document single-instance constraint | C5 | XS |

### Sequencing note

R0.3 (solver stderr) and R0.4 (error boundary) are prerequisites for efficiently debugging
everything else — they convert opaque failures into legible ones. Do them before any new model work,
not after.

R0.6 (migrations) blocks R1.3 (session table). Sequence accordingly.

---

## F. Severity summary

**C0 — exploitable or data-loss**
A1 (session secret fallback)

**C1 — breaks in production**
A2, B1, C1, C2, C4, D1

**C2 — degrades or misleads**
A3, A4, A5, A6, B2, C3, C5, C6, C7, D2, D3

**No action**
D4

---

## G. What this audit did not cover

Stated so the gaps are known rather than assumed absent:

- `services/import.ts` — CSV import size limits, row caps, and DoS characteristics were not read in
  detail. Fixture names suggest reasonable coverage (`bad-encoding`, `duplicate-id`,
  `version-mismatch`, `three-bad-rows`).
- Database indexing and query plans under load.
- Frontend accessibility (keyboard navigation, contrast, screen-reader behaviour).
- Dependency vulnerability scanning.
- The `mockup-sandbox` package, which appears to be a design prototype rather than shipped code.
- Load/performance characteristics at realistic classroom concurrency.
