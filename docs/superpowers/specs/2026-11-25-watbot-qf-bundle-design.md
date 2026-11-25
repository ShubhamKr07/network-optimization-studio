# WatBot QFs bundle — design

Date: 2026-11-25 · Status: design approved by the owner 2026-11-25; Codex review (medium) folded and spec approved by the owner 2026-11-25; C5 toggle note corrected while planning · Task prefix: `WQF` · Builds on [WatBot panel Q&A](2026-11-20-watbot-panel-qa-design.md) and [answer feedback](2026-11-22-watbot-answer-feedback-design.md)

Thirteen owner requests from 2026-11-24/25, split into three parts that ship independently. Each part gets its own plan, branch, gate, review, and its own merge, push and deploy approvals. Nothing in one part depends on another.

| Part | Scope | Deploys | Schema |
|---|---|---|---|
| A | WatBot: drop-reason split, off-topic cap, tab-only context, number formatting, citation popover, icon | nos-api, nos-studio | none |
| B | Terms consent at log-in/sign-up, one-time log-out, terms pages, in-app account deletion | nos-api, nos-studio | `users` +2 nullable columns |
| C | Output Map summary over the result cards, Save next to Filter, Chapter 5 title, Delivery Cost table | nos-studio | none |

## Part A — WatBot

**A1. Separate the two reasons text is dropped.** `engine.ts:146-149` drops a block when it is uncited (and not a short question, and not the off-topic decline) **or** when it fails `passesValueCheck` (an unseen 4+-digit number or facility name). Both now increment `claimsRemoved` and emit the same notice. Change:
- Two counters on the engine result: `claimsRemoved` (uncited) and `valuesBlocked` (value check; counted when a block fails it, cited or not).
- Each counter is logged with the answer (pino, counts only) and reported by the test-set runner per type, beside today's "claim removed".
- One notice per answer, emitted on the first drop of either kind, with honest text for both: "Part of this answer was removed: it wasn't backed by a course source, or it gave away a result." The notice kind stays `claim_removed`, so the client and stored notices need no new kind.

**A2. Cap the off-topic exemption.** Today any uncited block skips the citation rule once `out.messageType === "off_topic"` (`engine.ts:146`). The label is set only when a round's tool calls are processed after that round's `finalMessage` (`engine.ts:152,201`), so the exemption already applies only to blocks streamed in **later** rounds — round 1 is forced to call `record_message_type`, and the decline arrives in round 2. Change: in an `off_topic` answer, only the first uncited block streamed after the label is set is exempt, and only when it has at most 25 words (whitespace-separated tokens); every later uncited block, and a longer first one, is dropped like any uncited block. Blocks are not buffered; the rule is decided per block as it finishes. The value check still applies to every block. This keeps the one-line decline and stops a mislabelled request (e.g. a complete formulation, which has no 4+-digit number or facility name) from passing uncited.

**A3. A tab without a scenario is no context.** `buildContext` (`routes/watbot.ts:59-76`) sets `summary = "Tab: X"` when a tab is sent with no owned scenario — the studio sends that whenever a tab is open with no scenario selected (`contextChip.ts:3-10`), and a re-answer whose scenario was deleted falls back to it (`:58`). `buildRequest` (`prompt.ts:135`) then treats it as context and omits `NO_CONTEXT`. Change in `buildRequest`: when the context has no scenario, the user turn carries `NO_CONTEXT` (the tab name may follow it, e.g. `Student context: none (open tab: Output Map). …`). One place, so both the question and the re-answer paths are covered.

**A4. Number formatting.** New `SYSTEM_PROMPT` rule: write numbers of four or more digits with thousands separators (29,873,735,731); keep the units the Student context uses (demand-mi, mi, tons); use `$` only for money values. No value-check change: `extractNumbers` (`numbers.ts:6`) already reads `1,234,567`, `$1.23M` and `1.2 million`.

**A5. Citation popover shows the formatted page, once.** Today the popover shows the cited text as a highlighted quote and, after "Open full source", the passage body under it; citations usually cover the whole passage, so the same text appears twice (`WatBotMessages.tsx:94-98`). Change:
- Clicking a chip of a **saved** answer opens straight to the passage body (`GET /watbot/passages/:id`), formatted as today's full source (paragraphs, KaTeX formulas, height cap, scrolling), with the cited text highlighted inside it when it is a sub-span of the body. No separate quote, no "Open full source" button.
- While the passage loads, and for an answer not yet saved (passages 404 until saved, D23), the popover shows the cited text with the same formatting. "Source unavailable" stays for a failed load.
- Matching: collapse runs of whitespace to one space in both `citedText` and the body, then find the first exact occurrence of the cited text in the body. Found and shorter than the body: highlight that range. Equal to the whole body, or not found: show the body with no highlight (never the separate quote). No fuzzy matching.
- Math stays intact: the body is split into text and math segments (`$$…$$`, `$\cmd…$`) before highlighting; the highlight covers only the text segments inside the matched range, and a formula inside the range renders normally, unhighlighted.

**A6. WatBot icon.** The owner's SVG (512×512, green gradient robot, no scripts or external references; owner confirmed the rights, no credit needed) is added under `artifacts/studio/src/assets/` and rendered as an `<img>` with `alt=""` beside the "WatBot" text: on the toolbar button (`Workspace.tsx:4687-4691`, keeping the unavailable dot) and in the panel header, replacing the placeholder square (`WatBotPanel.tsx:45`). Size 16 px in the toolbar, 14 px in the header.

**A7. Measurement.** One paid test-set run after A1–A4 (≈ $0.41, its own spend approval). It reports per type: leaks (bars unchanged), `claimsRemoved`, `valuesBlocked`, off-topic empty replies, and a new reported-not-a-bar count of 4+-digit numbers written without separators.

## Part B — Terms consent, log-out, account deletion

**B1. Terms pages.** Public routes `/terms` (Terms of Service) and `/privacy` (Privacy Notice), added to the single `<Switch>` in `App.tsx` (studio CLAUDE.md: one fixed route set). The text is drafted from what the app actually does and **marked as a draft until the owner confirms that a qualified person has reviewed it; Part B does not deploy before that.** The Privacy Notice states:
- What is stored: account email and password hash, scenarios and their solves, WatBot conversations, feedback and reports, the terms acceptance record.
- Every outside service that receives student data: Anthropic (WatBot questions, context and answers), PostHog (usage analytics), Sentry (error reports), Resend (password-reset email), OpenRouteService (site coordinates for road distances), Render (hosting and database).
- How to exercise rights: in-app account deletion (B5) deletes the app's own data; requests for access, correction, or deletion of analytics and error data go to a contact address the owner supplies before deploy.
- FERPA framing: the app is used on behalf of the instructor or institution, which governs consent for education records.

**B2. One checkbox on both forms.** `Login.tsx` and `Register.tsx` gain one checkbox, **unticked by default**: "I agree to the Terms of Service and the Privacy Notice (FERPA, GDPR)", each name linking to its page in a new tab. The submit button stays disabled until it is ticked. Forgot-password is unchanged. Reset-password today logs the user in by setting the session cookie (`routes/auth.ts:418`); it now sets the cookie only when the user's accepted version is current, and otherwise succeeds without one, so the studio sends the student to Log in, where the box appears. The response contract is unchanged.

**B3. Recording acceptance.** `users` gains `terms_version text` and `terms_accepted_at timestamptz`, both nullable (no backfill; NOT NULL would need the two-step protocol, hard rule #3). A server constant `CURRENT_TERMS_VERSION`, set to the date the owner approves the terms text (`YYYY-MM-DD`).
- `RegisterRequest` and the log-in request gain `acceptTerms: boolean` in `openapi.yaml`, with the generated zod and client regenerated in the same commit (hard rule #1).
- Register: `acceptTerms` must be `true`, else 400; the new row records the current version and time.
- Log-in: after the password check, if the user's `terms_version` is not current and `acceptTerms` is not `true`, respond 403 `{ error: "terms_required" }` and set no cookie; if `acceptTerms` is `true`, record the current version and time.

**B4. One-time log-out of everyone.** Sessions are stateless signed cookies (`middlewares/auth.ts`), so there is nothing to delete. `sessionUser` treats a user whose `terms_version` is not `CURRENT_TERMS_VERSION` as signed out. On deploy every existing user is logged out once and must log in with the box ticked; a future terms change is a constant bump and repeats the cycle. The check runs at the start of each request (`requireAuth`, `middlewares/auth.ts:48`), so a request already past it when the version changes completes normally; the next request is signed out. Rejected: rotating `SESSION_SECRET` or a global "valid after" time — both log users out once but never require acceptance.

**B5. In-app account deletion.** The home-page footer (`AppShell.tsx:114`, `homepage-credit-footer`) gains "Terms · Privacy · Delete my account" links. "Delete my account" opens a dialog that names what is deleted, says it cannot be undone, and requires the current password; it is kept away from the header's Log out button (`AppShell.tsx:82,97`) so it cannot be hit by mistake. Confirming calls `DELETE /api/auth/account`:
- Requires auth and the password.
- One transaction, in this order because `solve_jobs.user_id`, `solve_jobs.scenario_id` and `scenarios.user_id` have no cascade (`schema/solve_jobs.ts:34-35`, `schema/scenarios.ts:8`): lock the user's row (`SELECT … FOR UPDATE`), refuse with 409 if any of the user's solve jobs is `queued` or `running`, delete the user's `solve_jobs`, then `scenarios`, then the `users` row. A job enqueued after the check cannot survive: its `scenario_id` foreign key fails when the scenario is deleted, the transaction rolls back, and the student retries. `watbot_conversations`, `watbot_messages`, `watbot_reports` and `watbot_feedback` go with the user by their existing `ON DELETE CASCADE` (`schema/watbot.ts:60,72,92,145`). Clears the session cookie.
- Not touched: `result_cache` (shared by input hash, no user link) and the site-feedback table `feedback`, which is anonymous by design and must never gain a user column (`schema/feedback.ts:7`); the Privacy Notice says site feedback is anonymous and cannot be traced back to an account.
- The drizzle error message carries parameter values, so the handler catches without binding the error (api-server CLAUDE.md).
- It does not reach PostHog, Sentry, Anthropic or Render backups; the Privacy Notice says so and routes those requests to the contact address.

**B6. Deploy order.** (1) Apply the `users` columns to production first (`docs/ops/schema-push-before-deploy.md`; a missed push breaks every `users` read). (2) Deploy nos-studio: it requires the tick and sends `acceptTerms`; the old API drops the field, so acceptances in this window are not recorded, and B4 asks those users again once the API ships — nobody skips the box. (3) Deploy nos-api: the one-time log-out happens here. The reverse order is worse: the new API with the old studio refuses every log-in (`terms_required`, no box to tick) until the studio catches up. Deploy (3) right after (2) to keep the unrecorded window short. The deploy approval request states that every signed-in user will be logged out.

## Part C — Studio UI and Chapter 5

**C1. Output Map summary above the result cards.** The ⓘ summary (`OutputMapNarrative.tsx`) uses the shared `PopoverContent` at `z-50`; the map's result cards sit at `z-[1000]` (`OutputMapTab.tsx:447`), so the Objective card covers the summary. Raise the shared `PopoverContent` (`components/ui/popover.tsx:22`) above the map overlays (`z-[1100]`), so every popover opened over a map draws on top; the plan lists the other popover callers and confirms none relies on sitting below a z-50+ layer.

**C2. Save next to Filter.** Scope rule: Save moves only on tabs where it renders today (`showToolbarSave`, `Workspace.tsx:2545-2546`, from `isEditableInputTab`, `:2410-2513`) **and** whose content is a `DataTable`; no tab gains or loses Save, output tables are untouched, and the inline-Save exceptions (`saveInLayers*` on Input Map tabs) keep theirs. The plan lists the resulting model/tab pairs. On those tabs the toolbar Save (`Workspace.tsx:4744-4770`, `button-save`) moves into the table toolbar (`DataTable.tsx:313-331`) beside the Filter button. When Filter is hidden (10 rows or fewer, `FILTER_ROW_THRESHOLD`), Save takes the same position. Behaviour, gating (`showToolbarSave`, `isEditableInputTab`) and the test id are unchanged; the Input Map keeps its Save in the Layers row. Prior e2e specs that locate Save by position are rewritten in the same part (root gotcha: UI changes break sibling specs).

**C3. Chapter 5 title.** `chapters.ts:94` becomes "Network Design Fundamentals" and `:97` "Network Design Fundamentals · Model Lab"; the landing card and workspace header read it. The manifest name served by `/api/models` is unchanged.

**C4. Delivery Cost table names.** From and To show the ID with the place, e.g. `W8 · Chicago, IL` (`DeliveryCostsTab.tsx:249,258`), from the dataset already in scope at `Workspace.tsx:4231`. The dataset has no name field, only city and state, and city names repeat, so the ID stays first; filtering and sorting keep working on the ID.

**C5. Base Multiplier.** A number box and an Apply button next to Download (`DeliveryCostsTab.tsx:403`). Apply sets Cost = round2(Base × multiplier) for every row matching the current filter, across all pages (all 10,329 pairs when unfiltered), overwriting existing Cost, then saves as one scenario write (`laneCostOverrides`). The multiplier must be a positive number; Apply is disabled otherwise. The plan measures the serialised unfiltered write against the scenario body limit (`MAX_IMPORT_BYTES`, `app.ts:97`); if a write would exceed it, Apply writes nothing and says how many rows to filter down to. A failed save shows the server's sentence via `describeWriteError` (studio CLAUDE.md). Edited costs change the solve whether or not **Adjust Cost Table** is on: `solve.py:1828-1837` applies `laneCostOverrides` unconditionally (`test_delivery.py:143-152` proves it with the toggle off); the toggle only switches on the distance-tier pricing (`solve.py:1727-1731`). So the multiplier needs no toggle gating and the table shows no toggle note. (Corrected 2026-11-25: the Codex-review fold had claimed the reverse from a misread of `solve.py:1728`; caught while planning Part C.)

**C6. Two decimal places.** Base and Cost display with normal rounding to 2 dp (1047.7157 → 1047.72). Costs written by C5 are stored at 2 dp; hand-typed costs are stored as typed.

## Testing

Every item gets a test that fails before the change. Layout items (A5 height and highlight, A6 icon, C1 stacking, C2 placement) get a real-browser assertion, since jsdom cannot see CSS (studio CLAUDE.md). B5 gets a real-Postgres test proving the transaction removes exactly the user's rows and nothing else, plus the 409 path. B3/B4 get route tests for register/log-in with and without `acceptTerms`, and a session test for the version mismatch. Each part runs the full gate and the e2e gate with `E2E_BASE_URL` set before merge.

## Out of scope

Deleting data from third-party services; per-institution consent flows; translating the terms; changing how solves are priced or costed.
