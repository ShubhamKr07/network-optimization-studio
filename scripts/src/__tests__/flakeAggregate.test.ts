import { describe, it, expect } from "vitest";
import { aggregate, type PwReport } from "../harness/lib/flakeAggregate.js";

function run(specs: { file: string; title: string; ok: boolean }[]): PwReport {
  return {
    suites: [
      {
        file: specs[0]?.file,
        specs: specs.map((s) => ({ title: s.title, file: s.file, ok: s.ok })),
      },
    ],
  };
}

describe("flakeAggregate", () => {
  it("counts runs and failures per test across reports", () => {
    const stable = { file: "a.spec.ts", title: "stable", ok: true };
    const flaky = (ok: boolean) => ({ file: "a.spec.ts", title: "flaky", ok });
    const reports = [
      run([stable, flaky(true)]),
      run([stable, flaky(false)]),
      run([stable, flaky(true)]),
      run([stable, flaky(false)]),
    ];
    const rows = aggregate(reports);
    const s = rows.find((r) => r.title === "stable")!;
    const f = rows.find((r) => r.title === "flaky")!;
    expect(s).toMatchObject({ runs: 4, failures: 0, flakeRate: 0 });
    expect(f).toMatchObject({ runs: 4, failures: 2, flakeRate: 0.5 });
  });

  it("marks a fully-failing test rate=1 (broken)", () => {
    const rows = aggregate([
      run([{ file: "b.spec.ts", title: "broken", ok: false }]),
      run([{ file: "b.spec.ts", title: "broken", ok: false }]),
    ]);
    expect(rows[0]).toMatchObject({ runs: 2, failures: 2, flakeRate: 1 });
  });

  it("derives ok from nested test results when spec.ok is absent", () => {
    const report: PwReport = {
      suites: [
        {
          file: "c.spec.ts",
          suites: [
            {
              specs: [
                { title: "nested", tests: [{ results: [{ status: "passed" }] }] },
                { title: "nested-fail", tests: [{ results: [{ status: "failed" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const rows = aggregate([report]);
    expect(rows.find((r) => r.title === "nested")!.failures).toBe(0);
    expect(rows.find((r) => r.title === "nested-fail")!.failures).toBe(1);
  });
});
