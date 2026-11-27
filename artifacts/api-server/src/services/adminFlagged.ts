import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { WatBotBlock } from "@workspace/db";
import { chicagoStart, chicagoEnd, type AdminRange } from "./adminRange.js";

type Row = {
  at: Date; model_id: string; blocks: WatBotBlock[]; message_type: string | null; question_blocks: WatBotBlock[] | null;
  helped: boolean | null; rating_reason: string | null; rating_note: string | null; repair_message_id: number | null;
  report_reason: string | null; report_note: string | null; reanswer_blocks: WatBotBlock[] | null;
};
const text = (b: WatBotBlock[]) => b.map(x => x.text).join(" ").trim();

// The two lookups are bounded to the conversation by created_at so they use IDX_watbot_messages_conversation, not a pkey walk.
// Flagged = a tutor reply rated not helped or reported (spec §4.2). Allowlist per D9. ids are used for ordering
// inside the query and never selected, so they cannot reach the response.
export const flaggedQuery = (r: AdminRange) => sql`
    SELECT t.created_at AS at, c.model_id, t.blocks,
      (SELECT s.message_type FROM watbot_messages s WHERE s.conversation_id = t.conversation_id AND s.role = 'student' AND s.created_at <= t.created_at AND s.id < t.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS message_type,
      (SELECT s.blocks FROM watbot_messages s WHERE s.conversation_id = t.conversation_id AND s.role = 'student' AND s.created_at <= t.created_at AND s.id < t.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS question_blocks,
      f.helped, f.reason AS rating_reason, f.note AS rating_note, f.repair_message_id,
      r.reason AS report_reason, r.note AS report_note,
      (SELECT rt.blocks FROM watbot_messages rt WHERE rm.id IS NOT NULL AND rt.conversation_id = t.conversation_id AND rt.role = 'tutor' AND rt.created_at >= rm.created_at AND rt.id > rm.id ORDER BY rt.created_at, rt.id LIMIT 1) AS reanswer_blocks
    FROM watbot_messages t
    JOIN watbot_conversations c ON c.id = t.conversation_id JOIN users u ON u.id = t.user_id
    LEFT JOIN watbot_feedback f ON f.message_id = t.id
    LEFT JOIN watbot_messages rm ON rm.id = f.repair_message_id
    LEFT JOIN LATERAL (SELECT reason, note FROM watbot_reports WHERE message_id = t.id ORDER BY id DESC LIMIT 1) r ON true
    WHERE t.role = 'tutor' AND u.role IN ('student', 'instructor')
      AND t.created_at >= ${chicagoStart(r.from)} AND t.created_at < ${chicagoEnd(r.to)}
      ${r.modelId ? sql`AND c.model_id = ${r.modelId}` : sql``}
      AND (f.helped = false OR r.reason IS NOT NULL)
    ORDER BY t.created_at DESC, t.id DESC LIMIT 101`;

export async function getAdminFlagged(r: AdminRange) {
  const rows = (await db.execute(flaggedQuery(r))).rows as Row[];
  return {
    truncated: rows.length > 100,
    items: rows.slice(0, 100).map(x => ({
      at: new Date(x.at).toISOString(), modelId: x.model_id, messageType: x.message_type,
      question: x.question_blocks ? text(x.question_blocks) : null,
      answer: { text: text(x.blocks), citations: [...new Set(x.blocks.flatMap(b => b.citations.map(c => c.label)))] },
      rating: x.helped === false ? { reason: x.rating_reason, note: x.rating_note } : null,
      report: x.report_reason ? { reason: x.report_reason, note: x.report_note } : null,
      reanswer: x.repair_message_id == null ? { status: "none" as const, text: null }
        : x.reanswer_blocks ? { status: "answered" as const, text: text(x.reanswer_blocks) } : { status: "not_completed" as const, text: null },
    })),
  };
}
