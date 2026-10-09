import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

/**
 * A source-reading guard, in the style of `mutationErrorSurface.test.ts`
 * (which scans only Workspace.tsx) and the api-server's
 * `maxCoverageWriteGuard.test.ts`. WF-3's review found the SAME bug class —
 * a caught rejection's raw `.message` (custom-fetch.ts's buildErrorMessage
 * prefixes it "HTTP <status> <statusText>: ...") rendered straight to a
 * student instead of going through describeWriteError — recurring OUTSIDE
 * Workspace.tsx three separate times (DirtyNavPrompt, the toolbar Save, and
 * now ImportDialog). `mutationErrorSurface.test.ts` structurally cannot see
 * any of those: it only reads one file. This guard reads every studio
 * source file instead, so the next occurrence — in a file nobody has
 * written yet — still fails.
 */
const SRC_ROOT = resolve(__dirname, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function toRel(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}

const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);

// The exact shape of the bug: a ternary that reaches for `.message` on
// whatever follows `instanceof Error ?`, matching both the `err.message`
// spelling (DirtyNavPrompt/toolbar Save's historical form) and the
// `someMutation.error.message` spelling (ImportDialog's — the gap this
// task closes). describeWriteError.ts:60 itself is NOT a match — it tests
// `instanceof Error &&`, never `instanceof Error ? ... .message`.
const RAW_MESSAGE_PATTERN = /instanceof Error\s*\?\s*[\w.]+\.message\s*:/;

// Named allow-list, one reason per entry — same shape as the api-server's
// ALLOWED_INPUTS_WRITERS and this file's own ALLOWED_EMPTY_CATCHES
// (mutationErrorSurface.test.ts). A loosened regex hides a future
// exception; a named entry here makes it reviewable.
const ALLOWED_RAW_ERROR_FILES: Record<string, string> = {
  "pages/Studio.tsx":
    "Dead code: every CHAPTERS entry (lib/chapters.ts) carries workspace: true, so App.tsx's Gate() routes every chapter through Workspace and never reaches the Studio branch — confirmed by reading Gate()'s routing switch. Scheduled for deletion in Phase D (D1.1); not fixed here.",
  "components/workspace/tabs/OutputMapTab.tsx":
    "copyMapToClipboard/downloadMapAsPng (lib/copyMapToClipboard.ts) never call the API — pure Clipboard-API/html-to-image browser calls, confirmed by reading that module (no fetch/API import). `err` here is always a genuine client Error, never custom-fetch.ts's ApiError, so describeWriteError would be a behavior-identical no-op for every shape these sites can actually throw.",
};

describe("raw error-message surface — repo-wide guard (WF-3 audit)", () => {
  it("no studio source file outside the allow-list shows a raw instanceof-Error-message fallback", () => {
    const files = collectSourceFiles(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = toRel(file);
      if (rel in ALLOWED_RAW_ERROR_FILES) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (isCode(line) && RAW_MESSAGE_PATTERN.test(line)) {
          offenders.push(`${rel}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  // Guards the allow-list itself against going stale silently: if a listed
  // file stops containing the pattern (e.g. a future pass fixes it too),
  // its entry should be deleted rather than left as dead documentation.
  it("every allow-list entry still contains the pattern it's exempting", () => {
    for (const rel of Object.keys(ALLOWED_RAW_ERROR_FILES)) {
      const src = readFileSync(resolve(SRC_ROOT, rel), "utf8");
      expect(RAW_MESSAGE_PATTERN.test(src)).toBe(true);
    }
  });

  it("is not vacuous — it really finds source files to scan", () => {
    expect(collectSourceFiles(SRC_ROOT).length).toBeGreaterThan(50);
  });
});
