# Gate proposal: config_preflight

**Symptom:** a gate runs to completion and reports a result that is not about
the code under test — either because it was pointed at the wrong target, or
because the command never actually executed. Both failures are *self-concealing*:
they produce confident output.

**Occurrences:**

- 2026-10-05 `agents-opus-ponytail` — existing row (`gate_proposed` filled).
- 2026-10-09 `CH4O-12` — `pnpm e2e:gate` with `E2E_BASE_URL` unset.
  `playwright.config.ts:3-5` defaults `BASE_URL` to a remote
  `kirk.replit.dev` deployment, so the whole gate ran against a stale remote app
  and produced **136 bogus failures**. The trap was documented in
  `CLAUDE.md` for `labs.spec.ts` only, but it governs the entire gate.
- 2026-10-09 `CH4O-13` — the quiet-machine precondition was written as
  `ps aux | grep "[v]itest" | grep -vc "zsh -c" && pnpm --filter api-server test`.
  **`grep -c` exits 1 when the count is 0**, so `&&` short-circuited precisely
  when the machine *was* quiet: the suite never ran, while the guard printed its
  all-clear.

**The common mechanism, stated once:** a gate's *preconditions* were never
asserted — the target URL, a required env var, and the exit status of the check
itself were all assumed rather than observed. This is the same family as the
documented `git checkout main | tail -2 && git merge` incident in
`CLAUDE.md`'s Branch discipline: **a guard whose exit code is read from the
wrong command is worse than no guard, because it reports success.**

The consequence worth stating plainly: **any historical "e2e:gate green" claim in
this repo was only ever about local code if `E2E_BASE_URL` was set.** An
unqualified green from an earlier session is not evidence about local HEAD.

**Proposed automated gate — two parts:**

1. **Fail fast on a missing target.** In `playwright.config.ts`, replace the
   remote-URL default with a hard failure when the variable is unset for a local
   gate run:

   ```ts
   const BASE_URL = process.env.E2E_BASE_URL
     ?? (process.env.E2E_ALLOW_REMOTE ? REMOTE_FALLBACK : (() => {
          throw new Error("E2E_BASE_URL is unset. Set it to your local studio origin, or set E2E_ALLOW_REMOTE=1 to deliberately target the remote app.");
        })());
   ```

   Opting in to the remote target stays possible; defaulting to it silently does
   not.

2. **Never let a count's exit status gate a command.** Any precondition check
   must assign and compare, not chain:

   ```bash
   cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' ')
   [ "$cnt" = "0" ] || { echo "NOT QUIET"; exit 1; }
   ```

   Mechanisable as a `scripts/harness/` lint over committed shell that flags
   `grep -c` (or `grep -vc`) on the left of `&&`.

**How to enable:** part 1 is a change to `artifacts/studio/playwright.config.ts`
plus updating the documented run recipe in `artifacts/studio/e2e/CLAUDE.md`.
Part 2 is a new check under `scripts/harness/`, wired into the `harness:*`
family.

**Status:** proposed — awaiting human approval (not enabled)
