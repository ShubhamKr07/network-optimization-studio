import { describe, it, expect } from "vitest";
import {
  parseStandingPermissions,
  classifyGrant,
  classifyRule,
  classifyAll,
  diffAllow,
  parseDenials,
  topDeniedTool,
  escapeCell,
  redactCommand,
  scanSensitive,
  sha256Hex,
  matchesProjectAllow,
  suggestRule,
  buildCandidates,
  type Candidate,
} from "../harness/lib/permissions.js";
import type { ManagedMap } from "../harness/lib/permissionManaged.js";
import { evaluateAudit, transcriptDirFor } from "../harness/audit-permissions.js";

describe("parseStandingPermissions", () => {
  it("reads allow/deny/ask, tolerating missing keys", () => {
    expect(parseStandingPermissions({ permissions: { allow: ["Bash(ls)"], deny: [] } })).toEqual({
      allow: ["Bash(ls)"],
      deny: [],
      ask: [],
    });
    expect(parseStandingPermissions({})).toEqual({ allow: [], deny: [], ask: [] });
    expect(parseStandingPermissions(null)).toEqual({ allow: [], deny: [], ask: [] });
  });
});

describe("classifyGrant", () => {
  it("flags whole-tool grants as risky", () => {
    expect(classifyGrant("Bash").level).toBe("risky");
    expect(classifyGrant("Bash").ruleId).toBe("whole_tool_grant");
  });

  it("flags unrestricted wildcards as risky", () => {
    expect(classifyGrant("Bash(*)").ruleId).toBe("wildcard_all");
    expect(classifyGrant("Bash(:*)").ruleId).toBe("wildcard_all");
  });

  it("flags destructive shell as risky", () => {
    expect(classifyGrant("Bash(rm -rf test-results)").ruleId).toBe("destructive_bash");
    expect(classifyGrant("Bash(sudo apt install x)").ruleId).toBe("destructive_bash");
    expect(classifyGrant("Bash(chmod +x scripts/x.sh)").ruleId).toBe("destructive_bash");
  });

  it("flags git push as risky even with a trailing wildcard (risky beats broad)", () => {
    const g = classifyGrant("Bash(git push *)");
    expect(g.level).toBe("risky");
    expect(g.ruleId).toBe("git_push");
  });

  it("flags secret/env exposure and arbitrary sql as risky", () => {
    expect(classifyGrant("Bash(env)").ruleId).toBe("secret_exposure");
    expect(classifyGrant("Bash(printenv)").ruleId).toBe("secret_exposure");
    expect(classifyGrant("Bash(psql *)").ruleId).toBe("arbitrary_sql");
  });

  it("flags a whole MCP server grant as risky but a specific MCP tool as ok", () => {
    expect(classifyGrant("mcp__render").level).toBe("risky");
    expect(classifyGrant("mcp__render__trigger_deploy").level).toBe("ok");
  });

  it("marks scoped wildcards broad and specific commands ok", () => {
    expect(classifyGrant("Bash(pnpm run *)").level).toBe("broad");
    expect(classifyGrant("Bash(brew install *)").level).toBe("broad");
    expect(classifyGrant("Bash(pnpm -v)").level).toBe("ok");
    expect(classifyGrant("Bash(pg_isready)").level).toBe("ok");
  });
});

describe("classifyRule / destructive level (T1)", () => {
  it("classifies rm -r*/rm -rf, sudo, chmod/chown, dd if=, mkfs, git clean as destructive", () => {
    expect(classifyGrant("Bash(rm -rf test-results)").level).toBe("destructive");
    expect(classifyGrant("Bash(rm -r build)").level).toBe("destructive");
    expect(classifyGrant("Bash(sudo apt install x)").level).toBe("destructive");
    expect(classifyGrant("Bash(chmod +x scripts/x.sh)").level).toBe("destructive");
    expect(classifyGrant("Bash(chown user file)").level).toBe("destructive");
    expect(classifyGrant("Bash(dd if=/dev/zero of=/dev/sda)").level).toBe("destructive");
    expect(classifyGrant("Bash(mkfs.ext4 /dev/sda1)").level).toBe("destructive");
    expect(classifyGrant("Bash(git clean -fd)").level).toBe("destructive");
  });

  it("classifies git reset --hard and --force/force-push as destructive (moved out of risky)", () => {
    expect(classifyGrant("Bash(git reset --hard HEAD~1)").level).toBe("destructive");
    expect(classifyGrant("Bash(git push --force origin main)").level).toBe("destructive");
    expect(classifyGrant("Bash(git checkout --force)").level).toBe("destructive");
  });

  it("classifies SQL DROP/TRUNCATE as destructive", () => {
    expect(classifyGrant("Bash(psql -c 'DROP TABLE users')").level).toBe("destructive");
    expect(classifyGrant("Bash(psql -c 'TRUNCATE TABLE users')").level).toBe("destructive");
  });

  it("keeps plain git push (no force) as risky", () => {
    expect(classifyGrant("Bash(git push origin main)").level).toBe("risky");
    expect(classifyGrant("Bash(git push origin main)").ruleId).toBe("git_push");
  });

  it("keeps a whole-tool/unrestricted-wildcard Bash grant as risky, not destructive", () => {
    expect(classifyGrant("Bash").level).toBe("risky");
    expect(classifyGrant("Bash(*)").level).toBe("risky");
  });

  it("classifyRule classifies a full Tool(pattern) rule identically to classifyGrant (post-edit path)", () => {
    expect(classifyRule("Bash(rm -rf test-results)").level).toBe("destructive");
    expect(classifyRule("Bash(git push --force origin main)").level).toBe("destructive");
    expect(classifyRule("Bash(pnpm run *)").level).toBe("broad");
    expect(classifyRule("Bash(pnpm -v)").level).toBe("ok");
    expect(classifyRule("Bash(rm -rf x)")).toEqual(classifyGrant("Bash(rm -rf x)"));
  });
});

describe("escapeCell (T2 — locked escaping contract)", () => {
  it("applies the exact locked order for a fixture containing every escaped class", () => {
    // CR, LF, NUL, another control char (SOH \x01), then &, <, >, |, `, then bidi controls
    // (U+202A LRE ... U+202E RLO, U+2066 LRI ... U+2069 PDI) surrounding a "z".
    const input =
      "a\rb\nc\x00d\x01e & <tag> | `code` " +
      "‪z‮ " +
      "⁦w⁩";
    const expected = "a b c d e &amp; &lt;tag&gt; \\| \\`code\\` z w";
    expect(escapeCell(input)).toBe(expected);
  });
});

describe("redactCommand / scanSensitive (T2)", () => {
  it("redacts a db connection URL to <db-url>", () => {
    expect(redactCommand("psql postgres://user:secretpass@db.example.com:5432/mydb")).toBe(
      "psql <db-url>",
    );
  });

  it("redacts a bearer token to <token>", () => {
    expect(redactCommand("curl -H 'Authorization: Bearer abcdef123456'")).toBe(
      "curl -H 'Authorization: <token>'",
    );
  });

  it("redacts an explicit --password flag to <password>", () => {
    expect(redactCommand("mysqldump --password=hunter2 mydb")).toBe("mysqldump <password> mydb");
  });

  it("redacts an email address to <email>", () => {
    expect(redactCommand("mail me at shubham.kumar549@gmail.com")).toBe("mail me at <email>");
  });

  it("redacts an inline KEY=value env prefix to <env>", () => {
    expect(redactCommand("FOO_SECRET=abc123 node script.js")).toBe("<env> node script.js");
  });

  it("redacts an absolute home path to <home-path>", () => {
    expect(redactCommand("cat /Users/shubhamkr/.ssh/id_rsa")).toBe("cat <home-path>/.ssh/id_rsa");
  });

  it("scanSensitive is false for a clean command", () => {
    expect(scanSensitive("echo hello world")).toBe(false);
    expect(scanSensitive("pnpm --filter api-server test")).toBe(false);
  });

  it("scanSensitive flags a residual >=16-char mixed-class token that redaction didn't catch", () => {
    expect(scanSensitive("mycli --deploy sk_live_51H8abcdEFGH1234ijkl")).toBe(true);
  });

  it("scanSensitive flags a secret keyword even without a matched value pattern", () => {
    expect(scanSensitive("curl -H 'X-My-Secret-Value: yes'")).toBe(true);
  });

  it("sha256Hex is deterministic and matches node:crypto for a known input", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });
});

describe("matchesProjectAllow (T3 — metachar-safe, narrow claim)", () => {
  it("ignores non-Bash entries entirely", () => {
    expect(matchesProjectAllow("git status", ["Read(foo)", "Edit(bar)", "mcp__render"])).toBe(false);
  });

  it("a bare whole-tool Bash grant covers any command", () => {
    expect(matchesProjectAllow("anything at all", ["Bash"])).toBe(true);
  });

  it("expands the permission * wildcard to .* after escaping", () => {
    expect(matchesProjectAllow("pnpm run build", ["Bash(pnpm run *)"])).toBe(true);
    expect(matchesProjectAllow("pnpm test", ["Bash(pnpm run *)"])).toBe(false);
  });

  it("returns false, never throws, when nothing covers the command", () => {
    expect(matchesProjectAllow("rm -rf /", ["Bash(pnpm -v)"])).toBe(false);
  });

  // One covered (exact match) + one uncovered (a command that would incorrectly match if the
  // metacharacter were left as live regex syntax instead of escaped literal text) case for EACH
  // regex metacharacter in `$ [ ] ( ) \ . + ? ^ { } |`.
  it("escapes '.' — a literal dot must not act as 'any character'", () => {
    expect(matchesProjectAllow("cat notes.txt", ["Bash(cat notes.txt)"])).toBe(true);
    expect(matchesProjectAllow("cat notesXtxt", ["Bash(cat notes.txt)"])).toBe(false);
  });

  it("escapes '+' — a literal plus must not act as 'one or more'", () => {
    expect(matchesProjectAllow("echo a+b", ["Bash(echo a+b)"])).toBe(true);
    expect(matchesProjectAllow("echo aab", ["Bash(echo a+b)"])).toBe(false);
  });

  it("escapes '?' — a literal question mark must not act as 'optional'", () => {
    expect(matchesProjectAllow("echo colou?r", ["Bash(echo colou?r)"])).toBe(true);
    expect(matchesProjectAllow("echo color", ["Bash(echo colou?r)"])).toBe(false);
  });

  it("escapes '^' — a literal caret must not act as an anchor", () => {
    expect(matchesProjectAllow("echo a^b", ["Bash(echo a^b)"])).toBe(true);
    expect(matchesProjectAllow("echo ab", ["Bash(echo a^b)"])).toBe(false);
  });

  it("escapes '$' — a literal dollar must not act as an anchor", () => {
    expect(matchesProjectAllow("echo pay$5", ["Bash(echo pay$5)"])).toBe(true);
    expect(matchesProjectAllow("echo pay5", ["Bash(echo pay$5)"])).toBe(false);
  });

  it("escapes '(' and ')' — literal parens must not act as a grouping construct", () => {
    expect(matchesProjectAllow("echo (a)", ["Bash(echo (a))"])).toBe(true);
    expect(matchesProjectAllow("echo a", ["Bash(echo (a))"])).toBe(false);
  });

  it("escapes '[' and ']' — literal brackets must not act as a character class", () => {
    expect(matchesProjectAllow("echo [ab]", ["Bash(echo [ab])"])).toBe(true);
    expect(matchesProjectAllow("echo a", ["Bash(echo [ab])"])).toBe(false);
  });

  it("escapes '{' and '}' — literal braces must not act as a quantifier", () => {
    expect(matchesProjectAllow("echo x{1}", ["Bash(echo x{1})"])).toBe(true);
    expect(matchesProjectAllow("echo x", ["Bash(echo x{1})"])).toBe(false);
  });

  it("escapes '\\\\' — a literal backslash must not act as an escape prefix", () => {
    expect(matchesProjectAllow("echo C:\\data", ["Bash(echo C:\\data)"])).toBe(true);
    // Without escaping, "\\d" would behave as the digit class \d, incorrectly matching "5".
    expect(matchesProjectAllow("echo C:5ata", ["Bash(echo C:\\data)"])).toBe(false);
  });

  it("escapes '|' — a literal pipe must not act as top-level alternation", () => {
    expect(matchesProjectAllow("echo a|b", ["Bash(echo a|b)"])).toBe(true);
    // Without escaping, "^echo a|b$" would match ANY string starting with "echo a".
    expect(matchesProjectAllow("echo aXYZ", ["Bash(echo a|b)"])).toBe(false);
  });
});

describe("suggestRule (T4 — exact-by-default + reviewed template registry)", () => {
  it("is exact by default for an arbitrary command", () => {
    expect(suggestRule("echo hello")).toBe("Bash(echo hello)");
    expect(suggestRule("ls -la")).toBe("Bash(ls -la)");
  });

  it("generalizes git read subcommands (log, status, diff, show)", () => {
    expect(suggestRule("git log --oneline -5")).toBe("Bash(git log *)");
    expect(suggestRule("git status")).toBe("Bash(git status *)");
    expect(suggestRule("git diff HEAD~1")).toBe("Bash(git diff *)");
    expect(suggestRule("git show abc123")).toBe("Bash(git show *)");
  });

  it("generalizes git branch --list only (not bare git branch, which can create one)", () => {
    expect(suggestRule("git branch --list")).toBe("Bash(git branch --list *)");
    expect(suggestRule("git branch feature-x")).toBe("Bash(git branch feature-x)");
  });

  it("generalizes pnpm -v", () => {
    expect(suggestRule("pnpm -v")).toBe("Bash(pnpm -v)");
  });

  it("generalizes pnpm --filter <pkg> test|typecheck, wildcarding only the package name", () => {
    expect(suggestRule("pnpm --filter api-server test")).toBe("Bash(pnpm --filter * test)");
    expect(suggestRule("pnpm --filter studio typecheck")).toBe("Bash(pnpm --filter * typecheck)");
  });

  it("does NOT generalize pnpm --filter <pkg> test:watch as if it were plain test", () => {
    expect(suggestRule("pnpm --filter api-server test:watch")).toBe(
      "Bash(pnpm --filter api-server test:watch)",
    );
  });

  it("proposes an exact per-script rule for a known pnpm run script (never wildcards the script name)", () => {
    expect(suggestRule("pnpm run test")).toBe("Bash(pnpm run test)");
    expect(suggestRule("pnpm run build")).toBe("Bash(pnpm run build)");
  });

  it("falls back to exact for an unknown pnpm run script", () => {
    expect(suggestRule("pnpm run some-custom-script")).toBe("Bash(pnpm run some-custom-script)");
  });

  it("does NOT generalize pnpm exec, docker run, git config, or git push", () => {
    expect(suggestRule("pnpm exec vitest run")).toBe("Bash(pnpm exec vitest run)");
    expect(suggestRule("docker run -it ubuntu bash")).toBe("Bash(docker run -it ubuntu bash)");
    expect(suggestRule("git config user.name foo")).toBe("Bash(git config user.name foo)");
    expect(suggestRule("git push origin main")).toBe("Bash(git push origin main)");
  });

  it("never generalizes a destructive command, even if it superficially resembles a template", () => {
    expect(suggestRule("git push --force origin main")).toBe("Bash(git push --force origin main)");
    expect(suggestRule("git reset --hard HEAD~1")).toBe("Bash(git reset --hard HEAD~1)");
    expect(suggestRule("rm -rf /tmp/x")).toBe("Bash(rm -rf /tmp/x)");
  });
});

describe("diffAllow", () => {
  it("computes added and removed sets", () => {
    expect(diffAllow(["a", "b", "c"], ["a", "c", "d"])).toEqual({ added: ["b"], removed: ["d"] });
    expect(diffAllow(["a"], [])).toEqual({ added: ["a"], removed: [] });
  });
});

// A minimal transcript: an assistant tool_use followed by a user tool_result that denies it.
function transcript(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

function toolUse(id: string, name: string, input: unknown, ts: string) {
  return { type: "assistant", timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } };
}
function denial(toolUseId: string, ts: string) {
  return {
    type: "user",
    timestamp: ts,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          is_error: true,
          content: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
        },
      ],
    },
  };
}

describe("parseDenials", () => {
  it("attributes a denial back to its originating tool call", () => {
    const text = transcript([
      toolUse("t1", "Bash", { command: "git push origin main" }, "2026-09-14T10:00:00.000Z"),
      denial("t1", "2026-09-14T10:00:05.000Z"),
    ]);
    const d = parseDenials(text);
    expect(d).toHaveLength(1);
    expect(d[0].tool).toBe("Bash");
    expect(d[0].input).toBe("git push origin main");
  });

  it("does NOT flag transcript text that merely quotes the denial phrase", () => {
    const echoed = {
      type: "user",
      timestamp: "2026-09-14T10:00:00.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "x",
            is_error: false,
            content: "grep output: The user doesn't want to proceed with this tool use appears in a log line here",
          },
        ],
      },
    };
    expect(parseDenials(transcript([echoed]))).toEqual([]);
  });

  it("filters denials to the task window", () => {
    const text = transcript([
      toolUse("t1", "Bash", { command: "a" }, "2026-09-10T00:00:00.000Z"),
      denial("t1", "2026-09-10T00:00:01.000Z"), // before window
      toolUse("t2", "Edit", { file_path: "x" }, "2026-09-14T10:00:00.000Z"),
      denial("t2", "2026-09-14T10:00:01.000Z"), // in window
    ]);
    const d = parseDenials(text, { start: "2026-09-14T00:00:00.000Z", end: "2026-09-15T00:00:00.000Z" });
    expect(d).toHaveLength(1);
    expect(d[0].tool).toBe("Edit");
  });

  it("topDeniedTool returns the modal tool", () => {
    const text = transcript([
      toolUse("t1", "Bash", { command: "a" }, "2026-09-14T10:00:00.000Z"),
      denial("t1", "2026-09-14T10:00:01.000Z"),
      toolUse("t2", "Bash", { command: "b" }, "2026-09-14T10:00:02.000Z"),
      denial("t2", "2026-09-14T10:00:03.000Z"),
      toolUse("t3", "Edit", { file_path: "x" }, "2026-09-14T10:00:04.000Z"),
      denial("t3", "2026-09-14T10:00:05.000Z"),
    ]);
    expect(topDeniedTool(parseDenials(text))).toBe("Bash");
  });
});

describe("evaluateAudit", () => {
  const AT = "2026-09-15T00:00:00.000Z";

  it("builds a row and gates on a risky grant", () => {
    const res = evaluateAudit("bundleX", AT, ["Bash(git push *)", "Bash(pnpm -v)"], 0, [], [], []);
    expect(res.row.allow_total).toBe("2");
    expect(res.row.risky_grants).toBe("1");
    expect(res.row.broad_grants).toBe("0");
    expect(res.gateReasons.length).toBeGreaterThanOrEqual(1);
    expect(res.row.notes).toMatch(/gate:/);
  });

  it("does not gate when all grants are ok/broad and no recurrence", () => {
    const res = evaluateAudit("bundleY", AT, ["Bash(pnpm run *)", "Bash(pnpm -v)"], 0, ["Bash(pnpm -v)"], [], []);
    expect(res.gateReasons).toEqual([]);
    expect(res.row.broad_grants).toBe("1");
    expect(res.row.allow_new).toBe("1"); // "Bash(pnpm run *)" not in baseline
    expect(res.row.notes).toBe("");
  });

  it("gates on a recurring denied tool (2nd occurrence across audits)", () => {
    const denials = [{ at: AT, tool: "Bash", input: "git push", toolUseId: "t1" }];
    const res = evaluateAudit("bundleZ", AT, ["Bash(pnpm -v)"], 0, ["Bash(pnpm -v)"], denials, ["Bash"]);
    expect(res.row.top_denied_tool).toBe("Bash");
    expect(res.gateReasons.some((r) => /recurring denial/.test(r))).toBe(true);
  });
});

describe("transcriptDirFor", () => {
  it("maps a repo path to the ~/.claude/projects slug", () => {
    expect(transcriptDirFor("/Users/x/network-optimization-studio")).toMatch(
      /\.claude\/projects\/-Users-x-network-optimization-studio$/,
    );
  });
});

// --- buildCandidates (T8) -------------------------------------------------

function ledgerLine(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

function ledgerPrompted(toolUseId: string, at: string, command: string, permissionMode = "default"): string {
  return ledgerLine({ at, sessionId: "s1", toolUseId, event: "prompted", command, permissionMode });
}

function ledgerExecuted(toolUseId: string, at: string, permissionMode = "default"): string {
  return ledgerLine({ at, sessionId: "s1", toolUseId, event: "executed", permissionMode });
}

function emptyManaged(): ManagedMap {
  return {};
}

describe("buildCandidates (T8)", () => {
  it("produces a grant candidate for a promotable command not in the project allowlist", () => {
    const ledger = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "git log -5"), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const candidates = buildCandidates({ ledger, transcript: "", projectAllow: [], managed: emptyManaged() });
    const grants = candidates.filter((c) => c.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0].proposedRule).toBe("Bash(git log *)"); // template-generalized
    expect(grants[0].level).toBe("broad"); // classified on the PROPOSED rule, not the raw command
    expect(grants[0].sensitive).toBe(false);
    expect(grants[0].reviewLocalOnly).toBe(false);
    expect(grants[0].provenance).toBe("prompted_and_executed");
    expect(grants[0].count).toBe(1);
  });

  it("filters out a promotable command already covered by the project allowlist (not-covered filter)", () => {
    const ledger = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "pnpm -v"), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const candidates = buildCandidates({
      ledger,
      transcript: "",
      projectAllow: ["Bash(pnpm -v)"],
      managed: emptyManaged(),
    });
    expect(candidates.filter((c) => c.kind === "grant")).toHaveLength(0);
  });

  it("dedupes repeated occurrences of the same effective rule into one candidate with an aggregated count", () => {
    const ledger = [
      ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "git log -5"),
      ledgerExecuted("t1", "2026-09-14T10:00:01.000Z"),
      ledgerPrompted("t2", "2026-09-15T10:00:00.000Z", "git log --oneline"), // different raw command, same template rule
      ledgerExecuted("t2", "2026-09-15T10:00:01.000Z"),
    ].join("\n");
    const candidates = buildCandidates({ ledger, transcript: "", projectAllow: [], managed: emptyManaged() });
    const grants = candidates.filter((c) => c.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0].count).toBe(2);
    expect(grants[0].firstSeen).toBe("2026-09-14T10:00:00.000Z");
    expect(grants[0].lastSeen).toBe("2026-09-15T10:00:00.000Z");
  });

  it("a sensitive grant candidate carries no proposedRule and is reviewLocalOnly", () => {
    // Not caught by any redaction placeholder (no Bearer/db-url/password/email/env shape) but a
    // residual >=16-char mixed-class token, so scanSensitive flags it (mirrors the T2 fixture).
    const sensitiveCommand = "mycli --deploy sk_live_51H8abcdEFGH1234ijkl";
    const ledger = [
      ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", sensitiveCommand),
      ledgerExecuted("t1", "2026-09-14T10:00:01.000Z"),
    ].join("\n");
    const candidates = buildCandidates({ ledger, transcript: "", projectAllow: [], managed: emptyManaged() });
    const grants = candidates.filter((c) => c.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0].sensitive).toBe(true);
    expect(grants[0].reviewLocalOnly).toBe(true);
    expect(grants[0].proposedRule).toBeUndefined();
    expect(grants[0].redactedPreview).toBe("sensitive — review locally");
  });

  it("produces a deny candidate from a transcript denial, classified on its own proposed rule", () => {
    const t = transcript([
      toolUse("d1", "Bash", { command: "git push --force origin main" }, "2026-09-14T10:00:00.000Z"),
      denial("d1", "2026-09-14T10:00:01.000Z"),
    ]);
    const candidates = buildCandidates({ ledger: "", transcript: t, projectAllow: [], managed: emptyManaged() });
    const denies = candidates.filter((c) => c.kind === "deny");
    expect(denies).toHaveLength(1);
    expect(denies[0].level).toBe("destructive"); // never generalized
    expect(denies[0].proposedRule).toBe("Bash(git push --force origin main)");
    expect(denies[0].provenance).toBe("prompted_and_denied");
  });

  it("produces a revoke candidate from a stale managed rule", () => {
    const managed: ManagedMap = {
      "Bash(git log *)": {
        owner: "shubham",
        rationale: "test",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        count: 5,
      },
    };
    const candidates = buildCandidates({
      ledger: "",
      transcript: "",
      projectAllow: [],
      managed,
      now: "2026-03-01T00:00:00.000Z",
      staleWeeks: 8,
    });
    const revokes = candidates.filter((c) => c.kind === "revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0].proposedRule).toBe("Bash(git log *)");
  });

  it("splits candidates by kind (grant/deny/revoke can all appear together)", () => {
    const ledger = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "git status"), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const t = transcript([
      toolUse("d1", "Bash", { command: "rm -rf /tmp/scratch" }, "2026-09-14T11:00:00.000Z"),
      denial("d1", "2026-09-14T11:00:01.000Z"),
    ]);
    const managed: ManagedMap = {
      "Bash(pnpm run build)": {
        owner: "shubham",
        rationale: "test",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        count: 1,
      },
    };
    const candidates = buildCandidates({
      ledger,
      transcript: t,
      projectAllow: [],
      managed,
      now: "2026-03-01T00:00:00.000Z",
      staleWeeks: 8,
    });
    const kinds = new Set(candidates.map((c) => c.kind));
    expect(kinds).toEqual(new Set(["grant", "deny", "revoke"]));
  });

  it("candidate ids are stable across two independent runs with the same input", () => {
    const ledger = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "git log -5"), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const input = { ledger, transcript: "", projectAllow: [], managed: emptyManaged() };
    const a = buildCandidates(input);
    const b = buildCandidates(input);
    expect(a.map((c: Candidate) => c.id)).toEqual(b.map((c: Candidate) => c.id));
    expect(a[0].id).toHaveLength(12);
  });
});
