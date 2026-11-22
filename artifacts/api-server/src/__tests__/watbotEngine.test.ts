// artifacts/api-server/src/__tests__/watbotEngine.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { WorkloadIdentityError } from "@anthropic-ai/sdk/lib/credentials/types";
import { keepUncitedBlock, passesValueCheck } from "../watbot/citations.js";
import { bundleTokens, costUsd, reservationUsd } from "../watbot/cost.js";
import { classifyAnthropicError, retryAfterMs } from "../watbot/errors.js";
import { extractNumbers, matchesValue } from "../watbot/numbers.js";
import { facilityNames } from "../watbot/facilities.js";
import { buildRequest, FORCE_RECORD_MODELS, REPAIR_RULES, REPLY_RULES, excludedTypeResult, repairQuestion, SEARCH_LIMIT_RESULT, TOOLS } from "../watbot/prompt.js";
import { answerQuestion, MAX_REQUEUES, MAX_ROUNDS, setTransientBackoffForTests, TRANSIENT_BACKOFF_MS, type AnswerInput, type EngineEvent, type RoundGate } from "../watbot/engine.js";
import type { WatBotClient } from "../watbot/client.js";
import { WATBOT_MESSAGE_TYPES } from "@workspace/db";

const bundle = [{ title: "Chapter 3", passages: [
  { id: 11, label: "Ch 3 · p.38", body: "P-median minimizes demand-weighted distance." },
  { id: 12, label: "Ch 3 · p.39", body: "Each customer is served by one facility." },
] }];

type Call = Anthropic.MessageStreamParams;
type Round =
  | { events: Anthropic.RawMessageStreamEvent[]; final: Partial<Anthropic.Message> }
  | { events?: Anthropic.RawMessageStreamEvent[]; error: unknown } // optional events, then the round fails (e.g. a 429)
  | { events: Anthropic.RawMessageStreamEvent[]; hang: true };  // streams, then waits until aborted (Stop)

const abortError = () => Object.assign(new Error("Request was aborted."), { name: "AbortError" });

// Scripted fake: one entry per round. Each request is deep-cloned on capture,
// so later rounds cannot mutate earlier captures.
function fakeClient(rounds: Round[]): WatBotClient & { calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    messages: {
      stream(params: Call, opts?: { signal?: AbortSignal }) {
        calls.push(structuredClone(params));
        const r = rounds[i++]!;
        if ("error" in r) {
          return {
            async *[Symbol.asyncIterator]() { for (const e of r.events ?? []) yield e; throw r.error; },
            finalMessage: async () => { throw r.error; },
          };
        }
        if ("hang" in r) {
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of r.events) yield e;
              await new Promise((_, reject) => {
                if (opts?.signal?.aborted) reject(abortError());
                opts?.signal?.addEventListener("abort", () => reject(abortError()));
              });
            },
            finalMessage: async () => { throw abortError(); },
          };
        }
        return {
          async *[Symbol.asyncIterator]() { for (const e of r.events) yield e; },
          finalMessage: async () => ({ usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [], stop_reason: "end_turn", ...r.final }) as Anthropic.Message,
        };
      },
    },
  } as unknown as WatBotClient & { calls: Call[] };
}

const apiErr = (status: number, message: string, error?: object, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message, ...error } }, message, new Headers(headers));
const rateLimited = (retryAfter?: string) =>
  ({ error: apiErr(429, "rate limited", { type: "rate_limit_error" }, retryAfter === undefined ? {} : { "retry-after": retryAfter }) });
const messageStart = (inputTokens: number) =>
  ({ type: "message_start", message: { usage: { input_tokens: inputTokens, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never as Anthropic.RawMessageStreamEvent;
const recordingGate = () => { const waits: number[] = []; const gate: RoundGate = { requeue: async (ms) => { waits.push(ms); } }; return { gate, waits }; };

const textBlock = (index: number, text: string, citations: unknown[]): Anthropic.RawMessageStreamEvent[] => [
  { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } } as never,
  { type: "content_block_delta", index, delta: { type: "text_delta", text } } as never,
  ...citations.map((citation) => ({ type: "content_block_delta", index, delta: { type: "citations_delta", citation } }) as never),
  { type: "content_block_stop", index } as never,
];

const toolRound = (id: string, name: string, input: object) => ({
  events: [] as Anthropic.RawMessageStreamEvent[],
  final: { stop_reason: "tool_use" as const, content: [{ type: "tool_use", id, name, input } as Anthropic.ToolUseBlock] },
});
const answerRound = (text: string) => ({ events: textBlock(0, text, []), final: { stop_reason: "end_turn" as const } });

// Transient-retry backoff is zeroed by default here; tests that need real delays call setTransientBackoffForTests.
beforeEach(() => setTransientBackoffForTests([0, 0]));
afterEach(() => setTransientBackoffForTests(null));
const baseInput = (client: WatBotClient, extra: Partial<AnswerInput> = {}): AnswerInput => ({
  client, model: "claude-haiku-5-5", bundle, readingList: [], fixedQuestions: [], facilityNames: [], history: [], contextSummary: "",
  question: "q", emit: () => {}, signal: new AbortController().signal, ...extra,
});

// Last user turn of a captured request = the tool results the engine sent back.
const lastToolResults = (call: Call) =>
  (call.messages[call.messages.length - 1]!.content as Anthropic.ToolResultBlockParam[]);

describe("keepUncitedBlock", () => {
  it.each([
    ["Which part of the story rules that out?", true],
    ["Good question.", true],
    ["Open-site counts scale roughly with the square root of demand points in this dataset overall.", false],
  ])("%s → %s", (text, keep) => expect(keepUncitedBlock(text)).toBe(keep));
});

describe("extractNumbers / matchesValue", () => {
  it.each([
    ["Total cost 1,234,567.89 and 12 sites", [1234567.89, 12]],
    ["about $1.23M overall", [1230000]],
    ["roughly 1.2 million", [1200000]],
    ["4.5 M ton-miles", [4500000]],
    ["about 45k tons", [45000]],
    ["450 m from the plant", [450]], // lowercase m is a distance unit, never "million"
    ["a 5 km radius", [5]],          // "km" is not the k multiplier
  ])("extracts %s", (text, expected) => expect(extractNumbers(text)).toEqual(expected));
  it.each([
    [1234567, true], [1234570, true], [1235000, true], [1200000, true],
    [1000000, false], // 1 significant figure is too coarse to count as the value
    [1300000, false], [7, false],
  ])("%d matches 1234567 → %s", (candidate, expected) => expect(matchesValue(candidate, 1234567)).toBe(expected));
});

// D20 — short uncited blocks that pass keepUncitedBlock still may not carry a value or site the student hasn't seen.
describe("passesValueCheck", () => {
  it("does not unlock a precise value from a coarser shown number (no reverse match)", () => {
    expect(passesValueCheck("The total is 1,234,567.", [], "objective 1200000")).toBe(false);
  });
  const names = ["Allentown", "Chicago"];
  it("drops a short leak: a 4+-digit value not in the context", () => {
    expect(keepUncitedBlock("The best total is 1,234,567.")).toBe(true); // short enough to pass the word rule…
    expect(passesValueCheck("The best total is 1,234,567.", names, "")).toBe(false); // …so the value check must catch it
  });
  it("drops a question carrying an objective value or a facility name", () => {
    expect(passesValueCheck("Is it about 1.23 million?", names, "")).toBe(false);
    expect(passesValueCheck("Should Allentown be open?", names, "")).toBe(false);
  });
  it("keeps the same text when the context summary already shows the value or name (D14)", () => {
    const ctx = "Tab: output-map · Scenario: Baseline · p = 3 · objective 1234567 · open sites: Allentown, Chicago";
    expect(passesValueCheck("The best total is 1,234,567.", names, ctx)).toBe(true);
    expect(passesValueCheck("Is it about 1.23 million?", names, ctx)).toBe(true);
    expect(passesValueCheck("Should Allentown be open?", names, ctx)).toBe(true);
  });
  it("ignores numbers under four digits and names only as whole words", () => {
    expect(passesValueCheck("What happens with p = 3 and 450 miles?", names, "")).toBe(true);
    expect(passesValueCheck("What would Chicagoland customers see?", names, "")).toBe(true);
  });
  it("matches names case-insensitively, after Unicode folding", () => {
    expect(passesValueCheck("should ALLENTOWN be open?", names, "")).toBe(false);
    expect(passesValueCheck("Is chicago the hub?", names, "")).toBe(false);
    expect(passesValueCheck("should ALLENTOWN be open?", names, "open sites: allentown")).toBe(true);
    expect(passesValueCheck("Is ＢＥＬÉＭ closer?", ["Belém"], "")).toBe(false); // full-width + accented, NFKC-folded
  });
});

describe("facilityNames", () => {
  it("reads candidate-facility cities from the model's dataset (non-vacuous)", () => {
    expect(facilityNames("p-median-us")).toContain("Allentown");
    expect(facilityNames("p-median-us").length).toBeGreaterThan(10);
    for (const id of ["p-median-brazil", "max-coverage-us", "delivery-teaching-us", "transport-coal", "two-echelon-jade-us", "two-echelon-gold-au"]) {
      expect(facilityNames(id).length, id).toBeGreaterThan(0);
    }
  });
  it("has no dataset names for super-model, and takes imported facilities from the context scenario's inputs", () => {
    expect(facilityNames("super-model")).toEqual([]);
    const inputs = { warehouses: [{ id: "W1", city: "Fresno" }, { id: "Depot North" }], plants: [{ id: "P1", city: "Stockton" }] };
    expect(facilityNames("super-model", inputs)).toEqual(["Fresno", "Depot North", "Stockton"]);
    expect(facilityNames("p-median-us", { addedWarehouses: [{ id: "X1", city: "Fresno" }] })).toContain("Fresno");
    expect(facilityNames("p-median-us", { addedWarehouses: [{ id: "X1", city: "Fresno" }] })).toContain("Allentown");
  });
});

describe("costUsd and the D21 reservation", () => {
  it("fails closed: an unknown model is priced strictly above Haiku, and its reservation exceeds the default $10 cap", () => {
    const u = { input_tokens: 1000, output_tokens: 1000 } as Anthropic.Usage;
    expect(costUsd("not-a-real-model", u)).toBeGreaterThan(costUsd("claude-haiku-5-5", u));
    expect(reservationUsd("not-a-real-model", 63_800)).toBeGreaterThan(10);
  });
  it("drops empty history turns and keeps cache_control on the last non-empty one", () => {
    const req = buildRequest({ model: "m", bundle: [], fixedQuestions: [], contextSummary: "", question: "q",
      history: [{ role: "student", text: "a" }, { role: "tutor", text: "   " }, { role: "student", text: "b" }, { role: "tutor", text: "" }] });
    const texts = req.messages.slice(1, -1).map((m) => (m.content as Anthropic.TextBlockParam[])[0]!);
    expect(texts.map((t) => t.text)).toEqual(["a", "b"]);
    expect(texts[0]!.cache_control).toBeUndefined();
    expect(texts[1]!.cache_control).toEqual({ type: "ephemeral" });
  });
  it("prices Haiku 5.5 input, output, cache read and cache write", () => {
    const usd = costUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 } as Anthropic.Usage);
    expect(usd).toBeCloseTo(0.10 + 0.50 + 0.01 + 0.125, 6);
  });
  it("reserves 5 × (bundle + 10K) at the cache-write price + 5 × max_tokens at the output price", () => {
    // 4 rounds + the one bonus round an R3 rejection can add; super-model's 63.8K bundle reserves ≈ $0.056
    expect(reservationUsd("claude-haiku-5-5", 63_800)).toBeCloseTo(5 * 73_800 * 0.125 / 1e6 + 5 * 4000 * 0.5 / 1e6, 9);
    expect(reservationUsd("claude-haiku-5-5", 63_800)).toBeCloseTo(0.056, 3);
  });
  it("estimates bundle tokens as characters ÷ 4", () => {
    expect(bundleTokens(bundle)).toBe(Math.round((bundle[0]!.passages[0]!.body.length + bundle[0]!.passages[1]!.body.length) / 4));
  });
});

describe("retryAfterMs (D24)", () => {
  it.each([
    [{ "retry-after": "2" }, 2000],
    [{ "retry-after": "120" }, 60_000],  // clamped to 60 s
    [{ "retry-after": "0" }, 1000],      // clamped to 1 s
    [{ "retry-after": "soon" }, 5000],   // invalid → 5 s
    [{}, 5000],                          // missing → 5 s
  ])("%j → %d ms", (headers, ms) => expect(retryAfterMs(apiErr(429, "slow", {}, headers as Record<string, string>))).toBe(ms));
});

describe("classifyAnthropicError", () => {
  it("maps the user-set spend limit 400 to project_limit (not unavailable)", () => {
    expect(classifyAnthropicError(apiErr(400, "You have reached your specified API usage limits. You will regain access on 2026-12-01"))).toBe("project_limit");
  });
  it("maps the tier spend-cap 429 to project_limit", () => {
    expect(classifyAnthropicError(apiErr(429, "cap", { details: { error_code: "enforced_spend_limit_reached" } }))).toBe("project_limit");
  });
  it("maps other 429s (incl. ramp limits) to rate_limited", () => {
    expect(classifyAnthropicError(apiErr(429, "slow down", { details: { error_code: "ramp_limit_exceeded" } }))).toBe("rate_limited");
  });
  it("maps 5xx, 529 and connection errors to unavailable", () => {
    expect(classifyAnthropicError(apiErr(529, "overloaded"))).toBe("unavailable");
    expect(classifyAnthropicError(new Anthropic.APIConnectionError({ message: "down" }))).toBe("unavailable");
  });
  it("maps 401 and 403 (invalid key / permission) to unavailable", () => {
    expect(classifyAnthropicError(apiErr(401, "invalid x-api-key"))).toBe("unavailable");
    expect(classifyAnthropicError(apiErr(403, "forbidden"))).toBe("unavailable");
  });
  it("maps the SDK missing-credentials error to unavailable, but other unknown errors stay failed", () => {
    expect(classifyAnthropicError(new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.'))).toBe("unavailable");
    expect(classifyAnthropicError(new Error("boom"))).toBe("failed");
  });  it("maps a failed OIDC token exchange (Render workload identity) to unavailable", () => {
    expect(classifyAnthropicError(new WorkloadIdentityError("Token exchange failed with status 401: rule mismatch", 401))).toBe("unavailable");
    expect(classifyAnthropicError(new WorkloadIdentityError("oidc_federation config requires organization_id"))).toBe("unavailable");
  });
});

describe("buildRequest", () => {
  it("puts the bundle in cached, citation-enabled content documents and history as plain text", () => {
    const req = buildRequest({ model: "claude-haiku-5-5", bundle, fixedQuestions: ["What decision is this model making?"], history: [{ role: "student", text: "hi" }, { role: "tutor", text: "hello" }], contextSummary: "Output Map · Baseline · p = 4", question: "Why?" });
    const first = req.messages[0]!.content as Anthropic.ContentBlockParam[];
    const doc = first[0] as Anthropic.DocumentBlockParam;
    expect(doc.citations).toEqual({ enabled: true });
    expect((doc.source as Anthropic.ContentBlockSource).content).toHaveLength(2);
    const intro = first[first.length - 1] as Anthropic.TextBlockParam;
    expect(intro.cache_control).toEqual({ type: "ephemeral" });
    expect(intro.text).toContain("Q1. What decision is this model making?");
    const last = req.messages[req.messages.length - 1]!;
    expect(JSON.stringify(last)).toContain("Output Map · Baseline · p = 4");
    expect(JSON.stringify(req.messages)).not.toContain('"citations":[');
  });

  it("declares the three tools sorted by name, with tool_choice auto", () => {
    const req = buildRequest({ model: "m", bundle, fixedQuestions: [], history: [], contextSummary: "", question: "q" });
    const names = (req.tools as Anthropic.Tool[]).map((t) => t.name);
    expect(names).toEqual(["log_gap", "record_message_type", "search_book"]);
    expect(names).toEqual([...names].sort());
    expect(req.tool_choice).toEqual({ type: "auto" });
  });

  it("record_message_type accepts exactly the five FR-37 types, each with a reply rule", () => {
    const tool = TOOLS.find((t) => t.name === "record_message_type")!;
    expect((tool.input_schema.properties as { type: { enum: string[] } }).type.enum).toEqual([...WATBOT_MESSAGE_TYPES]);
    expect(Object.keys(REPLY_RULES).sort()).toEqual([...WATBOT_MESSAGE_TYPES].sort());
  });
});

describe("answerQuestion", () => {
  it("forwards cited blocks, drops uncited claims once, keeps guiding questions; a skipped type call leaves messageType null", async () => {
    const client = fakeClient([{ events: [
      ...textBlock(0, "Demand weights each distance", [{ type: "content_block_location", cited_text: "P-median minimizes demand-weighted distance.", document_index: 0, document_title: "Chapter 3", start_block_index: 0, end_block_index: 1 }]),
      ...textBlock(1, "Open-site counts scale roughly with the square root of demand points in this dataset overall.", []),
      ...textBlock(2, "What would happen with p = 1?", []),
    ], final: { stop_reason: "end_turn" } }]);
    const events: EngineEvent[] = [];
    const result = await answerQuestion(baseInput(client, { readingList: [{ kind: "book", chapter: 3 }], question: "Why?", emit: (e) => events.push(e) }));
    expect(result.blocks.map((b) => b.text)).toEqual(["Demand weights each distance", "What would happen with p = 1?"]);
    expect(result.blocks[0]!.citations).toEqual([{ passageId: 11, label: "Ch 3 · p.38", citedText: "P-median minimizes demand-weighted distance." }]);
    expect(events.filter((e) => e.type === "notice")).toEqual([{ type: "notice", kind: "claim_removed" }]);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.messageType).toBeNull();
    expect(result.gapTopic).toBeNull();
    expect(result).toMatchObject({ failure: null, stopped: false, reachedModel: true });
  });

  it("record_message_type stores the type and returns that type's reply rule", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "incorrect_attempt" }),
      answerRound("Which constraint does that choice break?"),
    ]);
    const result = await answerQuestion(baseInput(client));
    expect(result.messageType).toBe("incorrect_attempt");
    expect(lastToolResults(client.calls[1]!)).toEqual([{ type: "tool_result", tool_use_id: "t1", content: REPLY_RULES.incorrect_attempt }]);
  });

  // M1: the stored type and the rule the model follows must never disagree.
  it("a second record_message_type call gets the first type's reply rule, and the stored type stays the first", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "incorrect_attempt" }),
      toolRound("t2", "record_message_type", { type: "correct_attempt" }),
      answerRound("Which constraint does that choice break?"),
    ]);
    const result = await answerQuestion(baseInput(client));
    expect(result.messageType).toBe("incorrect_attempt");
    expect(lastToolResults(client.calls[2]!)).toEqual([{ type: "tool_result", tool_use_id: "t2", content: REPLY_RULES.incorrect_attempt }]);
  });

  // WATBOT-FB R1/R2: the repair rule follows the type's own rule.
  it("appends the repair rule to the recorded type's reply rule", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "incorrect_attempt" }),
      answerRound("Which constraint does that choice break?"),
    ]);
    await answerQuestion(baseInput(client, { repair: { rule: REPAIR_RULES.too_many_questions, excludeType: null } }));
    expect(lastToolResults(client.calls[1]!)).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: `${REPLY_RULES.incorrect_attempt}\n\n${REPAIR_RULES.too_many_questions}` },
    ]);
  });

  // WATBOT-FB R3: the ruled-out type is rejected and not stored; the next valid one is.
  it("rejects the excluded type, then stores the next type with its normal rule", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "concept_question" }),
      toolRound("t2", "record_message_type", { type: "stuck_or_wants_answer" }),
      answerRound("What does the passage say about it?"),
    ]);
    const result = await answerQuestion(baseInput(client, { repair: { rule: null, excludeType: "concept_question" } }));
    expect(lastToolResults(client.calls[1]!)).toEqual([{ type: "tool_result", tool_use_id: "t1", is_error: true, content: excludedTypeResult("concept_question") }]);
    expect(lastToolResults(client.calls[2]!)).toEqual([{ type: "tool_result", tool_use_id: "t2", content: REPLY_RULES.stuck_or_wants_answer }]);
    expect(result.messageType).toBe("stuck_or_wants_answer");
    // QA (live R3): with auto on round 2 the model answered without re-recording, leaving the type
    // null. After a rejection the next round is forced again; the round after a valid record is auto.
    expect(client.calls.map((c) => c.tool_choice)).toEqual([
      { type: "tool", name: "record_message_type" }, { type: "tool", name: "record_message_type" }, { type: "auto" },
    ]);
  });

  // Review fix 1: a rejection is not a round against the budget (once per question).
  it("a rejected record does not use up a round: reject, record, search, search, answer completes", async () => {
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "concept_question" }),
      toolRound("t2", "record_message_type", { type: "stuck_or_wants_answer" }),
      toolRound("s1", "search_book", { query: "a" }),
      toolRound("s2", "search_book", { query: "b" }),
      answerRound("What does the passage say about it?"),
    ]);
    const events: EngineEvent[] = [];
    const result = await answerQuestion(baseInput(client, { repair: { rule: null, excludeType: "concept_question" }, deps: { searchBook: vi.fn().mockResolvedValue([]) }, emit: (e) => events.push(e) }));
    expect(result.failure).toBeNull();
    expect(result.messageType).toBe("stuck_or_wants_answer");
    expect(events.some((e) => e.type === "block")).toBe(true);
    expect(client.calls).toHaveLength(MAX_ROUNDS + 1);
  });

  // Review fix 3: a valid record in the same response as the rejected one cancels the forced round.
  it("does not force a round when the same response also records a valid type", async () => {
    const two = { events: [] as Anthropic.RawMessageStreamEvent[], final: { stop_reason: "tool_use" as const, content: [
      { type: "tool_use", id: "t1", name: "record_message_type", input: { type: "concept_question" } },
      { type: "tool_use", id: "t2", name: "record_message_type", input: { type: "stuck_or_wants_answer" } },
    ] as Anthropic.ToolUseBlock[] } };
    const client = fakeClient([two, answerRound("What does the passage say about it?")]);
    const result = await answerQuestion(baseInput(client, { repair: { rule: null, excludeType: "concept_question" } }));
    expect(result.messageType).toBe("stuck_or_wants_answer");
    expect(client.calls.map((c) => c.tool_choice)).toEqual([{ type: "tool", name: "record_message_type" }, { type: "auto" }]);
  });

  // Review fix 2: the displayed search query is value-checked; the search itself is not changed.
  it("shows a plain search query as is, and 'the course book' for one carrying an unseen value", async () => {
    for (const [query, shown] of [["aggregation", "aggregation"], ["optimal cost 1234567", "the course book"]] as const) {
      const events: EngineEvent[] = [];
      const searchBook = vi.fn().mockResolvedValue([]);
      const client = fakeClient([toolRound("s1", "search_book", { query }), answerRound("Which part of it is unclear?")]);
      await answerQuestion(baseInput(client, { emit: (e) => events.push(e), deps: { searchBook } }));
      expect(events[0]).toEqual({ type: "searching", query: shown });
      expect(searchBook).toHaveBeenCalledWith(query, []);
    }
  });

  // F9 / Spec 1 D20 (revised): a citation does not make a leaked value safe, in any answer.
  it("drops a cited block that carries an unseen value, and keeps it when the context shows the value", async () => {
    const cited = { type: "content_block_location", cited_text: "x", document_index: 0, document_title: bundle[0]!.title, start_block_index: 0, end_block_index: 1 };
    const round = () => [toolRound("t1", "record_message_type", { type: "stuck_or_wants_answer" }),
      { events: textBlock(0, "The total cost is 1,234,567 in this solution.", [cited]), final: { stop_reason: "end_turn" as const } }];
    const events: EngineEvent[] = [];
    const hidden = await answerQuestion(baseInput(fakeClient(round()), { emit: (e) => events.push(e) }));
    expect(hidden.blocks).toHaveLength(0);
    expect(hidden.claimsRemoved).toBe(1);
    expect(events).toContainEqual({ type: "notice", kind: "claim_removed" });
    const shown = await answerQuestion(baseInput(fakeClient(round()), { shownFacts: "objective 1234567" }));
    expect(shown.blocks).toHaveLength(1); // non-vacuity: the citation itself is accepted, only the value decides
    const repaired = await answerQuestion(baseInput(fakeClient(round()), { repair: { rule: REPAIR_RULES.too_many_questions, excludeType: null } }));
    expect(repaired.blocks).toHaveLength(0);
  });

  it("repairQuestion puts the re-answer note after the original question; REPAIR_RULES has no rule for R3", () => {
    expect(repairQuestion("Why p = 3?", "hard_to_follow")).toBe('Why p = 3?\n\n(Re-answer: the student asked "Explain it step by step" about your previous reply.)');
    expect(REPAIR_RULES.not_what_i_asked).toBeNull();
  });

  // M2: forced tool use 400s on models that reject it with thinking on; those keep auto.
  it("forces record_message_type on round 1 only for models in FORCE_RECORD_MODELS", async () => {
    const client = fakeClient([answerRound("What does the passage say?")]);
    await answerQuestion(baseInput(client, { model: "claude-sonnet-5-5" }));
    expect(FORCE_RECORD_MODELS.has("claude-sonnet-5-5")).toBe(false);
    expect(client.calls[0]!.tool_choice).toEqual({ type: "auto" });
  });

  it("runs search_book, sends search_result blocks back, and maps their citations", async () => {
    const searchBook = vi.fn().mockResolvedValue([{ id: 77, label: "Ch 13 · p.242", body: "Validate the aggregation." }]);
    const client = fakeClient([
      toolRound("tu1", "search_book", { query: "aggregation" }),
      { events: textBlock(0, "Validate it first", [{ type: "search_result_location", cited_text: "Validate the aggregation.", source: "passage:77", title: "Ch 13 · p.242", search_result_index: 0, start_block_index: 0, end_block_index: 1 }]), final: { stop_reason: "end_turn" } },
    ]);
    const events: EngineEvent[] = [];
    const result = await answerQuestion(baseInput(client, { question: "How?", emit: (e) => events.push(e), deps: { searchBook } }));
    expect(events[0]).toEqual({ type: "searching", query: "aggregation" });
    const round2 = JSON.stringify(client.calls[1]);
    expect(round2).toContain('"type":"search_result"');
    expect(round2).toContain('"source":"passage:77"');
    expect(result.blocks[0]!.citations[0]!.passageId).toBe(77);
  });

  // Spec §7: the search cap, and the cache invariant behind D18/D19.
  it("answers a third search with the limit result; forces record_message_type on round 1 only; keeps tools and system identical", async () => {
    const searchBook = vi.fn().mockResolvedValue([]);
    const events: EngineEvent[] = [];
    const client = fakeClient([
      toolRound("s1", "search_book", { query: "a" }),
      toolRound("s2", "search_book", { query: "b" }),
      toolRound("s3", "search_book", { query: "c" }),
      answerRound("What does the passage you have say?"),
    ]);
    await answerQuestion(baseInput(client, { emit: (e) => events.push(e), deps: { searchBook } }));
    expect(client.calls).toHaveLength(4);
    expect(searchBook).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "searching")).toHaveLength(2);
    expect(lastToolResults(client.calls[3]!)).toEqual([{ type: "tool_result", tool_use_id: "s3", content: SEARCH_LIMIT_RESULT }]);
    expect(SEARCH_LIMIT_RESULT).toBe("Search limit reached. Answer from the passages you already have.");
    expect(client.calls[0]!.tool_choice).toEqual({ type: "tool", name: "record_message_type" });
    for (const call of client.calls.slice(1)) expect(call.tool_choice).toEqual({ type: "auto" });
    for (const call of client.calls) {
      expect(JSON.stringify(call.tools)).toBe(JSON.stringify(client.calls[0]!.tools));
      expect(JSON.stringify(call.system)).toBe(JSON.stringify(client.calls[0]!.system));
    }
  });

  it("log_gap yields a gapTopic and a gap_logged notice, without touching the database", async () => {
    const events: EngineEvent[] = [];
    const client = fakeClient([
      toolRound("g1", "log_gap", { topic: "rail freight rates", nearestCoveredTopic: "outbound transportation costs" }),
      answerRound("The course materials don't cover rail rates; want to look at outbound costs instead?"),
    ]);
    const result = await answerQuestion(baseInput(client, { emit: (e) => events.push(e) }));
    expect(result.gapTopic).toBe("rail freight rates (nearest covered: outbound transportation costs)");
    expect(events).toContainEqual({ type: "notice", kind: "gap_logged" });
  });

  it(`ends with failure round_limit after ${MAX_ROUNDS} rounds without an answer`, async () => {
    const client = fakeClient([
      toolRound("r1", "record_message_type", { type: "concept_question" }),
      toolRound("s1", "search_book", { query: "a" }),
      toolRound("s2", "search_book", { query: "b" }),
      toolRound("s3", "search_book", { query: "c" }),
      answerRound("never reached"),
    ]);
    const result = await answerQuestion(baseInput(client, { deps: { searchBook: vi.fn().mockResolvedValue([]) } }));
    expect(client.calls).toHaveLength(MAX_ROUNDS);
    expect(result).toMatchObject({ failure: "round_limit", reachedModel: true });
    expect(result.messageType).toBe("concept_question");
    expect(result.usage.costUsd).toBeGreaterThan(0); // spend is still reported so the project cap counts it
  });

  it("returns refused on stop_reason refusal", async () => {
    const client = fakeClient([{ events: [], final: { stop_reason: "refusal" } }]);
    const result = await answerQuestion(baseInput(client));
    expect(result.refused).toBe(true);
  });

  // D20 — engine wiring of the value check, with the same notice as an uncited claim.
  it("drops a short uncited block carrying an unseen value, and keeps it when the context shows that value", async () => {
    const leak = "The best total is 1,234,567.";
    const run = async (shownFacts: string) => {
      const events: EngineEvent[] = [];
      const result = await answerQuestion(baseInput(fakeClient([answerRound(leak)]), { shownFacts, facilityNames: ["Allentown"], emit: (e) => events.push(e) }));
      return { result, events };
    };
    const hidden = await run("");
    expect(hidden.result.blocks).toEqual([]);
    expect(hidden.result.claimsRemoved).toBe(1);
    expect(hidden.events).toEqual([{ type: "notice", kind: "claim_removed" }]);
    const shown = await run("objective 1234567");
    expect(shown.result.blocks.map((b) => b.text)).toEqual([leak]);
  });

  // D22 — Stop/disconnect returns the forwarded part; the buffered block is not kept.
  it("returns a partial result on abort with message_start usage and estimated output", async () => {
    const ac = new AbortController();
    const client = fakeClient([{ hang: true, events: [
      { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } } } as never,
      ...textBlock(0, "What do you notice?", []),
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: null } } as never,
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Buffered and never forwarded" } } as never,
    ] }]);
    const result = await answerQuestion(baseInput(client, { signal: ac.signal, emit: (e) => { if (e.type === "block") ac.abort(); } }));
    expect(result).toMatchObject({ stopped: true, reachedModel: true });
    expect(result.blocks.map((b) => b.text)).toEqual(["What do you notice?"]);
    expect(result.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 50, outputTokens: Math.ceil("What do you notice?".length / 4), estimated: true });
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("uses the last message_delta's output tokens when one arrived before the abort", async () => {
    const ac = new AbortController();
    const client = fakeClient([{ hang: true, events: [
      { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never,
      { type: "message_delta", delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 7 } } as never,
      ...textBlock(0, "What do you notice?", []),
    ] }]);
    const result = await answerQuestion(baseInput(client, { signal: ac.signal, emit: (e) => { if (e.type === "block") ac.abort(); } }));
    expect(result.stopped).toBe(true);
    expect(result.usage.outputTokens).toBe(7);
    expect(result.usage.estimated).toBeUndefined();
  });

  // D24 — 429 re-queue, resending only the failed round.
  it("re-queues a 429 through the gate with retry-after and resends only the failed round", async () => {
    const { gate, waits } = recordingGate();
    const client = fakeClient([
      toolRound("t1", "record_message_type", { type: "concept_question" }),
      rateLimited("2"),
      answerRound("Which constraint binds here?"),
    ]);
    const result = await answerQuestion(baseInput(client, { gate }));
    expect(waits).toEqual([2000]);
    expect(client.calls).toHaveLength(3);
    expect(JSON.stringify(client.calls[2]!.messages)).toBe(JSON.stringify(client.calls[1]!.messages)); // same round resent
    expect(lastToolResults(client.calls[2]!)[0]!.content).toBe(REPLY_RULES.concept_question);        // round 1 kept, not re-run
    expect(result).toMatchObject({ failure: null, messageType: "concept_question" });
    expect(result.blocks.map((b) => b.text)).toEqual(["Which constraint binds here?"]);
  });

  it(`fails after ${MAX_REQUEUES} re-queues (the 4th 429), clamping an invalid retry-after to 5 s`, async () => {
    const { gate, waits } = recordingGate();
    const client = fakeClient([rateLimited("soon"), rateLimited(), rateLimited("2"), rateLimited("2")]);
    const result = await answerQuestion(baseInput(client, { gate }));
    expect(waits).toEqual([5000, 5000, 2000]);
    expect(client.calls).toHaveLength(MAX_REQUEUES + 1);
    expect(result).toMatchObject({ failure: "rate_limited", reachedModel: false });
  });

  it("returns stopped when the student stops while re-queued", async () => {
    const ac = new AbortController();
    const gate: RoundGate = { requeue: async () => { ac.abort(); throw new Error("aborted"); } };
    const result = await answerQuestion(baseInput(fakeClient([rateLimited("2")]), { gate, signal: ac.signal }));
    expect(result).toMatchObject({ stopped: true, reachedModel: false }); // never reached the model → route logs it cancelled
    expect(result.blocks).toEqual([]);
  });

  // D22 — provider failures return a result with what was forwarded and billed; they never throw.
  // D24 — transient 5xx/529/connection errors: up to 2 in-round retries, never a re-queue.
  it("waits 0.5 s then 1.5 s by default", () => {
    expect([...TRANSIENT_BACKOFF_MS]).toEqual([500, 1500]);
  });

  it("answers normally after one 529 (one in-round retry, no re-queue)", async () => {
    const { gate, waits } = recordingGate();
    const client = fakeClient([{ error: apiErr(529, "overloaded") }, answerRound("Which constraint binds here?")]);
    const result = await answerQuestion(baseInput(client, { gate }));
    expect(client.calls).toHaveLength(2);
    expect(waits).toEqual([]);
    expect(result).toMatchObject({ failure: null, stopped: false });
    expect(result.blocks.map((b) => b.text)).toEqual(["Which constraint binds here?"]);
    // The retry is still round 1, so it still forces record_message_type.
    for (const call of client.calls) expect(call.tool_choice).toEqual({ type: "tool", name: "record_message_type" });
  });

  it("retries a connection error the same way", async () => {
    const client = fakeClient([{ error: new Anthropic.APIConnectionError({ message: "socket hang up" }) }, answerRound("Which constraint binds here?")]);
    const result = await answerQuestion(baseInput(client));
    expect(client.calls).toHaveLength(2);
    expect(result.failure).toBeNull();
  });

  it("waits the injected backoff between attempts", async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([{ error: apiErr(529, "overloaded") }, { error: apiErr(529, "overloaded") }, answerRound("Done?")]);
      setTransientBackoffForTests([500, 1500]);
      const p = answerQuestion(baseInput(client));
      await vi.advanceTimersByTimeAsync(499);
      expect(client.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1499);
      expect(client.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect((await p).failure).toBeNull();
      expect(client.calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends through the failure path as unavailable after three consecutive 529s, without re-queueing", async () => {
    const { gate, waits } = recordingGate();
    const err = () => ({ error: apiErr(529, "overloaded") });
    const client = fakeClient([err(), err(), err(), answerRound("never sent")]);
    const result = await answerQuestion(baseInput(client, { gate }));
    expect(client.calls).toHaveLength(3); // 1 attempt + 2 retries
    expect(waits).toEqual([]);
    expect(result).toMatchObject({ failure: "unavailable", reachedModel: false, blocks: [] });
    expect(result.usage.costUsd).toBe(0);
  });

  it("does not retry a 529 that follows a forwarded block", async () => {
    const events: EngineEvent[] = [];
    const client = fakeClient([
      { events: [messageStart(100), ...textBlock(0, "What do you notice?", [])], error: apiErr(529, "overloaded") },
      answerRound("never sent"),
    ]);
    const result = await answerQuestion(baseInput(client, { emit: (e) => events.push(e) }));
    expect(client.calls).toHaveLength(1);
    expect(events.filter((e) => e.type === "block")).toHaveLength(1);
    expect(result).toMatchObject({ failure: "unavailable", reachedModel: true });
  });

  it("ends through the stopped path when the student stops during the backoff", async () => {
    const ac = new AbortController();
    const client = fakeClient([{ error: apiErr(529, "overloaded") }, answerRound("never sent")]);
    setTransientBackoffForTests([10_000, 10_000]);
    const p = answerQuestion(baseInput(client, { signal: ac.signal }));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const result = await p;
    expect(client.calls).toHaveLength(1);
    expect(result).toMatchObject({ stopped: true, failure: null, reachedModel: false });
  });

  // D22 — provider failures return a result with what was forwarded and billed; they never throw.
  it("keeps the usage of every attempt that got message_start before the final 529", async () => {
    const failedAfterStart = () => ({ events: [messageStart(100)], error: apiErr(529, "overloaded") });
    const result = await answerQuestion(baseInput(fakeClient([failedAfterStart(), failedAfterStart(), failedAfterStart()])));
    expect(result).toMatchObject({ failure: "unavailable", reachedModel: true, blocks: [] });
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 0, estimated: true }); // 3 billed attempts
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("keeps a forwarded block and its usage when the connection drops after it", async () => {
    const result = await answerQuestion(baseInput(fakeClient([{
      events: [messageStart(100), ...textBlock(0, "What do you notice?", [])],
      error: new Anthropic.APIConnectionError({ message: "socket hang up" }),
    }])));
    expect(result).toMatchObject({ failure: "unavailable", reachedModel: true });
    expect(result.blocks.map((b) => b.text)).toEqual(["What do you notice?"]);
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: Math.ceil("What do you notice?".length / 4), estimated: true });
  });

  it("maps the spend-limit 400 to a project_limit failure", async () => {
    const result = await answerQuestion(baseInput(fakeClient([{ error: apiErr(400, "You have reached your specified API usage limits.") }])));
    expect(result.failure).toBe("project_limit");
  });

  // D24 — a 429 after a forwarded block is not re-queued (the resend would repeat that text).
  it("does not re-queue a 429 that follows a forwarded block: the block appears once and the answer fails", async () => {
    const { gate, waits } = recordingGate();
    const events: EngineEvent[] = [];
    const client = fakeClient([
      { events: [messageStart(100), ...textBlock(0, "What do you notice?", [])], error: rateLimited("2").error },
      answerRound("never sent"),
    ]);
    const result = await answerQuestion(baseInput(client, { gate, emit: (e) => events.push(e) }));
    expect(waits).toEqual([]);
    expect(client.calls).toHaveLength(1);
    expect(events.filter((e) => e.type === "block")).toHaveLength(1);
    expect(result).toMatchObject({ failure: "error", reachedModel: true });
    expect(result.blocks.map((b) => b.text)).toEqual(["What do you notice?"]);
  });
});
