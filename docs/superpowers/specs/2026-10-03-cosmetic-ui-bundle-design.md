# Cosmetic UI bundle — design

**Date:** 2026-10-03
**Branch:** `cosmetic-ui` (worktree `/Users/shubhamkr/nos-cosmetic`, locked), branched off `main` @ `3e34364`
**Scope:** five independent cosmetic/UX changes, one commit each.

Five changes, no shared state between them beyond both #2 and #3 touching the same
region of `Workspace.tsx`. They are specified and committed in the order below so
that #3 lands on a layout #2 has already simplified.

| # | Change | Primary surface |
|---|---|---|
| 2 | Remove the open-tab strip above the content area | `artifacts/studio` |
| 3 | Chapter 4's step toggle moves into the always-visible toolbar row | `artifacts/studio` |
| 4 | New browser-tab icon | `artifacts/studio` |
| 5 | Anonymous feedback widget on the homepage | `lib/api-spec`, `lib/db`, `artifacts/api-server`, `artifacts/studio` |
| 6 | Animated network background behind the homepage | `artifacts/studio` |

(The user's own list began at item 2; confirmed there is no item 1. The numbering
is preserved here so the spec, the plan, and the user's message agree.)

---

## Item 2 — Remove the open-tab strip

### Current state

`Workspace.tsx:4616` renders `<TabBar>` between the sidebar-adjacent column's top
edge and the content region. It is a VS Code–style strip: one chip per open
entity, each with a close `×`, plus a `tab-bar-empty` placeholder when nothing is
open. Tab state lives in `lib/workspaceTabs.ts` — a 66-line reducer with
`open` / `activate` / `close` actions — consumed by `Workspace.tsx` via
`useReducer` at `:2364`.

The sidebar tree (`SidebarTree`) already lists every input and output entity and
already opens them. The strip therefore duplicates navigation the sidebar
provides, and costs a row of vertical space on every screen.

### Decision

Delete the strip. The sidebar becomes the only navigator; clicking an entity
swaps the content region directly. One view is active at a time.

### Changes

- **Delete** `artifacts/studio/src/components/workspace/TabBar.tsx` and
  `artifacts/studio/src/__tests__/TabBar.test.tsx`.
- **`Workspace.tsx`:** remove the `TabBar` import (`:44`) and its mount
  (`:4616–4621`).
- **`Workspace.tsx`:** delete `handleActivateTab` (`:2526`). It exists only to be
  passed to `<TabBar onActivate>`, so with the strip gone it is unreachable. Its
  body fires the PostHog event `"scenario tab viewed"`; that event retires with
  it. Opening an entity from the sidebar dispatches `open` directly through
  `openTab` (`:2515`) and never went through this handler, so no analytics
  coverage of sidebar navigation is lost — there was none.

### Deliberately NOT changed: `lib/workspaceTabs.ts`

The reducer stays exactly as it is. `activeTab` (`:2366`) still selects what
`renderTabContent()` renders, and `openTab` still sets it. Replacing the reducer
with a plain `useState<entityId>` would mean reworking the one-shot Input Map
seeding (`:2531`, keyed on `modelId` via a ref guard) and every `dispatch` call
site — strictly more work than deleting a component, for no user-visible
difference. The smaller change fully closes the gap; there is no simpler option
that also removes the strip.

Two consequences, accepted and to be recorded in the commit body:

1. The reducer's `close` action becomes UI-unreachable. It is left in place
   (dead but harmless, and its unit tests keep passing) rather than removed, so
   that this commit is a pure deletion of UI.
2. `tabState.tabs` becomes an invisible most-recently-used list that grows as the
   user navigates. Each entry is a small object (`id`, `kind`, `entity`,
   `label`); the entity set per model is bounded at well under 30, and `open`
   dedupes by id, so the array cannot grow without bound.

### Tests

- `src/__tests__/TabBar.test.tsx` — deleted with its component.
- `src/__tests__/Workspace.test.tsx` — remove assertions on the strip; add one
  asserting the strip is absent and that a sidebar click still swaps
  `tab-content-region`.
- `src/__tests__/Workspace.Analytics.test.tsx` — remove the
  `"scenario tab viewed"` case.
- **`e2e/bundle6-ui-tweaks.spec.ts`** — five assertions drive the strip directly
  (`tab-${id}` aria-selected at `:165`, `tab-close-${id}` click at `:184`,
  `tab-bar-empty` at `:185`/`:187`, `tab-${id}` count at `:188`). Rewrite to
  drive navigation from the sidebar and drop the close/empty-state assertions,
  which describe behavior that no longer exists.
- **`e2e/jade-transport-costs.spec.ts:153`** — `tab-output:cost-summary` click
  becomes a sidebar click.
- `e2e/empty-first-run-workspace.spec.ts` — references only `tab-content-*`
  testids, which survive unchanged. No edit needed; verified by grep, not assumed.

Rewriting the two sibling specs **before** merge is explicit here because this
repo's recurring `spec_gap` failure class is exactly "a UI bundle breaks a prior
bundle's Playwright spec and nobody notices until the gate runs."

---

## Item 3 — Chapter 4's step toggle moves beside Save

### Current state

`StepToggle` (`components/workspace/StepToggle.tsx`) renders the two-button group
`1. Max Coverage` / `2. Min Distance` plus an `n of 2 solved` counter. It is
mounted once, at `Workspace.tsx:4545`, inside the dark `.scnd-band` page header,
gated on `stepState.isMaxCoverage && stepState.steps` (true only for
`max-coverage-us`). In the header it sits to the left of `UnitToggle` and the Run
Optimizer button, visually distant from the content it governs.

The Save button lives in a separate light toolbar row (`:4631–4648`) directly
below the strip, rendered only when `isEditableInputTab` is true and the active
model does not render Save inline in its own Layers row.

### Decision

Move the step toggle out of the header and into that toolbar row. On
`max-coverage-us` the row renders on **every** tab, not only editable input tabs,
so the toggle is always present. Save continues to render only where it is
meaningful; on a non-editable tab the row shows the toggle and counter alone.

Single mount. The header mount is removed, not duplicated — a control declared in
two places is a drift bug this repo has already paid for once.

### Changes

- **`Workspace.tsx`:** remove the `<StepToggle>` block from the header
  (`:4544–4551`).
- **`Workspace.tsx`:** change the toolbar row's render condition from
  `isEditableInputTab && !saveInLayersRow…` to
  `(stepState.isMaxCoverage && stepState.steps) || (isEditableInputTab && !saveInLayersRow…)`,
  and render `<StepToggle>` inside it (left-aligned) when
  `stepState.isMaxCoverage && stepState.steps`, with the existing Save cluster
  (unsaved-changes text + Save button) staying right-aligned under its own
  unchanged condition.
- No change to `StepToggle.tsx` itself, to its props, or to `stepState`.
- No change for the other six models: their toolbar row condition is unchanged,
  so they see exactly today's behavior.

### Tests

- `src/__tests__/StepToggle.test.tsx` — unchanged (component untouched).
- `src/__tests__/Workspace.test.tsx` — assert for `max-coverage-us` that
  `step-toggle` is present on an output tab (where it previously would have been
  in the header) and that `button-save` is absent on that same tab; assert for a
  non-Chapter-4 model that the toolbar row still renders only on editable input
  tabs.
- E2E: any spec asserting the toggle's position within the header must be
  updated. The toggle's own testids (`step-toggle`, `step-toggle-1`,
  `step-toggle-2`, `text-steps-solved-counter`) are unchanged, so specs that only
  locate it by testid keep working. The implementing task greps `e2e/` for those
  four testids and for header-scoped locators around them before claiming done.

---

## Item 4 — Browser tab icon

### Current state

`artifacts/studio/index.html` sets `<link rel="icon" type="image/png" href="/book-cover.png" />`.
`artifacts/studio/public/` holds `book-cover.png`, `favicon.svg`, `opengraph.jpg`,
`robots.txt`.

### Decision

Use the green circular network mark supplied by the user, present on their machine
at `~/Downloads/global-network.png` (914 bytes, created 2026-10-03 03:34).

### Changes

- Copy the file to `artifacts/studio/public/global-network.png`.
- Repoint `index.html`'s `<link rel="icon">` at `/global-network.png`.
- Leave `book-cover.png` in place — it is used elsewhere (the Landing book-cover
  band motif), so this is a favicon change only, not a deletion.
- Leave `opengraph.jpg` and the Open Graph meta tags unchanged. Social-card
  artwork was not in scope for this request.
- Leave `favicon.svg` in place, unreferenced, as it is today.

### Tests

No unit test — a static asset reference in `index.html` is outside the vitest
entry point. Verification is manual: load the dev server and confirm the tab icon,
and confirm the file is served at `/global-network.png`.

---

## Item 5 — Anonymous feedback widget on the homepage

### Decision summary

A fixed bottom-right control on the homepage opens a small panel with one free-text
field and a Send button. Submitting stores the text and a timestamp and shows a
thank-you. **Nothing identifying is stored** — the submission is genuinely
anonymous, which is what lets the UI say so truthfully.

### Anonymity

The feedback table has **no `user_id` column at all**, nullable or otherwise. The
endpoint does not read the session cookie and does not log the client IP with the
row. The panel tells the user "Sent anonymously — we won't know who you are," and
that statement is literally true of what is persisted.

The cost is accepted and stated: a feedback item cannot be followed up with its
author, and a submission cannot be attributed to a cohort or chapter.

Note the resulting shape: the endpoint is unauthenticated, but the only surface
that currently offers it (`/`) is behind login (`App.tsx:62`). So in practice every
submitter today is a signed-in user whose identity is deliberately discarded. The
endpoint being public is what makes the widget reusable on a future unauthenticated
page without a contract change.

### Database

New table in a new file `lib/db/src/schema/feedback.ts`, re-exported from
`lib/db/src/schema/index.ts` (which uses `.js` extensions on its relative
specifiers — `export * from "./feedback.js";`):

| Column | Type | Notes |
|---|---|---|
| `id` | `serial("id").primaryKey()` | matches `solve_jobs.ts:33` |
| `body` | `text` NOT NULL | the feedback text |
| `created_at` | `timestamp({ withTimezone: true })` NOT NULL default `now()` | **`timestamptz` is mandatory** — see the standing rule; a naked `timestamp` here reads back skewed by the database's UTC offset |

New table, zero existing rows, so the two-step NOT NULL protocol does not apply —
`drizzle-kit push` can add it with its constraints in one step.

### API

- **Contract first.** `POST /feedback` is defined in `lib/api-spec/openapi.yaml`,
  then Orval is re-run and the regenerated `lib/api-zod` / `lib/api-client-react`
  output is committed in the same commit as the spec change. No hand-editing of
  anything under `src/generated/`.
- Request body: `{ "body": string }`, 1–4000 characters after trimming.
- Responses: `201` with an empty object on success; `400` on validation failure;
  `429` when rate-limited.
- New route file `artifacts/api-server/src/routes/feedback.ts`, registered in
  `routes/index.ts` — **not** in `app.ts`. This repo's convention is that every
  router registers in `routes/index.ts` and `app.ts` mounts that one combined
  router at `/api`, so the OpenAPI path `/feedback` is served at `POST
  /api/feedback`. No auth middleware. No ownership filter — there is nothing
  owned.
- **Rate limiting is required**, because this is an open write endpoint. Mirror
  the shape already proven in `routes/auth.ts:52–73`: a module-level
  `Map<ip, {count, windowStart}>`, a fixed window, and a test-only
  `resetFeedbackRateLimiterForTests()` export. Limit: **5 submissions per minute
  per IP** — well above any honest use, low enough that a single IP cannot flood
  the table. 429 returns `{ error: "Too many submissions, try again shortly" }`.
  The limiter is per-IP and in-memory, with the same single-instance,
  no-restart-survival caveat the login limiter carries; that is acceptable for a
  feedback box and is documented in the route's own comment rather than solved.
- The 4000-character cap and the rate limit together bound the worst case a
  single IP can write in a minute to 20 KB.

### Readout

Database only. No `GET /feedback`, no admin role, no email forwarding. Feedback is
read with a direct SQL query when wanted. This is a deliberate scope limit: this
repo has no admin concept, and inventing one to read a feedback box would be the
larger and more debt-laden option.

### Frontend

- New component `artifacts/studio/src/components/FeedbackWidget.tsx`.
- Mounted in `Landing.tsx` only.
- Collapsed state: a fixed round button, bottom-right, `data-testid="feedback-button"`,
  with an accessible label. Fixed positioning so it does not disturb the Labs grid.
- Expanded state: a small panel with the anonymity hint, a `textarea`
  (`data-testid="feedback-input"`), a Send button (`data-testid="feedback-send"`,
  disabled while the text is empty or a request is in flight), and a close control.
- On success the panel replaces its body with "Thanks — got it."
  (`data-testid="feedback-thanks"`) and auto-closes after a short delay.
- On failure it shows an inline retryable error and keeps the typed text, so a 429
  or a network blip does not lose what the user wrote.
- Uses the Orval-generated mutation hook from `@workspace/api-client-react`; no
  hand-written fetch.

### Tests

- `artifacts/api-server/src/__tests__/feedback.test.ts` — happy path writes a row;
  empty and over-length bodies are rejected 400; the 6th submission within the
  window is 429; `resetFeedbackRateLimiterForTests` is called in `beforeEach`.
  One case asserts the persisted row has **no** user column and that `created_at`
  is populated.
- `lib/db` — assert the `created_at` column is `timestamptz`, not merely that a
  round-trip preserves the value. A round-trip test passes on a UTC database even
  when the column type is wrong, which is precisely how this class of bug reached
  production here before.
- `artifacts/studio/src/__tests__/FeedbackWidget.test.tsx` — opens, submits, shows
  the thank-you; Send is disabled on empty input; an error response keeps the
  typed text.
- E2E: one spec in `artifacts/studio/e2e/` that opens the widget on the homepage,
  submits, and asserts the thank-you.

---

## Item 6 — Animated network background on the homepage

### Source

`~/Downloads/network-bg.html` — a 78-line self-contained custom element
(`<network-bg>`) drawing a drifting node-and-edge network on a canvas: 26 nodes,
5 of them square "hubs", edges drawn only between pairs where at least one end is
a hub and the distance is under 340 px, with opacity falling off linearly over
that range. It absolutely-positions itself to fill a `position: relative` parent,
sets `pointer-events: none`, and marks the canvas `aria-hidden`.

Its demo page uses `#F5F6F1` as the background and `rgba(128,132,122,…)` for nodes
and edges. Those are not arbitrary: `--surface-sunken` in this app's
`index.css:356` is exactly `#F5F6F1`, and `--ink-400` at `:350` is `#83887A`,
within a few units of `#80847A`. The animation was authored against this palette.

### Decision

Port it to a React component rather than registering the custom element.
Rationale: the codebase is React throughout, a custom element would need an
imperative registration side effect at import time plus a `declare global` JSX
shim, and a React component is directly testable with RTL/vitest — which the
reduced-motion branch needs.

Mount it behind the homepage content only, not in `AppShell`. The request was for
the homepage; putting it in the shell would also place it behind Compare, the
chapter pages that use the shell, and the auth pages.

### Component

New file `artifacts/studio/src/components/NetworkBackground.tsx`.

- Renders a single `<canvas>` inside an absolutely-positioned wrapper
  (`absolute inset-0`, `pointer-events-none`, `aria-hidden="true"`,
  `data-testid="network-background"`).
- Canvas sizing, node simulation, edge rule, and draw loop are ported verbatim in
  behavior from the source file; the per-frame work is unchanged.
- `useEffect` owns the `requestAnimationFrame` loop and the `resize` listener, and
  its cleanup cancels the frame and removes the listener — the same contract the
  original's `disconnectedCallback` provided.
- **Color** is read once at mount from the computed value of `--ink-400` on the
  wrapper element and converted to the `"r,g,b"` string the draw code needs, with
  the source file's `128,132,122` as the fallback if the token is missing or
  unparseable. Read **once**, not reactively: the app has no runtime theme
  switcher — `index.css:441` defines a `.dark` block, but nothing in `src/` ever
  applies that class, verified by grep. If a theme toggle is added later, this is
  the single place that needs to become reactive, and the fallback keeps it
  correct-looking in the meantime.
- **`prefers-reduced-motion: reduce`** is honored: when it matches, the component
  draws exactly one static frame and never starts the rAF loop. The network still
  reads as a background texture; it simply does not move.
- Node count, hub count, and color remain overridable through props with the
  source file's defaults (26 / 5 / token-derived).

### Mounting

`Landing.tsx`'s outer `<div className="max-w-[860px] mx-auto p-8">` gains
`relative` and `<NetworkBackground />` as its first child. Every existing child
already participates in normal flow above it; the one requirement the source file
documents — a `position: relative` container — is satisfied by that class.

No change to the Labs grid, the stats line, the cards, or any of their testids.

### Tests

`artifacts/studio/src/__tests__/NetworkBackground.test.tsx`:

- Renders the canvas with `aria-hidden` and `pointer-events: none`.
- With `matchMedia` mocked to report `prefers-reduced-motion: reduce`,
  `requestAnimationFrame` is never called.
- With reduced motion off, the loop starts, and unmounting calls
  `cancelAnimationFrame` and removes the resize listener.

`Landing.test.tsx` gains one assertion that `network-background` is present and
that the existing Labs content still renders.

---

## Commits

One commit per item (rule 4), each a rollback point, each gated before the next
begins:

1. `[COSM-1] remove the workspace tab strip`
2. `[COSM-2] move chapter 4 step toggle into the always-visible toolbar row`
3. `[COSM-3] use the network mark as the browser tab icon`
4. `[COSM-4] add an anonymous feedback widget to the homepage`
5. `[COSM-5] animate a network background behind the homepage`

Note the commit numbers are sequential and do not line up with the item numbers
above, which follow the user's own list: `COSM-1`→item 2, `COSM-2`→item 3,
`COSM-3`→item 4, `COSM-4`→item 5, `COSM-5`→item 6.

The `COSM-4` (feedback) commit carries the `openapi.yaml` change and its
regenerated Orval output together, per rule 1.

A changelog entry in `docs/CHANGELOG-implementation.md` lands with the bundle,
appended at the bottom.

## Verification

Per-item: the item's own tests, run and green before the next item starts.

Whole-branch gate before requesting merge approval:

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
pnpm e2e:gate
```

Two standing cautions apply to reading those results:

- Before trusting the studio vitest run, confirm no other session is running
  vitest concurrently — `ps aux | grep "[v]itest" | grep -v "zsh -c"`, read the
  rows, require zero. Concurrent runs in another worktree produce timeouts in
  shared components this branch never touched.
- Read the e2e run's `e2e/report/results.json` (`stats.unexpected` and
  `stats.flaky`), not the console tail, which silently folds retried failures away.

No solver code changes in this bundle, so `e2e_accuracy.py` is untouched by
construction; the pytest suite is run anyway as the standing gate requires.

## Out of scope

- Any change to the Open Graph image or social-card metadata.
- A GET endpoint, admin role, or email notification for feedback.
- Removing `lib/workspaceTabs.ts` or its `close` action.
- Extending the animated background beyond the homepage.
- Changes to the other six models' toolbar behavior.
