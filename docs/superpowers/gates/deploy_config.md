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

**How to enable:** new script under `scripts/harness/`, exposed as
`pnpm deploy:preflight`, referenced from the Branch discipline section of
`CLAUDE.md` as a required step before any deploy approval is requested. It
reports; it must not trigger deploys itself, since deploying is a separately
approved action.

**Status:** proposed — awaiting human approval (not enabled)
