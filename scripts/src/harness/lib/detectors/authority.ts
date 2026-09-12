import { globToRe } from "../glob.js";

/**
 * Rank a file by the authority list (index 0 = most authoritative). Lower rank wins. A path unmatched
 * by any pattern gets a rank just past the list end. `*` matches anything (the catch-all tier).
 */
export function authorityRank(path: string, authority: string[]): number {
  for (let i = 0; i < authority.length; i++) {
    if (globToRe(authority[i]).test(path)) return i;
  }
  return authority.length;
}

/** Of two files, the one to propose changing = the LESS authoritative (higher rank). Ties → b. */
export function lessAuthoritative(a: string, b: string, authority: string[]): string {
  return authorityRank(a, authority) <= authorityRank(b, authority) ? b : a;
}
