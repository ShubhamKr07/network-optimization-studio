// Standalone script (see run.ts) — hands the week's aggregated PostHog
// usage numbers (never raw events, never PII) to Claude and returns a
// markdown product-recommendations report string.

import Anthropic from "@anthropic-ai/sdk";
import type { WeeklyAggregates } from "./queryPosthog";

export interface SynthesizeOpts {
  anthropicApiKey: string;
  weekEnding: string;
}

export async function synthesizeReport(
  agg: WeeklyAggregates,
  opts: SynthesizeOpts,
): Promise<string> {
  const client = new Anthropic({ apiKey: opts.anthropicApiKey });
  const prompt = [
    "You are a product analyst for an educational supply-chain optimization tool.",
    "Given these weekly usage aggregates (no PII), write a prioritized, concrete",
    "product-recommendations report in markdown. Focus on funnel drop-offs,",
    "solve failures/rejections, and stale-without-resolve behavior.",
    "",
    "```json",
    JSON.stringify(agg, null, 2),
    "```",
  ].join("\n");
  const msg = await client.messages.create({
    // Pinned concrete model id (valid current Anthropic model). Sonnet 5 is
    // deliberately chosen over Opus for a weekly summarization/synthesis job:
    // capable enough for aggregate-to-prose, materially cheaper for a cron.
    // If the configured Anthropic account lacks this model, change it here to
    // an id that account has (e.g. "claude-opus-4-8"); do NOT leave it unpinned.
    model: "claude-sonnet-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .map((b: { type: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("");
  return `# Product Insights — week ending ${opts.weekEnding}\n\n${text}\n`;
}
