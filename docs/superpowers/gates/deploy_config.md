# Gate proposal: deploy_config

**Symptom:** the two services and the database are deployed or migrated in an
order that leaves the system internally inconsistent, in a way nothing in the
repo checks and nothing in the deploy tooling enforces.

**Occurrences:**

- 2026-07-24 `R0.9` — existing row, `gate_proposed` empty. `nos-studio` was
  created via MCP rather than a Blueprint apply and shipped with **no SPA
  fallback rewrite**, so every client-side route 404'd in production while `/`
  worked.
- 2026-10-09 `CH4O-P1` — the migration/deploy ordering was written for **two**
  moving parts when there are **three**. `nos-studio` was never placed in the
  order, and new-studio-against-old-API is the *default* outcome of a push to
  `main` (the `nos-api` commit webhook has not been observed to fire, so a push
  arms both and starts neither — then whichever is triggered first wins). That
  is a 422 window on every Chapter 4 save, with a cause the runbook did not
  list, so it would have been misdiagnosed as a failed migration.

- 2026-10-10 `PWR` — **a required environment variable was absent and nothing
  noticed.** `RESEND_API_KEY` was never set on `nos-api`, so password reset
  shipped broken. The endpoint still answered `200` by design (anti-enumeration
  means a success response is deliberately not evidence of delivery), the
  student was told "a reset link is on its way", and the only trace was a single
  Sentry event. It stayed invisible until a human tried to reset a password.
  Nothing in this proposal's existing four checks would have caught it, because
  they all reason about *which services and migrations* the diff requires, not
  about *whether the target service has the configuration the new code reads*.
- 2026-10-10 `PWR` — **a schema push ran against local dev and never against
  production.** This one IS covered by check 1 below, which was drafted on
  2026-10-09 and is still not enabled. The deploy shipped code whose
  `select()` enumerates every schema column against a table missing two, and
  **every** `users` query 500'd for ~13 minutes — `GET /api/auth/user` runs on
  every page load, so the whole app, not the new feature. A gate that exists as
  an unapproved draft is worth exactly as much as no gate, and this is the
  evidence.

**The common mechanism:** the deploy surface is **inferred rather than
measured**, and the ordering constraint lives only in prose. Two concrete
inference failures are already on record in `CLAUDE.md`: deciding
"frontend-only" from a pathspec over `artifacts/api-server lib/db lib/api-spec`
(which missed `solvers/*/manifest.json` and shipped a stale model name), and
trusting an MCP tool's parameter list as the complete requirements picture for a
resource type.

**Proposed automated gate — a `pnpm deploy:preflight <base>..<head>` script
that prints a required-action list and exits non-zero until each is confirmed:**

1. **Derive the deploy surface by measurement, no pathspec.** Diff the full
   range and map changed paths to services:
   - `artifacts/api-server/**`, `lib/**`, **`solvers/**`** → `nos-api`
     (`solvers/*/manifest.json` is read at boot by `registry/modelRegistry.ts`
     and baked in by `Dockerfile`'s `COPY . .`)
   - `artifacts/studio/**`, `lib/api-client-react/**`, `lib/units/**` → `nos-studio`
   - `lib/db/src/schema/**` → flag for `drizzle-kit push`, **but diff it**: a
     comment-only change (as in CH4O) needs no push.
2. **Detect a required data migration** by looking for added files under
   `artifacts/api-server/src/migrations/` in the range, and refuse to report
   "ready" until the operator confirms it has run.
3. **Enforce the order** by checking live state rather than trusting the
   trigger: before reporting `nos-studio` ready, assert via `get_deploy` /
   `list_deploys` that `nos-api`'s **live** deploy is on the target SHA.
4. **Verify a non-root route after a static-site deploy.** Root always has a
   matching file regardless of rewrite config, so a root-only check cannot catch
   a missing SPA fallback — the R0.9 lesson. Require at least one nested route
   returning 200 with `#root`.

5. **Assert that required environment variables exist on the target service,
   derived from the code rather than from a hand-kept list.** Grep the deploy
   range for newly-read `process.env.X` keys, and refuse to report "ready" until
   each is confirmed present on the service it is read by. The PWR occurrence is
   the argument for deriving it: a hand-maintained list would not have contained
   `RESEND_API_KEY` either, because the person who forgot to set the variable is
   the same person who would have had to add it to the list. Note the Render MCP
   has no read path for env-var values (only a merge-write), so the check can
   confirm presence via the Dashboard or by an operator attestation — but it must
   name the specific variables rather than asking "is config done?".

   A cheaper partial that does not need the preflight script and is already
   shipped as `PWR-FU4`: a **boot-time** log naming each missing variable and its
   consequence. That turns an invisible gap into a visible one at deploy time
   without blocking a deploy, and is the right severity for config whose absence
   degrades a non-core feature. It is not a substitute for check 5, because
   nobody reads boot logs on a green deploy.

**Review note (2026-10-11, CH4OS-ship) — gap in check 1's path→service map.**
The map above covers source directories only. Root build inputs are missing, so
a change to any of them would be reported as "no deploy needed":

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` → **both**
  services. Both builds run `pnpm install --frozen-lockfile` from the repo root
  (`Dockerfile:18` for `nos-api`; `render.yaml:76` buildCommand for `nos-studio`),
  so a dependency or workspace change alters both built artefacts.
- `tsconfig.base.json` → **both** services. It is extended by both
  `artifacts/api-server/tsconfig.json` and `artifacts/studio/tsconfig.json` (and
  every `lib/*` package they build), so a compiler-option change alters both builds.
- `Dockerfile` → **`nos-api` only** (`render.yaml:5` `dockerfilePath`; `nos-studio`
  is `runtime: static` and never reads it).
- `render.yaml` → **not a code deploy but a config sync**, and asymmetric:
  `nos-api` follows the Blueprint, while `nos-studio` is Dashboard-managed
  (`render.yaml:72`), so a `render.yaml` change for it must be repeated by hand in
  the Dashboard or it silently does nothing. The preflight should print that as
  its own required action rather than mapping the file to a deploy.

The rule is "every file the two build commands read", not a fixed list — derive
it from `Dockerfile` and `render.yaml`'s `buildCommand` when the script is written,
so a new root input does not reopen this gap.

**How to enable:** new script under `scripts/harness/`, exposed as
`pnpm deploy:preflight`, referenced from the Branch discipline section of
`CLAUDE.md` as a required step before any deploy approval is requested. It
reports; it must not trigger deploys itself, since deploying is a separately
approved action.

**Approved scope (2026-10-12).** The trimmed version is built as `pnpm deploy:preflight -- <base>..<head>`
(`scripts/src/deploy/preflight.ts`): check 1 (with the root-file fix above, from a fixed list guarded by a
test that each file exists), 1a (schema diff, comment-only detection), 2 (added migration files), 4 (as
`--verify-studio <url>`, exit non-zero on failure) and 5 (new `process.env.X` / `import.meta.env.VITE_X` /
Python `os.environ.get("X")` / `os.environ["X"]` / `os.getenv("X")` reads, per service). Check 3 (order) is printed as an operator step, not enforced. Dropped from the proposal: "exits
non-zero until confirmed" (it keeps no persisted state, so there is nothing to confirm against) and the
Render API (no new credential). It reports only and never deploys.

**Status:** approved (trimmed version) 2026-10-12 — enabled as pnpm deploy:preflight
