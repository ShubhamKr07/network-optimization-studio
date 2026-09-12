import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";
import { lessAuthoritative } from "./authority.js";

const IMPERATIVE = /\b(always|never|must not|must|do not|don't|use|run|prefer)\b/i;
const STOP = new Set(["always", "never", "must", "not", "do", "don't", "use", "run", "prefer", "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "be", "this", "that", "it", "with", "when", "should", "always,", "we", "you"]);

interface Sent {
  file: string;
  origin: "repo" | "memory";
  text: string;
  line: number;
  tokens: Set<string>;
  negated: boolean;
}

function sentences(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const s of lines[i].split(/(?<=[.!?])\s+/)) {
      const t = s.trim();
      if (t) out.push({ text: t, line: i + 1 });
    }
  }
  return out;
}

const contentTokens = (t: string) =>
  new Set(t.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

const isNegated = (t: string) => /\b(never|must not|do not|don't|avoid|no longer|not)\b/i.test(t);

// The two sentences must be about the same ACTION — share a directive verb — to be a real conflict.
const VERBS = ["use", "run", "edit", "commit", "delete", "merge", "touch", "enable", "add", "remove", "call", "import", "quarantine", "deploy", "push", "rename"];
const sharedVerb = (a: string, b: string): boolean => {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return VERBS.some((v) => al.includes(v) && bl.includes(v));
};

/** Imperative sentences that share ≥3 content tokens but carry opposing modals → conflict. */
export const conflictingInstruction: Detector = (records, cfg) => {
  const sents: Sent[] = [];
  for (const r of records) {
    for (const s of sentences(r.text)) {
      if (!IMPERATIVE.test(s.text)) continue;
      sents.push({ file: r.path, origin: r.origin, text: s.text, line: s.line, tokens: contentTokens(s.text), negated: isNegated(s.text) });
    }
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < sents.length; i++) {
    for (let j = i + 1; j < sents.length; j++) {
      const a = sents[i];
      const b = sents[j];
      if (a.file === b.file) continue;
      if (a.negated === b.negated) continue; // opposing modals only
      if (!sharedVerb(a.text, b.text)) continue; // must be about the same action
      let shared = 0;
      for (const t of a.tokens) if (b.tokens.has(t)) shared++;
      if (shared < 4) continue;
      const loserFile = lessAuthoritative(a.file, b.file, cfg.authority);
      const cand = loserFile === a.file ? a : b;
      const other = cand === a ? b : a;
      const id = candidateId("conflicting_instruction", cand.file, cand.text);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        type: "conflicting_instruction",
        origin: cand.origin,
        file: cand.file,
        lines: [cand.line, cand.line],
        evidence: `opposing instruction vs ${other.file}:${other.line} ("${other.text.slice(0, 60)}")`,
        related: [other.file],
      });
    }
  }
  return out;
};
