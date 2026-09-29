# Stale e2e specs (surfaced by the OBS-3 flake audit, 2026-09-11)

The frozen-commit flake audit (`bash scripts/harness/flake-audit.sh --runs 20`, sha `4be058f`) found
**23/36 gate specs stable, 2 flaky, 11 broken**. Investigation (checkpoint #3, "investigate now")
root-caused **all 11 broken specs to test-rot** — later bundles changed testids / header text /
interaction flows, and these older specs were never updated because **e2e is not in CI** and the full
suite wasn't re-run after Bundle 4 / Input Map v2 / Bundle 6 / Phase 3.2. The application is live and
correct; the specs drifted.

This is exactly what the self-monitoring harness exists to surface: a repo that looked green (unit
tests pass, e2e never run) was hiding 11 rotted e2e tests.

## The 2 genuinely flaky (quarantined `@flaky`)

Intermittent, not broken — quarantined from `pnpm e2e:gate`, still run via `pnpm e2e:quarantine`:

| rate | spec › test |
|------|-------------|
| 1/20 | `bundle6.1-legend-distances.spec.ts › p-median-us: one merged table…` |
| 2/20 | `bundle6.1-legend-distances.spec.ts › Leg distances tab renders the restyled table…` |

## The 11 broken (test-rot — NOT flaky, NOT product bugs)

Not quarantined (quarantine would mask consistent failures). Each needs a selector/flow update:

| spec › test | rotted anchor | root cause / owning change |
|-------------|---------------|----------------------------|
| `import.spec.ts › export→edit one demand→import` | `getByText(/Al's Athletics · Model Lab/)` | Studio retired; chapter routes render Workspace (Bundle 6). Header text gone. |
| `design-system.spec.ts › auth chrome` | `getByTestId('auth-band')` | Bundle 4 AuthShell renamed → `auth-cover`/`auth-shell`/`auth-labs-strip` (0 src refs for `auth-band`). |
| `design-system.spec.ts › workspace chrome` | `div.flex.items-center.gap-1` hasText `Band 1` | brittle CSS-class selector no longer matches the current DOM. |
| `tab-coverage.spec.ts › p-median-us` | `getByTestId('input-map-draft-panel')` | Input Map v2 replaced the draft-panel with `CreateEntityDialog`/`MapDetailsCard` (0 src refs). |
| `tab-coverage.spec.ts › transport-coal` | `input-map-draft-panel` | same (Input Map v2). |
| `tab-coverage.spec.ts › two-echelon-gold-au` | `input-map-draft-panel` | same (Input Map v2). |
| `two-echelon.spec.ts › BOM sweep + Compare diff` | `button-scenario-dropdown` | Bundle 6 removed the header scenario dropdown (sidebar-only switching); Compare page removed (Phase 3.2). |
| `input-map-v2.spec.ts › add on map→Save→toast→solve` | `badge-distance-estimated-…` | estimated-distance flow/seed drifted (testid still exists; path to it changed). |
| `input-map-v2.spec.ts › marker right-click / ghost copy / move` | `create-entity-dialog` | map-first edit interaction flow drifted. |
| `workspace-ux-r1-r9.spec.ts › p-median-us R1-R9 + compare` | `cost-summary-compare-open-facilities-<id>` | seed-coupled id + Bundle 6 Solution Summary compare rework. |
| `bundle2-fastfollow.spec.ts › add mine+station→Solve` | `expect(...).toContain(...)` | generated lane-cost content assertion drifted. |

## Proposed gate (checkpoint #5 — DECISION: SKIP for now)

11 occurrences of cause `spec_gap` in one audit (all logged in `failures.csv`, `gate_proposed=pnpm
e2e:gate in CI`). The harness rule (a cause twice → propose a gate) is decisively tripped. The
proposed gate was **adding `pnpm e2e:gate` to `.github/workflows/ci.yml`**. **Human decision
(2026-09-12): SKIP** — CI has no Playwright-browser / app-boot / seed infrastructure, so this is a
substantial infra build, not a one-line gate, and it would be red on the 11 stale specs regardless.
The `failures.csv` rows keep `gate_proposed=pnpm e2e:gate in CI` as the record; enabling it is a
separate future effort gated on (a) building the CI e2e infra and (b) repairing the 11 specs below.

## Recommended follow-up (separate task, not part of the harness build)

Repair the 11 specs (update selectors/text to the current DOM; decouple from seed ids; seed solver
results instead of driving real CBC where a spec only needs a result to exist). Then enable the CI
e2e gate. Tracked here until scheduled.

---

## STATUS 2026-09-30 — both preconditions are now MET. This section supersedes the two above.

Read this before acting on anything above it; the SKIP decision's stated blockers no longer hold.

**(a) CI e2e infra — BUILT.** `.github/workflows/ci.yml` gained a `Create database schema` step
(the Postgres service had always started empty — this repo has no migration files, so every
DB-touching suite had been failing on `relation "users" does not exist`, red since at least
`4cf3bc1`) and an `e2e` job that installs Chromium, boots api-server + studio, waits for readiness,
and runs `pnpm e2e:gate`.

**(b) The 11 specs — REPAIRED.** All 11 tests across the 7 files listed above. Measured gate on the
repair branch: **53 passed / 2 failed / 4 skipped**, reproduced identically by CI, so the gate is
deterministic rather than environment-sensitive.

### The gate is still `continue-on-error: true`, deliberately

Two specs remain red and **cannot** be fixed by a spec change: `posthog-analytics.spec.ts` and
`sentry-capture.spec.ts` need `VITE_POSTHOG_KEY` / `VITE_SENTRY_DSN` as **repository secrets**. They
pass locally when those vars are set — verified — so they are an environment gap, not a defect. Do
not "fix" them in a spec, and do not tag them `@flaky`: they fail deterministically.

Flipping `continue-on-error` to `false` requires one of: adding those two secrets; a `test.skip()`
conditioned on the env var being absent (the self-healing pattern
`artifacts/studio/e2e/helpers/modelLock.ts` already uses for the locked JADE chapter); or a decision
to accept them as permanently red.

### One half of the repair mandate was NOT done — recorded, not hidden

"Seed solver results instead of driving real CBC" above was **not** carried out, and the repair moved
the other way: `input-map-v2.spec.ts`'s solve wait went 30s → 90s and `two-echelon.spec.ts` gained
`test.setTimeout(180_000)` with two real CBC solves. Reason: no result-seeding helper or test-only
seed endpoint exists anywhere in `artifacts/studio/e2e/` or `artifacts/api-server/src/routes/`, so
honouring it means building new infrastructure, not editing specs.

For `two-echelon` that is arguably correct regardless — the BOM flip point *is* the thing under test,
so a seeded result would prove nothing. For `input-map-v2` only the final step needs a result to
exist, so it is a genuine candidate. **This remains open** and directly affects `e2e:gate`
wall-clock and flake rate under the default 4-worker run.

### Also still open

`e2e/**` is outside `artifacts/studio/tsconfig.json`'s `include`, so `pnpm run typecheck` does not
typecheck these specs at all. A typo'd testid ships undetected and the specs can silently re-rot
exactly as they did before. Consider an `e2e/` tsconfig so at least the type layer is gated.
