# Measurement Environment — Pinned Config + Teardown Runbook (M3.1 Step 1)

**Status: DRAFT for MP-2 approval. Nothing here is provisioned yet.** This is the
artifact the MP-2 checkpoint approves (measurement plan Phase 3, Task M3.1 Step 2).
No `provision-env.sh` runs, no Render resource is created, until MP-2 is recorded
in `docs/CHANGELOG-implementation.md`.

The isolated environment exists to run the Phase 3 load harness against a **real,
A-carrying** deployment without touching production (`nos-api`/`nos-studio`/
`nos-postgres`) or production user data. It is disposable scaffolding with a named
teardown owner and a dated cost snapshot.

---

## 1. Pinned configuration (proposed — MP-2 ratifies or amends)

| Item | Proposed pinned value | Notes / open decision |
|---|---|---|
| **Application SHA** | `9291eae` (Bundle A, currently live on prod `nos-api`) | The env must carry Option A. `9291eae` is the deployed A tip; `A-land-main` also has `ac10977` (boot-error logging) + `3ed41bb` (docs). **Decision:** pin the deployed `9291eae` for prod parity, or `3ed41bb` to include the boot-logging fix. Whichever is pinned is the single `app_sha` used for calibration, prediction and authoritative runs (M2.1b / M3.4b / M5.2). |
| **Dataset version** | current six models under `solvers/` at the pinned SHA | p-median-us, p-median-brazil, transport-coal, two-echelon-gold-au, two-echelon-jade-us, chens-cosmetics-cn |
| **Region** | `oregon` | Matches prod `nos-postgres`; keeps load-generator↔API↔DB latency representative |
| **API service** | new Render **web service**, runtime `docker` (`./Dockerfile`), name `nos-measure-api` | Separate from prod `nos-api` (`srv-d9hglg6…`) |
| **API compute plan** | `standard` (baseline representative run) | **Decision:** prod runs `starter` (0.5 vCPU / 512 MB) — too small to load-test CBC honestly. Phase-2 sizing showed ≈1.4–2.2 cores needed, so propose `standard` (1 vCPU / 2 GB) as the pinned **representative** plan. The M5.2 topology sweep separately measures the high-core vertical (≤ `12c-96g`), one dedicated worker, and a horizontal fleet (≤ 100 instances) — those plans are pinned in their own run manifests, not here. |
| **Instance count** | 1 (representative baseline) | Fixed; never rely on preview-env autoscaling (plan M5.2) |
| **Database** | new Render Postgres, plan `basic-256mb`, name `nos-measure-postgres` | Separate instance from prod (`dpg-d9hg4bmp…`); prod-parity plan. **Decision:** bump to `basic-1gb` if 50-cohort + 7 500 all-JADE cold inputs + `solve_jobs`/`result_cache` growth over a 3 h soak needs headroom. |
| **Cache namespace** | the measurement DB's own `result_cache` table (physically separate DB = separate namespace) | No shared cache with prod by construction |
| **Env vars** | `DATABASE_URL`→measure-postgres; `PORT`; `SOLVER_V2_WRITE_ENABLED` **unset (OFF)**; `POSTHOG_API_KEY` **unset**; `POSTHOG_HOST` unset; `SENTRY_DSN` **unset** | Analytics/alerts OFF (M3.1 Step 3 asserts both absent after boot). Measure the shipped default path (flag OFF), matching what students run today. |
| **Load generator** | Render one-off job / short-lived service in `oregon` (same region as the API) | **Decision:** same-region driver keeps `api_overhead_sec` (M3.3a) and end-to-end latency free of WAN noise. A local-machine driver is acceptable for **exploratory shakedown only** (labelled non-authoritative), not for the authoritative open-loop runs (the 99%-achieved-rate gate, M3.3 Step 5). |
| **Teardown owner** | **product owner (Shubham)** — CONFIRM at MP-2 | A named human who owns deleting the resources when measurement ends |

## 2. Isolation guarantees (M3.1 Step 6)

- Distinct Render service id, database id, and DB name from every prod resource — asserted before any run.
- A sentinel write/read is confined to `nos-measure-postgres` only.
- **No production user identity is ever read or copied** to "prove" non-overlap — that would import the very data the isolation avoids. Isolation is proven by distinct identifiers + a measurement-DB-only sentinel, not by comparing against prod rows.
- 50 synthetic users are created via the real `POST /auth/register`; credentials/cookies live only in gitignored, permission-restricted temp storage — **never committed** (M3.1 Step 5).

## 3. Teardown procedure (owner-run when measurement completes)

1. Delete the disposable worker prototype first if one exists (M5.1), verifying its queue namespace is empty.
2. Delete `nos-measure-api` (Render service) → confirm it no longer appears in `list_services`.
3. Delete `nos-measure-postgres` (Render Postgres) → confirm removal in `list_postgres_instances`.
4. Purge the gitignored session/credential temp dir.
5. Confirm no measurement resource remains billable in the workspace; record the teardown date + who ran it in `docs/CHANGELOG-implementation.md`.
6. Prod `nos-api`/`nos-studio`/`nos-postgres` are never touched by any teardown step.

## 4. Cost snapshot (dated 2026-09-24; verify live Render pricing before approving)

Approximate monthly list prices (US), prorated for a short-lived (days-scale) measurement env:

| Resource | Plan | ~Monthly | Notes |
|---|---|---|---|
| `nos-measure-api` | `standard` (1 vCPU / 2 GB) | ~$25/mo | representative baseline; only while running |
| `nos-measure-postgres` | `basic-256mb` | ~$7/mo | prod-parity |
| M5.2 topology sweep (separate, later) | high-core vertical (≤12c-96g), 1 worker, ≤100-inst fleet | **materially higher, short-lived** | priced per-candidate in each run manifest at MP-3; NOT part of this baseline snapshot |

**These are estimates from memory, not a live quote — a current Render price check is part of the MP-2 approval.** The baseline (standard API + basic-256mb DB), if torn down within days, is single-digit-to-low-tens of dollars; the topology sweep is the expensive part and is separately gated at MP-3.

---

## 5. MP-2 checkpoint (the question this artifact exists to support)

> **Measurement needs an isolated Render environment — separate database, separate
> cache namespace, synthetic identities, analytics/alerts disabled, named teardown
> owner, dated cost snapshot. Approve provisioning and its teardown plan?**

Recorded answer (UTC date + decider + this artifact reference) goes in
`docs/CHANGELOG-implementation.md` **before** `provision-env.sh` runs (M3.1 Step 2 → Step 3).
