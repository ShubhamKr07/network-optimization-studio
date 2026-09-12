import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";

/**
 * Catches SEMANTIC staleness the reference/keyword detectors miss: a doc that makes a present-tense
 * claim about the repo which the repo contradicts (e.g. "the solver is pure TypeScript / Python was
 * unavailable" when solve.py runs Python/PuLP/CBC). Scans ALL in-scope docs (repo + memory).
 *
 * Emitted as `stale_reference` (a confidently-wrong statement is stale content) so it flows through
 * the existing schema/report/csv without new columns. Patterns are PRESENT-TENSE and narrow to avoid
 * flagging historical narrative ("we removed the openid-client dep", "Replit deploy files").
 */

interface RepoFacts {
  solverIsPython: boolean;
  rendersOnRender: boolean;
  usesArgon2: boolean;
}

function repoFacts(root: string): RepoFacts {
  const read = (p: string) => {
    try {
      return readFileSync(join(root, p), "utf8");
    } catch {
      return "";
    }
  };
  return {
    solverIsPython: existsSync(join(root, "artifacts/api-server/src/solver/solve.py")),
    rendersOnRender: read("render.yaml").length > 0,
    usesArgon2: read("artifacts/api-server/src/routes/auth.ts").includes("argon2"),
  };
}

interface Claim {
  re: RegExp;
  contradicted: (f: RepoFacts) => boolean;
  label: string;
}

const CLAIMS: Claim[] = [
  {
    re: /\bsolver is a pure typescript\b|\bpure typescript (?:greedy|solver)\b/i,
    contradicted: (f) => f.solverIsPython,
    label: "claims a pure-TypeScript solver, but solve.py runs Python/PuLP/CBC",
  },
  {
    re: /\bpython(?:\s*\/\s*pulp)?\b[^.\n]*\bunavailable\b|\bpython package installation[^.\n]*unavailable\b/i,
    contradicted: (f) => f.solverIsPython,
    label: "claims Python/PuLP is unavailable, but the solver is Python/PuLP/CBC (solve.py)",
  },
  {
    re: /\bdeploys?\s+(?:to|on)\s+(?:replit|heroku|vercel|netlify)\b/i,
    contradicted: (f) => f.rendersOnRender,
    label: "claims a non-Render deploy target, but render.yaml deploys on Render",
  },
  {
    re: /\b(?:uses?|using|via)\s+(?:replit[ -]?auth|openid[ -]?connect|passport(?:\.js)?)\b/i,
    contradicted: (f) => f.usesArgon2,
    label: "claims Replit-Auth/OpenID/Passport, but auth uses argon2 cookie sessions",
  },
];

export const factContradiction: Detector = (records, _cfg, repoRoot) => {
  const facts = repoFacts(repoRoot);
  const out: Candidate[] = [];
  for (const r of records) {
    const lines = r.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const c of CLAIMS) {
        if (c.re.test(lines[i]) && c.contradicted(facts)) {
          out.push({
            id: candidateId("stale_reference", r.path, `factcontra ${c.label} :: ${lines[i]}`),
            type: "stale_reference",
            origin: r.origin,
            file: r.path,
            lines: [i + 1, i + 1],
            evidence: `contradicts repo fact — ${c.label}`,
            related: [],
          });
        }
      }
    }
  }
  return out;
};
