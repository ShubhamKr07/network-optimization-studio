// artifacts/api-server/src/watbot/cost.ts
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_ROUNDS, MAX_TOKENS } from "./prompt.js";
import type { BundleDoc } from "./passages.js";

// USD per million tokens. Source: claude-api skill model table (cached 2026-10-06);
// cache read = 0.1x input, cache write (5-min TTL) = 1.25x input.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.10, output: 0.50 },
};
const priceFor = (model: string) => PRICES[model] ?? PRICES["claude-haiku-5-5"]!;
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

// D21 — worst-case cost of one question: every round re-writes the whole prompt
// to cache and emits max_tokens. Deliberately conservative (super-model ≈ $0.045);
// replaced by the actual stored cost when the question finishes, stops or fails.
export function reservationUsd(model: string, bundleTokenCount: number): number {
  const p = priceFor(model);
  return (MAX_ROUNDS * (bundleTokenCount + HISTORY_ALLOWANCE_TOKENS) * p.input * CACHE_WRITE
    + MAX_ROUNDS * MAX_TOKENS * p.output) / 1_000_000;
}
