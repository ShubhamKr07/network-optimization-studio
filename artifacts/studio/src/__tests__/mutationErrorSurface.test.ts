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

describe("Workspace mutation error surface", () => {
  it("every .mutate( call site has an onError before the next one begins", () => {
    const src = readFileSync(SRC, "utf8");
    const lines = src.split("\n");
    // Ignore commented-out code so a `// foo.mutate(` note is not an offender.
    const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
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
      const own = lines.slice(i, end).join("\n");
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

  it("every .catch( handler in this file does something with the error it catches", () => {
    const src = readFileSync(SRC, "utf8");
    const lines = src.split("\n");
    const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.catch\(/.test(line) && isCode(line));

    const offenders: string[] = [];
    sites.forEach(({ line, i }, n) => {
      const end = n + 1 < sites.length ? sites[n + 1].i : lines.length;
      // A `.catch(` handler is typically a short arrow-function body ending
      // at its own closing `});` — cap the window at 15 lines so a later
      // site's unrelated code can never be mistaken for this one's body.
      const own = lines.slice(i, Math.min(end, i + 15)).join("\n");
      const usesError = /toast\s*\(|describeWriteError\(|setError\(|throw\b/.test(own);
      if (!usesError && !ALLOWED_EMPTY_CATCHES.some(name => own.includes(name))) {
        offenders.push(`${SRC}:${i + 1} — ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
