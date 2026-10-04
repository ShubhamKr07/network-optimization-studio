# Gate: `other` — resolved by splitting the cause

**Status: DECIDED 2026-10-05 (approved).** The preflight below is **enabled**. The `other` cause has
been split, and both rows that triggered this proposal have been re-filed. This file is kept as the
record of what was decided and why, not as an open proposal.

**Original symptom:** the second-occurrence rule fired on `other` — two rows, no gate — but the two
occurrences shared only the catch-all label.

**Occurrences:**
- 2026-09-30 `ch9-unlock` — `pnpm --filter api-server test` with no `DATABASE_URL` fails **21 files at
  COLLECTION**, not assertion (`DATABASE_URL must be set…`, thrown by `lib/db/src/index.ts:8` at import
  time via `routes/scenarios.ts`). Reads exactly like a broad structural regression; cost a full
  ~10 min suite run plus a diagnostic run to attribute. **Now filed as `config_preflight`.**
- 2026-10-04 `SBR` — the whole-branch review found a real user-facing bug **no suite could have
  caught**: an abandoned delete-confirm pinned the Scenarios flyout open permanently with pointer
  events live, parking a 224px interactive panel over the content column. The gate was green with
  that bug in the tree. **Now filed as `review_caught`.**

---

## Decision 1 — preflight for the config case: ENABLED

`artifacts/api-server/scripts/preflight-db-url.mjs`, wired as `pretest` in
`artifacts/api-server/package.json`. Fails in under a second naming the cause, instead of letting 21
suites fail at import in a shape that disguises it.

Verified both directions before enabling, which is the point of a gate:
- without `DATABASE_URL` → exits 1, prints the cause and the exact re-run command, **no suite runs**;
- with it → passes through, `cors.test.ts` runs 3/3.

Deliberately **not** solved by making the `lib/db` import lazy: that hides the misconfiguration until
the first query and scatters the failure across runtime instead of startup. The problem was never
that it fails — it is that it failed 21 times in a misleading shape.

## Decision 2 — the review-caught case: NO GATE, BY DESIGN

No automated check is proposed, and that is the decision rather than an omission.

The flyout bug was reachable only by hovering a rail, starting a delete, and abandoning it. No
assertion existed because **nobody had conceived of the state**. An automated check can only test a
behaviour someone already imagined; this class exists precisely because that is not always true. The
control that caught it is the pipeline's existing step 5 — whole-branch review before push — and the
cycle is the evidence it works: two full gates were green with that bug present.

A gate citing a defect it could not have caught is worse than an honest gap, because it converts a
known blind spot into a false sense of coverage. The `review_caught` cause now exists so rows like
this can be recorded as "no gate, correctly" instead of accumulating under a catch-all and firing
this rule again.

The nearest honest mechanical control is not a gate but a coverage rule, already recorded as a
Gotcha in `CLAUDE.md` from the same bundle: when a feature's behaviour lives in CSS or in a browser
API that `setup.ts` stubs, RTL coverage of it is structurally incapable of failing, so it needs a
real-browser spec. That is a review checklist item, not a CI step.

## Decision 3 — split the taxonomy: DONE

`config_preflight` and `review_caught` added to the cause list in
`.claude/skills/harness-retro/SKILL.md`, with the rationale inline and a standing instruction:
**keep `other` genuinely residual — a second row about to land under it is the signal to add a cause,
not to reuse the bucket.**

Why this was the root fix rather than a tidy-up: the second-occurrence rule's contract is "this cause
recurred". A catch-all breaks that contract, so the rule fired on a coincidence of labelling — a
false positive of the rule itself. A rule that cries wolf gets ignored, which costs more than two
extra labels.

## The pattern worth keeping

All three decisions come from the same root, and it is the same root as the `solvers/**` deploy-scope
error recorded in `CLAUDE.md` the day before: **a label, a path list, or a scope that was correct
when written, silently stopped being correct, and had nothing attached to signal the change.** The
defence is not more care at the time of writing — it is attaching the evidence, so a later reader can
tell when the ground has moved.
