import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";

const VERSION_TOKEN = /[-_ ](v?\d+(\.\d+)*|\d{4}-\d{2}-\d{2})\b/gi;
const stripVersion = (s: string) => s.replace(VERSION_TOKEN, "").toLowerCase();

/** Two docs differing only by a version token, or sharing ≥50% of headings → older is superseded. */
export const superseded: Detector = (records) => {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  // Explicit markers.
  for (const r of records) {
    const lines = r.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/\b(DEPRECATED|superseded by|see instead)\b/i.test(lines[i])) {
        const id = candidateId("superseded", r.path, lines[i]);
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ id, type: "superseded", origin: r.origin, file: r.path, lines: [i + 1, i + 1], evidence: `explicit supersede marker: "${lines[i].trim().slice(0, 80)}"`, related: [] });
        }
      }
    }
  }

  // Pairwise version-token / heading-overlap.
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      const sameBase = stripVersion(a.path) === stripVersion(b.path) && a.path !== b.path;
      const ah = new Set(a.headings.map((h) => h.text.toLowerCase()));
      const bh = new Set(b.headings.map((h) => h.text.toLowerCase()));
      const shared = [...ah].filter((h) => bh.has(h)).length;
      const minCount = Math.min(ah.size, bh.size);
      const headingOverlap = minCount >= 3 && shared / minCount >= 0.5;
      if (!sameBase && !headingOverlap) continue;
      // older (by lastChange) is the candidate
      const older = a.lastChange <= b.lastChange ? a : b;
      const newer = older === a ? b : a;
      const id = candidateId("superseded", older.path, `superseded-by ${newer.path}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        type: "superseded",
        origin: older.origin,
        file: older.path,
        lines: [1, 1],
        evidence: sameBase ? `version-token sibling of newer ${newer.path}` : `shares ${shared}/${minCount} headings with newer ${newer.path}`,
        related: [newer.path],
      });
    }
  }
  return out;
};
