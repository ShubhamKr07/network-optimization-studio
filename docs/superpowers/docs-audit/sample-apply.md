# docs-audit — /docs-apply sample

A controlled sample sweep to exercise `/docs-apply` end-to-end (PR #3 was merged directly, so the
apply tool wasn't run live). Three deliberate detectable plants, one finding each.

## Sweep 2026-09-12 (sample)

Summary: 3 findings (3 commits), 0 dismissed.

### Finding 30b926f3f2 · stale_reference · repo · high · delete-file · commit ead2e1b
- **Where:** `docs/ops/sample-a.md:2` — references the removed Arcadia layer.
- **Proposal:** delete the file.

### Finding 4ade1ede44 · stale_reference · repo · high · delete-file · commit 4f6d177
- **Where:** `docs/ops/sample-b.md:2` — references nonexistent `artifacts/ghost/sample-b-target.ts`.
- **Proposal:** delete the file.

### Finding 93111fbe38 · stale_reference · repo · high · delete-file · commit 7921a81
- **Where:** `docs/ops/sample-c.md:2` — references undefined `pnpm bogus:not-a-real-script`.
- **Proposal:** delete the file.

## Carried over
(none — sample PR.)

## Dismissed
(none.)
