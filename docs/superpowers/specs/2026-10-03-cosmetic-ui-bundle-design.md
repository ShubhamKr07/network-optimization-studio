# Cosmetic UI bundle — design

**Date:** 2026-10-03
**Branch:** `cosmetic-ui` (worktree `/Users/shubhamkr/nos-cosmetic`, locked), branched off `main` @ `3e34364`
**Scope:** five cosmetic/UX changes, one commit each.

| # | Change | Primary surface |
|---|---|---|
| 2 | Remove the open-tab strip above the content area | `artifacts/studio` |
| 3 | Chapter 4's step toggle moves into the always-visible toolbar row | `artifacts/studio` |
| 4 | New browser-tab icon | `artifacts/studio` |
| 5 | Feedback widget on the homepage, stored unattributed | `lib/api-spec`, `lib/db`, `artifacts/api-server`, `artifacts/studio` |
| 6 | Animated network background behind the homepage | `artifacts/studio` |

(The user's list began at item 2; confirmed there is no item 1. The numbering is
preserved so this spec, the plan, and the original request agree.)

This document is the single normative contract for the bundle. A deep review on
2026-10-03 raised findings R1–R20; all of them are **folded into the sections
below**, not appended. The resolution log records what each finding changed and
who decided it, but the binding text is the item sections themselves.

---

## Resolution log

Seven review claims were independently verified against the code before being
accepted; all seven held, including three that contradicted the first draft.

| # | Disposition | Where it landed |
|---|---|---|
| R1 | **Product decision (user): stale outputs become unreachable.** Verified: `jade-transport-costs.spec.ts:146–154` documents the strip as the deliberate second half of the stale-output contract. | Item 2 → "Retiring the stale-output return path" |
| R2 | **Accepted; first draft was wrong.** Verified only three `dispatch` sites (`:2516`, `:2526`, `:4620`); two die with the strip, so `useState` is simpler than retaining the reducer — the inverse of the first draft's claim. | Item 2 → "Active-view state" |
| R3 | **Accepted + product decision (user): move Input Map's Save into the shared row.** Verified `Workspace.tsx:2498` includes `max-coverage-us` in `saveInLayersRow`. Contrast figures accepted. | Item 3 |
| R4 | **Accepted.** Verified `custom-fetch.ts:367` sets `credentials: "include"`. The anonymity claim is narrowed to what is actually controlled. | Item 5 → "What is and is not guaranteed" |
| R5 | **Accepted + product decision (user): auth-gated.** Verified no `trust proxy` in `artifacts/api-server/src/`, so `req.ip` is Render's load balancer. | Item 5 → "Authentication and rate limiting" |
| R6 | Accepted. | "Production rollout" |
| R7 | Accepted. | Item 5 → "API contract" |
| R8 | Accepted. | Item 5 → "Widget behavior and accessibility" |
| R9 | Accepted. | Item 5 → "Placement" (resolved structurally by item 6's layering) |
| R10 | Accepted. | Item 6 → "Layering" |
| R11 | **Accepted + product decision (user): cover the whole scrollable main area.** | Item 6 → "Mounting" |
| R12 | Accepted. | Item 6 → "Tests" |
| R13 | Accepted. | Item 5 and item 6 → "Tests" |
| R14 | Accepted. | Item 5 → "Tests" |
| R15 | **Accepted; first draft was wrong.** Verified `timestampClock.test.ts` (`EXPECTED_TIMESTAMPTZ`) and `schemaColumns.test.ts` exist in the API suite; the proposed `lib/db` test would never have run in the gate. | Item 5 → "Database" |
| R16 | **Accepted; first draft was wrong.** Verified `AppShell`/`AuthShell` import `src/assets/book-cover.jpg`; `public/book-cover.png` is referenced only by the favicon link. | Item 4 |
| R17 | Accepted. | Item 6 → "Source" |
| R18 | Accepted. | Item 2 → "Analytics" |
| R19 | Accepted. | Item 2 → "Documentation" |
| R20 | Accepted. | Item 2 → "Tests" |

---

## Item 2 — Remove the open-tab strip

### Current state

`Workspace.tsx:4616` renders `<TabBar>` between the content column's top edge and
the content region: one chip per open entity, each with a close `×`, plus a
`tab-bar-empty` placeholder. Tab state lives in `lib/workspaceTabs.ts`, a 66-line
reducer consumed via `useReducer` at `:2364`. The sidebar tree already lists and
opens every input and output entity, so the strip duplicates navigation and costs
a row of vertical space on every screen.

### Decision

Delete the strip. The sidebar becomes the only navigator; clicking an entity
swaps the content region directly. One view is active at a time.

### Active-view state

Replace the reducer with a single `useState<WorkspaceTab | null>` named
`activeView`. There are exactly three `dispatch` call sites today — `openTab`
dispatches `open` (`:2516`), `handleActivateTab` dispatches `activate` (`:2526`),
and `TabBar.onClose` dispatches `close` (`:4620`) — and the last two disappear
with the strip. Only `open` survives, and both remaining callers (the one-shot
Input Map seed and the solve-success path) already route through `openTab`, so
`openTab` simply sets the state.

The first draft proposed retaining the reducer on the grounds that replacing it
meant reworking "every dispatch call site." That was wrong, and verifying the
call sites is what showed it: retaining the reducer would keep a hidden
insertion-order list, two actions no user can invoke, and tests for unreachable
behavior. `noUnusedLocals` is `false` in this repo, so TypeScript would not have
flagged any of it.

- **Delete** `lib/workspaceTabs.ts` and `workspaceTabs.test.ts`. Keep the
  `WorkspaceTab` type (move it next to its one consumer, or inline it).
- **Delete** `components/workspace/TabBar.tsx` and `__tests__/TabBar.test.tsx`.
- **`Workspace.tsx`:** remove the `TabBar` import (`:44`), its mount
  (`:4616–4621`), `handleActivateTab` (`:2526`), and the `useReducer` (`:2364`);
  `activeTab` (`:2366`) becomes `activeView`.
- Update the empty-state copy at `:4676` from "Pick an item from the sidebar to
  open it as a tab" to view-oriented wording.

### Retiring the stale-output return path

**This is a deliberate product behavior change, decided by the user, not a
side effect.**

Today, saving edited inputs marks a scenario stale, which sets
`hasFreshSolvedRun` (`:1531`) false, which disables every Outputs row in the
sidebar (`SidebarTree.tsx:129–130` via `hasSolvedRun`, passed at `:4598`). The
strip has no such guard, so an already-open output tab stays clickable and
re-activating it renders `<StaleOutputBanner>` (`:4085`, `:4244`).
`jade-transport-costs.spec.ts:146–154` asserts both halves explicitly, and its
inline comment names the strip as "the other, equally real half of the contract."

Removing the strip removes that return path. The chosen resolution is to accept
it: **once inputs are saved, outputs are closed until the scenario is re-solved.**
The sidebar's existing disablement becomes the sole, and now the only reachable,
stale signal.

Consequences, all intentional:

- **`StaleOutputBanner` is retained** — resolved 2026-10-03, no longer an
  implementation-time question. `Workspace.tsx:4071-4076` states its own
  contract: it blanks the output's real content behind the banner "even if the
  tab was already open+active from before the scenario transitioned to stale",
  and `:4084-4085` returns the banner *instead of* the content. So "stale
  outputs are unreachable" is already satisfied by two surviving mechanisms —
  the sidebar refuses navigation *to* a stale output, and this branch refuses to
  render stale *content* in a view that was already active. No redirect effect,
  no `useEffect` clearing the active view, and no new derived boolean are
  required; adding one would duplicate a guard that already works. The component
  and its test are untouched by this bundle.
- `jade-transport-costs.spec.ts:145–154` loses its strip half. Rewrite it to
  assert the sidebar row is disabled and stop there, and delete the
  `stale-output-banner` assertion with a comment recording that the return path
  was retired deliberately by this bundle.
- No change to `hasFreshSolvedRun` itself, and no new `hasAnySolvedRun` derived
  boolean. The alternative resolution — keeping stale outputs reachable from the
  sidebar — was considered and rejected by the user.

### Analytics

`handleActivateTab` fires `track("scenario tab viewed", …)`. Deleting it retires
the event. Static search finds the name only in the Workspace handler, its test,
and historical PostHog docs, **but that does not prove no live PostHog insight or
dashboard consumes it**, and the review could not check — no
`POSTHOG_CLI_API_KEY`/`POSTHOG_CLI_PROJECT_ID` is configured.

Before the event is deleted, run the PostHog check per the repo's standing rule:
`posthog-cli api --agent-help`, then `posthog-cli api skill list`, schema-discover
`system.insights` before querying, search saved insight definitions for the exact
event name, and resolve each match's dashboard consumers. Then choose explicitly
between retiring it, migrating to a new view-navigation event, or keeping the name
with documented new semantics.

**Do not silently move the event into `openTab`.** That changes its meaning from
"reactivated an already-open tab" to "opened a view from the sidebar" and makes
historical trends misleading.

### Documentation

Current design-system documentation names `TabBar` as an active app component.
Audit and correct `docs/design-system/DECISIONS.md`, `docs/design-system/readme.md`,
and `docs/design-system/github.md`. Check the docs-audit inventory's ownership
before editing any generated file. Historical specs and plans under
`docs/superpowers/specs/**` and `plans/**` stay untouched — they are historical
record. A standalone design-system `TabBar` example may remain as a library
artifact; only the app-to-component mapping must become truthful.

### Tests

Full rewrite inventory at the reviewed commit:

- `src/__tests__/TabBar.test.tsx`, `src/__tests__/workspaceTabs.test.ts` — deleted
  with their units.
- `Workspace.test.tsx:1797–1799` — solve success asserts the Output Map strip
  button and `aria-selected`. Rewrite against the content surface and the active
  sidebar row.
- `Workspace.test.tsx:1819` — failed solve asserts no Output Map strip button.
  Rewrite as a positive assertion about what the content region shows.
- `Workspace.test.tsx:2543–2556` — one-shot seed and close-last-tab. Replace with
  a positive assertion that Input Map content is the initial active view; delete
  the close-behavior case outright.
- `Workspace.test.tsx:3469–3475` — solve overlay success asserts the strip button.
  Rewrite against the content surface.
- `Workspace.Analytics.test.tsx:234–251` — reactivation analytics; delete with the
  event, subject to the PostHog check above.
- `e2e/bundle6-ui-tweaks.spec.ts:142–188` — title, seed, close, empty-strip, and
  no-reopen behavior. Rewrite to sidebar navigation; drop close/empty-state
  assertions for behavior that no longer exists.
- `e2e/jade-transport-costs.spec.ts:145–154` — per "Retiring the stale-output
  return path" above.
- `e2e/empty-first-run-workspace.spec.ts` — touches only `tab-content-*` testids,
  which survive. Verified by grep; no edit.

Rewriting sibling specs **before** merge is called out explicitly because this
repo's recurring `spec_gap` class is exactly "a UI bundle breaks a prior bundle's
Playwright spec and nobody notices until the gate runs."

---

## Item 3 — Chapter 4's step toggle moves beside Save

### Current state

`StepToggle` renders `1. Max Coverage` / `2. Min Distance` plus an `n of 2 solved`
counter, mounted once at `Workspace.tsx:4545` inside the dark `.scnd-band` header,
gated on `stepState.isMaxCoverage && stepState.steps` (true only for
`max-coverage-us`). Save lives in a separate light toolbar row (`:4631–4648`),
rendered only when `isEditableInputTab` holds and no model-specific
`saveInLayersRow*` flag suppresses it.

### Decision

Move the toggle into the toolbar row. On `max-coverage-us` that row renders on
**every** tab. Single mount — the header mount is removed, not duplicated; a
control declared twice is a drift class this repo has already paid for.

### Save placement on Input Map

`Workspace.tsx:2498` puts `max-coverage-us` in `saveInLayersRow` alongside
`p-median-us` and `p-median-brazil`, so Chapter 4's Input Map renders Save inside
`InputMapTab`'s Layers row and suppresses the shared toolbar's Save. Left alone,
the toggle would not be beside Save on exactly that tab.

**Decision (user): move Chapter 4's Input Map Save into the shared row.** Remove
`max-coverage-us` from the `saveInLayersRow` condition and suppress its inline
Layers-row Save, so toggle and Save sit together on every Chapter 4 tab.
`p-median-us` and `p-median-brazil` keep their inline Save unchanged — the
condition is per-model and the other two entries are untouched. Because
`InputMapTab`'s Layers row is shared with those two models, the inline Save must
be suppressed by a prop driven from the same per-model condition, not deleted.

### Light-surface restyling

`StepToggle` is styled for the dark band and moving it unchanged would fail
contrast on the light toolbar:

| Foreground | Background | Ratio |
|---|---|---:|
| `#ADB1A4` (`--ink-300`) | `#F5F6F1` (`--surface-sunken`) | 2.01:1 |
| `#ADB1A4` (`--ink-300`) | `#181A15` (`--surface-band`) | 8.02:1 |
| `#5B5F54` (`--ink-500`) | `#F5F6F1` (`--surface-sunken`) | 6.02:1 |

Its `hover:bg-white/10` is likewise near-invisible on a light surface. Restyle the
sole component for the light toolbar: `border-border`, `text-muted-foreground`,
`hover:bg-muted`, keeping the selected button's primary background and white text.
No surface variant prop — there is only one mount, so a variant would be
speculative API.

### Layout

- Remove the `<StepToggle>` block from the header (`:4544–4551`).
- Toolbar row condition becomes
  `(stepState.isMaxCoverage && stepState.steps) || (isEditableInputTab && !saveInLayersRow && !saveInLayersRowTransport && !saveInLayersRowTwoEchelon && !saveInLayersRowJade)`.
- Inside the row: toggle left, Save cluster (unsaved-changes text + button) pushed
  right with `ml-auto`, row `flex-wrap` so it reflows rather than overflowing.
- Browser-check at 375 px with both toggle and Save present.
- No change to `StepToggle`'s props or to `stepState`. No change to the other six
  models' toolbar behavior.

### Tests

- `StepToggle.test.tsx` — extend for the light-surface classes.
- `Workspace.test.tsx` — for `max-coverage-us`: `step-toggle` present on an output
  tab, `button-save` absent there, and both present together on Input Map (the new
  shared-row Save). For `p-median-us`: Input Map Save still renders in the Layers
  row, and the toolbar row still appears only on editable input tabs.
- Grep `e2e/` for `step-toggle`, `step-toggle-1`, `step-toggle-2`,
  `text-steps-solved-counter`, `button-save`, and `saveInLayersRow`-adjacent
  locators, classifying every `button-save` path by model and active entity so the
  Chapter 4 Input Map change cannot hide inside shared p-median wiring.

---

## Item 4 — Browser tab icon

### Current state

`index.html` sets `<link rel="icon" type="image/png" href="/book-cover.png" />`.
`public/book-cover.png` is **266×400** — non-square, so browsers squash it.

Contrary to the first draft, `public/book-cover.png` has no other runtime
consumer: `AppShell.tsx:7` and `AuthShell.tsx:2` import `src/assets/book-cover.jpg`,
a different file. Repository search finds `public/book-cover.png` only in the
favicon link and historical docs.

### Decision

Use the user-supplied green network mark. Verified file: 16×16 RGBA PNG, 914
bytes, SHA-256 `c34fa79ad77acb7bdad9bd114cd362be280f209559e6309ee7ecf9fd9793d864`,
sourced from `~/Downloads/global-network.png` and already copied (untracked) to
`artifacts/studio/public/global-network.png`.

**The 16×16 source is accepted as-is by explicit user decision**, having been told
it will look soft on HiDPI (a 16 CSS-px favicon renders at 32 device px). It is
still an improvement on a squashed 266×400 book cover. No upscaling — there is no
detail to recover.

- Track `artifacts/studio/public/global-network.png`.
- Repoint `index.html`'s `<link rel="icon">` to `/global-network.png`.
- Retain `public/book-cover.png` (no longer referenced; removal is out of scope
  for a cosmetic bundle and is not required by this change).
- Leave `favicon.svg` (an unreferenced leftover orange square) and the Open Graph
  image and meta tags unchanged.

### Verification

No vitest coverage — a static reference in `index.html` is outside the test entry
point. Reproducible checks instead:

1. `pnpm --filter studio build`;
2. assert `dist/public/global-network.png` exists;
3. assert the built HTML references `/global-network.png`;
4. GET the asset from the running server; require 200 and `image/png`;
5. inspect browser chrome after a cache-bypassing reload.

---

## Item 5 — Feedback widget on the homepage

### Decision summary

A control in the bottom-right of the homepage opens a small panel with one
free-text field and a Send button. Submitting stores the text and a timestamp and
shows a thank-you. The request is authenticated, but **no account identifier or
client IP is stored on the row**.

### Authentication and rate limiting

**Decision (user), after the trade-off was explained and confirmed:** the endpoint
requires authentication; the authenticated user id is used **only** as a transient
in-memory rate-limit key and is never persisted.

The deciding facts, both verified:

- `lib/api-client-react/src/custom-fetch.ts:367` sets
  `credentials: init.credentials ?? "include"`, so the session cookie accompanies
  every generated request whether or not the endpoint reads it. Making the
  endpoint public would mean ignoring the cookie, not preventing it.
- `artifacts/api-server/src/` never sets Express `trust proxy`. Render terminates
  TLS at its load balancer, so `req.ip` is the proxy's address. A per-IP limit on
  a public endpoint would collapse to a single shared bucket and let one abuser
  block every user.

Limiting by authenticated user id is therefore both more reliable and smaller in
scope than the trusted-proxy work a public endpoint would require.

- **Limit:** 5 submissions per minute per user id.
- **Store:** module-level `Map<userId, {count, windowStart}>`, mirroring the shape
  at `routes/auth.ts:52–73`, with a test-only
  `resetFeedbackRateLimiterForTests()` export. Entries age out with the window.
  In-memory, single-instance, not restart-surviving — acceptable for a feedback
  box behind auth, documented in the route rather than solved.
- **Ordering:** the limiter runs **after** structural/body validation, so
  malformed requests cannot consume an honest user's quota. This matches the
  established auth-route ordering.
- `429` carries a `Retry-After` header.

### What is and is not guaranteed

Guaranteed, and testable: the `feedback` row has no account, session, or IP
column; the route neither reads the session for persistence nor logs the feedback
body; nothing in the application writes the submitter's identity alongside the
text.

Not guaranteed, and therefore not claimed in the UI: the server process
transiently knows who the requester is (it must, to authenticate); Render's
platform access logs record request metadata outside this schema; a user can type
identifying information into the body; and with few concurrent users a timestamp
could narrow authorship by correlation.

**UI wording:** "Stored without your account ID — we don't save who sent this.
Please avoid personal details." The phrase "we won't know who you are" is
rejected as unsupportable.

**Implementation constraint:** the route must not log the request body, and must
not log the request alongside user context.

### Database

New table in `lib/db/src/schema/feedback.ts`, re-exported from
`lib/db/src/schema/index.ts` (which uses `.js` specifiers —
`export * from "./feedback.js";`):

| Column | Type | Notes |
|---|---|---|
| `id` | `serial("id").primaryKey()` | matches `solve_jobs.ts:33` |
| `body` | `text("body").notNull()` | the feedback text, stored trimmed |
| `created_at` | `timestamp("created_at", { withTimezone: true }).notNull().defaultNow()` | **`timestamptz` is load-bearing** — a naked `timestamp` reads back skewed by the database's UTC offset |

No account, session, or IP column — that absence is the privacy guarantee and is
asserted by test, not by convention.

A new table with zero rows, so the two-step NOT NULL protocol does not apply;
`drizzle-kit push` can add it with constraints in one step. Decide during
implementation whether to add a CHECK constraint on trimmed body length as
defense in depth.

### API contract

Contract-first: define the endpoint in `lib/api-spec/openapi.yaml`, re-run Orval,
and commit the spec with its regenerated output. Never hand-edit
`src/generated/`.

Pinned so the route, Zod validator, generated hook, and frontend cannot diverge:

- `operationId`, generated hook name, tag, and request schema name are chosen and
  recorded in the plan before codegen runs.
- Request body `{ "body": string }`, 1–4000 characters **after trimming**; the
  trimmed value is what is persisted.
- Success is **`204` with no body** — avoids defining a schema for an empty `201`.
- `400` and `429` both carry an `ErrorEnvelope` body; `429` also sets
  `Retry-After`.
- `401` for an unauthenticated request.
- Run codegen twice and require no diff on the second pass:
  ```bash
  pnpm --filter @workspace/api-spec codegen
  pnpm --filter @workspace/api-spec codegen
  git diff --exit-code -- lib/api-zod/src/generated lib/api-client-react/src/generated
  ```
  The first pass's diff is expected and must be reviewed for request schema,
  response type, error types, URL, hook name, credentials behavior, and barrel
  exports.

New route file `artifacts/api-server/src/routes/feedback.ts`, registered in
`routes/index.ts` — **not** `app.ts`. This repo's convention is that every router
registers in `routes/index.ts` and `app.ts` mounts the one combined router at
`/api`, so the OpenAPI path `/feedback` is served at `POST /api/feedback`.

### Readout

Database only. No `GET /feedback`, no admin role, no email forwarding. This repo
has no admin concept, and inventing one to read a feedback box would be the larger
and more debt-laden option.

### Placement

The homepage credit footer (`AppShell.tsx`, `homepage-credit-footer`) sits below
the scrollable `<main>` and is always visible, so a viewport-fixed
`bottom-4 right-4` button would overlap it.

The widget is therefore positioned **inside item 6's relative wrapper** — the
container that holds the scrollable main area and excludes the footer — at
`absolute bottom-4 right-4`, with a mobile safe-area inset. It sits above the
background canvas and the content (`z-20`), below global dialogs and toasts. This
resolves the footer collision structurally rather than by tuning an offset.

If items 5 and 6 are implemented in either order, the wrapper is introduced by
whichever lands first; the plan records the dependency.

### Widget behavior and accessibility

The expanded panel is a **non-modal popover** (not a dialog — it does not need to
trap focus or block the page).

- Collapsed: a round button, `data-testid="feedback-button"`, with an accessible
  name, `aria-expanded`, and `aria-controls`.
- Expanded: the anonymity sentence, a labelled `textarea`
  (`data-testid="feedback-input"`, with `maxLength` for immediate UX while server
  validation stays authoritative), a Send button (`data-testid="feedback-send"`),
  and a close control with an accessible name.
- Focus moves to the textarea on open; Escape closes and returns focus to the
  launcher.
- Send is disabled when `body.trim().length === 0` and while a request is in
  flight, so a duplicate submit is impossible.
- Success replaces the body with "Thanks — got it."
  (`data-testid="feedback-thanks"`) and auto-closes after a short delay. The timer
  is cleared on unmount and on manual close, and auto-close resets text and status
  so reopening shows a fresh form.
- Failure (including `429`, which gets its own message) retains the exact typed
  text.
- Panel width is bounded by the mobile viewport.
- Uses the generated mutation hook; no hand-written fetch.

### Tests

- `artifacts/api-server/src/__tests__/feedback.test.ts` — happy path persists a
  row; empty, whitespace-only, and over-length bodies are rejected `400`;
  unauthenticated is `401`; the 6th submission in a window is `429` with
  `Retry-After`; a malformed body does not consume quota;
  `resetFeedbackRateLimiterForTests()` runs in `beforeEach`. Deletes its rows in
  `afterEach`/`afterAll`.
- **Timestamp proof must run in the gate.** Add `feedback.created_at` to
  `artifacts/api-server/src/__tests__/timestampClock.test.ts`'s
  `EXPECTED_TIMESTAMPTZ` inventory, and a Drizzle metadata assertion to
  `schemaColumns.test.ts`. The first draft proposed a `lib/db` test; no `lib/db`
  suite is invoked by the documented gate command, so that proof would have
  existed and never run.
- **Schema-absence proof:** assert via Drizzle table metadata or
  `information_schema.columns` that no account/session/IP column exists.
  Selecting a row and observing the returned object lacks a `user` key is not
  sufficient.
- `FeedbackWidget.test.tsx` — open/submit/thank-you; Send disabled on
  whitespace-only input; duplicate-submit prevention; keyboard close and focus
  restoration; timer cleanup and reset; `429` messaging; error retains typed text.
- **`AppShell.test.tsx` is the suite the widget breaks** (corrected 2026-10-03;
  an earlier draft named the two Landing suites). Those two render `<Landing />`
  directly and `Landing.tsx` imports only the two landing hooks, so neither ever
  mounts the widget. `AppShell.test.tsx` renders hero shells at `:97`, `:180`,
  and `:195`, and its wholesale `@workspace/api-client-react` mock (`:16-19`)
  exports no `useSubmitFeedback` — so it must mock `FeedbackWidget`. It also has
  two footer-topology assertions (`:137-152`, `:154-174`) that require the
  footer to be a sibling of `<main>`; the new wrapper nests `<main>`, so both
  must be rewritten to assert the footer is a sibling of the *wrapper* and
  outside the scroll area. All of this lands in the feedback commit, not the
  background one, or that commit cannot pass its own gate.
- E2E: the Playwright test **intercepts** `POST /api/feedback` and asserts
  open/submit/thank-you, leaving no durable row. Anonymous rows have no user FK,
  so the global teardown — which purges test users and their FK-owned data —
  cannot clean them up. Real persistence is proven by the API integration test
  above, which cleans up after itself. No production DELETE endpoint for test
  cleanup.

---

## Item 6 — Animated network background

### Source

`~/Downloads/network-bg.html`, SHA-256
`df9efa66c1f18207cbc058b17c714aa8465b8b1c1ee14488214c4f6e3d034e44`: a 78-line
custom element drawing a drifting node-and-edge network — 26 nodes, 5 square
"hubs", edges only between pairs where at least one end is a hub and the distance
is under 340 px, opacity falling off linearly over that range.

**The source was not reproducible from Git**, so it is committed verbatim
alongside this spec at `docs/superpowers/specs/assets/2026-10-03-network-bg.html`
(SHA verified identical to the Downloads original). "Ported verbatim in behavior"
now has a referent for every velocity, opacity, radius, and draw-order constant.

Its palette is not arbitrary: `--surface-sunken` (`index.css:356`) is exactly the
demo's `#F5F6F1`, and `--ink-400` (`:350`) is `#83887A`, within a few units of the
demo's `rgba(128,132,122)`. It was authored against this app's palette.

### Component

New `artifacts/studio/src/components/NetworkBackground.tsx` — a React component,
not the custom element. A custom element would need an import-time registration
side effect and a `declare global` JSX shim, and would be harder to test; the
reduced-motion branch needs a test.

- Renders one `<canvas>` in a wrapper with `aria-hidden="true"`,
  `pointer-events: none`, `data-testid="network-background"`.
- **No configuration props.** Node count, hub count, and color are fixed internal
  constants. Props are added when a second caller needs them, not before.
- Color is read once at mount from the computed `--ink-400` on the wrapper and
  converted to the `"r,g,b"` string the draw code needs, falling back to
  `128,132,122`. Read once, not reactively: the app has no runtime theme switcher
  — `index.css:441` defines a `.dark` block but nothing in `src/` applies it,
  verified by grep. If a toggle is added later this is the one place to change.
- **Sizing uses `ResizeObserver`, not `window.resize`.** Landing's Recent Solves
  section arrives asynchronously and changes container height, which a window
  resize listener never observes. The demo could use `window.resize` because its
  container was a fixed viewport height; Landing's is data-dependent.
- **`prefers-reduced-motion: reduce`** draws a single static frame and never
  starts the rAF loop. Because resetting `canvas.width`/`height` clears the
  bitmap, a reduced-motion canvas **must redraw after each observed resize** or it
  goes blank.
- Cleanup cancels any pending frame and disconnects the observer.

### Mounting

**Decision (user): cover the whole scrollable main area**, not just Landing's
centered `max-w-[860px]` column.

This means mounting in `AppShell`, not `Landing`. `AppShell` currently renders
`<main className="flex-1 min-h-0 overflow-y-auto">{children}</main>`. An
`absolute inset-0` child of a scroll container tracks the visible box and scrolls
away, so the background is placed as a **sibling behind** the scroller:

```
<div className="flex-1 min-h-0 relative">
  <NetworkBackground />                                  {/* absolute inset-0, z-0 */}
  <main className="absolute inset-0 overflow-y-auto z-10">{children}</main>
</div>
```

**Gated to the homepage only.** `AppShell`'s `hero` prop is true for exactly one
route — `App.tsx:62` passes it for `<Landing />` and nothing else — so rendering
the background only when `hero` is true keeps it off Compare, NotFound, and the
chapter pages without any new prop or route check.

The header and footer stay outside the wrapper, so neither is overlaid.

### Layering

Normal flow is not a sufficient stacking contract — the source demo explicitly
positions every direct child, and this mount does not. Layers are explicit:

- background wrapper: `absolute inset-0`, `z-0`, `pointer-events-none`;
- scrollable main: `relative`/`absolute` with `z-10`;
- feedback widget (item 5): `z-20`;
- global dialogs and toasts remain above all of it.

Browser QA must confirm the canvas bounds match the intended surface and that
cards and links remain the hit targets. A component-presence test cannot detect a
canvas painted over the content.

### Tests

The jsdom setup defines `ResizeObserver` but provides no canvas 2D context, no
`matchMedia`, and no rAF mocks, so rendering the real component from every
existing AppShell-mounting test would risk "not implemented" errors and leaked
loops. Split accordingly:

- `NetworkBackground.test.tsx` owns controlled mocks for
  `HTMLCanvasElement.getContext`, `matchMedia`, `requestAnimationFrame`,
  `cancelAnimationFrame`, and `ResizeObserver`. Covers: canvas rendered
  `aria-hidden` and non-interactive; reduced motion never calls rAF; reduced
  motion redraws after an observed resize; normal motion starts the loop;
  unmount cancels the frame and disconnects the observer.
- `AppShell.test.tsx` mocks `NetworkBackground` to a cheap element and asserts
  only that it mounts for `hero` and does not mount otherwise. The two Landing
  suites need no change — they render `<Landing />` directly and never mount
  `AppShell`.
- The canvas-mock suite must **clear its `ctx` mocks in `beforeEach`**:
  `vitest.config.ts` does not set `clearMocks`, so a module-level `ctx` carries
  calls across cases and the reduced-motion "drew one static frame" assertion
  would be satisfied by the preceding test's frame — green even if the render
  draws nothing.
- Playwright/manual QA proves real drawing, placement, cleanup, and interaction.

---

## Commits

One commit per item, each a rollback point, each gated before the next starts.
Review-driven fixes go into the item they belong to, never a trailing cleanup
commit.

1. `[COSM-1] remove the workspace tab strip` — includes the active-view
   refactor, the stale-output retirement, the design-system doc corrections, and
   the analytics decision.
2. `[COSM-2] move chapter 4 step toggle into the always-visible toolbar row` —
   includes the light restyle and the Input Map Save relocation.
3. `[COSM-3] use the network mark as the browser tab icon`
4. `[COSM-4] add a feedback widget to the homepage` — `openapi.yaml` and its
   regenerated Orval output land together, per hard rule 1.
5. `[COSM-5] animate a network background behind the homepage` — includes the
   committed source asset.

Commit numbers are sequential and deliberately do not match the item numbers,
which follow the user's list: `COSM-1`→item 2, `COSM-2`→item 3, `COSM-3`→item 4,
`COSM-4`→item 5, `COSM-5`→item 6.

A `docs/CHANGELOG-implementation.md` entry lands with the bundle, appended at the
bottom.

## Dependency sweep

Run before implementation planning and again on the final branch. Classify every
result as: live consumer to update, current documentation to update, historical
record to retain, or generated artifact to regenerate.

```bash
rg -n 'TabBar|tab-bar|tab-close-|tab-input:|tab-output:|scenario tab viewed' \
  artifacts/studio docs/design-system
rg -n 'workspaceTabsReducer|workspaceTabId|initialWorkspaceTabState|dispatch\(' \
  artifacts/studio/src
rg -n 'StepToggle|step-toggle|text-steps-solved-counter|button-save|saveInLayersRow' \
  artifacts/studio/src artifacts/studio/e2e
rg -l 'vi\.mock\("@workspace/api-client-react"' artifacts/studio/src/__tests__ -g '*.test.ts*'
rg -n 'getContext|matchMedia|requestAnimationFrame|ResizeObserver' \
  artifacts/studio/src artifacts/studio/e2e
rg -n 'book-cover\.png|book-cover\.jpg|favicon\.svg|global-network' .
```

## Verification

Per item: that item's own tests, green before the next item begins.

Whole branch:

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
pnpm --filter studio build
pnpm e2e:gate
```

Two standing cautions on reading those results:

- Before trusting studio vitest, require zero concurrent runs:
  `ps aux | grep "[v]itest" | grep -v "zsh -c"` — read the rows, do not trust a
  bare count, which matches the agent's own wrapper.
- After Playwright, read `artifacts/studio/e2e/report/results.json` and require
  both `stats.unexpected === 0` and `stats.flaky === 0`. The console tail folds
  retried failures away silently.

Database proof, against a disposable database created from the branch:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'feedback'
ORDER BY ordinal_position;
```

Require exactly the intended columns, `created_at` as `timestamp with time zone`,
and no user/session/IP column. Never use `push --force` against a populated or
production database to make a test convenient.

Browser QA matrix: 375 px and desktop; reduced motion on and off; fresh and stale
outputs; Chapter 4 Input Map and an output view; feedback success, 400, 429, and
network failure; footer collision; canvas layering and hit-testing; favicon after
a cache-bypassing reload.

No solver code changes, so `e2e_accuracy.py` is untouched by construction; the
pytest suite still runs as the standing gate requires.

## Production rollout

`drizzle-kit push` does not run automatically on a Render API deploy, so the route
could reach production before `feedback` exists and 500 on every submission. The
API and frontend are separate services and can skew.

1. From the reviewed release commit, inspect the full `drizzle-kit push` proposal
   — it reconciles the whole schema, not just `feedback`.
2. Apply to a disposable Postgres and run the real schema and API integration
   tests.
3. **With separate production approval**, create the table before application
   rollout.
4. Prove via `information_schema.columns` that `feedback.created_at` is
   `timestamp with time zone` and no account/IP column exists.
5. Deploy the API; smoke-test validation, success, and rate limiting.
6. Deploy the frontend; exercise a real homepage submission.
7. To roll back, revert application code without dropping the table — an unused
   additive table is safer than a destructive rollback mid-incident.

Merge, push, and deploy are three separate approvals under this repo's branch
discipline. Nothing here authorises any of them.

## Closeout

1. Build the task plan: one row per affected file, test, and generated artifact,
   with an explicit schema → API → frontend dependency edge.
2. Implement as the five commits above, gating each.
3. Re-run the dependency sweep, then the full branch gate and browser matrix.
4. Run `/harness-retro <task_id>`; append the measured changelog record in the
   final bundle commit.
5. Stop for merge approval.

## Out of scope

- Open Graph image or social-card metadata.
- A GET endpoint, admin role, or email notification for feedback.
- Removing `public/book-cover.png` or `public/favicon.svg`.
- Extending the animated background beyond the homepage.
- Changes to the other six models' toolbar behavior.
- Upscaling or re-authoring the favicon artwork.
- Server-side branch protection or CI changes.
