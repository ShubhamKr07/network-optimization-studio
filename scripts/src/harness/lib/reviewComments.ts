export type Decision = "keep" | "apply" | "edit" | "delete" | "defer" | "dismiss" | "question";

export interface RawComment {
  findingId: string;
  body: string;
}

export interface ParsedComment {
  findingId: string;
  decision: Decision;
  arg?: string; // the text after `edit:` / reason after `dismiss:`
}

const RECOGNIZED = new Set<Decision>(["keep", "apply", "edit", "delete", "defer", "dismiss"]);

/** Parse one review comment body → decision + optional arg. First token, case-insensitive. */
export function parseComment(body: string): { decision: Decision; arg?: string } {
  const trimmed = body.trim();
  const m = trimmed.match(/^(\w+)\s*:?\s*([\s\S]*)$/);
  const token = (m?.[1] ?? "").toLowerCase();
  const rest = (m?.[2] ?? "").trim();
  if (RECOGNIZED.has(token as Decision)) {
    const decision = token as Decision;
    if (decision === "edit" || decision === "dismiss") return { decision, arg: rest };
    return { decision };
  }
  return { decision: "question" };
}

export function parseReviewComments(comments: RawComment[]): ParsedComment[] {
  return comments.map((c) => ({ findingId: c.findingId, ...parseComment(c.body) }));
}

export interface Finding {
  id: string;
  commitSha: string; // "" for memory findings (not committed)
  origin: "repo" | "memory";
}

export interface ResolutionStep {
  findingId: string;
  decision: Decision;
  action: "revert" | "keep" | "new-commit-edit" | "new-commit-delete" | "apply-memory" | "answer";
  target: string; // sha to revert/keep, or "memory", or ""
}

/**
 * Pure resolution planner: given the findings on a PR and the parsed review decisions, produce the
 * exact action per finding. `git revert` for keep/defer/dismiss; keep the commit for apply; a new
 * commit for edit/delete; answer-only for question. Memory findings never touch git.
 */
export function planResolution(findings: Finding[], parsed: ParsedComment[]): ResolutionStep[] {
  const byId = new Map(parsed.map((p) => [p.findingId, p]));
  return findings.map((f) => {
    const p = byId.get(f.id);
    // Default when no comment on a repo finding = apply (accept as drafted); memory requires explicit.
    const decision: Decision = p?.decision ?? (f.origin === "memory" ? "defer" : "apply");
    if (decision === "question") return { findingId: f.id, decision, action: "answer", target: "" };
    if (f.origin === "memory") {
      if (decision === "apply" || decision === "edit") return { findingId: f.id, decision, action: "apply-memory", target: "memory" };
      return { findingId: f.id, decision, action: "answer", target: "memory" }; // keep/defer/dismiss on memory: no git, recorded in findings file
    }
    switch (decision) {
      case "apply": return { findingId: f.id, decision, action: "keep", target: f.commitSha };
      case "keep":
      case "defer":
      case "dismiss": return { findingId: f.id, decision, action: "revert", target: f.commitSha };
      case "edit": return { findingId: f.id, decision, action: "new-commit-edit", target: f.commitSha };
      case "delete": return { findingId: f.id, decision, action: "new-commit-delete", target: f.commitSha };
      default: return { findingId: f.id, decision, action: "answer", target: "" };
    }
  });
}
