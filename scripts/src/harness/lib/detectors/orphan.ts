import type { Detector, Candidate } from "./types.js";
import { candidateId } from "../ids.js";

const WELL_KNOWN = [/^CLAUDE\.md$/, /^README\.md$/, /^\.claude\//, /^docs\/ops\//];
const DAY = 86400000;

/** Zero inbound links, not in a well-known location, unchanged 90+ days. "now" = newest lastChange. */
export const orphan: Detector = (records) => {
  const dated = records.map((r) => Date.parse(r.lastChange)).filter((n) => Number.isFinite(n));
  const now = dated.length ? Math.max(...dated) : 0;
  const out: Candidate[] = [];
  for (const r of records) {
    if (r.origin === "memory") continue; // memory has its own detector
    if (r.inboundLinks.length > 0) continue;
    if (WELL_KNOWN.some((re) => re.test(r.path))) continue;
    const t = Date.parse(r.lastChange);
    if (!Number.isFinite(t)) continue;
    const ageDays = (now - t) / DAY;
    if (ageDays < 90) continue;
    out.push({
      id: candidateId("orphan", r.path, "orphan"),
      type: "orphan",
      origin: "repo",
      file: r.path,
      lines: [1, 1],
      evidence: `no inbound links, not a well-known location, unchanged ${Math.round(ageDays)}d (last ${r.lastChange})`,
      related: [],
    });
  }
  return out;
};
