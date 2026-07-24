# Render Migration (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Network Optimization Studio from local-only/Replit-only development to a real deployed environment on Render (Docker web service for the API+solver, static site for the frontend, managed Postgres), without changing any product behavior.

**Architecture:** Three Render resources mapped 1:1 to the app's real technical concerns — `nos-api` (Docker web service running Express + the Python/PuLP solver via the existing async worker pool), `nos-studio` (static site serving the built Vite/React frontend), `nos-postgres` (managed Postgres). No new queue/broker service — the existing in-process async solve dispatcher (`jobRunner.ts`) needs nothing added to run inside `nos-api` as-is.

**Tech Stack:** Docker (`node:24-slim` base + `python3`/`pulp`), Render Blueprint (`render.yaml`), Express 5, Postgres 16, Vite/React static build.

## Global Constraints

- Don't touch `attached_assets/`, `.replit`, `replit.md`, or `push-to-github.mjs` (CLAUDE.md hard rule — Replit stays intact as a fallback deploy target; nothing in this plan requires touching it).
- This is infrastructure-only: no product behavior changes, no scenario/solve logic changes, no DB schema changes.
- Every task's code changes must keep local development working unchanged (all new behavior is gated on `NODE_ENV === "production"` or an env var that's unset locally).
- Full verification gate must stay green after every task: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`.
- One task = one commit, message format `[R0.x] <imperative summary>` (this repo's established convention).

---

## Reconciliation notes (this plan vs. the originally-uploaded `NETWORK_MIGRATION_PLAN.md`)

`NETWORK_MIGRATION_PLAN.md` (repo root, merged from `origin/main`) was written against an earlier state of this codebase, before Phases 3.5–6 of `IMPLEMENTATION_PLAN.md` landed. Every technical claim in it was re-verified against the actual current repo (commit `24ad23e` at time of writing) before this plan was drafted. Corrections:

- **Solve dispatch is no longer `pmedian.ts`'s `spawnSync`.** Phase 3.5 (G3.1) replaced it with an async worker pool in `artifacts/api-server/src/solver/jobRunner.ts`, using `spawn` (not `spawnSync`) — confirmed `spawnSync` no longer appears anywhere in `artifacts/api-server/src`. The underlying Docker requirement is unchanged (Python + `pulp` must be importable in the same container as the Node process, since `jobRunner.ts` still shells out to `python3 solve.py`), so Task R0.5 below is materially the same as originally proposed, just correctly attributed to `jobRunner.ts`.
- **The session cookie is `nos_session` (`SESSION_COOKIE` constant), not `USER_COOKIE`.** Defined in `artifacts/api-server/src/middlewares/auth.ts:3`; set via `setSessionCookie()` and cleared via `res.clearCookie()`, both in `artifacts/api-server/src/routes/auth.ts`. Still hardcodes `sameSite: "lax"` with no `secure` option — the underlying G1/G3 problem (lax cookies aren't sent cross-site on fetch/XHR) is unchanged, so R0.3 is still needed, just against the correct file/function.
- **Password hashing is `argon2`** (`argon2@^0.41.1`, already a real dependency, already in use in `routes/auth.ts`) — not a pending decision between argon2/bcryptjs as the original doc's risk table implied. R0.5's Dockerfile still needs `build-essential` for argon2's native bindings to compile in the image.
- **`GET /api/healthz` already exists** (`artifacts/api-server/src/routes/health.ts`, returns `{"status":"ok"}`) — confirmed, no new task needed to create it; R0.5's/render.yaml's health-check references are accurate as originally proposed.
- **CORS, DB pool (no `ssl` option), `vite.config.ts`'s `PORT`/`BASE_PATH` requirement, `custom-fetch.ts` (no `credentials` set, `setBaseUrl` exists but is never called), Node 24, pnpm lockfileVersion `9.0`, and the API's build output path (`artifacts/api-server/dist/index.mjs`, via `build.mjs`)** — all confirmed exactly as the original doc described. R0.1, R0.2, R0.4, R0.5, and R0.6 are otherwise unchanged from the original proposal.
- **Not independently re-verified:** the specific `pulp==3.3.2` version pin proposed for the new `requirements.txt` (R0.5) — this is inherited from the original doc's own testing note. This sandbox has no network access to build/test a Docker image, so this pin should be spot-checked against PyPI before the first real Render deploy, but is a reasonable starting point (this repo's own CI installs unpinned `pulp` today via `pip install pulp pytest`, so pinning is a strict improvement, not a regression).

---

## File Structure

New files this plan creates:
- `Dockerfile` (repo root) — builds `nos-api`'s image (Node + Python + built `api-server`).
- `.dockerignore` (repo root) — keeps the Docker build context small.
- `artifacts/api-server/src/solver/requirements.txt` — pins the solver's Python dependency for the deployed image only (CI's own `pip install pulp pytest` step is untouched).
- `render.yaml` (repo root) — Render Blueprint describing all three services.
- `.node-version` (repo root) — pins Node for `nos-studio`'s (non-Docker) static-site build.

Modified files:
- `lib/db/src/index.ts` — conditional TLS for the Postgres pool (R0.1).
- `artifacts/api-server/src/app.ts` — CORS allowlist instead of reflect-all (R0.2).
- `artifacts/api-server/src/routes/auth.ts` — environment-driven cookie `sameSite`/`secure` (R0.3).
- `lib/api-client-react/src/custom-fetch.ts` — default `credentials: "include"` (R0.4).
- `artifacts/studio/src/main.tsx` — wire `setBaseUrl` from a Vite env var (R0.4).
- `README.md` — short "Deploying" section pointing at this plan (R0.7, optional).

No files are deleted. No DB schema changes.

---

## Task R0.1: Postgres TLS

**Files:**
- Modify: `lib/db/src/index.ts:13`
- Test: `lib/db/src/__tests__/pool.test.ts` (new)

**Interfaces:**
- Consumes: `process.env.DATABASE_URL` (existing), `process.env.NODE_ENV` (existing, already read elsewhere in this codebase e.g. `app.ts`).
- Produces: no change to `pool`'s exported type (`pg.Pool`) or `db`'s exported type (`drizzle` instance) — this task only changes the `Pool` constructor's runtime options.

- [ ] **Step 1: Write the failing test**

Create `lib/db/src/__tests__/pool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPoolCtor = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  default: { Pool: mockPoolCtor },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({})),
}));

describe("db pool SSL configuration", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgresql://localhost/test" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("does not set ssl when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    await import("../index.js");
    expect(mockPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: undefined }),
    );
  });

  it("sets ssl with rejectUnauthorized:false when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    await import("../index.js");
    expect(mockPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/db test -- pool.test.ts`
Expected: FAIL — `mockPoolCtor` was called with `{ connectionString: ... }` only, no `ssl` key, so `expect.objectContaining({ ssl: undefined })` still technically matches (an absent key vs. an explicit `undefined` value both satisfy `objectContaining` in vitest) — so instead expect the SECOND assertion (production case) to fail, since `ssl` is never set at all today regardless of `NODE_ENV`. Confirm the production-case test fails with something like `expected Pool to have been called with ... "ssl": {"rejectUnauthorized": false} ... but it was called with { connectionString: ... }` (no `ssl` key present).

- [ ] **Step 3: Write minimal implementation**

Edit `lib/db/src/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/db test -- pool.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test`
Expected: both green (this change is in a shared `lib/db` package `api-server` depends on — confirm nothing downstream broke).

```bash
git add lib/db/src/index.ts lib/db/src/__tests__/pool.test.ts
git commit -m "[R0.1] Conditional Postgres TLS for production"
```

---

## Task R0.2: CORS allowlist

**Files:**
- Modify: `artifacts/api-server/src/app.ts:37`
- Test: `artifacts/api-server/src/__tests__/cors.test.ts` (new)

**Interfaces:**
- Consumes: new env var `CORS_ALLOWED_ORIGIN` (comma-separated list of allowed origins), existing `process.env.NODE_ENV`.
- Produces: no change to `app`'s exported type (`Express`) — only changes the `cors()` middleware's runtime `origin` option.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/__tests__/cors.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

describe("CORS origin handling", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("reflects any origin when NODE_ENV is not production (unchanged local-dev behavior)", async () => {
    process.env.NODE_ENV = "development";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "http://anything.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("http://anything.example.com");
  });

  it("allows an origin present in CORS_ALLOWED_ORIGIN when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGIN = "https://nos-studio.onrender.com,https://other.example.com";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "https://nos-studio.onrender.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://nos-studio.onrender.com");
  });

  it("rejects an origin NOT present in CORS_ALLOWED_ORIGIN when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGIN = "https://nos-studio.onrender.com";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api-server test -- cors.test.ts`
Expected: FAIL on the last two tests — today's `cors({ origin: true })` reflects `https://evil.example.com` back too, since it always reflects whatever `Origin` header it receives regardless of `NODE_ENV`.

- [ ] **Step 3: Write minimal implementation**

Edit `artifacts/api-server/src/app.ts`:

```ts
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const COOKIE_SECRET = process.env.SESSION_SECRET || "arcadia-dev-secret";

const app: Express = express();

// This is a stateful JSON API (auth, live scenario/solve-job data), not
// cacheable content. Express's default weak ETags turn identical repeat GETs
// (e.g. solve-job polling) into 304 Not Modified — which customFetch treats
// as an error, not "reuse your cached data" — corrupting the poll loop.
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// In production the API and frontend are different Render services (
// different origins), so an explicit allowlist is required — reflecting
// every origin (today's behavior) would be an open credentialed CORS
// policy once the API has a real public hostname. Local dev keeps the
// permissive reflect-all behavior unchanged.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin: process.env.NODE_ENV === "production" ? allowedOrigins : true,
  }),
);
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api-server test -- cors.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test`
Expected: both green.

```bash
git add artifacts/api-server/src/app.ts artifacts/api-server/src/__tests__/cors.test.ts
git commit -m "[R0.2] Production CORS allowlist via CORS_ALLOWED_ORIGIN"
```

---

## Task R0.3: Cross-origin cookie flags

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts:42-51` (`setSessionCookie`), `:110` (`clearCookie` call in `/auth/logout`)
- Test: `artifacts/api-server/src/__tests__/auth.test.ts` (extend existing file)

**Interfaces:**
- Consumes: existing `process.env.NODE_ENV`, existing `SESSION_COOKIE`/`SESSION_TTL_MS` imports from `../middlewares/auth.js` (unchanged).
- Produces: no change to `setSessionCookie`'s signature (`(res: Response, userId: string) => void`) — only the cookie options object changes at runtime.

- [ ] **Step 1: Write the failing test**

Add to `artifacts/api-server/src/__tests__/auth.test.ts` (inside the existing `describe("POST /api/auth/register", ...)` block, or as a new top-level `describe` — place it as a new top-level block right after the existing register tests):

```ts
describe("session cookie flags by environment", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("sets SameSite=Lax and no Secure flag outside production", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "development" };
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-2", email: "dev@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "dev@example.com", password: "supersecret" });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("sets SameSite=None and Secure in production", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-3", email: "prod@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "prod@example.com", password: "supersecret" });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/SameSite=None/i);
    expect(setCookie).toMatch(/Secure/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api-server test -- auth.test.ts`
Expected: FAIL on the second new test — today's `setSessionCookie` always sets `sameSite: "lax"` and never sets `secure`, regardless of `NODE_ENV`.

- [ ] **Step 3: Write minimal implementation**

Edit `artifacts/api-server/src/routes/auth.ts`, replacing `setSessionCookie` and the logout handler's `clearCookie` call:

```ts
function setSessionCookie(res: Response, userId: string) {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, userId, {
    httpOnly: true,
    signed: true,
    sameSite: crossOrigin ? "none" : "lax",
    secure: crossOrigin,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}
```

And in the `/auth/logout` handler, the clearing cookie's attributes must match the setting cookie's, or browsers won't clear it:

```ts
router.post("/auth/logout", (_req: Request, res: Response) => {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: crossOrigin ? "none" : "lax",
    secure: crossOrigin,
  });
  res.json(LogoutUserResponse.parse({ success: true }));
});
```

(Keep the rest of the logout handler — the response body construction — exactly as it is today; only the `clearCookie` options object changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api-server test -- auth.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test`
Expected: both green.

```bash
git add artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/__tests__/auth.test.ts
git commit -m "[R0.3] Environment-driven session cookie SameSite/Secure flags"
```

---

## Task R0.4: Cross-origin frontend wiring

**Files:**
- Modify: `lib/api-client-react/src/custom-fetch.ts:363`, `artifacts/studio/src/main.tsx`
- Test: `lib/api-client-react/src/__tests__/custom-fetch.test.ts` (check if a test file for `custom-fetch.ts` already exists — if so extend it; if not, create it)

**Interfaces:**
- Consumes: new Vite env var `VITE_API_BASE_URL` (build-time, via `import.meta.env`), existing `setBaseUrl(url: string | null): void` export from `custom-fetch.ts` (already exists, currently unused anywhere in `studio`).
- Produces: no change to `customFetch`'s exported signature — only its default `credentials` behavior changes when the caller doesn't explicitly pass one.

- [ ] **Step 1: Check for an existing custom-fetch test file**

Run: `ls lib/api-client-react/src/__tests__/ 2>/dev/null || find lib/api-client-react -iname "*custom-fetch*test*"`

If a test file exists, read it first to match its existing mocking conventions before adding to it. If none exists, create `lib/api-client-react/src/__tests__/custom-fetch.test.ts` with the test below as its full initial content (adjust the relative import path if this package's `src/` layout differs from what's assumed here — confirm via `ls lib/api-client-react/src/`).

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { customFetch } from "../custom-fetch.js";

describe("customFetch default credentials", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  it("defaults credentials to 'include' when the caller doesn't specify one", async () => {
    await customFetch("/api/whatever");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("include");
  });

  it("respects an explicit credentials value if the caller passes one", async () => {
    await customFetch("/api/whatever", { credentials: "omit" } as RequestInit);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("omit");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-client-react test -- custom-fetch.test.ts`
Expected: FAIL on the first test — `init.credentials` is currently `undefined` (never set) unless the caller passes it explicitly.

- [ ] **Step 4: Write minimal implementation**

Edit `lib/api-client-react/src/custom-fetch.ts`, in `customFetch`'s body where it currently calls `fetch`:

```ts
  const response = await fetch(input, {
    ...init,
    method,
    headers,
    credentials: init.credentials ?? "include",
  });
```

(This replaces the existing `const response = await fetch(input, { ...init, method, headers });` line — everything else in `customFetch` is unchanged.)

Then wire the base URL at frontend startup. Edit `artifacts/studio/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? null);

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-client-react test -- custom-fetch.test.ts`
Expected: PASS (2/2)

- [ ] **Step 6: Confirm the studio test suite and a local build are unaffected**

Run: `pnpm --filter studio test`
Expected: unaffected (no `VITE_API_BASE_URL` is set in the test environment, so `setBaseUrl(null)` runs, which is a no-op per its existing implementation — same as before this task).

Run: `PORT=5183 BASE_PATH=/ pnpm --filter studio run build`
Expected: succeeds, confirming a local build with `VITE_API_BASE_URL` unset still works exactly as before (this is also explicitly checked again at the end of R0.6/R0.9 against the real deployed build).

- [ ] **Step 7: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`
Expected: all green.

```bash
git add lib/api-client-react/src/custom-fetch.ts lib/api-client-react/src/__tests__/custom-fetch.test.ts artifacts/studio/src/main.tsx
git commit -m "[R0.4] Cross-origin fetch credentials + frontend base URL wiring"
```

---

## Task R0.5: Dockerfile for `nos-api`

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)
- Create: `artifacts/api-server/src/solver/requirements.txt`

**Interfaces:**
- Consumes: `artifacts/api-server`'s existing `build`/`start` scripts (`node ./build.mjs`, `node --enable-source-maps ./dist/index.mjs`), confirmed build output at `artifacts/api-server/dist/index.mjs`.
- Produces: a Docker image that `render.yaml` (R0.6) references via `dockerfilePath`.

This task has no unit-test surface (it's a container image, not application code) — verification is a DoD checklist run against the built image, matching this repo's own convention for infra-only changes.

- [ ] **Step 1: Create the solver's production requirements file**

Create `artifacts/api-server/src/solver/requirements.txt`:

```
pulp==3.3.2
```

(`pytest` is intentionally NOT in this file — it stays a local/CI-only dev dependency, per `.github/workflows/ci.yml`'s own separate `pip install pulp pytest` step, which is unaffected by this file. Before the first real deploy, spot-check `pulp==3.3.2` is still current on PyPI — this pin is inherited from the original migration plan draft and wasn't re-verified against a live PyPI lookup in this pass.)

- [ ] **Step 2: Create the Dockerfile**

Create `Dockerfile` at the repo root:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim

# Python for the solver (artifacts/api-server/src/solver/solve.py, invoked
# via child_process.spawn from solver/jobRunner.ts's async worker pool).
# build-essential is required for argon2's native bindings (argon2@^0.41.1,
# used in routes/auth.ts) to compile during `pnpm install`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, matching pnpm-lock.yaml's lockfileVersion 9.0 -> pnpm 9.x.
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# Build only api-server and the workspace packages it depends on. This
# deliberately skips `studio` (built + deployed separately as a static site,
# see render.yaml) and avoids a monorepo-wide build inside the API image.
RUN pnpm --filter api-server... --if-present run build

RUN pip install --break-system-packages --no-cache-dir \
      -r artifacts/api-server/src/solver/requirements.txt

ENV NODE_ENV=production
# Render injects PORT at runtime and routes to it — do not hardcode it here.
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

- [ ] **Step 3: Create `.dockerignore`**

Create `.dockerignore` at the repo root:

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

- [ ] **Step 4: Verify (DoD checklist)**

If Docker is available in this environment, run:
```bash
docker build -t nos-api-test .
docker run --rm -e PORT=10000 -e DATABASE_URL=postgresql://user:pass@localhost:5432/db -e SESSION_SECRET=test-secret nos-api-test &
sleep 3 && curl -s http://localhost:10000/api/healthz
```
Expected: `{"status":"ok"}` (the container will fail to serve real DB-backed routes without a reachable Postgres, but `/api/healthz` doesn't touch the DB — confirming the server boots and this route responds is sufficient to prove the image builds and runs Node + the built app correctly).

If Docker/network access to pull `node:24-slim` is unavailable in this environment (as it was when this plan was drafted), skip the local build and instead let Render's own build serve as the first real verification (covered by R0.9's deployed checklist) — do not mark this task blocked solely because of sandbox network restrictions on `docker build`.

- [ ] **Step 5: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
Expected: all green (this task adds no application code, so the gate should be unaffected — this run just confirms nothing else regressed).

```bash
git add Dockerfile .dockerignore artifacts/api-server/src/solver/requirements.txt
git commit -m "[R0.5] Dockerfile for nos-api (Node + Python/pulp)"
```

---

## Task R0.6: `render.yaml` blueprint

**Files:**
- Create: `render.yaml` (repo root)
- Create: `.node-version` (repo root)

**Interfaces:**
- Consumes: `Dockerfile` (R0.5), `CORS_ALLOWED_ORIGIN` (R0.2), `VITE_API_BASE_URL` (R0.4), `SESSION_SECRET` (already read by `app.ts` today), `artifacts/studio`'s existing `build` script and its `PORT`/`BASE_PATH` requirement (confirmed unchanged in `vite.config.ts:9-26`).
- Produces: the Render Blueprint a human applies in R0.8.

No unit-test surface — verified via Render's own Blueprint preview, per this task's DoD.

- [ ] **Step 1: Pin Node for the static-site build**

Create `.node-version` at the repo root:

```
24
```

- [ ] **Step 2: Write `render.yaml`**

Create `render.yaml` at the repo root:

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
        value: "10000"          # unused at runtime for a static site;
                                  # vite.config.ts just needs it present
                                  # and numeric at build time (G6)
      - key: VITE_API_BASE_URL
        value: https://nos-api.onrender.com
      - key: NODE_VERSION
        value: "24"

databases:
  - name: nos-postgres
    plan: starter
    postgresMajorVersion: 16
```

`https://nos-api.onrender.com` / `https://nos-studio.onrender.com` are placeholders — Render assigns the real subdomain from each service's `name`. Update both cross-references (`CORS_ALLOWED_ORIGIN` on `nos-api`, `VITE_API_BASE_URL` on `nos-studio`) once the services exist (R0.8 — this is a chicken-and-egg on first apply, resolved by a manual dashboard edit or a `render.yaml` update + redeploy after first creation).

Confirm `artifacts/studio/dist/public` is actually the real build output path before committing this — run: `grep -n "outDir\|build:" artifacts/studio/vite.config.ts` and adjust `staticPublishPath` if the actual configured output directory differs.

- [ ] **Step 3: Verify (DoD checklist)**

In Render's dashboard: Dashboard → New → Blueprint → point at this repo → confirm the preview parses `render.yaml` without errors and shows the three expected resources (`nos-api`, `nos-studio`, `nos-postgres`) before applying it for real.

- [ ] **Step 4: Run the full gate and commit**

Run: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test`
Expected: all green (no application code touched).

```bash
git add render.yaml .node-version
git commit -m "[R0.6] Render Blueprint (nos-api, nos-studio, nos-postgres)"
```

---

## Task R0.7: README deploy section (P1, optional)

**Files:**
- Modify: `README.md` (repo root — not excluded by CLAUDE.md's hard rule, which only excludes `.replit`/`replit.md`/`push-to-github.mjs`)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a short "Deploying" section**

Append to `README.md` (check the file's existing heading structure first — run `grep -n "^#" README.md` — and place this as a new top-level `## Deploying` section, matching the existing heading style):

```markdown
## Deploying

This app deploys to Render via the Blueprint in `render.yaml` (three services: `nos-api` Docker web service, `nos-studio` static site, `nos-postgres` managed Postgres). See `docs/superpowers/plans/2026-07-24-render-migration.md` for the full rationale and task-by-task history.

One manual step after the first Blueprint apply: copy the two real `*.onrender.com` URLs Render assigns and set `CORS_ALLOWED_ORIGIN` (on `nos-api`) and `VITE_API_BASE_URL` (on `nos-studio`) to each other's real URL, then redeploy both services.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "[R0.7] Document Render deploy in README"
```

---

## Task R0.8: STOP AND ASK — human deploy step

This is not a code task. Claude Code cannot click through Render's dashboard. Once `render.yaml` (R0.6) is committed and pushed, a human needs to:

1. Create the Blueprint in Render's dashboard, pointing at this repo.
2. After first deploy, copy the two real `*.onrender.com` URLs Render assigns and set `CORS_ALLOWED_ORIGIN` (on `nos-api`) and `VITE_API_BASE_URL` (on `nos-studio`) to each other's real URL — a manual dashboard edit or a `render.yaml` update + redeploy, since the URLs don't exist until the services are first created.
3. Confirm the `nos-api` and `nos-postgres` plans are **Starter**, not Free — a solve can legitimately run up to 120s (`timeLimitSec` default) + a 15s buffer, and Render's free tier spins down on inactivity / expires Postgres after 90 days, neither acceptable for a course running a full term.
4. If a custom domain is added later, revisit R0.3 — `sameSite: "lax"` becomes usable again once both services share an apex domain, marginally more robust than `"none"`.

---

## Task R0.9: Post-deploy verification (manual, against the real deployed environment)

Not a code task — a checklist to run once R0.8 is complete:

- [ ] `GET https://nos-api.onrender.com/api/healthz` → `{"status":"ok"}`.
- [ ] From `nos-studio`'s real URL: register → login → refresh the page → still logged in (confirms the cookie survives a cross-origin round trip — the real integration test of R0.2/R0.3/R0.4 together).
- [ ] Browser devtools → Application → Cookies: the `nos_session` cookie on the `nos-api` host shows `SameSite=None; Secure`.
- [ ] A scenario solve completes within the deployed environment (confirms R0.5's Python/CBC install works and the Starter plan is active — a cold-started free instance would likely time out mid-solve).
- [ ] `PORT=5183 BASE_PATH=/ pnpm --filter studio run build` locally, with `VITE_API_BASE_URL` unset, still produces a working relative-path build (regression check for R0.4 — already run once in R0.4's own Step 6, re-run here as the final end-to-end confirmation after all tasks land).
- [ ] **`GET` at least one client-side (non-root) route directly** — e.g. `curl -o /dev/null -w '%{http_code}' https://nos-studio.onrender.com/chapter-3` → expect `200` serving `index.html`, not `404`. Root alone always has a matching static file and cannot catch a missing SPA-fallback rewrite; this is the one check that actually exercises it. (Found missing in the first real run of this checklist — see the plan's own retrospective note below before repeating that mistake.)

**Retrospective (added after first real execution):** the original version of this checklist above only checked root (`/`), which passed even though `nos-studio` had zero SPA-fallback rewrite configured — every nested client-side route 404'd in production and wasn't caught until a real user hit it post-deploy. Root cause: `nos-studio` was created directly via the Render MCP `create_static_site` tool (forced by `nos-api` needing Docker, which the same tool family can't create — see R0.8's note), and that tool's schema has no `routes`/rewrite parameter at all; the Blueprint (`render.yaml`) was never actually applied to create it, so `render.yaml`'s presence didn't help either. **Lesson for any future task that creates a Render resource type for the first time via MCP rather than a Blueprint apply: read that resource type's own `render-<type>` skill (e.g. `render-static-sites`, `render-web-services`) BEFORE creating it, specifically for Blueprint-only fields the MCP create tool's schema doesn't expose** — don't rely on the MCP tool's parameter list to be a complete picture of what the resource needs.

---

## Self-Review

**Spec coverage:** every section of `NETWORK_MIGRATION_PLAN.md` (G1-G7 problem statements, R0.1-R0.8 tasks, the env var inventory, the verification gate, the risk table, the explicit out-of-scope list) maps to a task above — R0.1 (G5), R0.2 (G3), R0.3 (G1), R0.4 (G2, G6's `vite.config.ts` requirement confirmed unchanged so no separate task needed for it), R0.5 (G4, G7's plan tier requirement folded into R0.8), R0.6 (env var inventory + Blueprint), R0.7 (docs, optional), R0.8 (human step), R0.9 (the original doc's §4 deployed-environment checklist). The original doc's §5 risk table and §6 out-of-scope list are informational, not tasks — carried into this plan's Reconciliation Notes and R0.8/R0.5 callouts rather than duplicated as their own tasks.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" found — every step has real, complete code or an exact command with expected output. R0.5/R0.6/R0.8/R0.9 have no unit-test steps because they're infra config/manual-verification tasks with no code-level test surface in this repo (matches this project's own established convention for infra-only plan tasks, e.g. `IMPLEMENTATION_PLAN.md`'s own DoD-style verification for non-code tasks).

**Type consistency:** `setSessionCookie(res: Response, userId: string): void` (R0.3) is unchanged from its current signature. `customFetch`'s signature (R0.4) is unchanged — only its default runtime behavior changes. `setBaseUrl(url: string | null): void` (R0.4) already exists with this exact signature; `main.tsx`'s new call matches it (`import.meta.env.VITE_API_BASE_URL ?? null` is `string | null`, consistent with the parameter type — Vite's `import.meta.env` values are `string | undefined`, and `?? null` correctly converts `undefined` to `null`).
