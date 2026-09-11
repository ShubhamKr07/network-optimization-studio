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

## Proposed gate (checkpoint #5 — pending human approval)

11 occurrences of cause `spec_gap` in one audit (all logged in `failures.csv`, `gate_proposed=pnpm
e2e:gate in CI`). The harness rule (a cause twice → propose a gate) is decisively tripped. **Proposed
gate: add `pnpm e2e:gate` to `.github/workflows/ci.yml`** so a DOM/testid/text change that rots a spec
fails CI instead of silently rotting. Not enabling until (a) the 11 specs are repaired and the gate
lane is green, and (b) the human approves — otherwise CI would be red on day one.

## Recommended follow-up (separate task, not part of the harness build)

Repair the 11 specs (update selectors/text to the current DOM; decouple from seed ids; seed solver
results instead of driving real CBC where a spec only needs a result to exist). Then enable the CI
e2e gate. Tracked here until scheduled.
