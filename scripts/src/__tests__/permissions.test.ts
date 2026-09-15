import { describe, it, expect } from "vitest";
import {
  parseStandingPermissions,
  classifyGrant,
  classifyAll,
  diffAllow,
  parseDenials,
  topDeniedTool,
} from "../harness/lib/permissions.js";
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
