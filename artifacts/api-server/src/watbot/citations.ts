// artifacts/api-server/src/watbot/citations.ts
import type { WatBotCitation } from "@workspace/db";
import type { BundleDoc } from "./passages.js";
import { extractNumbers, matchesValue } from "./numbers.js";

export const MIN_CLAIM_WORDS = 12;

// ponytail: word-count / question-mark heuristic decides what is a "claim";
// upgrade to a second-pass check only if reports show it misclassifying.
export function keepUncitedBlock(text: string): boolean {
  const t = text.trim();
  return t.endsWith("?") || t.split(/\s+/).filter(Boolean).length < MIN_CLAIM_WORDS;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// D20 — Unicode case folding, applied to names, text and context alike: NFKC
// (full-width → ASCII, composed accents) then the locale-independent lower case.
const fold = (s: string) => s.normalize("NFKC").toLowerCase();
// Whole-name match ("Chicago" but not "Chicagoland"); Unicode-aware for names like "Belém".
// Case-insensitive by spec, so a city named "Reading" also drops a short uncited
// block using the word "reading": the cost is one dropped short block, never a leak.
const mentions = (foldedText: string, foldedName: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(foldedName)}(?![\\p{L}\\p{N}])`, "u").test(foldedText);

// D20 — an uncited block that passed keepUncitedBlock still fails when it carries
// a 4+-digit value or a candidate-facility name the student's context does not show.
export function passesValueCheck(text: string, facilityNames: string[], contextSummary: string): boolean {
  const shown = extractNumbers(contextSummary);
  for (const n of extractNumbers(text)) {
    if (Math.abs(n) < 1000) continue; // fewer than four digits
    if (!shown.some((v) => matchesValue(n, v) || matchesValue(v, n))) return false;
  }
  const t = fold(text);
  const ctx = fold(contextSummary);
  return !facilityNames.some((name) => { const n = fold(name); return mentions(t, n) && !mentions(ctx, n); });
}

type RawCitation =
  | { type: "content_block_location"; cited_text: string; document_index: number; start_block_index: number }
  | { type: "search_result_location"; cited_text: string; source: string; title: string | null }
  | { type: string; cited_text: string };

export function mapCitation(c: RawCitation, bundle: BundleDoc[]): WatBotCitation | null {
  if (c.type === "content_block_location" && "document_index" in c) {
    const p = bundle[c.document_index]?.passages[c.start_block_index];
    return p ? { passageId: p.id, label: p.label, citedText: c.cited_text } : null;
  }
  if (c.type === "search_result_location" && "source" in c) {
    const id = Number(c.source.replace(/^passage:/, ""));
    return Number.isInteger(id) ? { passageId: id, label: c.title ?? "", citedText: c.cited_text } : null;
  }
  return null;
}
