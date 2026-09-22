import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ch4-lock — structural guard, mirroring the precedent set by
// `historyReadOnlyGuards.test.ts` in the studio package.
//
// The lock is enforced per handler rather than by one router-level param
// guard, deliberately: a param guard costs an extra ownership-scoped SELECT
// on EVERY scenario request, whereas eight of these handlers already hold the
// row they need. The price of that choice is that a handler added later can
// forget the check — so this test removes the "can forget" part. It reads the
// route source and asserts every `:scenarioId` handler contains a lock check.
//
// If this fails for a route you just added: add
//   `if (isModelLocked(<row>.modelId)) { respondLocked(res); return; }`
// positioned AFTER the ownership-scoped 404 (so a non-owner still gets 404,
// never a 403 that would confirm the row exists — hard rule #5) and BEFORE
// any write.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, "..", "routes");

const ROUTE_FILES = ["scenarios.ts", "distanceBands.ts"];
const HANDLER_RE = /^router\.(get|post|patch|delete)\("(\/scenarios\/:scenarioId[^"]*)"/;

interface Handler { file: string; line: number; method: string; path: string; body: string }

function scenarioIdHandlers(): Handler[] {
  const out: Handler[] = [];
  for (const file of ROUTE_FILES) {
    const lines = readFileSync(join(ROUTES, file), "utf8").split("\n");
    const starts: number[] = [];
    lines.forEach((l, i) => { if (HANDLER_RE.test(l)) starts.push(i); });
    starts.forEach((start, idx) => {
      const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
      const m = HANDLER_RE.exec(lines[start])!;
      out.push({ file, line: start + 1, method: m[1], path: m[2], body: lines.slice(start, end).join("\n") });
    });
  }
  return out;
}

describe("locked-model guards are present on every scenario-scoped route", () => {
  const handlers = scenarioIdHandlers();

  it("finds the handlers at all — the sweep is not vacuously empty", () => {
    // Without this, a refactor that renames the param or the router variable
    // would leave every assertion below passing over an empty list.
    expect(handlers.length).toBeGreaterThanOrEqual(11);
  });

  it("guards every :scenarioId handler", () => {
    const unguarded = handlers
      .filter(h => !h.body.includes("isModelLocked("))
      .map(h => `${h.file}:${h.line} ${h.method.toUpperCase()} ${h.path}`);
    expect(unguarded).toEqual([]);
  });

  it("never refuses a locked model AFTER a write — the check precedes the mutation", () => {
    // A guard placed after `db.update`/`db.delete`/`db.insert` would return
    // 403 having already changed the data, which locks nothing. Assert the
    // first lock check in a mutating handler comes before the first write.
    const offenders: string[] = [];
    for (const h of handlers) {
      const guard = h.body.indexOf("isModelLocked(");
      const write = Math.min(
        ...["db.update(", "db.delete(", "db.insert(", "db.transaction("]
          .map(t => { const i = h.body.indexOf(t); return i === -1 ? Number.POSITIVE_INFINITY : i; }),
      );
      if (write !== Number.POSITIVE_INFINITY && guard > write) {
        offenders.push(`${h.file}:${h.line} ${h.method.toUpperCase()} ${h.path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("covers the two routes that carry no :scenarioId — create and list", () => {
    // These cannot be found by the sweep above (no param to match) and are
    // the two ways into a locked model that do not name an existing scenario.
    const src = readFileSync(join(ROUTES, "scenarios.ts"), "utf8");
    const create = src.slice(src.indexOf('router.post("/scenarios"'), src.indexOf('router.get("/scenarios/:scenarioId"'));
    const list = src.slice(src.indexOf('router.get("/scenarios"'), src.indexOf('router.post("/scenarios"'));
    expect(create).toContain("isModelLocked(");
    expect(list).toContain("isModelLocked(");
  });
});
