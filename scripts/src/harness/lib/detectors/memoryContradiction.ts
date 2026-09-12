import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";

// Current-state facts a memory file might assert that the repo can contradict.
const CLAIMS: { re: RegExp; contradictedIf: (repo: RepoFacts) => boolean; label: string }[] = [
  { re: /\bdeploys? (to|on) (replit|heroku|vercel|netlify)\b/i, contradictedIf: (r) => r.rendersOnRender, label: "deployment target (repo deploys on Render, see render.yaml)" },
  { re: /\b(neon|supabase)\b.*\b(database|postgres|db)\b/i, contradictedIf: (r) => r.rendersOnRender, label: "DB provider (repo uses Render managed Postgres)" },
  { re: /\b(replit ?auth|openid|passport)\b/i, contradictedIf: (r) => r.usesArgon2, label: "auth mechanism (repo uses argon2 cookie sessions)" },
  { re: /\b(arcadia|gamif\w*|quests?|leaderboard)\b/i, contradictedIf: () => true, label: "feature existence (Arcadia/gamification was removed)" },
];

interface RepoFacts {
  rendersOnRender: boolean;
  usesArgon2: boolean;
}

function repoFacts(repoRoot: string): RepoFacts {
  const read = (p: string) => {
    try {
      return readFileSync(join(repoRoot, p), "utf8");
    } catch {
      return "";
    }
  };
  return {
    rendersOnRender: read("render.yaml").length > 0,
    usesArgon2: read("artifacts/api-server/src/routes/auth.ts").includes("argon2"),
  };
}

/** A memory file asserting a current-state fact the repo contradicts. */
export const memoryContradiction: Detector = (records, _cfg, repoRoot) => {
  const facts = repoFacts(repoRoot);
  const out: Candidate[] = [];
  for (const r of records) {
    if (r.origin !== "memory") continue;
    const lines = r.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const c of CLAIMS) {
        if (c.re.test(lines[i]) && c.contradictedIf(facts)) {
          out.push({
            id: candidateId("memory_contradiction", r.path, lines[i]),
            type: "memory_contradiction",
            origin: "memory",
            file: r.path,
            lines: [i + 1, i + 1],
            evidence: `memory contradicts repo: ${c.label}`,
            related: [],
          });
        }
      }
    }
  }
  return out;
};
