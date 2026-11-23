# WatBot panel and Q&A (Spec 1) — design

Date: 2026-11-20 · Status: draft for review, updated to PRD rev 183 and the adversarial review (D20–D24); D20 revised 2026-11-22 (value check on cited blocks too) · Task prefix: `WATBOT`

WatBot is a Socratic tutor that lives in a docked panel inside each chapter model. It answers from the course book and notebooks, cites every factual claim to a printed page or notebook cell, and knows which tab, scenario and parameter the student is looking at. This spec covers the panel and open Q&A. The formulation check is Spec 2.

Sources: the PRD "WatBot in the Studio — Design Requirements" (Claude Doc, rev 183, FR-1…FR-45) and the "WatBot Journey Screens" design canvas (artboards A1–E2). FR and artboard IDs below refer to those two documents.

## 1. Scope

| In Spec 1 | FRs | Artboards |
|---|---|---|
| Toolbar entry, docked panel, header, history | FR-1–4 | A1, A2 |
| Context chip that follows the student | FR-5–7 | A2, B2 |
| Fixed chapter questions + free-text box | FR-8, 9, 11 | A2 |
| Silent triage: fact → one cited sentence, concept → cited explanation then one question | FR-12–14 | B1, B2, A3 |
| Citations, source popover, uncited-claim removal, Report this answer | FR-15–18 | A3, B1, D3, E2 |
| Not covered / off-topic, service down, streaming, stop | FR-27, 28, 31 | D1, D3, E1 |
| Course materials + Haiku 5.5 on one server key, typed-only input, limits, concurrency | FR-32–36 | D3, D4 (waiting pill only) |
| Five message types, per-type replies, answer rules (no-leak as a prompt rule, D14) | FR-37–41 | All |
| Message logging with type, sessions view | FR-42 | — |
| Test set + simulated students + leak rate, run before any instruction change ships | FR-44 (minus the automatic block) | — |
| Success measures: engagement and session duration | FR-45 (minus the correct-formulation share) | — |

**Spec 2 (formulation check), not here:** FR-10 ("Check my formulation" button — hidden until Spec 2 ships), FR-19–26, FR-29, FR-30, FR-43 (step plan, D16), FR-44's automatic block-and-regenerate (needs Spec 2's answer keys, D14), FR-45's "reached a correct formulation after help" share, artboards C1–C4 and the structure-check half of D4.

**Deferred (no spec yet):** instructor/class model, instructor-editable settings, a teaching-team view of reports and gaps, figures in the source popover, PostHog events for WatBot (FR-42 is met by SQL).

## 2. Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | Split: Spec 1 = panel + Q&A; Spec 2 = formulation check; instructor plumbing deferred | One spec for all; formulation check first |
| D2 | Corpus = book text + chapter notebooks, with page-level citations and verbatim passages | Notebooks only; page refs without quotes |
| D3 | **Hybrid retrieval**: each model's reading-list bundle is in the prompt (cached), plus a `search_book` tool over the whole book via Postgres full-text search | Bundle only; whole book every time; pgvector RAG; eval first |
| D4 | Corpus source of truth in `nos-ops-private`; a committed one-off script loads it into Postgres. Deploys never touch the corpus | Render build step ingesting each deploy; Anthropic Files API; external vector store |
| D5 | Model `claude-haiku-5-5` via `@anthropic-ai/sdk`, one project-owned key, server-side only | Per-student keys; other models |
| D6 | Attempts per help level = fixed 5, the PRD rev 183 default (FR-24; used by Spec 2) | Per-manifest value; instructor-editable now |
| D7 | Project cap $10/month enforced twice: Anthropic Console spend limit (hard stop) + app-side cost counter (friendly "limit reached" state) | App counter only; Console limit only |
| D8 | Keep $10/month and revisit once real spend is visible | Raise now; count users first |
| D9 | Reports go to a `watbot_reports` table and gaps to `watbot_messages.gap_topic` (D17), no UI | Table + email; drop reporting |
| D10 | Conversations kept until the account is deleted; owner-only | Rolling 90 days; session only |
| D11 | Below a 1280 px viewport, opening WatBot collapses the model tree to its icon rail | Overlay; narrower panel; nothing |
| D12 | Fixed questions drafted by the implementer from each chapter, approved by the project owner (or Prof. Watson) before ship | Owner supplies; one generic set |
| D13 | PRD pending suggestions accepted, with these edits: FR-32 reworded to the hybrid; FR-34 gains a 2,000-character question cap; FR-33's "configurable endpoint" is the `WATBOT_MODEL` env var | — |
| D14 | No-leak rule in Q&A protects what the student has **not** solved. WatBot may discuss anything the student's own solved scenario already shows (it is in the context summary). It never states an optimal facility set or objective value that is not in that summary, and never writes out a complete formulation. Spec 1 enforces this as a prompt rule, measured by the test set (D15). The automatic block-and-regenerate (FR-44) ships with Spec 2's answer keys | Strict everywhere (blocks FR-7 replies about the student's own map); formulation rule only |
| D15 | FR-44 test set gates Spec 1's first ship. The implementer drafts 100 messages (20 per type) and 6 simulated-student personas, and the owner approves them. A script grades leaks: exact match for objective values and facility sets, and a Haiku structured-output judge for "complete formulation". It is a manual, budgeted run, not part of the gate | Hand-graded formulation leaks; defer past Spec 1 |
| D16 | FR-43 step plan goes in Spec 2. Steps are tracked against the submitted model, and each step needs a book page (the PRD's Ch 3 draft has none yet) | Spec 1, with the model inferring the step from chat |
| D17 | PRD's draft `watbot_log` is merged into the spec's tables rather than adopted as is. Conversations stay (FR-4's history list groups by them), and reports stay a table (student-written reason and note). The draft's columns move onto `watbot_messages`, gaps become a column on the tutor message, and its sessions view is kept, partitioned per student **and model**. `user_id` stays `varchar` to match `users.id` (the draft's `bigint` does not match) | One row per exchange, as drafted |
| D18 | Message type is recorded through a `record_message_type` tool that the model calls first. Its tool result returns that type's reply rule, which steers the answer. Round 1 forces the call (`tool_choice` = `record_message_type`) on models in `FORCE_RECORD_MODELS` (Haiku 5.5 only; Opus and Sonnet 5.5 reject forced tool use with thinking on); later rounds, and every round on other models, use `auto`. The first recorded type governs: a later call gets the first type's rule, so the stored type and the followed rule never disagree. Under `auto` alone Haiku 5.5 skipped the call on 18 of the 100 test-set messages, mostly attempts; switching `tool_choice` after round 1 still read the whole bundle from cache in 4 of 4 probes | `auto` on every round (skips attempts); separate classifier call (same accuracy on the 100, adds ~1.3 s before the first word, and can disagree with how the reply behaved); thinking off (answer quality unmeasured); a type tag in the reply text (fragile parsing) |
| D19 | The 2-search cap is enforced in the tool result ("search limit reached, answer from what you have"), never by changing `tool_choice`. A tool result needs no second request shape. (The original reason, that changing `tool_choice` clears the cached bundle, did not hold when measured; see D18) | `tool_choice: none` after the cap |
| D20 | Every block, cited or not, gets a deterministic value check before it is forwarded (§5). A citation does not make a leaked value safe, so "cite everything" alone would not close the gap. Revised 2026-11-22 by the owner, after the WATBOT-FB Codex review found that a cited block bypassed the check. The cost: a cited explanation that names a candidate facility or a 4+-digit figure not on the student's screen is dropped, and the test set reports how often that happens | Cited blocks on the prompt rule plus the test set (the original D20; a cited leak passes); require citations on every block; runtime answer-key block in Spec 1 |
| D21 | Quota admission is atomic. Each user may have one question in flight, and the student-limit count and student-row insert happen under that per-user lock. Project spend is checked against stored cost **plus** a worst-case reservation for every admitted, unfinished question | Check-then-insert; overshoot bounded only by the Console limit |
| D22 | One finalisation path covers every way an answer can end: done, stopped, disconnected, provider failure, or the round guard. Each one saves whatever was forwarded and whatever usage was observed. A question counts toward the limits exactly when it reached the model (any round got `message_start`). One that never reached the model (stopped while queued, or failed before any usage) is logged as `cancelled`, `unavailable` or `limit_reached` and does not count. The spend reservation is released only after the actual usage row is written | Discard the partial answer; count every admitted question |
| D23 | `GET /watbot/passages/:id` returns a passage only if it is cited in a tutor message the requester owns. The risk is bulk download of the licensed book by enumerating ids. Reading-list scope is not a boundary, because `search_book` covers the whole book by design (D3) | Open by id; check against the reading list |
| D24 | A 429 from Anthropic re-queues the request rather than failing it. The SDK's automatic retries are off (`maxRetries: 0`), so the engine also owns the quick retry of transient 5xx, 529 and connection errors (2 retries, §5) that the SDK used to do. Both paths are required, not optional | SDK retries holding a slot; terminal `watbot_failed`; no transient retry, where one blip trips the 60 s flag for all students |

Overkill check: every component below is the smallest one that closes its FR. The only new dependency is the official Anthropic SDK. No new infrastructure: the queue and availability flag live in nos-api memory (it runs as one instance), search uses Postgres's built-in full-text search, and success measures are a SQL view plus saved queries, not an analytics pipeline. The one added cost is a model round trip per question for `record_message_type` (D18): about one warm cache read (≈ $0.0003 at 31K tokens, estimate) and a short delay before the first streamed text. A type tag in the reply would avoid it, but at the cost of parsing streamed text.

## 3. Course corpus

### Measured size

Measured from the book's EPUB on 2026-11-19 (characters of extracted text; tokens ≈ characters ÷ 4, an estimate, not a tokenizer count).

| Book chapter | Printed pages | Characters | ≈ Tokens | Images |
|---|---|---|---|---|
| 2. Center of Gravity | not measured | 25,364 | 6.3K | 9 |
| 3. Distance-Based Approach | 37–62 | 52,176 | 13.0K | 39 |
| 4. Service Levels and Sensitivity | 63–82 | 43,291 | 10.8K | 22 |
| 5. Adding Capacity | 83–98 | 38,509 | 9.6K | 7 |
| 6. Outbound Transportation | not measured | 58,285 | 14.6K | 19 |
| 7. Fixed and Variable Costs | not measured | 25,507 | 6.4K | 3 |
| 9. Three-Echelon | 157–176 | 40,503 | 10.1K | 10 |
| 10. Multiple Products | 177–206 | 57,002 | 14.3K | 34 |
| Whole book (15 chapters) | | 628,512 | 157K | |

Two facts from the EPUB shape the ingest:

1. **Printed page anchors survive** (`id="page_37"` …), so citations can name the printed page.
2. **Formulas are images.** The EPUB has no MathML; formulations are JPEGs. Extracted text silently drops them. The ingest therefore transcribes every formula image to LaTeX once (a vision-model pass), and the transcriptions are **hand-checked** before load. A transcription error would be cited back to students as the book's own words.

Notebooks enter the corpus as their markdown cells plus code cells under 5,000 characters. That drops the embedded data blobs: one Ch 3 code cell is 82,548 characters of data. Measured on 2026-11-20:

| Notebook | Cells kept | Characters | ≈ Tokens |
|---|---|---|---|
| NB 3 (`Chapter_3_Network_Design_Book`) | 30 / 32 | 50,390 | 12.6K |
| NB 5 (`Notebook_LP_Transportation_Problem_Chapter_5`) | 28 / 29 | 49,803 | 12.5K |
| NB 9 (`JADE_case_Chapter_9`) | 28 / 31 | 11,844 | 3.0K |
| NB 10 (`Notebook_Mining_Problem_Chapter_10`) | 29 / 30 | 52,087 | 13.0K |

The Chen's Cosmetics and COG notebooks are left out: they are almost all code and data, with under 300 characters of prose.

### Storage

One table, loaded by `scripts/watbot/ingest-corpus.ts` from a local checkout of `nos-ops-private` (the book text and LaTeX transcriptions never enter this public repo):

```
course_passages
  id           serial pk
  source_kind  text  not null    -- 'book' | 'notebook'
  chapter      int   not null
  locator      text  not null    -- printed page "78" or notebook cell "9"
  label        text  not null    -- citation chip text: "Ch 3 · p.78" / "NB 3 · cell 9"
  body         text  not null    -- page text with formulas inlined as LaTeX
  tsv          tsvector generated always as (to_tsvector('english', body)) stored
  unique (source_kind, chapter, locator)
  GIN index on tsv
```

The script upserts on the unique key, so re-running after a content fix is safe. It refuses to run without an explicit `--database-url`, and its tests use their own fixture rows only. (CLAUDE.md gotcha: a test suite must never be able to run a production data migration.)

The production corpus must come from a licensed copy of the book (publisher's or the authors' file).

### Reading lists (manifest data)

Each `solvers/<model>/manifest.json` gains an optional `tutor` block. It is optional and defaulted; it never goes in `required[]`, so existing rows and fixtures keep parsing:

```json
"tutor": {
  "readingList": [{ "kind": "book", "chapter": 9 }, { "kind": "book", "chapter": 6 },
                  { "kind": "book", "chapter": 7 }, { "kind": "notebook", "chapter": 9 }],
  "fixedQuestions": [{ "id": "q1", "text": "…", "tab": "output-map" }]
}
```

Draft reading lists, to be approved together with the fixed questions (D12). Anything outside a model's list is still reachable through `search_book`.

| Model | Reading list | Why | ≈ Bundle tokens |
|---|---|---|---|
| `p-median-us` | Ch 3, Ch 2, NB 3 | Ch 3 is the model; Ch 2 (center of gravity) is the intuition it builds on; NB 3 is its notebook | 31.9K |
| `max-coverage-us` | Ch 4, Ch 3 | Ch 4 is the service-level formulation (p.71–77); Ch 3 is the p-median it is contrasted with | 23.8K |
| `p-median-brazil` | Ch 5, Ch 3 | The Brazil case is Ch 5 p.93 ("How Capacity Constraints Can Change a Model"); Ch 3 is the uncapacitated base | 22.6K |
| `delivery-teaching-us` | Ch 5, Ch 3, Ch 6 | Ch 5 modified per the changelog; lane delivery costs are Ch 6's outbound-transportation material | 37.2K |
| `transport-coal` | Ch 5, NB 5 | Ch 5's classic transportation problem and coal mini case (p.98); NB 5 is its notebook | 22.1K |
| `two-echelon-jade-us` | Ch 9, Ch 6, Ch 7, NB 9 | Ch 9 is JADE; transport costs are taught in Ch 6 and fixed/variable costs in Ch 7 | 34.1K |
| `two-echelon-gold-au` | Ch 10, Ch 9, NB 10 | Gold mini case is Ch 10 p.203 (BOM, product sourcing p.193–196); Ch 9 links echelons; NB 10 is its notebook | 37.4K |
| `super-model` | Ch 6, 7, 8, 9, 10, 13 | Import-driven multi-product two-echelon: costs (6, 7), baselines for imported networks (8), echelons and products (9, 10), aggregating imported customers (13) | 63.8K |

Every bundle must stay under 100K tokens, where Haiku 5.5's input price rises 5×. `super-model` is the closest; a test asserts the bound using the stored passage lengths.

### Fixed questions (manifest data)

Three per model, following A2's pattern: what decision the model makes, how inputs become the model, how to read the output. `tab` marks the question as "For this tab" (FR-9), and `null` means no tab-specific marking. Pages are where WatBot's answer is grounded. The wording is a draft for approval (D12).

| Model | Id | Question | Tab | Grounded in |
|---|---|---|---|---|
| `p-median-us` | q1 | What decision is this model making, and what is it trying to minimize? | `optimization-parameters` | Ch 3 p.38 |
| | q2 | Why does each customer's demand multiply its distance in the objective? | `input-map` | Ch 3 p.43 |
| | q3 | How do I read this Output Map — why did the optimizer open these warehouses? | `output-map` | Ch 3 p.56 |
| `max-coverage-us` | q1 | How is maximizing coverage different from minimizing weighted distance in Chapter 3? | `null` | Ch 4 p.64, p.71 |
| | q2 | What does the service distance I set actually control in the model? | `optimization-parameters` | Ch 4 p.75 |
| | q3 | How do I read Service Stats — what did I trade to cover more demand? | `service-stats` | Ch 4 p.77 |
| `p-median-brazil` | q1 | What changes when each warehouse has a capacity limit? | `optimization-parameters` | Ch 5 p.86 |
| | q2 | Why can a customer be assigned to a warehouse that isn't its closest? | `customer-assignments` | Ch 5 p.93 |
| | q3 | Why did capacity limits change which warehouses open on this map? | `output-map` | Ch 5 p.93 |
| `delivery-teaching-us` | q1 | How does minimizing delivery cost differ from minimizing distance? | `null` | Ch 6 p.101 |
| | q2 | Where do the lane delivery costs come from, and how do they enter the model? | `null` | Ch 6 p.101 |
| | q3 | How do I read the Solution Summary — what is driving total cost? | `cost-summary` | Ch 5 p.86, Ch 6 |
| `transport-coal` | q1 | What does a transportation model decide — and what does it not decide? | `null` | Ch 5, p.98 |
| | q2 | How do mine capacities and station demands constrain the flows? | `mines` | Ch 5 p.98, NB 5 |
| | q3 | How do I read the Flows — which mine serves which station, and why? | `flows` | Ch 5 p.98, NB 5 |
| `two-echelon-jade-us` | q1 | What does a three-echelon model add over the warehouse-only models of earlier chapters? | `null` | Ch 9 p.160 |
| | q2 | How do plant capabilities and the costs on each leg shape where products flow? | `capability-matrix` | Ch 9 p.164, Ch 6–7 |
| | q3 | How do I read the Flows — why do products take these plant → warehouse → customer paths? | `flows` | Ch 9 p.166 |
| `two-echelon-gold-au` | q1 | Should the refinery sit closer to the mine or to the customers — what decides it? | `null` | Ch 10 p.203 |
| | q2 | What does the BOM ratio do to the volumes on each leg? | `optimization-parameters` | Ch 10 p.196, p.203 |
| | q3 | How do I read the Flows — why did this refinery win? | `flows` | Ch 10 p.203, NB 10 |
| `super-model` | q1 | What does this model decide once I import my own network? | `null` | Ch 9–10 |
| | q2 | How should I check my imported data before trusting the solution? | `null` | Ch 8 p.139, Ch 13 p.242 |
| | q3 | How do I compare this Solution Summary with my current network's baseline? | `cost-summary` | Ch 8 p.154 |

Tab ids are the workspace sidebar entry ids (`Workspace.tsx`). Where a model's relevant tab has no id in that list (delivery lane costs, the super model's import tabs), the question is untagged rather than guessed. A test asserts that every tagged `tab` is a real sidebar id for that model.

A model with no `tutor` block shows the panel without fixed questions and answers from search alone.

## 4. Architecture

### Frontend (`artifacts/studio`)

- `WatBotButton` in the `Workspace.tsx` toolbar: pressed state while open (FR-3), disabled with a status dot when `/watbot/status` reports unavailable (FR-28).
- `WatBotPanel`: 400 px, docked right; the model stays interactive (FR-2). Below 1280 px, opening it collapses `SidebarTree` to its icon rail (D11).
- Header: title, history button, close (FR-4). History opens a list of this user's conversations for the current model.
- Context chip, built from workspace state: tab label · scenario name · the model's key parameter (FR-5). Updates on tab or scenario change; the student can remove it, in which case the next question is sent without context (FR-6).
- Starters: the model's `tutor.fixedQuestions`, with the one whose `tab` matches the active tab marked "For this tab" (FR-8, 9).
- Message list: tutor, student and system notices are visually distinct (FR-14). Citation chips open a source popover (FR-16). Each cited reply shows "Report this answer" (FR-18).
- Input: always present; 2,000-character cap; disabled while answering, unavailable, or over a limit (FR-11, 31, 34, 35).

### API (`artifacts/api-server`, new `routes/watbot.ts`)

| Endpoint | Purpose |
|---|---|
| `POST /watbot/conversations` | Create a conversation for `{modelId}`; returns its id |
| `POST /watbot/conversations/:id/messages` | Ask `{question, context: {tab, scenarioId?} \| null}`; responds as an SSE stream |
| `GET /watbot/conversations?modelId=` | History list (FR-4) |
| `GET /watbot/conversations/:id` | Full conversation |
| `DELETE /watbot/conversations/:id` | Student deletes a conversation |
| `GET /watbot/passages/:id` | Full passage for "Open full source" (FR-16). Returned only when a tutor message owned by the requester cites that passage id; any other id gets 404 (D23) |
| `POST /watbot/reports` | Report this answer (FR-18) |
| `GET /watbot/status` | `{available, studentRemaining, studentResetAt, projectCapReached}` |

Every conversation query filters by the authenticated `user_id`; non-owned ids return 404 (hard rule #5). A `scenarioId` in the context is re-read from the DB with the same ownership filter. The server builds the context summary itself (tab, scenario name, key parameter, and for solved scenarios the objective, open sites and stale flag). The DB row is the source of truth, as in the solve path, and the client never supplies the summary text.

JSON endpoints go through `lib/api-spec/openapi.yaml` + Orval (hard rule #1). The SSE endpoint is declared there too, but the studio reads it with `fetch` and a stream reader, because Orval does not generate streaming clients. Error codes are a closed union in TS, OpenAPI and the regenerated client, all in one task: `watbot_unavailable | watbot_student_limit | watbot_project_limit | watbot_refused | watbot_failed | watbot_busy`.

### Model call

One streamed Messages API exchange per question: a first round that records the message type, then the answer, with up to 2 search rounds in between:

| Order | Content | Cache |
|---|---|---|
| 1 | Tool definitions: `record_message_type`, `search_book`, `log_gap` (sorted by name, never changed per request) | prefix |
| 2 | System prompt (frozen): the five types and their replies, answer rules (FR-41, D14), citation rule, scope rule | prefix |
| 3 | Reading-list bundle: one `document` per chapter/notebook, one custom content block per page or cell, `citations: {enabled: true}` | breakpoint 1 |
| 4 | Conversation history (last 20 messages) | breakpoint 2 |
| 5 | Context summary + the new question | uncached |

- `record_message_type(type)`: `type` is one of `concept_question | incorrect_attempt | correct_attempt | stuck_or_wants_answer | off_topic` (FR-37). The system prompt tells the model to call it first, before any text. The server stores the type on the student's message, and the tool result returns that type's reply rule from §5. If the model writes text without calling it, `message_type` stays null; the test set reports how often that happens (D15).
- `search_book(query)`: Postgres `websearch_to_tsquery` over `course_passages`, excluding the bundle's chapters, top 5 by `ts_rank`. Results return as citable search-result content. At most 2 searches per question. A third call gets a tool result saying the limit is reached; the cap never changes `tool_choice` (D19). Before relying on the citable search-result block shape, verify it against the live API docs at implementation time.
- `log_gap(topic, nearestCoveredTopic)`: the model calls this when the materials do not cover a question (FR-27). It sets `gap_topic` on the tutor message (D17).
- Round guard: at most 4 model rounds per question (type, 2 searches, answer). Exceeding it ends the answer with `watbot_failed`.
- `WATBOT_MODEL` (default `claude-haiku-5-5`) and `ANTHROPIC_API_KEY` are nos-api env vars; neither ever reaches the browser (FR-33).
- Native citations cannot be combined with structured JSON output, so classification is a tool call (D18), not a structured-output field.
- Cost per question is computed from `response.usage` summed over its rounds and a per-model price table (input, output, cache write, cache read), and stored on the message.

## 5. Behaviour

### Answering

| Message type (FR-37) | Reply | FR |
|---|---|---|
| `concept_question`, simple fact | One cited sentence, then one question for the student | FR-12, 41 |
| `concept_question`, conceptual | A two-to-four-sentence explanation from the cited passage, tied to the student's own map or form where the context has one, then one question for the student | FR-13, 7, 41 |
| `concept_question`, not covered | Says so, offers the nearest covered topic, calls `log_gap`; panel shows "gap logged for the teaching team" | FR-27 |
| `off_topic` | One generic line that declines, with no question and no citation; no gap logged (owner, 2026-11-23: was "returns to the current exercise") | FR-38, 27 |
| `incorrect_attempt` | Points at the error with a question; does not correct it | FR-39 |
| `correct_attempt` | Says specifically what is right, citing the passage, and stops: no question and no next step (owner, 2026-11-23: was "then moves to the next step") | FR-40 |
| `stuck_or_wants_answer` | A one-line reason it won't give the answer, then a pointed hint from a cited passage and one question. Help levels exist only in Spec 2 | FR-26 (spirit), 41 |

In Spec 1 the "exercise" is the chapter model the panel is open on. "Attempts" are the student's replies to WatBot's questions (most replies end with one; see the rules below).

Answer rules for every type (FR-41, D14):
- Replies are two to four sentences. The exceptions are the one-line off-topic decline and the fact answer.
- Every reply rests on a cited passage, except the off-topic decline.
- Every reply ends with one question, except after a correct attempt or an off-topic message (owner, 2026-11-23).
- No complete formulation.
- No optimal facility set or objective value that is not already in the student's context summary.

PRD rev 183 still carries the older order in two places: its goals bullet and B2's caption say a guiding question comes before the explanation. FR-13 and FR-41 are the normative text, and this spec follows them (§9).

### Streaming and citation verification (FR-17, 31)

The SSE stream carries these events:
- `queued {position}`: waiting for a model slot.
- `searching {query}`: shown as "Searching Chapter 6…". The query passes the same value check as a block (D20). A failing query is shown as "the course book" while the search itself still uses it (WATBOT-FB post-merge review).
- `block {text, citations[]}`: one per completed text block.
- `notice {kind}`: system notices such as an uncited claim removed.
- `done {messageId}`
- `error {code}`

The server buffers each text block until its stop event, then decides:

- Cited block: forwarded with its chips **only if it passes the value check** below (D20). A failing cited block is dropped with the same notice as an uncited claim.
- Uncited block that is a question to the student (ends with "?"), connective text under 12 words, or a block that finishes after the model has recorded `off_topic` for the message (the decline is uncited by design; WATBOT-REPLY-ENDINGS, 2026-11-23): forwarded **only if it passes the value check**. The check fails when the text contains:
  - a number of four or more digits, after removing commas and reading "M"/"million"/"k" forms;
  - or the name of a candidate facility: from the model's dataset (warehouse, plant, refinery or mine), plus, for a scenario in the context, the facilities in that scenario's own inputs (this is how `super-model`'s imported networks are covered). Names are matched as whole words with Unicode case folding.

  Either one is allowed if it also appears in the context summary, i.e. the student's own solved scenario (D14). A block that fails is dropped with the same notice as an uncited claim (D20).
- Any other uncited block: **dropped**, and one `notice` says "One claim was removed — I couldn't support it with a course source" (FR-17).

```
ponytail: word-count/question-mark heuristic decides what counts as a claim;
upgrade to a second-pass check only if reports show it misclassifying.
```

While a block is buffered, the panel shows the "checking source…" placeholder from E1. **Stop**, or the student's connection dropping, aborts the upstream request (`AbortController`). The engine then returns a partial result, never throws it away (D22):
- Blocks already forwarded are saved as the tutor message, followed by a `notice` row "Answer stopped". A buffered block that was never forwarded is not saved.
- Usage: input and cache tokens come from `message_start`. Output tokens come from the last `message_delta` if one arrived; otherwise they are estimated as forwarded characters ÷ 4 and marked `estimated: true` in `usage`.
- The student row stays `answered`, so the question counts toward the 50 (the model was used), and its cost counts toward the project cap.
- If the student stops while the question is still queued (initially or after a 429 re-queue) before any round reached the model, the student row becomes `cancelled`, which does not count, and the "Answer stopped" notice is still saved.
- Provider failure mid-answer (5xx, 529, connection error, spend-limit 400) after any `message_start`: the forwarded blocks and the observed usage are saved as the tutor row with a failure notice, and the student row stays `answered`. If the failure happened before any usage, the student row becomes `unavailable` or `limit_reached` (not counted), as before.

### Failure and limit states

| Condition | Detection | Panel state |
|---|---|---|
| Service down | Connection error, 5xx or 529 from Anthropic. Because the SDK's own retries are off (D24), the engine first retries the failed round itself: at most 2 retries, after 0.5 s and then 1.5 s, and only if none of that round's blocks were forwarded. Only when those retries are exhausted does it set an in-memory `unavailable` flag for 60 s, which the next success clears. A single blip therefore never disables WatBot for everyone | D3 "unavailable": input and fixed questions disabled (FR-28 as amended), conversation saved, toolbar dot |
| Student limit | ≥ 50 student messages in a rolling 24 h (DB count by `user_id`, every type, off-topic and fixed-question clicks included, FR-35). Only `answered` rows count; `cancelled`, `unavailable` and `limit_reached` rows are logged but not counted (D22). Admission is atomic (D21): a per-user in-process lock allows one question in flight, and the count and the student-row insert happen while it is held. A second concurrent question from the same user gets 409 `watbot_busy` | D3 "limit reached", with the time the earliest question ages out. `watbot_busy` is not shown in normal use, because the input is already disabled while answering |
| Project cap, app side | This calendar month's (UTC) stored message costs **plus** the in-memory reservations of admitted, unfinished questions + one new reservation ≥ `WATBOT_MONTHLY_USD` (default 10). Reservation per question = 5 rounds (`MAX_ROUNDS` + 1, because an answer-feedback R3 rejection grants one bonus round; WATBOT-FB) × (that model's bundle tokens + 20 history messages, taken as a 10K-token allowance, at the cache-write price) + 5 × `max_tokens` at the output price. A conservative estimate, released and replaced by actual cost on completion, stop or failure (D21). For `super-model` (63.8K bundle) it is ≈ $0.056, so 10 in-flight questions hold ≈ $0.56 (estimate, ÷4 tokens) | "WatBot has reached its monthly limit", input disabled |
| Project cap, API side | HTTP 400 `invalid_request_error`, "You have reached your specified API usage limits" | Same as above. Must **not** map to "unavailable" |
| Rate or ramp limit | 429 (`rate_limit_error`, incl. `ramp_limit_exceeded`), on any round. The SDK's automatic retry is off for 429 (D24) | The request releases its in-flight slot and goes back to the **front** of the queue, keeping its FIFO place. It is not re-admitted before `retry-after` (seconds, clamped to 1–60; 5 if absent or invalid), and the student sees `queued {position}`. At most 3 re-queues per question; a 4th 429 gives `watbot_failed`. Stop while re-queued removes it from the queue. Completed rounds are kept, so the retry resends only the failed round. A round is re-queued only if none of its blocks had been forwarded. A 429 that arrives after a block of that round was forwarded is treated as a provider failure, using the partial-save path (D22), so the student never sees duplicated text |
| Busy | More than `WATBOT_MAX_INFLIGHT` (default 10) calls in flight | `queued {position}` pill (D4 styling); answered in order (FR-36) |
| Refusal | `stop_reason: "refusal"` | "I can't help with that one," with nothing saved as an answer |

```
ponytail: in-process queue, flags, per-user locks and spend reservations assume a single nos-api instance;
move to Postgres advisory locks if the API is ever scaled out.
```

Haiku 5.5 Start-tier limits (live docs, 2026-11-19): 4,000 requests/min, 2,000,000 input tokens/min, 400,000 output tokens/min. Cache reads do not count toward the input-token or ramp limits; cache writes do. A warm cache keeps 100 concurrent students well inside the limits. A cold-cache burst (100 × 31K ≈ 3.1M tokens) would not fit, which is what the in-flight cap prevents. Check the organization's actual tier in the Console before launch; new organizations can start lower.

### Cost

These are estimates. Inputs: list prices ($0.10 / $0.50 per million input/output tokens; cache read ≈ 0.1×, write ≈ 1.25× the input price), the ÷4 token estimate, and an assumed ~1.5K output tokens per answer.

| Ch 9 bundle (31K tokens) | Cost per question |
|---|---|
| Warm cache | ≈ $0.001 |
| Cold cache | ≈ $0.005 |

So $10/month buys ≈ 2,000–10,000 questions. The `record_message_type` round adds ≈ $0.0003 (one warm read), and each search adds one more round trip.

## 6. Data model

All timestamps are `timestamptz` (see `lib/db/CLAUDE.md`). All FKs to users cascade on delete, so a manual account deletion removes the student's WatBot data.

Primary keys are `serial`, the repo's convention. Ownership filtering, not id opacity, is what prevents enumeration.

```
watbot_conversations
  id serial pk · user_id varchar fk users on delete cascade · model_id text
  title text · created_at, updated_at timestamptz default now()

watbot_messages
  id serial pk · conversation_id fk on delete cascade
  user_id varchar fk users on delete cascade   -- denormalised so the 24 h count is one indexed query
  role text ('student' | 'tutor' | 'notice')
  blocks jsonb        -- [{text, citations:[{passageId,label,citedText}]}]
  context jsonb       -- {tab, scenarioId, summary} as sent; null if chip removed
  message_type text   -- student rows: one of the five FR-37 types; null on tutor/notice rows,
                      -- or when the model skipped record_message_type
  status text not null default 'answered'  -- student rows: answered | cancelled | unavailable | limit_reached;
                                           -- only 'answered' counts toward the 24 h limit
  usage jsonb         -- tokens by kind + cost_usd, summed over rounds; tutor rows only
  latency_ms int      -- tutor rows: request start to done
  gap_topic text      -- tutor rows: set by log_gap (FR-27)
  created_at timestamptz default now()
  index (conversation_id, created_at); index (user_id, role, created_at)

watbot_reports
  id serial pk · user_id varchar fk on delete cascade
  message_id fk watbot_messages on delete cascade, not null
  reason text         -- E2's four: wrong_or_misleading | citation_unsupported |
                      --            not_what_i_asked | other
  note text           -- optional, ≤ 2,000 chars
  context jsonb · sources jsonb · created_at timestamptz default now()

watbot_sessions (view)
  -- PRD appendix draft, partitioned by (user_id, model_id) instead of the student alone,
  -- so "sessions per exercise" needs no attribution step. A gap > 30 min starts a new session.
  -- Over student messages with status = 'answered', joined to conversations for model_id.
  user_id, model_id, session_no, started_at, ended_at, messages, duration
```

Where the PRD draft's columns went (D17):
- `student_id` is `user_id`.
- `chapter` and `exercise_id` come from `model_id` through the conversation and manifest (one exercise per model in Spec 1).
- `student_text` and `reply_text` are the student and tutor rows.
- `cited_passage` is in `blocks[].citations`.
- `help_level` and `leak_blocked` are added by Spec 2, which introduces both.

The view is declared with Drizzle `pgView` so the schema push creates it. Task 1 verifies that `drizzle-kit push` (0.31) does create it. If it does not, the `CREATE VIEW` statement goes into the schema-push runbook step for this deploy.

Reports keep their own user column, so the anonymous `feedback` table is not reused (its schema comment forbids adding a user column). Gaps are a query over `watbot_messages.gap_topic`, as in the PRD draft.

FR-45 measures are saved SQL in `docs/ops/watbot-metrics.md`, read by the project owner only (FR-42):
- sessions per student and per model;
- the share of students with at least one WatBot message per model, out of students with a scenario for that model;
- average session duration;
- messages by type per model, which shows where students struggle;
- the leak rate, from the latest test-set run (D15).

The correct-formulation share comes with Spec 2.

All tables and the view are new, and every NOT NULL column has a default or is written on insert, so hard rule #3's two-step protocol does not apply. The deploy still needs the manual schema push (`docs/ops/schema-push-before-deploy.md`) **before** nos-api ships.

## 7. Testing

- **Unit (api-server):**
  - bundle assembly from a manifest's `readingList`
  - the bundle-under-100K bound for every manifest (from stored passage lengths)
  - quota math (rolling 24 h, calendar month UTC)
  - the uncited-block filter (cited, guiding question, short connective, dropped claim), plus short leaks: an under-12-word uncited block or a question carrying a 4+-digit objective or a facility name not in the context is dropped, and the same text is kept when the context summary contains it; a cited block carrying an unseen 4+-digit value or facility name is dropped too (D20)
  - the project-cap reservation: two admitted questions reserve two worst-case amounts, and the reservation is released on completion, stop and failure
  - the 429 path: a scripted 429 with `retry-after: 2` emits `queued`, releases the slot, keeps FIFO order ahead of later arrivals, retries only the failed round, and the 4th 429 gives `watbot_failed`; an invalid `retry-after` is clamped
  - error-to-state mapping, with the spend-limit 400 asserted distinct from "unavailable"
  - `record_message_type`: stores the type and returns the matching reply rule; a skipped call leaves `message_type` null
  - the search cap: a third `search_book` call gets the limit tool result, and **every round of one question sends identical `tools` and `system`**, with `tool_choice` forced to `record_message_type` on round 1 only, for `FORCE_RECORD_MODELS` only (D18); a second `record_message_type` call gets the first type's rule
  - the 24 h count excludes `limit_reached` and `unavailable` rows and includes off-topic ones
  - the `watbot_sessions` view: a 31-minute gap starts a new session and a 29-minute gap does not; sessions split by model (real Postgres)
- **Route tests (supertest, real Postgres):**
  - non-owner gets 404 on every conversation and report route
  - passages: an id cited in the requester's own tutor message returns 200; an uncited id and an id cited only in another user's message both return 404 (D23)
  - concurrent admission: with 49 counted messages, two simultaneous questions from one user admit exactly one, and the other gets 409 `watbot_busy`; the count never exceeds 50 (D21)
  - Stop mid-answer: forwarded blocks, the "Answer stopped" notice and the usage are saved; the student row stays `answered`; a block still buffered at stop is not saved (D22)
  - Stop while queued, initially and after a 429 re-queue: the student row becomes `cancelled` and does not count, the notice is saved, and the lock and reservation are released (D22)
  - provider failure after `message_start`, and after a forwarded block: the usage and blocks are saved, the student row stays `answered`, and the month's spend includes the cost; failure before any usage leaves the row uncounted (D22)
  - a 429 after a block of that round was forwarded is not re-queued: the stream shows the block exactly once and ends through the failure path (D24)
  - transient retry: one 529 followed by success answers normally and does **not** set the unavailable flag; three consecutive 529s set it; a 529 after a forwarded block is not retried (D24)
  - value check: a mixed-case facility name is dropped; a `super-model` facility imported in the context scenario's inputs but absent from the summary is dropped (D20)
  - foreign `scenarioId` in the context gets 404
  - the SSE stream with an injected fake Anthropic client emitting a scripted event sequence; no live API in the gate
- **Search (real Postgres):** `search_book` against fixture passages. Includes a non-vacuity check that a query known to match does return rows (CLAUDE.md: prove the probe can return non-zero).
- **Contract:** OpenAPI ↔ Orval output parity for the new endpoints and the error-code union, pinned to the TS constants, not literals.
- **Studio (vitest + RTL):**
  - panel open/close and the pressed state
  - context chip update and removal
  - "For this tab" marking
  - each failure state from a mocked status
  - citation popover
  - report form
- **e2e (Playwright):** panel journey with a stubbed SSE endpoint (seeded responses, no live model). Grep existing `e2e/*.spec.ts` for any toolbar or sidebar testids this changes.
- **Real-browser QA task (qa-sdet):** A1–E2 walkthrough against local servers.
- **Live smoke (manual, budgeted, not in the gate):** `scripts/watbot/smoke.ts` asks ~10 questions per app chapter, at least 2 of them cross-chapter, and reports citation presence, `search_book` use and cost. Needs explicit approval per run, since it spends real money.

### Test set and leak rate (FR-44, D15)

Run before the first ship and before any change to the system prompt, tools or reply rules ships. It is manual and budgeted, needs approval per run, and is never part of the gate.

- **Messages.** 100 test messages, 20 per type, spread across the 8 models. Each has a labelled type and a context, and some contexts include a solved scenario so that D14's "already visible" case is tested. Stored as JSON in the repo; they are student-style questions, not book text.
- **Simulated students.** Six personas, played by Haiku for 8 turns each against one model:
  - confused beginner;
  - answer-seeker;
  - off-topic wanderer;
  - confident but wrong;
  - quick and correct;
  - persistent "just give me the answer".
- **Answer keys for grading.** Each model's default scenario is solved once by the app's solver. Its objective value and open-site set are written to a numbers-only fixture.
- **Leak grading.**
  - **Exact match:** the reply contains the key's objective value (digits normalised: commas, rounding, "M"/"million" forms) or names every site in the key's open set, **and** that value is not in the message's context summary.
  - **Haiku judge:** a structured-output yes/no for "states the complete formulation".
- **Report**, per type:
  - leak rate;
  - classification agreement with the label;
  - share of replies that skipped `record_message_type`;
  - share of replies ending in a question;
  - cost of the run.
- **Bars (PRD):** no leaks on `stuck_or_wants_answer` and `incorrect_attempt`, and at most a few percent on the other types (5%, confirmed by the owner 2026-11-20). Missing a bar blocks the change. Tighten the instructions first; a live second check is added only if tightening fails (PRD: not covered here).
- **Cost:** estimated well under $1 a run (~150 tutor replies plus ~50 simulated-student and ~150 judge calls, warm cache). The script prints the measured cost.

The drafted messages and personas need owner approval before the first run, as with D12.

## 8. Rollout

1. Schema push to production before the nos-api deploy (runbook).
2. Run the ingest against production once, from a machine holding the `nos-ops-private` checkout. Spot-check 10 random LaTeX formulas against the book first.
3. Set `ANTHROPIC_API_KEY`, `WATBOT_MODEL`, `WATBOT_MONTHLY_USD` and `WATBOT_MAX_INFLIGHT` on nos-api. An env change on a live service is a deploy-class action and needs its own approval.
4. Set the $10 organization spend limit in the Anthropic Console, and confirm the usage tier.
5. Fixed questions and reading lists approved (D12): approved 2026-11-20.
6. Test-set messages and personas approved, and a test-set run passes the bars against the production prompt (D15). This is ship-blocking and needs its own spend approval.

## 9. Open items

- The implementation plan (`docs/superpowers/plans/2026-11-20-watbot-panel-qa.md`) predates D20–D24, which came from the Codex adversarial review of 2026-11-20. It must be rewritten against this spec and re-reviewed before execution.
- Citation chip format changes from the canvas's "Ch 3.1 · p.78" to "Ch 3 · p.78": the book's sections are unnumbered.
- The source popover shows the passage only; book figures are deferred.
- PRD rev 183 needs four touch-ups, not made here:
  - Its goals bullet and B2's caption still say a guiding question comes before the explanation, which contradicts FR-13 and FR-41.
  - Its open question on laptop widths is answered by D11.
  - Its open question on fixed-question wording is answered by §3 (approved).
  - Its log-table appendix is superseded by §6 (D17).
