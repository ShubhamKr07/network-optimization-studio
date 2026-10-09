# Gate proposal: review_caught

**Status: NO GATE PROPOSED — and that is the correct outcome, not an omission.**
This file exists because the second-occurrence rule fired mechanically. It is a
**false positive of the rule itself**, in exactly the shape the taxonomy note
already documents for `other`.

**Symptom:** a real defect reached review with no automated check capable of
finding it.

**Occurrences (4 rows with an empty `gate_proposed`):**

- 2026-10-03 `SBR-6` — an abandoned delete-confirm pinned a flyout open with
  live pointer events, swallowing clicks on the content column beneath.
- 2026-10-09 `CH4O-9` — the verification gate itself executed the production
  migration: the test called an unfiltered `migrateAll(db)`, which rewrites every
  row for the model in whatever database `DATABASE_URL` points at.
- 2026-10-09 `CH4O-7` — `handleSolve`'s `onSuccess` stored the stripped request
  payload as the last-saved snapshot, leaving every Chapter 4 scenario
  permanently dirty after one Run Optimizer.
- 2026-10-09 `CH4O-9` — the production runbook could not connect to production
  at all, and its backup step had no already-exists branch on a procedure whose
  own notes say a crashed run is safe to re-run.

**Why no gate is proposed.** `review_caught` is defined by the *absence* of an
automated check — the taxonomy note says so explicitly: *"these are expected to
have no gate, and saying so is the point of the row."* So the cause can never
accumulate a filled `gate_proposed`, and the rule will therefore re-fire on
**every** retro from now on. The rule's contract is "this mechanism recurred and
nothing guards it"; here the label records a *discovery channel*, not a
mechanism, and four rows share no common failure mode — a test pointed at the
wrong database, a React state-snapshot bug, and two runbook defects have nothing
in common to gate.

This is the same defect the taxonomy note describes for `other`:

> the rule fired on `other` with two rows that shared only the catch-all label
> […] A rule that cries wolf gets ignored, and that costs more than two extra
> labels.

**Recommended change to the harness instead of a gate** — one of:

1. **Exempt `review_caught` from the second-occurrence rule** in
   `.claude/skills/harness-retro/SKILL.md` step 4, the way a catch-all would be.
   Simplest, and makes the rule mean what it says.
2. **Stop using `review_caught` where a mechanism is identifiable** and classify
   by mechanism instead, filing `review_caught` only when no mechanism fits.
   Note that this branch already did that deliberately: the costSummary contract
   Critical was filed as `codegen_drift` and the runbook ordering as
   `deploy_config`, precisely because a gate *is* conceivable for those. On that
   discipline, two of the four rows above might also be reclassifiable
   (the unfiltered-`migrateAll` row has a plausible lint-style gate).

Option 1 is recommended; option 2 is the better long-run discipline and the two
are compatible.

**What the recurrence genuinely signals, since it is worth something:** not a
missing check, but that **review is currently load-bearing for correctness** —
four defects in two tasks reached the final gate undetected by ~4,300 automated
tests. The actionable reading is about review *coverage* (keep the whole-branch
review mandatory, and keep it scoped widely enough to see cross-layer and
operational concerns), not about adding a CI step.

**Status:** no gate proposed — awaiting a human decision on the taxonomy change
above.
