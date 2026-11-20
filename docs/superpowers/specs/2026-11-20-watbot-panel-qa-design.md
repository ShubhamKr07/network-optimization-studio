# WatBot panel and Q&A (Spec 1) — design

Date: 2026-11-20 · Status: draft for review · Task prefix: `WATBOT`

WatBot is a Socratic tutor that lives in a docked panel inside each chapter model. It answers from the course book and notebooks, cites every factual claim to a printed page or notebook cell, and knows which tab, scenario and parameter the student is looking at. This spec covers the panel and open Q&A. The formulation check is Spec 2.

Sources: the PRD "WatBot in the Studio — Design Requirements" (Claude Doc, FR-1…FR-36) and the "WatBot Journey Screens" design canvas (artboards A1–E2). FR and artboard IDs below refer to those two documents.

## 1. Scope

| In Spec 1 | FRs | Artboards |
|---|---|---|
| Toolbar entry, docked panel, header, history | FR-1–4 | A1, A2 |
| Context chip that follows the student | FR-5–7 | A2, B2 |
| Fixed chapter questions + free-text box | FR-8, 9, 11 | A2 |
| Silent triage: fact → cited one-liner, concept → one guiding question first | FR-12–14 | B1, B2, A3 |
| Citations, source popover, uncited-claim removal, Report this answer | FR-15–18 | A3, B1, D3, E2 |
| Not covered / off-topic, service down, streaming, stop | FR-27, 28, 31 | D1, D3, E1 |
| Course materials + Haiku 5.5 on one server key, typed-only input, limits, concurrency | FR-32–36 | D3, D4 (waiting pill only) |

**Spec 2 (formulation check), not here:** FR-10 ("Check my formulation" button — hidden until Spec 2 ships), FR-19–26, FR-29, FR-30, artboards C1–C4 and the structure-check half of D4.

**Deferred (no spec yet):** instructor/class model, instructor-editable settings, a teaching-team view of reports and gaps, figures in the source popover.

## 2. Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | Split: Spec 1 = panel + Q&A; Spec 2 = formulation check; instructor plumbing deferred | One spec for all; formulation check first |
| D2 | Corpus = book text + chapter notebooks, with page-level citations and verbatim passages | Notebooks only; page refs without quotes |
| D3 | **Hybrid retrieval**: each model's reading-list bundle is in the prompt (cached), plus a `search_book` tool over the whole book via Postgres full-text search | Bundle only; whole book every time; pgvector RAG; eval first |
| D4 | Corpus source of truth in `nos-ops-private`; a committed one-off script loads it into Postgres. Deploys never touch the corpus | Render build step ingesting each deploy; Anthropic Files API; external vector store |
| D5 | Model `claude-haiku-5-5` via `@anthropic-ai/sdk`, one project-owned key, server-side only | Per-student keys; other models |
| D6 | Attempts per help level = fixed 3 (used by Spec 2) | Per-manifest value; instructor-editable now |
| D7 | Project cap $10/month enforced twice: Anthropic Console spend limit (hard stop) + app-side cost counter (friendly "limit reached" state) | App counter only; Console limit only |
| D8 | Keep $10/month and revisit once real spend is visible | Raise now; count users first |
| D9 | Reports and gaps go to a `watbot_reports` table, no UI | Table + email; drop reporting |
| D10 | Conversations kept until the account is deleted; owner-only | Rolling 90 days; session only |
| D11 | Below a 1280 px viewport, opening WatBot collapses the model tree to its icon rail | Overlay; narrower panel; nothing |
| D12 | Fixed questions drafted by the implementer from each chapter, approved by the project owner (or Prof. Watson) before ship | Owner supplies; one generic set |
| D13 | PRD pending suggestions accepted, with these edits: FR-32 reworded to the hybrid; FR-34 gains a 2,000-character question cap; FR-33's "configurable endpoint" is the `WATBOT_MODEL` env var | — |

Overkill check: every component below is the smallest one that closes its FR. The only new dependency is the official Anthropic SDK. No new infrastructure: the queue and availability flag live in nos-api memory (it runs as one instance), and search uses Postgres's built-in full-text search.

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
| `GET /watbot/passages/:id` | Full passage for "Open full source" (FR-16) |
| `POST /watbot/reports` | Report this answer (FR-18) |
| `GET /watbot/status` | `{available, studentRemaining, studentResetAt, projectCapReached}` |

Every conversation query filters by the authenticated `user_id`; non-owned ids return 404 (hard rule #5). A `scenarioId` in the context is re-read from the DB with the same ownership filter. The server builds the context summary itself (tab, scenario name, key parameter, and for solved scenarios the objective, open sites and stale flag). The DB row is the source of truth, as in the solve path, and the client never supplies the summary text.

JSON endpoints go through `lib/api-spec/openapi.yaml` + Orval (hard rule #1). The SSE endpoint is declared there too, but the studio reads it with `fetch` and a stream reader, because Orval does not generate streaming clients. Error codes are a closed union in TS, OpenAPI and the regenerated client, all in one task.

### Model call

One Messages API call per question, streamed:

| Order | Content | Cache |
|---|---|---|
| 1 | Tool definitions: `search_book`, `log_gap` | prefix |
| 2 | System prompt (frozen): Socratic rules, silent triage, citation rule, scope rule | prefix |
| 3 | Reading-list bundle: one `document` per chapter/notebook, one custom content block per page or cell, `citations: {enabled: true}` | breakpoint 1 |
| 4 | Conversation history (last 20 messages) | breakpoint 2 |
| 5 | Context summary + the new question | uncached |

- `search_book(query)`: Postgres `websearch_to_tsquery` over `course_passages`, excluding the bundle's chapters, top 5 by `ts_rank`. Results return as citable search-result content. At most 2 searches per question. Before relying on the citable search-result block shape, verify it against the live API docs at implementation time.
- `log_gap(topic, nearestCoveredTopic)`: the model calls this when the materials do not cover a question (FR-27). It writes a `watbot_reports` row of kind `gap`.
- `WATBOT_MODEL` (default `claude-haiku-5-5`) and `ANTHROPIC_API_KEY` are nos-api env vars; neither ever reaches the browser (FR-33).
- Native citations cannot be combined with structured JSON output, so triage (fact / concept / off-topic, FR-12, 13, 27) is done in the system prompt rather than a separate classification call.
- Cost per question is computed from `response.usage` and a per-model price table (input, output, cache write, cache read), and stored on the message.

## 5. Behaviour

### Answering

| Question type | Behaviour | FR |
|---|---|---|
| Simple fact | One cited sentence | FR-12 |
| Conceptual | One guiding question tied to the student's own map or form, then the cited explanation on the next turn | FR-13, 7 |
| Not covered | Says so, offers the nearest covered topic, calls `log_gap`; panel shows "gap logged for the teaching team" | FR-27 |
| Off-topic | One-line redirect to what the student was doing, no gap logged | FR-27 |
| "Just give me the answer" (outside the formulation check) | Gives the explanation (help levels exist only in Spec 2) | — |

### Streaming and citation verification (FR-17, 31)

The SSE stream carries these events:
- `queued {position}`: waiting for a model slot.
- `searching {query}`: shown as "Searching Chapter 6…".
- `block {text, citations[]}`: one per completed text block.
- `notice {kind}`: system notices such as an uncited claim removed.
- `done {messageId}`
- `error {code}`

The server buffers each text block until its stop event, then decides:

- Cited block: forwarded with its chips.
- Uncited block that is a guiding question (ends with "?"), or connective text under 12 words: forwarded.
- Any other uncited block: **dropped**, and one `notice` says "One claim was removed — I couldn't support it with a course source" (FR-17).

```
ponytail: word-count/question-mark heuristic decides what counts as a claim;
upgrade to a second-pass check only if reports show it misclassifying.
```

While a block is buffered, the panel shows the "checking source…" placeholder from E1. **Stop** aborts the upstream request (`AbortController`) and saves whatever blocks were already forwarded.

### Failure and limit states

| Condition | Detection | Panel state |
|---|---|---|
| Service down | Connection error, 5xx or 529 from Anthropic sets an in-memory `unavailable` flag for 60 s; the next success clears it | D3 "unavailable": input and fixed questions disabled (FR-28 as amended), conversation saved, toolbar dot |
| Student limit | ≥ 50 student messages in a rolling 24 h (DB count by `user_id`) | D3 "limit reached", with the time the earliest question ages out |
| Project cap, app side | Sum of this calendar month's (UTC) stored message costs ≥ `WATBOT_MONTHLY_USD` (default 10) | "WatBot has reached its monthly limit", input disabled |
| Project cap, API side | HTTP 400 `invalid_request_error`, "You have reached your specified API usage limits" | Same as above. Must **not** map to "unavailable" |
| Rate or ramp limit | 429 (`rate_limit_error`, incl. `ramp_limit_exceeded`) | Request goes back to the queue, honouring `retry-after`; the student sees `queued` |
| Busy | More than `WATBOT_MAX_INFLIGHT` (default 10) calls in flight | `queued {position}` pill (D4 styling); answered in order (FR-36) |
| Refusal | `stop_reason: "refusal"` | "I can't help with that one," with nothing saved as an answer |

```
ponytail: in-process queue and flags assume a single nos-api instance;
move to Postgres advisory locks if the API is ever scaled out.
```

Haiku 5.5 Start-tier limits (live docs, 2026-11-19): 4,000 requests/min, 2,000,000 input tokens/min, 400,000 output tokens/min. Cache reads do not count toward the input-token or ramp limits; cache writes do. A warm cache keeps 100 concurrent students well inside the limits. A cold-cache burst (100 × 31K ≈ 3.1M tokens) would not fit, which is what the in-flight cap prevents. Check the organization's actual tier in the Console before launch; new organizations can start lower.

### Cost

These are estimates. Inputs: list prices ($0.10 / $0.50 per million input/output tokens; cache read ≈ 0.1×, write ≈ 1.25× the input price), the ÷4 token estimate, and an assumed ~1.5K output tokens per answer.

| Ch 9 bundle (31K tokens) | Cost per question |
|---|---|
| Warm cache | ≈ $0.001 |
| Cold cache | ≈ $0.005 |

So $10/month buys ≈ 2,000–10,000 questions; a search adds one round trip.

## 6. Data model

All timestamps are `timestamptz` (see `lib/db/CLAUDE.md`). All FKs to users cascade on delete, so a manual account deletion removes the student's WatBot data.

```
watbot_conversations
  id uuid pk · user_id fk users on delete cascade · model_id text
  title text · created_at, updated_at timestamptz default now()

watbot_messages
  id uuid pk · conversation_id fk on delete cascade
  user_id fk users on delete cascade   -- denormalised so the 24 h count is one indexed query
  role text ('student' | 'tutor' | 'notice')
  blocks jsonb        -- [{text, citations:[{passageId,label,citedText}]}]
  context jsonb       -- {tab, scenarioId, summary} as sent; null if chip removed
  usage jsonb         -- tokens by kind + cost_usd; tutor rows only
  created_at timestamptz default now()
  index (conversation_id, created_at); index (user_id, role, created_at)

watbot_reports
  id uuid pk · user_id fk on delete cascade
  kind text ('report' | 'gap')
  message_id fk watbot_messages on delete cascade, null for gaps raised mid-answer
  reason text         -- E2's four: wrong_or_misleading | citation_unsupported |
                      --            not_what_i_asked | other
  note text           -- optional, ≤ 2,000 chars
  topic text          -- gaps: the uncovered topic
  context jsonb · sources jsonb · created_at timestamptz default now()
```

Reports keep their own user column, so the anonymous `feedback` table is not reused (its schema comment forbids adding a user column).

All tables are new and every NOT NULL column has a default or is written on insert, so hard rule #3's two-step protocol does not apply. The deploy still needs the manual schema push (`docs/ops/schema-push-before-deploy.md`) **before** nos-api ships.

## 7. Testing

- **Unit (api-server):**
  - bundle assembly from a manifest's `readingList`
  - the bundle-under-100K bound for every manifest (from stored passage lengths)
  - quota math (rolling 24 h, calendar month UTC)
  - the uncited-block filter (cited, guiding question, short connective, dropped claim)
  - error-to-state mapping, with the spend-limit 400 asserted distinct from "unavailable"
- **Route tests (supertest, real Postgres):**
  - non-owner gets 404 on every conversation and report route
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

## 8. Rollout

1. Schema push to production before the nos-api deploy (runbook).
2. Run the ingest against production once, from a machine holding the `nos-ops-private` checkout. Spot-check 10 random LaTeX formulas against the book first.
3. Set `ANTHROPIC_API_KEY`, `WATBOT_MODEL`, `WATBOT_MONTHLY_USD` and `WATBOT_MAX_INFLIGHT` on nos-api. An env change on a live service is a deploy-class action and needs its own approval.
4. Set the $10 organization spend limit in the Anthropic Console, and confirm the usage tier.
5. Fixed questions and reading lists approved (D12) — ship-blocking.

## 9. Open items

- Fixed-question wording and reading lists (section 3) are drafted and await approval (D12).
- Citation chip format changes from the canvas's "Ch 3.1 · p.78" to "Ch 3 · p.78": the book's sections are unnumbered.
- The source popover shows the passage only; book figures are deferred.
- Success measures (PRD open question) are deferred; the stored usage, reports and gaps make them computable later.
