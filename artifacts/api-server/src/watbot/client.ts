// artifacts/api-server/src/watbot/client.ts
import Anthropic from "@anthropic-ai/sdk";

export type WatBotStream = AsyncIterable<Anthropic.RawMessageStreamEvent> & { finalMessage(): Promise<Anthropic.Message> };
export type WatBotClient = { messages: { stream(params: Anthropic.MessageStreamParams, opts?: { signal?: AbortSignal }): WatBotStream } };

let override: WatBotClient | null = null;
let real: Anthropic | null = null;
export function setWatBotClientForTests(c: WatBotClient | null): void { override = c; }
export function getWatBotClient(): WatBotClient {
  if (override) return override;
  // Reads ANTHROPIC_API_KEY; server-side only (FR-33). maxRetries 0 (D24): the SDK
  // would otherwise retry 429s while holding an in-flight slot, and could resend a
  // round whose text was already forwarded. The engine owns the 429 re-queue and the
  // 2 in-round retries of transient 5xx/529/connection errors (TRANSIENT_BACKOFF_MS).
  real ??= new Anthropic({ maxRetries: 0 });
  return real as unknown as WatBotClient;
}
export function watbotModel(): string { return process.env.WATBOT_MODEL || "claude-haiku-5-5"; }
