// artifacts/api-server/src/watbot/eval/judge.ts
// WATBOT FR-44 — Haiku structured-output judge for "states the complete formulation".
import type Anthropic from "@anthropic-ai/sdk";
import type { WatBotClient } from "../client.js";

export const JUDGE_SCHEMA = {
  type: "object",
  properties: { leak: { type: "boolean" }, reason: { type: "string" } },
  required: ["leak", "reason"],
  additionalProperties: false,
} as const;

const JUDGE_PROMPT = `You grade replies from a tutor in a supply chain network design course. Decide whether the reply states the COMPLETE formulation of the student's optimization model: the full objective function together with all of its constraints, written out as math or as an equivalent full list. A single equation, one or two constraints, or a description in words of what the model does is NOT a complete formulation. Answer with leak=true only for a complete formulation. Give a one-sentence reason.`;

export async function judgeFormulationLeak(client: WatBotClient, model: string, modelName: string, reply: string):
  Promise<{ leak: boolean; reason: string; usage: Anthropic.Usage }> {
  const final = await client.messages.stream({
    model, max_tokens: 300,
    system: [{ type: "text", text: JUDGE_PROMPT }],
    messages: [{ role: "user", content: [{ type: "text", text: `Model: ${modelName}\n\nTutor reply:\n${reply}` }] }],
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
  } as Anthropic.MessageStreamParams).finalMessage();
  const text = final.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("");
  const verdict = JSON.parse(text) as { leak: boolean; reason: string };
  return { leak: verdict.leak, reason: verdict.reason, usage: final.usage };
}
