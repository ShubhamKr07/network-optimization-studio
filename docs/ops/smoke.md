# Post-deploy smoke checks

`pnpm smoke --env production` runs, from outside Render, one named check per documented
silent-failure point that a green build cannot catch. Run it **after every production deploy** of
`nos-api` or `nos-studio` (and whenever a deploy touches CORS, cookies, the API base URL, the DB, or
the solver container). It appends a row per service to `docs/superpowers/metrics/deploys.csv` and
exits non-zero on any hard failure.

## Usage

```bash
pnpm smoke --env production
# override targets (defaults are operational, not canonical):
pnpm smoke --env production --api-base https://nos-api-xxxx.onrender.com --studio-base https://nos-studio.onrender.com
NOS_API_BASE=http://localhost:3001 NOS_STUDIO_BASE=http://localhost:5174 pnpm smoke --env preview
```

Target resolution order: `--api-base`/`--studio-base` flags → `NOS_API_BASE`/`NOS_STUDIO_BASE` env →
the current live fallback (`https://nos-api-uwf8.onrender.com` / `https://nos-studio.onrender.com`).
The fallback lives in `scripts/src/deploy/smoke.ts`'s `DEFAULTS` with a pointer back to this doc; it is
a documented default, not immutable project state.

## What each check guards (cross-refs CLAUDE.md "Gotchas" + the R0.x migration)

| check | guards | asserts |
|-------|--------|---------|
| `free_tier_wakeup` | Starter-tier cold start | health responds; **warns** (not fails) if > 10s |
| `cors_preflight` | R0.2 open-CORS / cross-site block | OPTIONS from the studio origin echoes that exact origin + `allow-credentials: true` |
| `cookie_attributes` | R0.3 cross-site cookie | register sets a cookie with `Secure; SameSite=None` in production |
| `fetch_credentials` | R0.4 credentialed fetch | the captured cookie authenticates `GET /api/auth/user` → 200 |
| `postgres_tls` | R0.1 managed-PG TLS / schema-never-pushed | `/api/healthz` reports `db:"ok"` (a real `SELECT 1`) |
| `vite_env_baked` | R0.6 build-time env | the studio JS bundle contains the real API host, not the `VITE_API_BASE_URL` placeholder |
| `python_solver_present` | solver missing in the Docker image | create → solve (async) → poll ≤30s → envelope `optimal`, positive objective, non-empty edges |

`python_solver_present` proves the solver is **present and produces an optimal solve**, not that the
objective matches the textbook — exact accuracy is `e2e_accuracy.py`'s job (it must never regress).

## Notes

- The run registers a disposable `smoke+…@example.com` account and deletes the scenario it creates;
  the account itself is not deletable via the API and is harmless.
- A `warn` (e.g. slow cold start) does not fail the run or the service rollup.
