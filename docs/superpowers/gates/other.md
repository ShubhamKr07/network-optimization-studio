# Gate proposal: other

**Status:** proposed — awaiting human approval (not enabled)

**Symptom:** two unrelated failures filed under the catch-all cause, one of which is
mechanically gateable and one of which is not.

**Occurrences:**
- 2026-09-30 `ch9-unlock` — `pnpm --filter api-server test` with no `DATABASE_URL` fails **21 files at
  COLLECTION**, not assertion (`DATABASE_URL must be set…` thrown by `lib/db/src/index.ts:8` at import
  time via `routes/scenarios.ts`). It reads exactly like a broad structural regression and cost a full
  ~10 min suite run plus a diagnostic run to attribute.
- 2026-10-04 `SBR` — the whole-branch review found a real user-facing bug **no suite could have
  caught**: an abandoned delete-confirm pinned the Scenarios flyout open permanently with pointer
  events live, parking a 224px interactive panel over the content column that swallowed clicks on the
  map and grids beneath it. The gate was green with that bug in the tree.

## These two do not share a mechanism, and that is the first finding

A gate proposal is supposed to name one automated check that would have caught the recorded
occurrences. These two have nothing in common except the label. Forcing a single gate over them would
produce a check that addresses neither. So this document proposes a gate for the one that is
gateable, states plainly that the other is not, and records the taxonomy problem that let them be
filed together.

## Proposed automated gate (covers occurrence 1 only)

A preflight in the api-server test script that fails fast with the real cause instead of letting 21
suites fail at import:

```jsonc
// artifacts/api-server/package.json
"pretest": "node -e \"if(!process.env.DATABASE_URL){console.error('\\n  DATABASE_URL is not set.\\n  The api-server suite imports lib/db at module load, so EVERY file fails at collection\\n  with what looks like a structural regression. Set it and re-run:\\n\\n    DATABASE_URL=\\\"postgresql://<user>@localhost:5432/nos_dev\\\" pnpm --filter api-server test\\n');process.exit(1)}\""
```

**How to enable:** add the `pretest` script above to `artifacts/api-server/package.json`. No CI change
needed — it runs wherever the suite runs.

**Why a preflight rather than a lazier `lib/db` import:** making the import lazy would hide the
misconfiguration until the first query and spread the failure across runtime instead of startup. The
problem was never that it fails — it is that it fails 21 times in a shape that disguises the cause.

## Occurrence 2 is deliberately NOT gateable, and should not be forced into one

The flyout bug was reachable only by hovering a rail, starting a delete, and abandoning it — a state
no assertion existed for because nobody had thought of the state. An automated check can only test a
behaviour someone already conceived of; this is the class that exists precisely because that is not
always true. The control for it is the pipeline's existing step 5 (whole-branch review before push),
which is what caught it. **Recording it here as "no gate proposed, by design" rather than inventing
one** — a gate that cannot catch the thing it cites is worse than an honest gap.

If anything mechanical is wanted for this class, the nearest honest candidate is not a gate but a
coverage rule, already recorded as a Gotcha from the same bundle: when a feature's behaviour lives in
CSS or in a browser API that `setup.ts` stubs, RTL coverage of it is structurally incapable of
failing, so it needs a real-browser spec. That is a review checklist item, not a CI step.

## The taxonomy finding

`other` is accumulating unrelated rows, which makes the second-occurrence rule fire on a coincidence
of labelling rather than on a recurring cause. Two options for the human:

1. **Split the catch-all** — add `config_preflight` (occurrence 1) and `review_caught` (occurrence 2)
   to the taxonomy in `.claude/skills/harness-retro/SKILL.md`, and re-file these two rows. The
   second-occurrence rule then measures real recurrence.
2. **Leave it** and accept that `other` will keep firing this rule spuriously, treating each firing as
   a prompt to re-read the rows rather than as evidence of a pattern.

Recommendation: option 1. The rule's value depends on a cause meaning the same thing twice.
