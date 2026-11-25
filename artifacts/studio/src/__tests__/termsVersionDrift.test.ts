import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TERMS_VERSION, PRIVACY_CONTACT_EMAIL } from "@/pages/legal/legalMeta";

// WQF-B — the terms version is declared twice by necessity: the server's
// CURRENT_TERMS_VERSION decides who holds a session; the studio's TERMS_VERSION
// is only the date printed on the pages. Two declarations of one fact drift;
// this fails the moment they do (same pattern as lockedChapterDrift.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}
const SERVER_FILE = join(findRepoRoot(HERE), "artifacts/api-server/src/lib/terms.ts");

describe("terms version drift", () => {
  it("the studio's TERMS_VERSION equals the server's CURRENT_TERMS_VERSION", () => {
    const m = readFileSync(SERVER_FILE, "utf8").match(/export const CURRENT_TERMS_VERSION = "([^"]+)";/);
    expect(m, "CURRENT_TERMS_VERSION not found in artifacts/api-server/src/lib/terms.ts").not.toBeNull();
    expect(TERMS_VERSION).toBe(m![1]);
  });

  it("is a YYYY-MM-DD date", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the contact address is a real, owner-supplied address", () => {
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i);
    expect(PRIVACY_CONTACT_EMAIL).not.toMatch(/example\.|\.test$|owner|placeholder/i);
  });
});
