# Cover Sign-in Page Implementation Plan

> **Execution:** agent-team dispatch per `AGENTS.md`. Never delegate to GLM (root hard rule #10).
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-csi-N -b csi-N-work <cover-sign-in tip>`) and dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-csi-N && git rev-parse --abbrev-ref HEAD` (must print `csi-N-work`, else STOP). The lead fast-forwards each commit onto `cover-sign-in`.
> - **Roles:** CSI-1 `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. CSI-2 `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - **Origin:** the user first folded this into Design Upgrade Phase 6 (autosave), then split it out on 2026-11-25 so it can ship without waiting for autosave. The only file both plans touch is `e2e/bundle6-ui-tweaks.spec.ts` (different tests: `/login` copy here, Save flows there); either can merge first.
> - Tasks run in order; every commit is green on its own. A stalled agent is resumed with `SendMessage`, never re-dispatched. Steps use checkbox (`- [ ]`) syntax.

**Status:** approved by the user 2026-11-25 (after a Codex adversarial review: approve, no findings); executes before Design Upgrade Phase 6.

**Goal:** signed-out visitors land on a public, book-cover-style sign-in page at `/` (and `/login`, `/register`, `/forgot-password`, `/reset-password`), built from the approved prototype v8, with log in / create account embedded in the cover's centre map strip, and one product name, "Network Design Labs", across the app.

**Architecture:** one shell component (`CoverShell` + a scoped `cover.css` ported from the prototype) and one page (`SignIn`, two modes) replace `AuthShell`, `Login` and `Register`; the world map is a static 46 KB SVG asset (no new runtime dependency); routes change only in `App.tsx`'s existing single `<Switch>`. **No API, OpenAPI, codegen, DB or solver change.**

**Tech stack:** React 18 + Vite, wouter, TanStack Query v5 (Orval client), vitest + RTL (jsdom), Playwright.

## Global Constraints

- **Design source:** `docs/superpowers/specs/2026-11-25-cover-sign-in-prototype.html` (approved v8) and decisions L1–L12 in CSI-1. Port, don't redesign.
- Never hand-edit `lib/api-zod/src/generated/**` or `lib/api-client-react/src/generated/**`. No task here needs a regen.
- Every auth failure the user sees goes through `describeWriteError` (`lib/describeWriteError.ts`), never `err.message`.
- Keep the one-`<Switch>` routing rule documented above `Gate` in `App.tsx`: every path is always a real `Route`; only its content branches on auth.
- Accessibility floor: every control keyboard-reachable with a visible focus ring; text ≥ 11 px; text contrast ≥ 4.5:1 (measured in the prototype: link green on paper 6.26:1, strip links 5.27:1+, footer white on band 5.1:1); external links announce "(opens in a new tab)"; route animation only under `prefers-reduced-motion: no-preference`.
- **Per-task obligations** (as in the Design Upgrade plans): karpathy + ponytail before code, ponytail-review before commit (qa-sdet exempt); sweep `artifacts/studio/src` and `artifacts/studio/e2e` for every removed testid/string; changelog `### CSI-N — …` in the same commit, numbers measured or `unknown`.
- **Gate (per task):** zero concurrent vitest (`cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || echo "vitest busy: $cnt"`), then `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`, one at a time, never `pkill`; check `docs/superpowers/flake-registry.md` before calling a failure a regression.
- **Commit:** assert not on `main`; static path list `P` (deletions included), `git add -A -- ${=P}`, check `git diff --cached --name-only` equals `P`, `git commit --only ${=P} -m "[CSI-N] …"` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task CSI-1: Cover sign-in page at signed-out `/`, `/login`, `/register` (and the password pages)

**Role:** `frontend-engineer`, reviewed by the lead on Opus plus `ponytail:ponytail-review`. The brief hands the engineer the test files explicitly. Invoke `andrej-karpathy-skills:karpathy-guidelines`, `ponytail:ponytail` and `impeccable` (its craft floor) before writing code, `ponytail:ponytail-review` before committing.

**Why this task exists:** an `impeccable` critique of the signed-out entry (2026-11-25, score 24/36) found: P1 there is no public landing page (signed-out `/` redirects to a log-in wall); P1 the product is never shown; P2 registering looks secondary, with no reassurance; P2 the chapter strip is unlabelled; P2 three product names (`Optimization Studio`, `SCND Optimization Studio`, `Network Design Labs`) and no `h1`; plus the "or" divider at `Login.tsx:69` measured 3.6:1 (`#83887a` on `#fdfdfc`). The user chose to fix all of them and approved prototype v8 after five feedback rounds. Mapping: P1 wall → signed-out `/` renders the page (Step 4); P1 product → the map strip + lede; P2 register → equal-weight toggle + the create hint; P2 strip → chapter names removed (L12); P2 names → L2 + `h1`; contrast → the divider no longer exists.

**Decisions L1–L12** (user-approved through the prototype rounds and the 2026-11-25 questions; the plan's only normative source for this page besides the prototype):

| ID | Decision |
|---|---|
| L1 | Look: the book cover's palette and imagery: green top band, mint graph-paper page with a washed world map, dots and white arcs; centre olive→teal strip with a white world map and routes. The form sits inside the strip, not in a separate card. Detector finding `codex-grid-background` is accepted (the brief asks for the cover's graph paper). |
| L2 | One product name, **Network Design Labs**, as the page `h1`, the `<title>`, the in-app fallback wordmark and the legal page's back link. The in-app kicker reads **Offered by Michael Watson** (user, 2026-11-25). |
| L3 | Log in / Create account is a toggle inside the strip; the create submit reads **Create account**. |
| L4 | The toggle is local state; `/login` and `/register` only pick the starting mode. |
| L5 | Hints: log-in `New here? Choose Create account above.`; create `Password: at least 8 characters. Free for students and instructors using the book; any email works, no invite code needed.` (user confirmed "Free for students"). |
| L6 | **Light only**, whatever the app theme or OS scheme. This reverses Phase 5's "auth pages follow the theme" for these routes; CSI-2 rewrites the two Phase 5 cases accordingly. |
| L7 | Consent checkbox and copy exactly as the live app's `TermsConsent` (WQF-B); submit disabled until it is ticked, in both modes. |
| L8 | Links on this page: surface-coloured text, semi-bold, no underline at rest, underline on hover/focus. External links open a new tab and carry a ↗ icon plus screen-reader "(opens in a new tab)". |
| L9 | "Supply Chain Network Design" links to `https://www.amazon.com/dp/B078PNRZJB`. |
| L10 | Forgot-password and reset-password use the same shell (user, 2026-11-25); `AuthShell` is deleted. |
| L11 | Footer: `Trouble signing in? Contact the developer`, a `mailto:` to the developer address `DeveloperCredit.tsx` already publishes. `DeveloperCredit` itself stays in `AppShell`. |
| L12 | No chapter names and no other authors on this page; "Offered by / Michael Watson" with LinkedIn and email icon links sits above the footer band. The lede's second sentence is one line from 860 px wide and wraps below that. |

**Source of truth:** the approved prototype v8, committed with this plan as `docs/superpowers/specs/2026-11-25-cover-sign-in-prototype.html` (open it in a browser; it loads d3 from a CDN only to draw the map, which this task replaces with a static asset). Port its CSS and markup; do not redesign. Where this task's text and the prototype disagree, the text wins (it records the user's later decisions, L1–L12).

**Files:**
- Create: `artifacts/studio/src/assets/world-land.svg` (generated once, Step 1; not under the generated-code dirs of hard rule #1)
- Create: `artifacts/studio/src/components/auth/CoverShell.tsx`, `artifacts/studio/src/components/auth/cover.css`
- Create: `artifacts/studio/src/pages/auth/SignIn.tsx` (replaces `Login.tsx` + `Register.tsx`)
- Create: `artifacts/studio/src/__tests__/SignIn.test.tsx` (every behavioural case of `Login.test.tsx` + `Register.test.tsx`, moved, plus the cases in Step 6)
- Modify: `artifacts/studio/src/App.tsx`, `artifacts/studio/src/components/auth/TermsConsent.tsx`, `artifacts/studio/src/pages/auth/ForgotPassword.tsx`, `artifacts/studio/src/pages/auth/ResetPassword.tsx`, `artifacts/studio/src/components/AppShell.tsx`, `artifacts/studio/src/pages/legal/LegalPage.tsx`, `artifacts/studio/index.html`
- Modify (tests): `src/__tests__/App.test.tsx`, `AppShell.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx`, and any other `src/` hit of the Step 7 sweep
- Delete: `src/components/auth/AuthShell.tsx`, `src/pages/auth/Login.tsx`, `src/pages/auth/Register.tsx`, `src/__tests__/Login.test.tsx`, `src/__tests__/Register.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing (studio-only; no API, OpenAPI, codegen, DB or solver change).
- Produces for CSI-2: testids `cover-shell`, `cover-strip`, `mode-login`, `mode-register` (`aria-pressed`), `cover-offered-by`, `cover-help`; kept testids `input-email`, `input-password`, `checkbox-accept-terms`, `link-consent-terms`, `link-consent-privacy`, `link-forgot-password`, `button-login` (log-in mode) / `button-register` (create mode), `alert-login-error`, `alert-register-error`, `alert-password-changed`, `text-password-hint`. Removed testids: `auth-shell`, `auth-cover`, `auth-labs-strip`, `auth-credit`.

- [ ] **Step 1: world map asset.** In an empty temp dir **outside the repo** (nothing is added to any `package.json`):

```bash
cd "$(mktemp -d)" && echo '{"type":"module","private":true}' > package.json
npm i --no-audit --no-fund d3-geo@3.1.1 topojson-client@3.1.0 world-atlas@2.0.2
cat > gen.mjs <<'EOF'
import { readFileSync } from "node:fs";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
const topo = JSON.parse(readFileSync("node_modules/world-atlas/land-110m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const g = land.features[0].geometry;
g.coordinates = g.coordinates.filter((poly) => Math.max(...poly[0].map((c) => c[1])) > -60); // drop Antarctica
// 1 unit = 1 degree: x = lon + 180, y = 90 - lat, so the page places routes without d3.
const projection = geoEquirectangular().scale(180 / Math.PI).translate([180, 90]);
const d = geoPath(projection).digits(1)(land);
process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180"><path d="${d}"/></svg>\n`);
EOF
node gen.mjs > /Users/shubhamkr/nos-csi-1/artifacts/studio/src/assets/world-land.svg
```

Expected (measured 2026-11-25 when this plan was written): 46 026 bytes, 16 718 gzipped. Paste the command and both measured sizes into the changelog entry.

- [ ] **Step 2: `CoverShell`.** `CoverShell({ children }: { children: ReactNode })` renders, top to bottom, the prototype's `.band` (decorative, `aria-hidden`), `.paper` (grid + washed world + dots + white arcs), `<main>` with `h1` "Network Design Labs", the lede, the `.strip` (`<section aria-label="Sign in or create an account" data-testid="cover-strip">`: the world picture on the left, `children` in `.access` on the right), the `.offered` block (`data-testid="cover-offered-by"`), and the footer band (`data-testid="cover-help"`).
  - **CSS:** `cover.css`, imported by `CoverShell.tsx`, is the prototype's `<style>` ported verbatim except: every rule scoped under `.cover` (the shell's root class), the `.review-bar`/`.tbd` rules dropped, the form controls restyled as in Step 3. Root: `<div className="cover" data-testid="cover-shell">`.
  - **Light only (L6):** `.cover` sets every colour it uses from its own variables (the prototype's `:root` block moved onto `.cover`, plus `color-scheme: light`), and overrides the two theme tokens its children read: `.cover .access { --link: #B8E6CB; --text-muted: #CFDDD0 }`, `.cover .paper { --link: #17661B }`, `.cover .band { --link: #FFFFFF }`. Nothing inside `.cover` may read a theme token that changes under `html.dark` (no shadcn `Input`, `Button`, `Alert`, `Checkbox` inside the shell).
  - **Map, no runtime dependency:** import `worldLand from "@/assets/world-land.svg"` (URL). The page wash is an `<img>` (or CSS `background-image`) inside the existing `svg.bg` layer at `opacity: .55` tinted with the prototype's `--land`; the strip picture is `<svg viewBox="12 12 348 134" preserveAspectRatio="xMidYMid meet">` containing `<image href={worldLand} width=360 height=180>` (the viewBox crops to the prototype's fit box, lon −168…180, lat 78…−56), with the routes, beads and bubbles drawn **in the same 360×180 degree space**: `const at = ([lon, lat]: [number, number]) => [lon + 180, 90 - lat] as const`. Port `places`, the seven route pairs, the bead spacing (`t = .12; t < 1; t += .19`) and the deterministic `rnd` (seed 7) from the prototype script; bead positions come from the quadratic Bézier formula, not `getTotalLength()` (jsdom has no SVG geometry). The white land fill is the image's `filter: invert(1)` or a pre-coloured `fill` in the asset; pick whichever keeps the asset single-sourced and say which in the report.
  - **Motion:** route draw-in only under `@media (prefers-reduced-motion: no-preference)`, exactly as the prototype; `--len` is the Bézier length estimate, rounded up.
  - **Copy, exact:** h1 `Network Design Labs`. Lede: `Hands-on labs for ` + book link + `.` + `<br>` + `<span class="one-line">Pick a model from the book, change it on the map, solve it with a real optimizer, and compare what moved.</span>`. Book link `href="https://www.amazon.com/dp/B078PNRZJB"`, text `Supply Chain Network Design`, ↗ icon, `<span class="sr">(opens in a new tab)</span>`, `target="_blank" rel="noopener noreferrer"` (L9). Offered block: `Offered by` / `Michael Watson` (spaced caps via CSS) / LinkedIn `https://www.linkedin.com/in/michael-watson-07600a1/` (new tab, `aria-label="Michael Watson on LinkedIn (opens in a new tab)"`) and `mailto:michael.watson@northwestern.edu` (`aria-label="Email Michael Watson"`). Footer: `Trouble signing in? ` + `<a href="mailto:shubham.shubham4995@gmail.com">Contact the developer</a>` (L11; the same address `DeveloperCredit.tsx` already publishes).

- [ ] **Step 3: `SignIn` page.** `SignIn({ initialMode }: { initialMode: "login" | "register" })` renders `CoverShell` with the prototype's `.access` content. One component, two modes, both mutation hooks (`useLoginUser`, `useRegisterUser`); mode is local state (no URL change on toggle, L4).

```tsx
const [mode, setMode] = useState(initialMode);
const create = mode === "register";
const mutation = create ? registerUser : loginUser;
// …
<ul className="modes" role="group" aria-label="Choose">
  <li><button type="button" data-testid="mode-login" aria-pressed={!create} onClick={() => setMode("login")}>Log in</button></li>
  <li><button type="button" data-testid="mode-register" aria-pressed={create} onClick={() => setMode("register")}>Create account</button></li>
</ul>
```

  - Fields are native `<input>` with the prototype's underline style, `id="email"` / `id="password"`, the current `autoComplete`, `required`, `maxLength={128}`, and in create mode `minLength={8}` + `autoComplete="new-password"`; labels via `<label htmlFor>`. Keep every existing behaviour of `Login.tsx` / `Register.tsx` unchanged: `acceptTerms: true` in the body, submit gated on the checkbox (`disabled` while unchecked or pending), `setQueryData(getGetCurrentAuthUserQueryKey(), data)` then `navigate("/", { replace: true })` (the race comment moves with it), `?reset=done` → `alert-password-changed` (log-in mode only), errors through `describeWriteError` with the two existing fallback sentences, `text-password-hint` "Password must be at least 8 characters." when 0 < length < 8 in create mode, button labels `Log in` / `Logging in…` and `Create account` / `Creating account…` (L3: was "Register"). Alerts are `<p role="alert">` styled in `cover.css`, not shadcn `Alert`. "Forgot?" is a wouter `<Link href="/forgot-password">`, hidden in create mode.
  - Hint under the form (L5): log-in mode `New here? Choose <strong>Create account</strong> above.`; create mode `Password: at least 8 characters. Free for students and instructors using the book; any email works, no invite code needed.` (verified 2026-11-25: `routes/auth.ts` has no invite or domain gate — re-check with `rg -n -i "invite|domain" artifacts/api-server/src/routes/auth.ts` and stop if one appeared).
  - `TermsConsent` (L7): keep its copy, testids and `{ checked, onCheckedChange }` props; swap the shadcn `Checkbox` for a native `<input type="checkbox" id="accept-terms">` (`onChange={(e) => onCheckedChange(e.target.checked)}`), give both links the ↗ icon and `<span className="sr">(opens in a new tab)</span>`, drop `className: "underline"` (L8: no underline at rest, underline on hover/focus via `cover.css`). It is used only inside the shell after this task (`rg -n TermsConsent artifacts/studio/src` to confirm).

- [ ] **Step 4: routes.** In `App.tsx`:

```tsx
<Route path="/login">{user ? <Redirect to="/" /> : <SignIn initialMode="login" />}</Route>
<Route path="/register">{user ? <Redirect to="/" /> : <SignIn initialMode="register" />}</Route>
…
<Route path="/">{user ? authedOnly(<Landing />, "Network Design Labs", true) : <SignIn initialMode="login" />}</Route>
```

Every other route keeps its `Redirect to="/login"` (one `<Switch>`, every path always a real `Route`: the comment above `Gate` still holds). `ForgotPassword` and `ResetPassword` render inside `CoverShell` (L10): their form replaces the mode toggle with a serif heading in the toggle's style (`Reset your password` / `Set a new password`), same field/button/alert styling, same testids and behaviour.

- [ ] **Step 5: one product name (L2).** Replace the remaining names with `Network Design Labs`: `index.html` `<title>` → `Network Design Labs`; `AppShell.tsx` kicker (both sites) `Optimization Studio by Prof. Michael Watson` → `Offered by Michael Watson` and the fallback wordmark `SCND Optimization Studio` → `Network Design Labs`; `LegalPage.tsx` `Back to Optimization Studio` → `Back to Network Design Labs`. Confirm with `rg -n "Optimization Studio" artifacts/studio/src artifacts/studio/index.html` → no hits outside tests you then update.

- [ ] **Step 6: tests.** `SignIn.test.tsx` carries every case of the two deleted files (rename `Register` button text to `Create account`; drop only the assertions about removed layout: `auth-cover` class, labs strip, "Optimization Studio", "By Prof. Michael Watson", `auth-credit`), plus:
  - `/` signed out renders `SignIn` in log-in mode, not a redirect (`App.test.tsx`: replace "never shows NotFound at / while unauthenticated (redirects toward /login instead)").
  - The toggle: clicking `mode-register` sets `aria-pressed`, swaps the submit to `button-register` "Create account", hides `link-forgot-password`, shows the create hint; and back.
  - `initialMode="register"` starts in create mode (`/register`).
  - The book, LinkedIn, Terms and Privacy links have `target="_blank"`, `rel` containing `noopener`, and the `(opens in a new tab)` text; the email link is `mailto:michael.watson@northwestern.edu`.
  - Light only: render with `document.documentElement.classList.add("dark")`; no element inside `cover-shell` uses a class from shadcn `Input`/`Button`/`Alert` (assert `cover-shell` contains no `[data-slot]`, or the equivalent marker those components carry — check which one they set and name it in the test).
  - Run `SignIn.test.tsx`, `App.test.tsx`, `AppShell.test.tsx`, `ForgotPassword.test.tsx`, `ResetPassword.test.tsx`, `LegalPage` tests if any: all green.

- [ ] **Step 7: sweep and verify.** `rg -n -e auth-shell -e auth-cover -e auth-labs-strip -e auth-credit -e "Optimization Studio" -e "By Prof" -e "No account" -e "Already have an account" -e AuthShell -e "pages/auth/(Login|Register)" artifacts/studio/src` → fix every hit. List every `artifacts/studio/e2e/` hit for CSI-2 (verified 2026-11-25: `bundle4-auth-landing`, `bundle6-ui-tweaks` :349-371, `design-system` :157-167, `design-upgrade-p1` :132, `design-upgrade-p2` :436/591, `design-upgrade-p5` :282/341/413/445-461/835/869/990, `password-reset`, `terms-consent`). Then look at it: `impeccable shot` of `/`, `/register`, `/forgot-password` at 1440×900, 1024×768, 390×844 against local servers, in light **and** with the OS in dark, and compare with the prototype; attach the shots to the report. Run `impeccable detect` on `CoverShell.tsx`, `cover.css`, `SignIn.tsx`; the `codex-grid-background` finding is accepted (L1: the cover's graph paper), anything else is fixed or reported.

- [ ] **Step 8:** per-task gate, then commit `[CSI-1] cover sign-in page at signed-out /, /login, /register` with the changelog entry (Step 1 sizes, the screenshot list, the e2e inventory).
---

### Task CSI-2: Real-browser QA and auth sibling e2e sweep (qa-sdet)

**Role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected, ignore it and say so), reviewed by a separate `fable` reviewer agent.

**Files:**
- Create: `artifacts/studio/e2e/cover-sign-in.spec.ts`
- Modify: every auth spec from CSI-1's inventory (verified 2026-11-25: `bundle4-auth-landing`, `bundle6-ui-tweaks` :349-371, `design-system` :157-167, `design-upgrade-p1` :132, `design-upgrade-p2` :436/591, `design-upgrade-p5` :282/341/413/445-461/835/869/990, `password-reset`, `terms-consent`), plus any further hit CSI-1's report lists
- Modify: `docs/superpowers/flake-registry.md` (sightings only), `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: auth sibling sweep.** Replace `auth-shell`/`auth-cover`/`auth-labs-strip`/`auth-credit` and old-copy assertions with the cover testids and copy (CSI-1 Interfaces, L2–L12); `Register` link clicks become `mode-register`; the Phase 5 "both themes" cases for `/login` and `/register` (`design-upgrade-p5` :869 and the theme-toggle loop at :341) assert the page stays light under `colorScheme: "dark"` and stays legible (L6), instead of asserting dark surfaces. Keep the 11 px floor (`design-upgrade-p1` :132). Run each changed spec green.

- [ ] **Step 2: `cover-sign-in.spec.ts`** (local servers per `e2e/CLAUDE.md`, `E2E_BASE_URL` set; registration through the UI or `/api/auth/register` with `acceptTerms: true`; signed out unless stated):
  - `/` renders `cover-shell` (no redirect, URL stays `/`), `h1` "Network Design Labs", `<title>` "Network Design Labs"; `/login` and `/register` render the same shell in log-in and create mode.
  - **Round trips from `/`:** toggle to create, tick consent, register a fresh email → lands on the chapter Landing; log out → `/login`; log in from `/` with that user → Landing. Submit stays disabled until consent is ticked, in both modes.
  - The book link, Terms, Privacy and LinkedIn each open a **new page** (`context.waitForEvent("page")`) at the expected URL; the form tab keeps its typed email.
  - **Forgot/reset** render inside `cover-shell` and keep their flows (`password-reset.spec.ts` covers the mail path).
  - **Keyboard:** Tab order is mode toggle → email → Forgot? → password → consent → Terms → Privacy → submit; every stop shows a visible focus ring (screenshot each).
  - **Light only (L6):** under `colorScheme: "dark"` and with `nos:theme-pref` = `dark` in localStorage, the paper background computes to `rgb(234, 243, 232)`; `legibilityScan` finds nothing under its threshold.
  - **Layout:** at 1440, 1024 and 390 widths no horizontal scroll (`scrollWidth <= clientWidth`); at ≥ 860 px the lede's second sentence is one line (its `getClientRects().length === 1`), at 390 px it wraps; no text under 11 px.
  - **Reduced motion:** with `reducedMotion: "reduce"` the route paths have no running animation.
  - Attach full-page screenshots of `/`, `/register`, `/forgot-password` at the three widths, light and dark OS scheme.
- [ ] **Step 3: gates.** `pnpm gate`; `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; `python3 artifacts/api-server/src/solver/tests/e2e_journey.py http://localhost:3001 auth` (the auth journey registers and logs in through the API this page calls). Record each number from the run in the changelog; never estimate.
- [ ] **Step 4:** commit `[CSI-2] cover sign-in real-browser QA and auth sibling e2e sweep` with the changelog entry.

---

## Branch setup (once, before CSI-1)

```bash
cd /Users/shubhamkr/network-optimization-studio
git fetch origin
git merge-base --is-ancestor origin/main main && echo "local main contains origin/main"   # must print; else STOP
git merge-base --is-ancestor origin/main du-6-landing-plan && echo "plan branch contains origin/main"   # must print; else rebase the plan branch first
git branch cover-sign-in du-6-landing-plan               # the plan commits ride in with this branch (plans were never merged to main on their own); never switch the shared checkout
git worktree add --lock /Users/shubhamkr/nos-csi-1 -b csi-1-work cover-sign-in
```

## Close-out

1. `superpowers:finishing-a-development-branch`, then `/harness-retro CSI`, then **STOP for merge approval**. Merge, whole-branch review on the merged state, push and deploy are each separately approved (root Branch discipline).
2. **Deploy is `nos-studio` only**: confirm with `pnpm deploy:preflight -- <deployed-sha>..HEAD` on the full diff (no pathspec) and include its checklist in the deploy approval request. Re-fetch `origin/main` immediately before the trigger. Pushing `main` is deploy-adjacent for `nos-studio`; say so when asking.
3. Deploy notes for the user: signed-out visitors see the cover sign-in page at `/` instead of a redirect to `/login`; every page reads "Network Design Labs"; the auth pages are light-only.
4. Whichever of this plan and Design Upgrade Phase 6 merges second re-runs its full gate on top of the first (the shared `bundle6-ui-tweaks.spec.ts` may need a trivial rebase).

## Self-review

- **Coverage:** every critique finding maps to a step (task preamble); L1–L12 each land in a step (L1 Step 2/7, L2 Step 5, L3–L5 Step 3, L6 Step 2 + CSI-2 Step 2, L7–L8 Step 3, L9 Step 2, L10 Step 4, L11–L12 Step 2); every removed testid and copy string is swept in `src/` (CSI-1 Step 7) and `e2e/` (CSI-2 Step 1); the map ships as a 46 KB static asset with no new dependency (CSI-1 Step 1).
- **Type consistency:** `CoverShell({ children })`, `SignIn({ initialMode: "login" | "register" })`, `TermsConsent({ checked, onCheckedChange })` (props unchanged) are defined in CSI-1 and used only there; testids listed in CSI-1 Interfaces are the ones CSI-2 asserts.
