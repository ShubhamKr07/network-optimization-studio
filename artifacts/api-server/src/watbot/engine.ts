// artifacts/api-server/src/watbot/engine.ts
import type Anthropic from "@anthropic-ai/sdk";
import { WATBOT_MESSAGE_TYPES, type WatBotBlock, type WatBotCitation, type WatBotMessageType, type WatBotUsage } from "@workspace/db";
import type { Tutor } from "@workspace/dataset-schema";
import type { WatBotClient } from "./client.js";
import { buildRequest, FORCE_RECORD_MODELS, FORCE_RECORD_TYPE, MAX_ROUNDS, REPLY_RULES, SEARCH_LIMIT_RESULT, type HistoryTurn } from "./prompt.js";
import { keepUncitedBlock, mapCitation, passesValueCheck } from "./citations.js";
import { costUsd } from "./cost.js";
import { classifyAnthropicError, retryAfterMs } from "./errors.js";
import { searchBook as defaultSearchBook, type BundleDoc } from "./passages.js";

export { MAX_ROUNDS };
export const MAX_SEARCHES = 2;
export const MAX_REQUEUES = 3;                  // D24: the 4th 429 on one question → failed
// D24 — in-round retries of a transient 5xx/529/connection error, replacing the
// SDK's quiet retries (maxRetries: 0). One entry per retry: at most 2 per round.
export const TRANSIENT_BACKOFF_MS: readonly number[] = [500, 1500];
let transientBackoffDefault: readonly number[] = TRANSIENT_BACKOFF_MS;
export function setTransientBackoffForTests(ms: readonly number[] | null): void { transientBackoffDefault = ms ?? TRANSIENT_BACKOFF_MS; }
export const STOPPED_NOTICE = "Answer stopped"; // D22: notice row after a stopped answer
export const FAILED_NOTICE = "WatBot couldn't finish this answer."; // D22: notice row after a provider failure
export const REFUSED_NOTICE = "I can't help with that one.";

export type EngineEvent =
  | { type: "searching"; query: string }
  | { type: "block"; block: WatBotBlock }
  | { type: "notice"; kind: "claim_removed" | "gap_logged" };

// D24 — how a 429'd round waits for its turn again. Task 6 implements it on the
// in-flight queue (release slot, front re-queue, wait retry-after, emit queued).
export type RoundGate = { requeue(retryAfterMs: number): Promise<void> };

// Why an answer failed. round_limit: 5th round; rate_limited: 4th 429;
// unavailable / project_limit / error: provider failure, incl. a 429 after a forwarded block.
export type AnswerFailure = "round_limit" | "rate_limited" | "unavailable" | "project_limit" | "error";

export type AnswerInput = {
  client: WatBotClient; model: string; bundle: BundleDoc[]; readingList: Tutor["readingList"];
  fixedQuestions: string[];
  facilityNames: string[];                 // D20: dataset + context-scenario facility names
  history: HistoryTurn[]; contextSummary: string; question: string;
  shownFacts?: string;                     // D20: server-derived context facts only (not name/tab); "" fails closed
  emit: (e: EngineEvent) => void; signal: AbortSignal;
  gate?: RoundGate;                        // default: just wait retry-after (CLIs with no queue)
  deps?: { searchBook?: typeof defaultSearchBook };
};

// Every ending is a result, never a throw (D22): done, refused, stopped, failed.
export type AnswerResult = {
  blocks: WatBotBlock[];                   // exactly what was forwarded to the student
  claimsRemoved: number; usage: WatBotUsage;
  refused: boolean;                        // stop_reason "refusal"
  stopped: boolean;                        // aborted (Stop, disconnect, or Stop while re-queued)
  failure: AnswerFailure | null;
  reachedModel: boolean;                   // D22: some round got message_start → the question counts
  messageType: WatBotMessageType | null;   // null when the model skipped record_message_type
  gapTopic: string | null;                 // set by log_gap; stored on the tutor row
};

export const zeroUsage = (model: string): WatBotUsage =>
  ({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });

// The shape the route finalises when the question never reached the engine
// (stopped while still waiting for its first in-flight slot).
export const emptyAnswerResult = (model: string, extra: Partial<AnswerResult> = {}): AnswerResult => ({
  blocks: [], claimsRemoved: 0, usage: zeroUsage(model), refused: false, stopped: false,
  failure: null, reachedModel: false, messageType: null, gapTopic: null, ...extra,
});

const isMessageType = (v: unknown): v is WatBotMessageType =>
  typeof v === "string" && (WATBOT_MESSAGE_TYPES as readonly string[]).includes(v);

const waitFor = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new Error("aborted")); return; }
  const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
  signal.addEventListener("abort", onAbort, { once: true });
});

export async function answerQuestion(input: AnswerInput): Promise<AnswerResult> {
  const searchBook = input.deps?.searchBook ?? defaultSearchBook;
  const gate: RoundGate = input.gate ?? { requeue: (ms) => waitFor(ms, input.signal) };
  // Built once: model, system and tools stay byte-identical across rounds; only
  // `messages` grows. tool_choice is forced to record_message_type on round 1 only:
  // left to `auto`, Haiku skipped the call on 12-16 of 40 attempt statements and
  // answered them directly. Measured: round 2 under `auto` still reads the bundle
  // cache after a forced round 1. The search cap stays in the tool result (D19).
  const params = buildRequest(input);
  let messages = params.messages;
  const out = emptyAnswerResult(input.model);
  let searches = 0;
  let requeues = 0;

  const addUsage = (u: Anthropic.Usage) => {
    out.usage.inputTokens += u.input_tokens ?? 0;
    out.usage.outputTokens += u.output_tokens ?? 0;
    out.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    out.usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    out.usage.costUsd += costUsd(input.model, u);
  };

  // Usage of the round in progress, as seen on the stream (D22). Cleared once the
  // round's finalMessage usage is added, so nothing is ever billed twice.
  let roundStart: Anthropic.Usage | null = null;
  let roundOutput: number | null = null;
  let roundForwardedChars = 0;
  const flushPartialRound = () => {
    if (!roundStart) return;
    if (roundOutput === null) out.usage.estimated = true;
    addUsage({ ...roundStart, output_tokens: roundOutput ?? Math.ceil(roundForwardedChars / 4) });
    roundStart = null; roundOutput = null;
  };
  const finish = (extra: Partial<AnswerResult> = {}): AnswerResult => {
    flushPartialRound();
    return { ...out, ...extra };
  };

  const streamRound = async (first: boolean): Promise<Anthropic.Message> => {
    roundStart = null; roundOutput = null; roundForwardedChars = 0;
    const toolChoice = first && FORCE_RECORD_MODELS.has(params.model) ? FORCE_RECORD_TYPE : params.tool_choice;
    const stream = input.client.messages.stream({ ...params, tool_choice: toolChoice, messages }, { signal: input.signal });
    const open = new Map<number, { text: string; citations: WatBotCitation[] }>();
    for await (const ev of stream) {
      if (ev.type === "message_start") { roundStart = ev.message.usage; out.reachedModel = true; }
      else if (ev.type === "message_delta") roundOutput = ev.usage.output_tokens;
      else if (ev.type === "content_block_start" && ev.content_block.type === "text") open.set(ev.index, { text: "", citations: [] });
      else if (ev.type === "content_block_delta") {
        const b = open.get(ev.index);
        if (!b) continue;
        if (ev.delta.type === "text_delta") b.text += ev.delta.text;
        else if (ev.delta.type === "citations_delta") {
          const c = mapCitation(ev.delta.citation as never, input.bundle);
          if (c) b.citations.push(c);
        }
      } else if (ev.type === "content_block_stop") {
        const b = open.get(ev.index);
        if (!b || !b.text.trim()) continue;
        open.delete(ev.index);
        // Cited → forward. Uncited → forward only if it is a question or short
        // connective (FR-17) AND carries no unseen value or site (D20).
        const keep = b.citations.length > 0
          || (keepUncitedBlock(b.text) && passesValueCheck(b.text, input.facilityNames, input.shownFacts ?? ""));
        if (keep) { out.blocks.push(b); roundForwardedChars += b.text.length; input.emit({ type: "block", block: b }); }
        else if (out.claimsRemoved++ === 0) input.emit({ type: "notice", kind: "claim_removed" });
      }
    }
    const final = await stream.finalMessage();
    out.reachedModel = true;
    roundStart = null; roundOutput = null; // replaced by the authoritative final usage
    return final;
  };

  try {
    for (let round = 1; ; round++) {
      if (round > MAX_ROUNDS) return finish({ failure: "round_limit" });
      let final!: Anthropic.Message;
      let transientRetries = 0; // per round
      for (;;) {
        try { final = await streamRound(round === 1); break; }
        catch (err) {
          if (input.signal.aborted) return finish({ stopped: true });
          const kind = classifyAnthropicError(err);
          // D24: a round may be retried or re-queued only if it forwarded nothing;
          // otherwise the resent round would show the student the same text twice → failure path.
          if (kind === "unavailable" && roundForwardedChars === 0 && transientRetries < transientBackoffDefault.length) {
            // Transient 5xx/529/connection error: wait in-round, holding the slot (not a re-queue).
            flushPartialRound(); // an attempt that got message_start was billed
            const delay = transientBackoffDefault[transientRetries++]!;
            try { await waitFor(delay, input.signal); } catch { return finish({ stopped: true }); } // only rejects on abort
            continue;
          }
          if (kind !== "rate_limited" || roundForwardedChars > 0) throw err;
          if (requeues >= MAX_REQUEUES) return finish({ failure: "rate_limited" });
          requeues++;
          flushPartialRound(); // a 429 rarely follows message_start, but billed tokens are kept if it does
          try { await gate.requeue(retryAfterMs(err)); }
          catch (gateErr) { if (input.signal.aborted) return finish({ stopped: true }); throw gateErr; }
        }
      }
      addUsage(final.usage);

      if (final.stop_reason === "refusal") return finish({ refused: true });
      if (final.stop_reason !== "tool_use") return finish();

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of final.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")) {
        if (tu.name === "record_message_type") {
          const type = (tu.input as { type?: unknown }).type;
          if (isMessageType(type)) {
            out.messageType ??= type; // first call wins; a second call cannot relabel the message
            results.push({ type: "tool_result", tool_use_id: tu.id, content: REPLY_RULES[out.messageType] }); // ...nor switch its rule
          } else {
            results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown type. Use one of: ${WATBOT_MESSAGE_TYPES.join(", ")}.` });
          }
        } else if (tu.name === "search_book") {
          if (searches >= MAX_SEARCHES) {
            // D19: the cap lives in the tool result, never in tool_choice.
            results.push({ type: "tool_result", tool_use_id: tu.id, content: SEARCH_LIMIT_RESULT });
            continue;
          }
          searches++;
          const query = String((tu.input as { query?: unknown }).query ?? "");
          input.emit({ type: "searching", query });
          const hits = await searchBook(query, input.readingList);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: hits.length
            ? hits.map((h) => ({ type: "search_result", source: `passage:${h.id}`, title: h.label, content: [{ type: "text", text: h.body }], citations: { enabled: true } })) as never
            : "No passages found." });
        } else if (tu.name === "log_gap") {
          const { topic, nearestCoveredTopic } = tu.input as { topic: string; nearestCoveredTopic: string };
          out.gapTopic = `${topic} (nearest covered: ${nearestCoveredTopic})`;
          input.emit({ type: "notice", kind: "gap_logged" });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "Gap logged." });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}.` });
        }
      }
      messages = [...messages, { role: "assistant", content: final.content }, { role: "user", content: results }];
    }
  } catch (err) {
    // D22: a provider failure (5xx, 529, connection, spend limit, a 429 after a
    // forwarded block) or any other error still returns what was forwarded and billed.
    if (input.signal.aborted) return finish({ stopped: true });
    const kind = classifyAnthropicError(err);
    return finish({ failure: kind === "unavailable" || kind === "project_limit" ? kind : "error" });
  }
}
