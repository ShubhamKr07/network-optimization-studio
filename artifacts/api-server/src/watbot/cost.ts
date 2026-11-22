// artifacts/api-server/src/watbot/cost.ts
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_ROUNDS, MAX_TOKENS } from "./prompt.js";
import type { BundleDoc } from "./passages.js";
import { logger } from "../lib/logger.js";

// USD per million tokens. Source: claude-api skill model table (cached 2026-10-06);
// cache read = 0.1x input, cache write (5-min TTL) = 1.25x input.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.10, output: 0.50 },
};
// Fail closed: an unknown WATBOT_MODEL is priced at a ceiling ($25 in / $125 out per MTok,
// ~250x Haiku and above any Anthropic list price), not guessed cheap. At the default $10 cap
// its reservation (~$11) refuses admission, so a mistyped model id stops spend instead of hiding it.
const UNKNOWN_MODEL_PRICE = { input: 25, output: 125 };
let warned = false;
const priceFor = (model: string) => {
  const known = PRICES[model];
  if (known) return known;
  if (!warned) { warned = true; logger.warn({ model }, "WatBot: no price for model; pricing at the ceiling"); }
  return UNKNOWN_MODEL_PRICE;
};
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

export function costUsd(model: string, u: Anthropic.Usage): number {
  const p = priceFor(model);
  return ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output
    + (u.cache_read_input_tokens ?? 0) * p.input * CACHE_READ
    + (u.cache_creation_input_tokens ?? 0) * p.input * CACHE_WRITE) / 1_000_000;
}

// ponytail: chars/4 token estimate, the same one the ingest's bundle report uses.
export const bundleTokens = (bundle: BundleDoc[]) =>
  Math.round(bundle.reduce((sum, d) => sum + d.passages.reduce((s, p) => s + p.body.length, 0), 0) / 4);

// D21 — 20 history messages are taken as a 10K-token allowance.
export const HISTORY_ALLOWANCE_TOKENS = 10_000;

// D21 — worst-case cost of one question: every round (MAX_ROUNDS + 1: an R3 rejection adds one bonus round) re-writes the whole prompt
// to cache and emits max_tokens. Deliberately conservative (super-model ≈ $0.056);
// replaced by the actual stored cost when the question finishes, stops or fails.
export function reservationUsd(model: string, bundleTokenCount: number): number {
  const p = priceFor(model);
  return ((MAX_ROUNDS + 1) * (bundleTokenCount + HISTORY_ALLOWANCE_TOKENS) * p.input * CACHE_WRITE
    + (MAX_ROUNDS + 1) * MAX_TOKENS * p.output) / 1_000_000;
}
