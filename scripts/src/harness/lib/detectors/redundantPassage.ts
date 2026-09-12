import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";
import { lessAuthoritative } from "./authority.js";

interface Para {
  file: string;
  origin: "repo" | "memory";
  text: string;
  line: number;
  shingles: Set<string>;
}

function paragraphs(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = text.split("\n");
  let buf: string[] = [];
  let start = 0;
  const flush = (end: number) => {
    const joined = buf.join(" ").trim();
    if (joined) out.push({ text: joined, line: start + 1 });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      flush(i);
    } else {
      if (buf.length === 0) start = i;
      buf.push(lines[i]);
    }
  }
  flush(lines.length);
  return out;
}

function shingles(text: string, n = 8): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(" "));
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Paragraph-level near-duplicates across DIFFERENT files (Jaccard ≥ 0.6, ≥40 words). */
export const redundantPassage: Detector = (records, cfg) => {
  const paras: Para[] = [];
  for (const r of records) {
    for (const p of paragraphs(r.text)) {
      const wc = p.text.split(/\s+/).length;
      if (wc < 40) continue;
      paras.push({ file: r.path, origin: r.origin, text: p.text, line: p.line, shingles: shingles(p.text) });
    }
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < paras.length; i++) {
    for (let j = i + 1; j < paras.length; j++) {
      if (paras[i].file === paras[j].file) continue;
      if (jaccard(paras[i].shingles, paras[j].shingles) < 0.6) continue;
      const loser = lessAuthoritative(paras[i].file, paras[j].file, cfg.authority);
      const winner = loser === paras[i].file ? paras[j] : paras[i];
      const cand = loser === paras[i].file ? paras[i] : paras[j];
      const id = candidateId("redundant_passage", cand.file, cand.text);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        type: "redundant_passage",
        origin: cand.origin,
        file: cand.file,
        lines: [cand.line, cand.line],
        evidence: `near-duplicate of ${winner.file}:${winner.line} (Jaccard ≥ 0.6)`,
        related: [winner.file],
      });
    }
  }
  return out;
};
