import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestPermissionReview } from "../harness/report.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "permrev-"));
}

describe("report — permission-review section", () => {
  it("returns null when the artifact directory is absent", () => {
    expect(latestPermissionReview(join(freshDir(), "does-not-exist"))).toBeNull();
  });

  it("returns null when the directory has no .md artifact", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "notes.txt"), "irrelevant");
    expect(latestPermissionReview(dir)).toBeNull();
  });

  it("inlines the newest .md and reads generatedAt from its sibling .json", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "2026-W37.md"), "## Grant candidates\n(old)\n");
    writeFileSync(join(dir, "2026-W37.json"), JSON.stringify({ generatedAt: "2026-09-14T00:00:00.000Z" }));
    writeFileSync(join(dir, "2026-W38.md"), "## Grant candidates\n(newest)\n");
    writeFileSync(join(dir, "2026-W38.json"), JSON.stringify({ generatedAt: "2026-09-21T00:00:00.000Z" }));

    const pr = latestPermissionReview(dir);
    expect(pr).not.toBeNull();
    expect(pr!.file).toBe("2026-W38.md"); // lexicographic sort → newest ISO week last
    expect(pr!.md).toContain("(newest)");
    expect(pr!.generatedAt).toBe("2026-09-21T00:00:00.000Z");
  });

  it("tolerates a missing/corrupt sibling .json (generatedAt null)", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "2026-W40.md"), "## Grant candidates\n");
    // no .json
    expect(latestPermissionReview(dir)!.generatedAt).toBeNull();

    writeFileSync(join(dir, "2026-W41.md"), "## Grant candidates\n");
    writeFileSync(join(dir, "2026-W41.json"), "{ not valid json");
    expect(latestPermissionReview(dir)!.generatedAt).toBeNull();
  });
});
