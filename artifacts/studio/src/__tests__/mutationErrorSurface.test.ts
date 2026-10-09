import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A source-reading guard, in the style of the api-server's
 * maxCoverageWriteGuard.test.ts. The defect this project fixes arose because
 * six of nine mutation call sites had no onError; the tenth site added later
 * is how it would recur, and no behavioural test can see a handler that was
 * never written.
 */
const SRC = resolve(__dirname, "../pages/Workspace.tsx");

// Ignore commented-out code so a `// foo.mutate(` note is not an offender,
// AND so a commented-out `onError:`/`toast(` inside an otherwise-real
// window can't be mistaken for a live handler satisfying the guard (WF-3
// review, minor 3 — both guards below filter comments out of SITE
// detection but used to leave them in the window text itself).
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
const stripComments = (text: string) => text.split("\n").filter(isCode).join("\n");

describe("Workspace mutation error surface", () => {
  it("every .mutate( call site has an onError before the next one begins", () => {
    const src = readFileSync(SRC, "utf8");
    const lines = src.split("\n");
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.mutate(Async)?\(/.test(line) && isCode(line));

    const offenders: string[] = [];
    sites.forEach(({ line, i }, n) => {
      // Scope each site's window to where the NEXT site starts, so a
      // neighbour's handler can never be mistaken for this one's. A fixed
      // line count cannot do this: the real gaps between these sites range
      // from 4 to over 700 lines.
      const end = n + 1 < sites.length ? sites[n + 1].i : lines.length;
      const own = stripComments(lines.slice(i, end).join("\n"));
      if (!/onError\s*:/.test(own)) offenders.push(`${SRC}:${i + 1} — ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it("is not vacuous — it really finds the mutate sites", () => {
    const src = readFileSync(SRC, "utf8");
    const count = (src.match(/\.mutate(Async)?\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it("no handler shows a raw error message instead of describeWriteError", () => {
    const src = readFileSync(SRC, "utf8");
    // The three pre-existing extractions all used `err.message`, which carries
    // buildErrorMessage's "HTTP 422 …" prefix plus the raw body.
    expect(src).not.toMatch(/err instanceof Error \? err\.message/);
  });

  // WF-3 gap fix — `.mutate(` isn't the only way to drop a write failure on
  // the floor: `handleSaveInputs` discarded `saveWholeInputsAsync()`'s
  // rejection via a `.catch(() => { /* silent */ })` that the scan above,
  // scoped to `.mutate(`/`.mutateAsync(`, structurally cannot see. Flags any
  // `.catch(` whose handler body never references the error (no toast, no
  // describeWriteError, no setError, no rethrow) — i.e. it binds a parameter
  // (or none at all) and then ignores it.
  //
  // A handler that deliberately needs no parameter (nothing to report, or it
  // unconditionally does something else useful) is still allowed, but only
  // by name, in ALLOWED_EMPTY_CATCHES below — same shape as the api-server's
  // maxCoverageWriteGuard.test.ts ALLOWED_INPUTS_WRITERS. There are none
  // today; this list exists so the next legitimate exception is a reviewable
  // one-liner, not a loosened regex.
  const ALLOWED_EMPTY_CATCHES: string[] = [];

  // Extracts the exact text of the `.catch( ... )` call starting at
  // `charOffset` (the index of its `.catch(`), by counting parens from the
  // opening one until its match closes — i.e. the call's own real extent,
  // not a guessed line count. WF-3 review, minor 4: the previous fixed
  // 15-line cap failed OPEN (an empty `.catch(` within 15 lines of some
  // unrelated `toast(`/`throw` would pass), and the "window ends where the
  // next site begins" alternative fails open too whenever a site is the
  // last (or only) one in the file, since the window then runs to EOF and
  // can pick up a later, unrelated site's handler. Paren-matching has
  // neither failure mode — it is bounded by the call's own syntax.
  function catchCallText(src: string, charOffset: number): string {
    const openIdx = src.indexOf("(", charOffset);
    let depth = 0;
    for (let i = openIdx; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) return src.slice(charOffset, i + 1);
      }
    }
    return src.slice(charOffset);
  }

  it("every .catch( handler in this file does something with the error it catches", () => {
    const src = readFileSync(SRC, "utf8");
    const lines = src.split("\n");
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.catch\(/.test(line) && isCode(line));

    // Char offset of the start of each line, to translate a site's line
    // index into a character offset for catchCallText.
    const lineStartChar: number[] = [];
    let running = 0;
    for (const l of lines) {
      lineStartChar.push(running);
      running += l.length + 1; // +1 for the stripped "\n"
    }

    const offenders: string[] = [];
    sites.forEach(({ line, i }) => {
      const charOffset = lineStartChar[i] + line.indexOf(".catch(");
      const own = stripComments(catchCallText(src, charOffset));
      const usesError = /toast\s*\(|describeWriteError\(|setError\(|throw\b/.test(own);
      // Match the allow-list name against this SITE's own line only, not
      // the extracted window — otherwise a future allowed name could be
      // satisfied by text belonging to a neighbouring site (WF-3 review).
      if (!usesError && !ALLOWED_EMPTY_CATCHES.some(name => line.includes(name))) {
        offenders.push(`${SRC}:${i + 1} — ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
